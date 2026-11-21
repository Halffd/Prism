//! The `/chat` route: a ChatGPT-style chat over the configured Prism
//! provider — a conversation-history rail, a centered transcript with
//! avatars and code blocks, hover actions (copy / regenerate) and a
//! rounded pill composer. Conversations persist to localStorage.
//!
//! The browser fetches; `prism-core` builds the wire body and decodes
//! the SSE/NDJSON stream into `StreamEvent`s, which land in the open
//! conversation one chunk at a time.

use dioxus::prelude::*;
use prism_core::client::StreamEvent;

use crate::api;
use crate::icons::Icon;
use crate::state::{ChatEntry, StudioState, PRISM_API_ID};
use crate::Route;

// ---------------------------------------------------------------------------
// Home-state suggestions (video-studio themed)
// ---------------------------------------------------------------------------

const SUGGESTIONS: [(&str, &str); 4] = [
    ("clapperboard", "Storyboard a 5-shot chase scene"),
    ("wand", "Write a Seedance prompt for a neon city flyover"),
    ("camera", "Explain the 180° rule in plain words"),
    ("film", "Plan a shot list for a product teaser"),
];

pub fn Chat() -> Element {
    let mut state = use_context::<StudioState>();

    let mut draft = use_signal(String::new);
    let error = use_signal(|| Option::<String>::None);
    let mut rail_open = use_signal(|| false);
    let copied = use_signal(|| Option::<usize>::None);

    let draft_v = draft();
    let error_v = error();
    let rail_open_v = rail_open();
    let copied_v = copied();

    let streaming_v = state.is_streaming();
    let conversations = state.list_conversations();
    let active_id = state.active_chat_id();
    let entries = state.transcript();
    let title = state.conversation_title();
    let settings_v = state.read_settings();

    let provider_label = settings_v.provider_label();
    let header_title = if active_id.is_empty() {
        "New chat".to_string()
    } else if title.is_empty() {
        "New chat".to_string()
    } else {
        title
    };
    let rail_style = if rail_open_v {
        "fixed inset-y-0 left-0 z-40 flex shadow-[0_0_80px_rgba(0,0,0,0.9)]"
    } else {
        "hidden"
    };
    let hint_text =
        format!("Prism is wired to {provider_label}. It can make mistakes — verify what matters.");

    // Keep the newest message in view while streaming or navigating.
    use_effect(move || {
        let last_len = state
            .transcript()
            .last()
            .map(|entry| entry.content.len())
            .unwrap_or(0);
        let _ = last_len;
        if let Some(document) = web_sys::window().and_then(|window| window.document()) {
            if let Some(element) = document.get_element_by_id("chat-end") {
                let _ = element.scroll_into_view();
            }
        }
    });

    rsx! {
        section { class: "flex min-h-[75vh] min-w-0 flex-1 flex-col lg:h-full lg:min-h-0 lg:flex-row",

            // ---- Mobile backdrop for the conversations rail ---------------
            if rail_open_v {
                div {
                    class: "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden",
                    onclick: move |_| rail_open.set(false),
                }
            }

            // ---- Conversations rail (ChatGPT-style history) ---------------
            aside { class: "shrink-0 flex-col border-r border-edge bg-app lg:static lg:flex lg:w-[260px] {rail_style}",

                div { class: "flex h-14 shrink-0 items-center gap-2 border-b border-edge px-3",
                    div { class: "grid size-7 place-items-center rounded-lg bg-linear-to-br from-accent1 to-accent2",
                        Icon { name: "clapperboard", class: "size-4 text-white", stroke_width: 1.9 }
                    }
                    span { class: "text-[13px] font-semibold text-white", "Prism" }
                    IconButtonGhost {
                        icon: "close",
                        label: "Close conversations",
                        class: "ml-auto lg:hidden",
                        on_press: move |_| rail_open.set(false),
                    }
                }

                div { class: "p-2",
                    button {
                        class: "flex w-full items-center gap-2 rounded-xl border border-edge bg-input/60 px-3 py-2.5 text-[12.5px] font-medium text-white transition-colors hover:border-white/20 hover:bg-input",
                        onclick: move |_| {
                            state.go_home();
                            rail_open.set(false);
                        },
                        Icon { name: "pencil", class: "size-4 text-sub", stroke_width: 1.8 }
                        "New chat"
                    }
                }

                div { class: "min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3",
                    if conversations.is_empty() {
                        div { class: "px-2.5 pt-2 text-[11.5px] text-sub/60",
                            "No conversations yet"
                        }
                    }
                    for conv in conversations.iter() {
                        {
                            let id_select = conv.id.clone();
                            let id_delete = conv.id.clone();
                            let is_active = conv.id == active_id;
                            let row_title = if conv.title.is_empty() {
                                "New chat".to_string()
                            } else {
                                conv.title.clone()
                            };
                            let mut state_row = state;
                            let mut rail_close = rail_open;
                            rsx! {
                                div {
                                    key: "{conv.id}",
                                    class: if is_active {
                                        "group flex w-full cursor-pointer items-center gap-2 rounded-lg bg-input px-2.5 py-2 text-white"
                                    } else {
                                        "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sub hover:bg-white/5 hover:text-white"
                                    },
                                    onclick: move |_| {
                                        state_row.select_chat(id_select.clone());
                                        rail_close.set(false);
                                    },
                                    span { class: "min-w-0 flex-1 truncate text-left text-[12.5px]",
                                        "{row_title}"
                                    }
                                    button {
                                        class: "shrink-0 rounded-md p-1 text-sub/60 opacity-0 transition-all hover:bg-white/10 hover:text-white group-hover:opacity-100",
                                        "aria-label": "Delete conversation",
                                        onclick: move |e: Event<MouseData>| {
                                            e.stop_propagation();
                                            state_row.delete_chat(id_delete.clone());
                                        },
                                        Icon { name: "trash", class: "size-3.5" }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ---- Chat column ----------------------------------------------
            div { class: "flex min-w-0 flex-1 flex-col",

                // Header
                div { class: "flex h-14 shrink-0 items-center gap-2 border-b border-edge px-3",
                    IconButtonGhost {
                        icon: "panel-left",
                        label: "Open conversations",
                        class: "lg:hidden",
                        on_press: move |_| rail_open.set(true),
                    }
                    span { class: "min-w-0 flex-1 truncate text-[13px] font-semibold text-white",
                        "{header_title}"
                    }
                    Link {
                        to: Route::Settings {},
                        class: "hidden max-w-[220px] items-center gap-1.5 truncate rounded-full border border-edge bg-input px-3 py-1.5 text-[11px] text-sub transition-colors hover:border-white/20 hover:text-white sm:flex",
                        Icon { name: "sparkles", class: "size-3 shrink-0 text-accent" }
                        "{provider_label}"
                    }
                    button {
                        class: "flex items-center gap-1.5 rounded-xl border border-edge bg-input/60 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:border-white/20 hover:bg-input",
                        onclick: move |_| state.go_home(),
                        Icon { name: "pencil", class: "size-3.5 text-sub" }
                        "New chat"
                    }
                }

                // Error banner
                if let Some(message) = error_v {
                    div { class: "mx-4 mt-3 flex items-center gap-2 rounded-xl border border-pink-500/40 bg-pink-500/10 px-3 py-2.5",
                        Icon { name: "close", class: "size-4 shrink-0 text-pink-400" }
                        span { class: "flex-1 text-[12px] text-pink-200", "{message}" }
                        Link {
                            to: Route::Settings {},
                            class: "shrink-0 rounded-lg bg-pink-500/20 px-2.5 py-1 text-[11px] font-medium text-pink-100 hover:bg-pink-500/30",
                            "Open Settings"
                        }
                    }
                }

                // Transcript / home state
                div { class: "min-h-0 flex-1 overflow-y-auto",
                    if entries.is_empty() {
                        ChatHome {}
                    } else {
                        div { class: "mx-auto flex max-w-3xl flex-col gap-7 px-4 py-6",
                            for (index, entry) in entries.iter().enumerate() {
                                {
                                    let is_last = index == entries.len() - 1;
                                    let row_streaming = streaming_v && is_last;
                                    let can_regen =
                                        !streaming_v && is_last && !entry.is_user()
                                            && !entry.content.is_empty();
                                    let is_copied = copied_v == Some(index);
                                    let text_for_copy = entry.content.clone();
                                    let mut copied_set = copied;
                                    rsx! {
                                        MessageRow {
                                            key: "{index}",
                                            entry: entry.clone(),
                                            streaming: row_streaming,
                                            can_regenerate: can_regen,
                                            copied: is_copied,
                                            on_copy: move |_: ()| {
                                                copy_to_clipboard(&text_for_copy);
                                                copied_set.set(Some(index));
                                            },
                                            on_regenerate: move |_: ()| {
                                                regenerate(state, error);
                                            },
                                        }
                                    }
                                }
                            }
                            div { id: "chat-end" }
                        }
                    }
                }

                // Composer
                div { class: "shrink-0 px-4 pb-3 pt-2",
                    div { class: "mx-auto max-w-3xl",
                        div { class: "flex items-end gap-2 rounded-[26px] border border-edge bg-input/70 p-2 pl-4 shadow-[0_8px_32px_rgba(0,0,0,0.45)] transition-colors focus-within:border-accent/50",
                            textarea {
                                class: "max-h-40 min-h-[28px] w-full flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-relaxed text-white outline-none placeholder:text-sub/50",
                                rows: "1",
                                placeholder: "Message Prism…",
                                value: "{draft_v}",
                                oninput: move |e| draft.set(e.value()),
                                onkeydown: move |e: Event<KeyboardData>| {
                                    if e.key() == Key::Enter && !e.modifiers().contains(Modifiers::SHIFT) {
                                        e.prevent_default();
                                        let text = draft();
                                        draft.set(String::new());
                                        send_message(state, error, text);
                                    }
                                },
                            }
                            if streaming_v {
                                button {
                                    class: "grid size-9 shrink-0 place-items-center rounded-full border border-edge bg-panel text-sub transition-colors hover:border-white/20 hover:text-white",
                                    "aria-label": "Stop generating",
                                    onclick: move |_| {
                                        if let Some(handle) = state.abort_handle() {
                                            handle.abort();
                                        }
                                    },
                                    Icon { name: "stop", class: "size-4" }
                                }
                            } else {
                                button {
                                    class: "grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-b from-accent1 to-accent2 text-white shadow-[0_4px_20px_rgba(176,38,255,0.4)] transition-all duration-200 hover:brightness-110 active:scale-[0.96] disabled:opacity-40 disabled:hover:brightness-100",
                                    "aria-label": "Send message",
                                    disabled: draft_v.trim().is_empty(),
                                    onclick: move |_| {
                                        let text = draft();
                                        draft.set(String::new());
                                        send_message(state, error, text);
                                    },
                                    Icon { name: "send", class: "size-4", stroke_width: 1.9 }
                                }
                            }
                        }
                        div { class: "mt-2 text-center text-[10.5px] text-sub/60",
                            "{hint_text}"
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Home state (ChatGPT-style greeting + suggestions)
// ---------------------------------------------------------------------------

fn ChatHome() -> Element {
    let state = use_context::<StudioState>();
    let error = use_signal(|| Option::<String>::None);

    rsx! {
        div { class: "mx-auto flex max-w-3xl flex-col items-center px-4 pb-6 pt-[10vh] text-center",
            div { class: "grid size-14 place-items-center rounded-2xl border border-accent/40 bg-accent/10 shadow-[0_0_32px_rgba(176,38,255,0.25)]",
                Icon { name: "sparkles", class: "size-6 text-accent", stroke_width: 1.8 }
            }
            h1 { class: "mt-4 text-[22px] font-semibold text-white",
                "What can I help with?"
            }
            p { class: "mt-1.5 text-[12.5px] text-sub",
                "Write, storyboard and plan — straight from the studio."
            }
            div { class: "mt-7 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2",
                for (icon, text) in SUGGESTIONS {
                    {
                        let state_chip = state;
                        let text_owned = text.to_string();
                        let err_chip = error;
                        rsx! {
                            button {
                                key: "{text}",
                                class: "flex items-center gap-2.5 rounded-xl border border-edge bg-input/50 px-3.5 py-3 text-left text-[12.5px] text-sub transition-all hover:border-white/20 hover:bg-input hover:text-white",
                                onclick: move |_| {
                                    let text = text_owned.clone();
                                    send_message(state_chip, err_chip, text);
                                },
                                Icon { name: icon, class: "size-4 shrink-0 text-accent/80", stroke_width: 1.8 }
                                span { class: "min-w-0 flex-1", "{text}" }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Message row
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
struct MessageRowProps {
    entry: ChatEntry,
    streaming: bool,
    can_regenerate: bool,
    copied: bool,
    on_copy: EventHandler<()>,
    on_regenerate: EventHandler<()>,
}

fn MessageRow(props: MessageRowProps) -> Element {
    let segments = split_code(&props.entry.content);
    let empty_typing = props.streaming && props.entry.content.is_empty();
    let copy_icon = if props.copied { "check" } else { "copy" };

    if props.entry.is_user() {
        rsx! {
            div { class: "flex justify-end",
                div { class: "max-w-[85%] rounded-3xl bg-input px-4 py-2.5 text-[13.5px] leading-relaxed text-white",
                    span { class: "whitespace-pre-wrap", "{props.entry.content}" }
                }
            }
        }
    } else {
        rsx! {
            div { class: "group flex gap-3",
                div { class: "grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-accent1 to-accent2 shadow-[0_0_16px_rgba(176,38,255,0.35)]",
                    Icon { name: "sparkles", class: "size-3.5 text-white", stroke_width: 1.9 }
                }
                div { class: "min-w-0 flex-1 space-y-2.5 pt-0.5",
                    if empty_typing {
                        span { class: "animate-pulse text-[13px] text-sub", "Prism is thinking…" }
                    } else {
                        for (segment_index, segment) in segments.iter().enumerate() {
                            {
                                let text = segment.text.clone();
                                let is_code = segment.code;
                                rsx! {
                                    if is_code {
                                        pre {
                                            key: "{segment_index}",
                                            class: "overflow-x-auto rounded-xl border border-edge bg-app p-3 text-[12px] leading-relaxed text-white/80",
                                            code { class: "font-mono whitespace-pre", "{text}" }
                                        }
                                    } else {
                                        p {
                                            key: "{segment_index}",
                                            class: "text-[13.5px] leading-relaxed text-white/90",
                                            span { class: "whitespace-pre-wrap", "{text}" }
                                        }
                                    }
                                }
                            }
                        }
                        if props.streaming {
                            span { class: "ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" }
                        }
                    }

                    // Hover actions (copy / regenerate)
                    if !props.streaming && !props.entry.content.is_empty() {
                        div { class: "-ml-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100",
                            button {
                                class: "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-sub transition-colors hover:bg-white/5 hover:text-white",
                                "aria-label": "Copy response",
                                onclick: move |_| props.on_copy.call(()),
                                Icon {
                                    name: copy_icon,
                                    class: "size-3.5",
                                    stroke_width: 1.8,
                                }
                            }
                            if props.can_regenerate {
                                button {
                                    class: "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-sub transition-colors hover:bg-white/5 hover:text-white",
                                    "aria-label": "Regenerate response",
                                    onclick: move |_| props.on_regenerate.call(()),
                                    Icon { name: "refresh", class: "size-3.5", stroke_width: 1.8 }
                                    "Regenerate"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Content rendering: fenced code blocks
// ---------------------------------------------------------------------------

/// A segment of assistant content: plain text or a fenced code block.
struct Segment {
    code: bool,
    text: String,
}

/// Split assistant content on ``` fences into text/code segments. An
/// unterminated fence (mid-stream) renders its remainder as code, which
/// is exactly how a partial response should look.
fn split_code(content: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut rest = content;
    loop {
        match rest.find("```") {
            None => {
                if !rest.is_empty() {
                    segments.push(Segment {
                        code: false,
                        text: rest.to_string(),
                    });
                }
                break;
            }
            Some(open) => {
                let (before, after) = rest.split_at(open);
                if !before.is_empty() {
                    segments.push(Segment {
                        code: false,
                        text: before.to_string(),
                    });
                }
                let after = &after[3..];
                match after.find("```") {
                    None => {
                        let code = strip_language(after);
                        if !code.is_empty() {
                            segments.push(Segment { code: true, text: code });
                        }
                        break;
                    }
                    Some(close) => {
                        let (code, tail) = after.split_at(close);
                        let code = strip_language(code);
                        if !code.is_empty() {
                            segments.push(Segment { code: true, text: code });
                        }
                        rest = &tail[3..];
                    }
                }
            }
        }
    }
    segments
}

/// Drop a short first line (the fence's language tag) from code content.
fn strip_language(code: &str) -> String {
    let trimmed = code.strip_prefix('\n').unwrap_or(code);
    match trimmed.find('\n') {
        Some(index) if index <= 16 => trimmed[index + 1..].to_string(),
        _ => trimmed.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

fn copy_to_clipboard(text: &str) {
    if let Some(window) = web_sys::window() {
        let clipboard = window.navigator().clipboard();
        let _ = clipboard.write_text(text);
    }
}

/// Re-run the last user turn: drop the trailing assistant entry and the
/// user entry, then send the same text again through the normal path.
fn regenerate(mut state: StudioState, error: Signal<Option<String>>) {
    if state.is_streaming() {
        return;
    }
    let mut entries = state.transcript();
    if entries.last().map(|e| e.is_user()).unwrap_or(true) {
        return;
    }
    entries.pop(); // assistant
    let user_text = entries.last().filter(|e| e.is_user()).map(|e| e.content.clone());
    let Some(user_text) = user_text else {
        return;
    };
    state.pop_last(); // assistant
    state.pop_last(); // user (send_message re-adds it)
    send_message(state, error, user_text);
}

/// Push the user turn, open the stream for the configured provider and
/// pump decoded events into the transcript. Free function because the
/// shared state is `Copy` — every handler can call it directly.
fn send_message(mut state: StudioState, mut error: Signal<Option<String>>, text: String) {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() || state.is_streaming() {
        return;
    }
    let settings_v = state.read_settings();
    if settings_v.needs_key() && settings_v.api_key.trim().is_empty() {
        error.set(Some(
            "No API key configured for this provider — open Settings to add one.".to_string(),
        ));
        return;
    }
    error.set(None);

    // History + the new user turn (the empty assistant slot is pushed
    // after this snapshot).
    let messages = state.chat_messages(&trimmed);
    state.push_user(trimmed);
    state.persist();

    state.streaming.set(true);
    let abort = api::Abort::new();
    state.abort.set(Some(abort.clone()));
    let settings_now = state.read_settings();

    spawn(async move {
        let outcome: Result<(), String> = if settings_now.provider_id == PRISM_API_ID {
            // Self-hosted prism-api: single-shot POST /api/chat.
            let content = messages
                .last()
                .map(|message| message.content.clone())
                .unwrap_or_default();
            api::prism_api_chat(
                &settings_now.base_url,
                &settings_now.api_key,
                &content,
                Some(&abort),
            )
            .await
            .map(|reply| state.set_last(reply))
        } else {
            let opened = if settings_now.is_ollama() {
                api::open_ollama_stream(
                    &settings_now.base_url,
                    &settings_now.model,
                    &messages,
                    Some(abort.clone()),
                )
                .await
            } else {
                api::open_chat_stream(
                    &settings_now.base_url,
                    &settings_now.api_key,
                    &settings_now.model,
                    &messages,
                    Some(abort.clone()),
                )
                .await
            };
            match opened {
                Err(e) => Err(e),
                Ok(mut stream) => {
                    let mut result = Ok(());
                    while let Some(event) = stream.next().await {
                        match event {
                            Ok(StreamEvent::Chunk(chunk)) => {
                                state.append_last(&chunk);
                            }
                            Ok(_) => break,
                            Err(e) => {
                                // A Stop press aborts the fetch mid-read;
                                // that ends the stream gracefully instead
                                // of surfacing an error.
                                result = if stream.is_aborted() { Ok(()) } else { Err(e) };
                                break;
                            }
                        }
                    }
                    result
                }
            }
        };

        if let Err(e) = outcome {
            state.append_last(&format!("\n\n⚠️ {e}"));
        }
        state.abort.set(None);
        state.streaming.set(false);
        state.persist();
    });
}

// ---------------------------------------------------------------------------
// Small ghost icon button (rail chrome)
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
struct IconButtonGhostProps {
    icon: &'static str,
    label: &'static str,
    #[props(default)]
    class: &'static str,
    on_press: EventHandler<()>,
}

fn IconButtonGhost(props: IconButtonGhostProps) -> Element {
    rsx! {
        button {
            class: "grid size-8 shrink-0 place-items-center rounded-lg text-sub transition-colors hover:bg-white/5 hover:text-white {props.class}",
            "aria-label": "{props.label}",
            onclick: move |_| props.on_press.call(()),
            Icon { name: props.icon, class: "size-4" }
        }
    }
}
