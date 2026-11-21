//! The `/settings` route: connect the studio to the Prism system.
//!
//! Providers come straight from `prism_core::providers::PROVIDERS` (plus
//! the self-hosted prism-api entry). Settings persist to localStorage;
//! "Test connection" hits the OpenAI-compatible `/models` endpoint and
//! decodes the reply with the core's parser.

use dioxus::prelude::*;

use crate::api;
use crate::components::ui::DropdownMenu;
use crate::icons::Icon;
use crate::state::{PrismSettings, StudioState, PRISM_API_ID};

pub fn Settings() -> Element {
    let mut state = use_context::<StudioState>();

    let current = state.read_settings();
    let mut provider_id = use_signal(|| current.provider_id.clone());
    let mut base_url = use_signal(|| current.base_url.clone());
    let mut model = use_signal(|| current.model.clone());
    let mut api_key = use_signal(|| current.api_key.clone());
    let mut status = use_signal(|| Option::<(bool, String)>::None);

    let provider_id_v = provider_id();
    let base_url_v = base_url();
    let model_v = model();
    let api_key_v = api_key();
    let status_v = status();

    let providers = PrismSettings::all_providers();
    let current_label = providers
        .iter()
        .find(|(id, _)| *id == provider_id_v)
        .map(|(_, label)| label.clone())
        .unwrap_or_else(|| provider_id_v.clone());
    let is_prism_api = provider_id_v == PRISM_API_ID;
    let preset = PrismSettings::for_provider(&provider_id_v);
    let key_hint = if is_prism_api {
        "Optional bearer token for the prism-api server"
    } else if preset.needs_key() {
        "Required — stored only in this browser (localStorage), never sent anywhere else"
    } else {
        "Not required for local servers"
    };
    let base_hint = if is_prism_api {
        "Root URL of your self-hosted prism-api server"
    } else {
        "OpenAI-compatible base URL, including the version segment"
    };
    let status_style = match status_v {
        Some((true, _)) => "text-emerald-400",
        Some((false, _)) => "text-pink-400",
        None => "",
    };

    rsx! {
        section { class: "flex min-h-[75vh] min-w-0 flex-1 flex-col overflow-y-auto lg:h-full",
            div { class: "mx-auto w-full max-w-xl px-4 py-6",

                // ---- Header --------------------------------------------------
                div { class: "mb-5",
                    h1 { class: "text-[18px] font-semibold text-white", "Settings" }
                    p { class: "mt-1 text-[12.5px] text-sub",
                        "Connect the studio to the Prism system. Requests go straight from your browser to the provider — prism-core builds the wire bodies and decodes the streams."
                    }
                }

                // ---- Connection card ------------------------------------------
                div { class: "space-y-4 rounded-xl border border-edge bg-input/70 p-4",

                    // Provider
                    div { class: "space-y-1.5",
                        div { class: "text-[11px] font-medium text-sub", "Provider" }
                        DropdownMenu {
                            options: providers.iter().map(|(_, label)| label.clone()).collect(),
                            selected: current_label.clone(),
                            on_select: move |label: String| {
                                let picked = providers
                                    .iter()
                                    .find(|(_, candidate)| *candidate == label)
                                    .map(|(id, _)| id.clone())
                                    .unwrap_or_else(|| PRISM_API_ID.to_string());
                                let preset = PrismSettings::for_provider(&picked);
                                provider_id.set(picked);
                                base_url.set(preset.base_url);
                                model.set(preset.model);
                                api_key.set(String::new());
                                status.set(None);
                            },
                            menu_class: "left-0 right-0 top-full mt-1",
                            button_class: "w-full",
                            div { class: "flex w-full items-center justify-between gap-2 rounded-lg border border-edge bg-panel px-3 py-2.5 text-left transition-colors hover:border-white/20",
                                span { class: "text-[13px] font-medium text-white", "{current_label}" }
                            }
                        }
                    }

                    Field {
                        label: "Base URL",
                        value: base_url_v,
                        placeholder: "https://api.example.com/v1",
                        hint: base_hint,
                        oninput: move |value: String| base_url.set(value),
                    }

                    Field {
                        label: "Model",
                        value: model_v,
                        placeholder: "gpt-4o",
                        hint: "Sent as the `model` field of the chat request",
                        oninput: move |value: String| model.set(value),
                    }

                    Field {
                        label: "API key",
                        value: api_key_v,
                        placeholder: "sk-…",
                        password: true,
                        hint: key_hint,
                        oninput: move |value: String| api_key.set(value),
                    }
                }

                // ---- Actions ---------------------------------------------------
                div { class: "mt-4 flex flex-wrap items-center gap-2",
                    button {
                        class: "rounded-xl bg-linear-to-b from-accent1 to-accent2 px-4 py-2 text-[12px] font-semibold text-white shadow-[0_4px_24px_rgba(176,38,255,0.35)] transition-all duration-200 hover:brightness-110 active:scale-[0.98]",
                        onclick: move |_| {
                            let next = PrismSettings {
                                provider_id: provider_id(),
                                base_url: base_url().trim().to_string(),
                                model: model().trim().to_string(),
                                api_key: api_key(),
                            };
                            let saved = state.save_settings(next);
                            let message = if saved {
                                "Settings saved — they persist in this browser."
                            } else {
                                "Applied for this session (localStorage unavailable)."
                            };
                            status.set(Some((true, message.to_string())));
                        },
                        "Save"
                    }
                    if !is_prism_api {
                        button {
                            class: "rounded-xl border border-edge bg-input/70 px-4 py-2 text-[12px] font-medium text-sub transition-colors hover:border-white/20 hover:text-white",
                            onclick: move |_| {
                                let url = base_url();
                                let key = api_key();
                                status.set(Some((true, "Testing connection…".to_string())));
                                spawn(async move {
                                    match api::fetch_models(&url, &key).await {
                                        Ok(models) => status.set(Some((
                                            true,
                                            format!("Connected — {} models available", models.len()),
                                        ))),
                                        Err(e) => status.set(Some((false, e))),
                                    }
                                });
                            },
                            "Test connection"
                        }
                    }
                    if let Some((ok, message)) = status_v {
                        span { class: "flex items-center gap-1.5 text-[11.5px] {status_style}",
                            if ok {
                                Icon { name: "sparkles", class: "size-3.5" }
                            } else {
                                Icon { name: "close", class: "size-3.5" }
                            }
                            "{message}"
                        }
                    }
                }

                // ---- Provider notes ----------------------------------------------
                div { class: "mt-5 rounded-xl border border-edge bg-panel p-3.5",
                    div { class: "text-[11px] font-semibold uppercase tracking-[0.12em] text-sub/60",
                        "Wire formats"
                    }
                    ul { class: "mt-2 space-y-1.5 text-[12px] leading-relaxed text-sub",
                        li { "• Direct providers — OpenAI-compatible SSE at the chat-completions endpoint, decoded by prism-core's SseDecoder" }
                        li { "• Ollama — native NDJSON on the server root plus /api/chat, decoded by the NdjsonDecoder" }
                        li { "• Prism API — self-hosted /api/chat endpoint (non-streaming JSON)" }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
struct FieldProps {
    label: &'static str,
    value: String,
    placeholder: &'static str,
    #[props(default)]
    password: bool,
    hint: &'static str,
    oninput: EventHandler<String>,
}

fn Field(props: FieldProps) -> Element {
    let input_type = if props.password { "password" } else { "text" };
    rsx! {
        div { class: "space-y-1.5",
            div { class: "text-[11px] font-medium text-sub",
                "{props.label}"
            }
            input {
                class: "w-full rounded-lg border border-edge bg-panel px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder:text-sub/50 focus:border-accent/60",
                r#type: "{input_type}",
                value: "{props.value}",
                placeholder: "{props.placeholder}",
                spellcheck: "false",
                autocomplete: "off",
                oninput: move |e| props.oninput.call(e.value()),
            }
            div { class: "text-[10.5px] text-sub/70",
                "{props.hint}"
            }
        }
    }
}
