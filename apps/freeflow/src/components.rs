//! The reusable pieces: a toggle, a pill tool button, an icon button, and
//! the two gallery card states.
//!
//! Every one of them takes the colour tokens from the stylesheet rather
//! than restating them, so a change to `--accent-primary` moves the whole
//! suite at once.
//!
//! Callbacks are plain `FnMut` bounds rather than `EventHandler<T>`: a
//! generic closure is callable from a host that has no event of its own to
//! hand over, which is the difference between a component that composes
//! and one that only works inside one component.

use dioxus::prelude::*;

use crate::app::Asset;
use crate::icons::icon;

/// A switch. Labelled, keyboard-reachable, and it glows when on.
pub fn toggle<F>(label: &str, on: bool, mut on_click: F) -> Element
where
    F: FnMut(Event<MouseData>) + 'static,
{
    rsx! {
        button {
            class: "ff-toggle",
            "data-on": on.to_string(),
            onclick: move |evt| on_click(evt),
            span { class: "ff-toggle-track", span { class: "ff-toggle-thumb" } }
            "{label}"
        }
    }
}

/// A pill-shaped tool button. The active one carries the accent border and
/// glow; everything else is a quiet surface that lifts on hover.
pub fn tool_button<F>(
    icon_name: &'static str,
    label: &'static str,
    active: bool,
    badge: Option<&'static str>,
    mut on_click: F,
) -> Element
where
    F: FnMut(Event<MouseData>) + 'static,
{
    rsx! {
        button {
            class: "ff-tool",
            "data-active": active.to_string(),
            onclick: move |evt| on_click(evt),
            {icon(icon_name, "ff-icon ff-icon--lg")}
            "{label}"
            if let Some(text) = badge {
                span { class: "ff-badge", "{text}" }
            }
        }
    }
}

/// A square, quiet, icon-only button.
pub fn icon_button<F>(
    icon_name: &'static str,
    title: &'static str,
    danger: bool,
    mut on_click: F,
) -> Element
where
    F: FnMut(Event<MouseData>) + 'static,
{
    rsx! {
        button {
            class: "ff-iconbtn",
            "data-danger": danger.to_string(),
            "aria-label": title,
            title: title,
            onclick: move |evt| on_click(evt),
            {icon(icon_name, "ff-icon ff-icon--sm")}
        }
    }
}

/// A finished asset. The artwork is a *procedural placeholder* derived from
/// the prompt, which is the honest thing for a UI shell to show: nothing
/// here claims a model produced video.
pub fn asset_card<FD, FX>(asset: Asset, mut on_download: FD, mut on_delete: FX) -> Element
where
    FD: FnMut(u64) + 'static,
    FX: FnMut(u64) + 'static,
{
    let art = format!(
        "radial-gradient(90% 70% at 22% 18%, hsl({0} 82% 62%) 0%, transparent 62%), \
         radial-gradient(80% 65% at 78% 82%, hsl({1} 78% 52%) 0%, transparent 58%), \
         linear-gradient(150deg, hsl({2} 42% 22%), hsl({3} 46% 12%))",
        asset.hue,
        asset.hue2,
        asset.hue2,
        asset.hue
    );
    let tag = if asset.kind == "video" { "VIDEO" } else { "IMAGE" };
    let meta_icon = if asset.kind == "video" { "video" } else { "image" };

    rsx! {
        div { class: "ff-card", key: "{asset.id}",
            div { class: "ff-card-art", style: "background: {art};" }
            span { class: "ff-card-tag", "{tag}" }
            div { class: "ff-card-meta",
                {icon(meta_icon, "ff-icon ff-icon--sm")}
                span { "{asset.prompt}" }
            }
            div { class: "ff-card-actions",
                button {
                    class: "ff-card-act",
                    "aria-label": "Download",
                    title: "Download",
                    onclick: move |_| on_download(asset.id),
                    {icon("download", "ff-icon ff-icon--sm")}
                }
                button {
                    class: "ff-card-act",
                    "aria-label": "Fullscreen",
                    title: "Fullscreen",
                    {icon("maximize", "ff-icon ff-icon--sm")}
                }
                button {
                    class: "ff-card-act",
                    "data-danger": "true",
                    "aria-label": "Delete",
                    title: "Delete",
                    onclick: move |_| on_delete(asset.id),
                    {icon("trash", "ff-icon ff-icon--sm")}
                }
            }
        }
    }
}

/// A skeleton card: the in-progress state. Pulsing rather than frozen, so
/// the wait reads as work happening instead of a fake delay.
pub fn skeleton_card(index: usize) -> Element {
    rsx! {
        div { class: "ff-card ff-card--skeleton", key: "skel-{index}",
            div { class: "ff-skel" }
            div { class: "ff-skel-line" }
        }
    }
}

/// The gallery's empty state: floating polaroids, an invitation, and the
/// guarantee that nothing here is metered.
pub fn empty_state(prompt: &str) -> Element {
    rsx! {
        div { class: "ff-empty",
            // A small stack of polaroids, tilted, floating on a CSS loop.
            svg { class: "ff-empty-art", view_box: "0 0 128 104",
                g { opacity: "0.35",
                    rect { x: 22, y: 14, width: 52, height: 62, rx: 6, fill: "#26262c", transform: "rotate(-11 48 45)" }
                }
                g { opacity: "0.7",
                    rect { x: 52, y: 20, width: 54, height: 64, rx: 6, fill: "#1e1e24", transform: "rotate(7 79 52)" }
                }
                rect { x: 40, y: 26, width: 54, height: 64, rx: 6, fill: "#2a2a32", stroke: "#D946EF", "stroke-width": "1.2", transform: "rotate(-3 67 58)" }
                rect { x: 47, y: 33, width: 40, height: 34, rx: 4, fill: "url(#gra)" }
                defs {
                    linearGradient { id: "gra", x1: "0", y1: "0", x2: "1", y2: "1",
                        stop { offset: "0%", "stop-color": "#D946EF", "stop-opacity": "0.85" }
                        stop { offset: "100%", "stop-color": "#6366f1", "stop-opacity": "0.45" }
                    }
                }
                path { d: "M112 22l1.6 4.4L118 28l-4.4 1.6L112 34l-1.6-4.4L106 28l4.4-1.6z", fill: "#D946EF" }
                path { d: "M14 76l1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z", fill: "#D946EF", opacity: "0.7" }
            }
            h2 { "Empty, for now" }
            p { "Your first creation changes that." }
            p { class: "ff-empty-hint",
                if prompt.trim().is_empty() {
                    "Write a prompt and press Generate."
                } else {
                    "Press Generate to fill the library."
                }
            }
        }
    }
}

/// A compact inline sparkle, for the generate button.
pub fn sparkle() -> Element {
    icon("sparkle", "ff-icon")
}