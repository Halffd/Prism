//! Inline SVG icons, drawn in the lucide idiom: one 24x24 box, round caps
//! and joins, `currentColor` strokes. Keeping them here rather than pulling
//! in `dioxus-free-icons` means the app has no icon dependency to fall out
//! of sync with its stroke weights.
//!
//! Strokes, fill and width live on `.ff-icon` in the stylesheet, so an icon
//! inherits the colour of whatever it sits inside.

use dioxus::prelude::*;

/// One icon by name. Stroking is CSS's job; this only supplies geometry.
pub fn icon(name: &str, class: &str) -> Element {
    let shape = match name {
        "chat" => rsx! { path { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" } },
        "director" => rsx! {
            rect { x: 2, y: 3, width: 20, height: 18, rx: 2 }
            path { d: "M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5" }
        },
        "video" => rsx! {
            path { d: "M23 7l-7 5 7 5V7z" }
            rect { x: 1, y: 5, width: 15, height: 14, rx: 2 }
        },
        "image" => rsx! {
            rect { x: 3, y: 3, width: 18, height: 18, rx: 2 }
            circle { cx: 8.5, cy: 8.5, r: 1.5 }
            path { d: "m21 15-5-5L5 21" }
        },
        "world" => rsx! {
            circle { cx: 12, cy: 12, r: 10 }
            path { d: "M2 12h20" }
            path { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" }
        },
        "character" => rsx! {
            path { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }
            circle { cx: 12, cy: 7, r: 4 }
        },
        "audio" => rsx! {
            path { d: "M2 12h2M6 8v8M10 4v16M14 8v8M18 6v12M22 12h0" }
        },
        "plugins" => rsx! {
            rect { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }
            rect { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }
            path { d: "M14 6.5h3.5V10M10 17.5H6.5V14" }
        },
        "folder" => rsx! {
            path { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" }
        },
        "brandkit" => rsx! {
            path { d: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.15-.29-.35-.43-.75-.43-1.16 0-.99.81-1.69 1.79-1.69h1.93C18.61 16.31 22 13.46 22 9.68 22 5.36 17.52 2 12 2z" }
            circle { cx: 7.5, cy: 11.5, r: 1.2 }
            circle { cx: 11, cy: 7.5, r: 1.2 }
            circle { cx: 15.5, cy: 8.5, r: 1.2 }
        },
        "workflow" => rsx! {
            rect { x: 3, y: 3, width: 6, height: 6, rx: 1.5 }
            rect { x: 15, y: 15, width: 6, height: 6, rx: 1.5 }
            path { d: "M6 9v3a3 3 0 0 0 3 3h6" }
        },
        "template" => rsx! {
            rect { x: 3, y: 3, width: 18, height: 18, rx: 2 }
            path { d: "M3 9h18M9 21V9" }
        },
        "arena" => rsx! {
            path { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" }
            path { d: "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" }
        },
        "info" => rsx! {
            circle { cx: 12, cy: 12, r: 10 }
            path { d: "M12 16v-4M12 8h.01" }
        },
        "camera" => rsx! {
            path { d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" }
            circle { cx: 13, cy: 13, r: 3 }
        },
        "grid" => rsx! {
            rect { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }
            rect { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }
            rect { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }
            rect { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }
        },
        "wand" => rsx! {
            path { d: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" }
        },
        "trash" => rsx! {
            path { d: "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }
        },
        "plus" => rsx! { path { d: "M12 5v14M5 12h14" } },
        "minus" => rsx! { path { d: "M5 12h14" } },
        "x" => rsx! { path { d: "M18 6 6 18M6 6l12 12" } },
        "menu" => rsx! { path { d: "M4 6h16M4 12h16M4 18h16" } },
        "search" => rsx! {
            circle { cx: 11, cy: 11, r: 8 }
            path { d: "m21 21-4.3-4.3" }
        },
        "filter" => rsx! { path { d: "M22 3H2l8 9.46V19l4 2v-8.54z" } },
        "sort" => rsx! {
            path { d: "m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" }
        },
        "star" => rsx! {
            path { d: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" }
        },
        "labels" => rsx! {
            path { d: "M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" }
            circle { cx: 7.5, cy: 7.5, r: 1.2 }
        },
        "download" => rsx! {
            path { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" }
        },
        "maximize" => rsx! {
            path { d: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" }
        },
        "chevron" => rsx! { path { d: "m6 9 6 6 6-6" } },
        "caret" => rsx! { path { d: "m5 8 7 7 7-7" } },
        "sparkle" => rsx! {
            path { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" }
        },
        "infinity" => rsx! {
            path { d: "M12 12c-2-2-3-4-5-4a4 4 0 1 0 0 8c2 0 3-2 5-4 2-2 3-4 5-4a4 4 0 1 1 0 8c-2 0-3-2-5-4z" }
        },
        _ => rsx! { circle { cx: 12, cy: 12, r: 9 } },
    };

    rsx! {
        svg {
            class: "{class}",
            view_box: "0 0 24 24",
            "aria-hidden": "true",
            {shape}
        }
    }
}

/// A compact helper so call sites read `ic!("chat", "ff-icon")`.
#[macro_export]
macro_rules! ic {
    ($name:expr) => {
        $crate::icons::icon($name, "ff-icon")
    };
    ($name:expr, $class:expr) => {
        $crate::icons::icon($name, $class)
    };
}