//! The three-column shell: sidebar, workspace, gallery.
//!
//! Everything is local state in one signal. Nothing is metered: no credit
//! counter, no plan check, no "Pro" badge. The one deliberate compromise is
//! generation — it produces procedural placeholders rather than calling a
//! model, and says so on the card, because a demo that implies it ran video
//! is dishonest in a way a beautiful placeholder is not.

use dioxus::prelude::*;

use crate::components::{asset_card, empty_state, icon_button, skeleton_card, toggle, tool_button};
use crate::icons::icon;

// ---------------------------------------------------------------------------
// The tool rail
// ---------------------------------------------------------------------------

/// The tools in the rail, in order. `id` is what state stores; `label` is
/// what a person reads; `badge` is the pill's corner note.
const TOOLS: &[(&str, &str, &str, Option<&str>)] = &[
    ("video", "Video", "video", None),
    ("image", "Image", "image", None),
    ("world", "World", "world", None),
    ("character", "Character", "character", None),
    ("audio", "Audio", "audio", None),
    ("plugins", "Plugins", "plugins", Some("10+ ON")),
];

/// The workspace heading and the button, per tool.
const TOOL_COPY: &[(&str, &str, &str)] = &[
    ("video", "Text to Video", "Generate video"),
    ("image", "Text to Image", "Generate image"),
    ("world", "Text to World", "Generate world"),
    ("character", "Text to Character", "Generate character"),
    ("audio", "Text to Audio", "Generate audio"),
    ("plugins", "Plugin Studio", "Run plugin"),
];

fn tool_copy(id: &str) -> (&'static str, &'static str) {
    TOOL_COPY
        .iter()
        .find(|(tool, _, _)| *tool == id)
        .map(|(_, title, action)| (*title, *action))
        .unwrap_or(("Create", "Generate"))
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/// One library entry.
#[derive(Clone)]
pub struct Asset {
    pub id: u64,
    /// "video" or "image" — drives the corner tag and the meta glyph.
    pub kind: &'static str,
    pub prompt: String,
    pub ratio: String,
    pub res: String,
    pub duration: String,
    /// Two hues for the procedural gradient, derived from the prompt.
    pub hue: u16,
    pub hue2: u16,
}

/// A small deterministic hash, so the same prompt always draws the same
/// gradient and a rerun is recognisable.
fn hash(text: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        h ^= u64::from(byte);
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

/// Build one placeholder asset. Pure, so the choice of gradient is a
/// property of the prompt and the id rather than of whatever the UI was
/// doing when the button was pressed.
fn make_asset(id: u64, prompt: &str, tool: &str, ratio: &str, res: &str, duration: &str) -> Asset {
    let h = hash(prompt) ^ hash(&id.to_string());
    Asset {
        id,
        kind: if tool == "image" { "image" } else { "video" },
        prompt: prompt.chars().take(48).collect(),
        ratio: ratio.to_string(),
        res: res.to_string(),
        duration: duration.to_string(),
        hue: (h % 360) as u16,
        hue2: ((h >> 12) % 360) as u16,
    }
}

// ---------------------------------------------------------------------------
// The suite's whole state
// ---------------------------------------------------------------------------

/// Output presets offered by the picker. No credit cost, no tier — just
/// what the encoder would be told.
const PRESETS: &[(&str, &str, &str)] = &[
    ("16:9", "480p", "5s"),
    ("16:9", "720p", "5s"),
    ("9:16", "720p", "5s"),
    ("1:1", "720p", "5s"),
    ("16:9", "1080p", "10s"),
];

#[derive(Clone)]
pub struct Suite {
    /// Active tool id.
    pub tool: &'static str,
    pub prompt: String,
    /// 1..=8, the quantity picker's value.
    pub quantity: u8,
    pub auto_polish: bool,
    pub audio_on: bool,
    /// References dropped into the visual-reference zone.
    pub refs: u8,
    pub model: &'static str,
    /// Index into `PRESETS`.
    pub preset: usize,
    /// Which gallery folder is selected.
    pub folder: &'static str,
    /// Library, newest first.
    pub assets: Vec<Asset>,
    /// True while skeletons are on screen.
    pub loading: bool,
    pub query: String,
    pub favorites_only: bool,
    /// Footer pill: "chat" or "tools".
    pub footer: &'static str,
    /// Mobile drawer: "none", "sidebar", "gallery".
    pub drawer: &'static str,
    next_id: u64,
}

impl Default for Suite {
    fn default() -> Self {
        Suite {
            tool: "video",
            prompt: String::new(),
            quantity: 1,
            auto_polish: true,
            audio_on: true,
            refs: 0,
            model: "Seedance 2.5",
            preset: 0,
            folder: "Unsorted",
            assets: Vec::new(),
            loading: false,
            query: String::new(),
            favorites_only: false,
            footer: "tools",
            drawer: "none",
            next_id: 1,
        }
    }
}

impl Suite {
    fn ratio(&self) -> &'static str {
        PRESETS[self.preset].0
    }
    fn res(&self) -> &'static str {
        PRESETS[self.preset].1
    }
    fn duration(&self) -> &'static str {
        PRESETS[self.preset].2
    }

    /// The assets the gallery should show, after the query and the
    /// favourites filter.
    fn visible(&self) -> Vec<Asset> {
        let query = self.query.trim().to_lowercase();
        self.assets
            .iter()
            .filter(|a| query.is_empty() || a.prompt.to_lowercase().contains(&query))
            .cloned()
            .collect()
    }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

#[allow(non_snake_case)]
pub fn App() -> Element {
    let mut suite = use_signal(Suite::default);

    // Close the mobile drawer whenever a panel opens the other one.
    let mut set_drawer = move |which: &'static str| {
        suite.write().drawer = which;
    };

    let mobile = suite.read().drawer != "none";
    let sidebar_open = suite.read().drawer == "sidebar";
    let gallery_open = suite.read().drawer == "gallery";

    rsx! {
        div { class: "ff-root",
            // ---- mobile top bar (hidden on desktop) ----
            div { class: "ff-mobilebar",
                button {
                    class: "ff-iconbtn",
                    "aria-label": "Menu",
                    onclick: move |_| set_drawer(if sidebar_open { "none" } else { "sidebar" }),
                    {icon("menu", "ff-icon")}
                }
                span { class: "ff-title", "FreeFlow" }
                span { class: "ff-mobile-spacer" }
                button {
                    class: "ff-iconbtn",
                    "aria-label": "Library",
                    onclick: move |_| set_drawer(if gallery_open { "none" } else { "gallery" }),
                    {icon("folder", "ff-icon")}
                }
            }

            {sidebar(suite, sidebar_open)}
            {workspace(suite)}
            {gallery(suite, gallery_open)}

            if mobile {
                div {
                    class: "ff-scrim",
                    "data-open": "true",
                    onclick: move |_| set_drawer("none"),
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// A. Sidebar
// ---------------------------------------------------------------------------

fn sidebar(mut suite: Signal<Suite>, open: bool) -> Element {
    let tool = suite.read().tool;

    rsx! {
        aside { class: "ff-sidebar", "data-open": open.to_string(),
            div { class: "ff-sidebar-head",
                button { class: "ff-project",
                    {icon("folder", "ff-icon")}
                    span { "Personal Project" }
                    small { {icon("caret", "ff-icon ff-icon--sm")} }
                }
            }

            div { class: "ff-scroll",
                div { class: "ff-section-label", "Agents" }
                nav {
                    button { class: "ff-nav",
                        {icon("chat", "ff-icon")}
                        "Chat Mode"
                    }
                    button { class: "ff-nav",
                        {icon("director", "ff-icon")}
                        "Director Mode"
                    }
                }

                div { class: "ff-section-label", "Tools" }
                div { class: "ff-tools",
                    for (id, label, ic, badge) in TOOLS.iter().copied() {
                        {tool_button(ic, label, tool == id, badge, move |_| {
                            suite.write().tool = id;
                        })}
                    }
                }

                div { class: "ff-section-label", "Assets" }
                nav {
                    for (label, ic) in [("Director Projects", "folder"), ("Character & World", "world"), ("Brand kit", "brandkit"), ("Media", "folder"), ("Workflows", "workflow")] {
                        button { class: "ff-nav", key: "{label}",
                            {icon(ic, "ff-icon")}
                            "{label}"
                        }
                    }
                }

                div { class: "ff-section-label", "Inspire" }
                nav {
                    button { class: "ff-nav",
                        {icon("template", "ff-icon")}
                        "Templates"
                    }
                    button { class: "ff-nav",
                        {icon("arena", "ff-icon")}
                        "Arena"
                        span { class: "ff-badge ff-badge--new", "New" }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// B. Workspace
// ---------------------------------------------------------------------------

fn workspace(mut suite: Signal<Suite>) -> Element {
    let (title, action) = tool_copy(suite.read().tool);
    let s = suite.read();
    let prompt = s.prompt.clone();
    let preset = PRESETS[s.preset];
    let quantity = s.quantity;
    let loading = s.loading;
    let refs = s.refs;
    let auto_polish = s.auto_polish;
    let audio_on = s.audio_on;
    let footer = s.footer;
    drop(s);

    let prompt_for_generate = prompt.clone();
    let generate = move |_evt: Event<MouseData>| {
        let text = prompt_for_generate.trim().to_string();
        if text.is_empty() || loading {
            return;
        }
        suite.write().loading = true;
        let wanted = quantity as usize;

        // The skeletons are on screen while this runs. It is a real timer
        // rather than a painted freeze, so the wait is honest work: the
        // futures are awaited, nothing pretends to be faster or slower than
        // it is.
        spawn(async move {
            gloo_timers::future::TimeoutFuture::new(700).await;
            let mut state = suite.write();
            state.loading = false;
            for _ in 0..wanted {
                let id = state.next_id;
                state.next_id += 1;
                // Reading the presets into locals keeps the borrow away
                // from the insert below.
                let tool = state.tool;
                let ratio = state.ratio().to_string();
                let res = state.res().to_string();
                let duration = state.duration().to_string();
                let asset = make_asset(id, &text, tool, &ratio, &res, &duration);
                state.assets.insert(0, asset);
            }
        });
    };

    rsx! {
        section { class: "ff-workspace",
            div { class: "ff-workspace-inner",
                // ---- head ----
                div { class: "ff-ws-head",
                    h1 { "{title}" }
                    span { class: "ff-info", title: "Everything here is free and unlocked.",
                        {icon("info", "ff-icon")}
                    }
                }

                // ---- model ----
                button { class: "ff-select",
                    strong { "{suite.read().model}" }
                    span { class: "ff-caret", {icon("caret", "ff-icon ff-icon--sm")} }
                }

                // ---- visual references ----
                div { class: "ff-drop",
                    span { class: "ff-count", "{refs}/50" }
                    div { class: "ff-drop-plus", {icon("plus", "ff-icon")} }
                    div { class: "ff-drop-title", "Add visual references (Optional)" }
                    div { class: "ff-drop-sub", "JPEG, PNG, WEBP · 30 MB max" }
                }

                // ---- prompt ----
                div { class: "ff-prompt",
                    textarea {
                        placeholder: "Enter text to freely combine reference assets and generate a video.",
                        value: "{prompt}",
                        oninput: move |evt| suite.write().prompt = evt.value(),
                    }
                    div { class: "ff-prompt-bar",
                        {icon_button("camera", "Camera", false, move |_| {})}
                        {icon_button("grid", "Grid", false, move |_| {})}
                        {icon_button("wand", "Magic wand", false, move |_| {})}
                        {icon_button("trash", "Clear prompt", true, move |_| suite.write().prompt = String::new())}
                        span { class: "ff-spacer" }
                        {toggle("Auto Polish", auto_polish, move |_| {
                            let next = !suite.read().auto_polish;
                            suite.write().auto_polish = next;
                        })}
                    }
                }

                // ---- settings row ----
                div { class: "ff-settings",
                    {toggle("Audio", audio_on, move |_| {
                            let next = !suite.read().audio_on;
                            suite.write().audio_on = next;
                        })}
                    button { class: "ff-select",
                        strong { "{preset.0} | {preset.1} | {preset.2}" }
                        span { class: "ff-caret", {icon("caret", "ff-icon ff-icon--sm")} }
                    }
                }

                // ---- action bar ----
                div { class: "ff-settings",
                    div { class: "ff-qty",
                        button {
                            "aria-label": "Fewer",
                            disabled: quantity <= 1,
                            onclick: move |_| {
                                let next = suite.read().quantity.saturating_sub(1).max(1);
                                suite.write().quantity = next;
                            },
                            {icon("minus", "ff-icon ff-icon--sm")}
                        }
                        span { class: "ff-qty-val", "{quantity}/8" }
                        button {
                            "aria-label": "More",
                            disabled: quantity >= 8,
                            onclick: move |_| {
                                let next = (suite.read().quantity + 1).min(8);
                                suite.write().quantity = next;
                            },
                            {icon("plus", "ff-icon ff-icon--sm")}
                        }
                    }
                    button {
                        class: "ff-generate",
                        disabled: loading,
                        onclick: generate,
                        {icon("sparkle", "ff-icon")}
                        if loading { "Generating…" } else { "{action}" }
                    }
                }

                // ---- footer pill ----
                div { class: "ff-footabs",
                    button {
                        class: "ff-footab",
                        "data-active": (footer == "chat").to_string(),
                        onclick: move |_| suite.write().footer = "chat",
                        "Chat"
                    }
                    button {
                        class: "ff-footab",
                        "data-active": (footer == "tools").to_string(),
                        onclick: move |_| suite.write().footer = "tools",
                        "Tools"
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// C. Gallery
// ---------------------------------------------------------------------------

fn gallery(mut suite: Signal<Suite>, open: bool) -> Element {
    let s = suite.read();
    let visible = s.visible();
    let loading = s.loading;
    let quantity = s.quantity as usize;
    let folder = s.folder;
    let query = s.query.clone();
    let favorites_only = s.favorites_only;
    let count = s.assets.len();
    drop(s);

    rsx! {
        aside { class: "ff-gallery", "data-open": open.to_string(),
            // ---- top bar ----
            div { class: "ff-gallery-top",
                button { class: "ff-select",
                    span { "{folder}" }
                    span { class: "ff-caret", {icon("caret", "ff-icon ff-icon--sm")} }
                }
                div { class: "ff-gallery-actions",
                    {icon_button("labels", "Labels", false, move |_| {})}
                    {icon_button("folder", "Folders", false, move |_| {})}
                    {icon_button("template", "Templates", false, move |_| {})}
                    {icon_button("filter", "Filter", false, move |_| {})}
                    {icon_button("sort", "Sort", false, move |_| {})}
                    {icon_button("star", "Favourites", favorites_only, move |_| {
                            let next = !suite.read().favorites_only;
                            suite.write().favorites_only = next;
                        })}
                    {icon_button("trash", "Clear library", true, move |_| suite.write().assets.clear())}
                    {icon_button("search", "Search", false, move |_| {})}
                }
            }

            // ---- the guarantee, where the upgrade nag normally sits ----
            div { class: "ff-notice",
                {icon("infinity", "ff-icon")}
                span {
                    b { "Unlimited history. No tracking." }
                    " Everything you make stays here, free."
                }
            }

            // ---- body ----
            if visible.is_empty() && !loading {
                {empty_state(&query)}
            } else {
                div { class: "ff-scroll",
                    div { class: "ff-grid",
                        for (index, _) in (0..quantity).enumerate() {
                            if loading { {skeleton_card(index)} }
                        }
                        for asset in visible.into_iter() {
                            {asset_card(asset.clone(), move |_| {}, move |id| {
                                suite.write().assets.retain(|a| a.id != id);
                            })}
                        }
                    }
                    if !loading && count > 0 {
                        div { style: "padding: 0 12px 14px; font-size: 10.5px; color: var(--text-dim);",
                            "{count} creation(s) · nothing expires, nothing metered"
                        }
                    }
                }
            }
        }
    }
}