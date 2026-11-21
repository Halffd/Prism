//! Right workspace area: top navigation bar, filters, empty state,
//! generating placeholder and the results grid.
//!
//! NOTE: the "stored for 7 days / upgrade" banner is intentionally NOT
//! included — the app has no paywalls, no credits and no storage limits.

use dioxus::prelude::*;

use crate::components::ui::{DropdownMenu, IconButton};
use crate::icons::Icon;
use crate::state::StudioState;

/// A generated clip displayed in the workspace grid.
#[derive(Clone, PartialEq)]
pub struct VideoCard {
    pub title: String,
    pub ratio: String,
    pub res: String,
    pub dur: String,
    pub model: String,
    /// Base hue (0..360) used to derive a unique gradient per card.
    pub hue: u16,
}

const COLLECTIONS: [&str; 4] = ["Unsorted", "All creations", "Favorites", "Archived"];

const FILTERS: [(&str, &str); 3] = [
    ("tag", "Labels"),
    ("folder", "Folders"),
    ("template", "Templates"),
];

const BAR_ACTIONS: [&str; 4] = ["refresh", "star", "grid", "filter"];

pub fn Workspace() -> Element {
    let state = use_context::<StudioState>();
    let mut collection = use_signal(|| "Unsorted".to_string());
    let mut active_filter = use_signal(|| String::new());
    let mut search_open = use_signal(|| false);
    let mut search = use_signal(String::new);

    let collection_v = collection();
    let active_filter_v = active_filter();
    let search_open_v = search_open();
    let search_v = search();
    let generating = state.generating;
    let generating_v = generating();

    let all = state.generations.read();
    let list: Vec<VideoCard> = all
        .iter()
        .filter(|c| {
            search_v.is_empty()
                || c.title.to_lowercase().contains(&search_v.to_lowercase())
        })
        .cloned()
        .collect();

    rsx! {
        section { class: "flex min-h-[75vh] min-w-0 flex-1 flex-col lg:h-full lg:min-h-0",

            // ---- Top navigation bar --------------------------------------
            div { class: "flex h-14 shrink-0 items-center gap-1 border-b border-edge px-3",
                DropdownMenu {
                    options: COLLECTIONS.iter().map(|c| c.to_string()).collect(),
                    selected: collection_v.clone(),
                    on_select: move |v: String| collection.set(v),
                    menu_class: "left-0 top-full mt-1 w-44",
                    span { class: "text-[13px] font-semibold text-white", "{collection_v}" }
                }

                div { class: "mx-2 h-5 w-px bg-edge" }

                for (icon, label) in FILTERS {
                    {
                        let is_active = active_filter_v == label;
                        let style = if is_active {
                            "bg-white/10 text-white"
                        } else {
                            "text-sub hover:bg-white/5 hover:text-white"
                        };
                        rsx! {
                            button {
                                key: "{label}",
                                class: "hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 sm:flex {style}",
                                onclick: move |_| {
                                    if active_filter() == label {
                                        active_filter.set(String::new());
                                    } else {
                                        active_filter.set(label.to_string());
                                    }
                                },
                                Icon { name: icon, class: "size-3.5" }
                                "{label}"
                            }
                        }
                    }
                }

                div { class: "ml-auto flex items-center gap-0.5",
                    if search_open_v {
                        input {
                            class: "mr-1 h-8 w-36 rounded-lg border border-edge bg-input px-2.5 text-[12px] text-white outline-none transition-colors placeholder:text-sub/70 focus:border-accent/60 sm:w-44",
                            placeholder: "Search creations…",
                            value: "{search_v}",
                            oninput: move |e| search.set(e.value()),
                        }
                    }
                    for icon in BAR_ACTIONS {
                        IconButton {
                            key: "{icon}",
                            icon: icon,
                            label: icon,
                            on_press: move |_| {},
                        }
                    }
                    IconButton {
                        icon: "search",
                        label: "Search",
                        active: search_open_v,
                        on_press: move |_| {
                            search_open.toggle();
                            if !search_open() {
                                search.set(String::new());
                            }
                        },
                    }
                }
            }

            // ---- Content ---------------------------------------------------
            div { class: "relative min-h-0 flex-1 overflow-y-auto",
                if generating_v {
                    GeneratingPlaceholder {}
                } else if list.is_empty() {
                    EmptyState {}
                } else {
                    div { class: "grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
                        for (i, card) in list.iter().enumerate() {
                            VideoTile { key: "{i}", card: card.clone(), index: i }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

fn EmptyState() -> Element {
    rsx! {
        div { class: "absolute inset-0 grid place-items-center overflow-hidden p-6",

            // Ambient purple glow
            div { class: "pointer-events-none absolute size-80 rounded-full bg-accent/10 blur-3xl" }

            div { class: "relative flex flex-col items-center text-center",
                // Floating polaroid stack — a soft, glowing pile of
                // "creations waiting to happen"
                div { class: "relative mb-10 h-52 w-64",

                    // Back polaroid (left)
                    div {
                        class: "absolute left-0 top-8 w-32 animate-float-slow rounded-md bg-[#ece9e2] p-1.5 pb-6 shadow-[0_14px_36px_rgba(0,0,0,0.5)]",
                        style: "--float-rotate: -10deg",
                        div {
                            class: "h-24 rounded-[3px]",
                            style: "{photo_gradient(210)}",
                        }
                    }

                    // Back polaroid (right)
                    div {
                        class: "absolute right-0 top-4 w-32 animate-float rounded-md bg-[#ece9e2] p-1.5 pb-6 shadow-[0_14px_36px_rgba(0,0,0,0.5)]",
                        style: "--float-rotate: 9deg",
                        div {
                            class: "h-24 rounded-[3px]",
                            style: "{photo_gradient(335)}",
                        }
                    }

                    // Front polaroid (center, largest)
                    div {
                        class: "absolute left-14 top-10 w-36 animate-float rounded-md bg-[#ece9e2] p-1.5 pb-6 shadow-[0_18px_44px_rgba(0,0,0,0.6)]",
                        style: "--float-rotate: -3deg",
                        div { class: "relative h-28 overflow-hidden rounded-[3px]",
                            div { class: "absolute inset-0", style: "{photo_gradient(280)}" }
                            div { class: "absolute inset-0 grid place-items-center",
                                div { class: "grid size-9 place-items-center rounded-full bg-black/35 backdrop-blur-sm",
                                    Icon { name: "play", class: "size-3.5 translate-x-px text-white", stroke_width: 2.0 }
                                }
                            }
                        }
                    }

                    // Floating sparkle accents
                    div { class: "absolute -right-3 -top-3 z-10 grid size-8 rotate-12 place-items-center rounded-xl border border-accent/40 bg-panel shadow-[0_0_20px_rgba(176,38,255,0.35)]",
                        Icon { name: "sparkles", class: "size-4 text-accent", stroke_width: 1.9 }
                    }
                    div { class: "absolute -bottom-2 -left-4 z-10 grid size-7 -rotate-12 place-items-center rounded-lg border border-white/15 bg-panel",
                        Icon { name: "video", class: "size-3.5 text-sub" }
                    }
                }

                h2 { class: "text-[26px] font-semibold tracking-tight text-white",
                    "Empty, for now"
                }
                p { class: "mt-1.5 text-[13px] text-sub",
                    "Your first creation changes that."
                }
            }
        }
    }
}

/// Vivid gradient for a polaroid "photo", hue-driven like the result
/// tiles so the artwork feels consistent with generated content.
fn photo_gradient(hue: u16) -> String {
    let hue2 = (hue + 60) % 360;
    format!(
        "background-image: linear-gradient(140deg, hsl({hue}, 55%, 26%), hsl({hue2}, 68%, 42%))"
    )
}

// ---------------------------------------------------------------------------
// Generating placeholder
// ---------------------------------------------------------------------------

fn GeneratingPlaceholder() -> Element {
    rsx! {
        div { class: "absolute inset-0 grid place-items-center p-6",
            div { class: "flex w-full max-w-sm flex-col items-center rounded-2xl border border-edge bg-panel p-8 text-center shadow-[0_16px_48px_rgba(0,0,0,0.4)]",
                div { class: "size-12 animate-spin rounded-full border-2 border-accent/25 border-t-accent" }
                div { class: "mt-5 text-[14px] font-semibold text-white",
                    "Generating your video…"
                }
                div { class: "mt-1 text-[12px] text-sub",
                    "Free and unlimited — no credits, no waiting rooms."
                }
                div { class: "mt-5 h-1 w-full overflow-hidden rounded-full bg-white/5",
                    div { class: "animate-shimmer h-full w-full" }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Result tile
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
struct VideoTileProps {
    card: VideoCard,
    index: usize,
}

fn VideoTile(props: VideoTileProps) -> Element {
    let card = &props.card;
    let hue = card.hue % 360;
    let hue2 = (hue + 60) % 360;
    let gradient = format!(
        "background-image: linear-gradient(135deg, hsl({hue}, 60%, 18%), hsl({hue2}, 70%, 34%))"
    );
    let meta = format!(
        "{} · {} · clip {}",
        card.model,
        card.dur,
        props.index + 1
    );

    rsx! {
        div { class: "group overflow-hidden rounded-xl border border-edge bg-panel transition-all duration-200 hover:border-white/20 hover:shadow-[0_8px_32px_rgba(0,0,0,0.45)]",
            div { class: "relative aspect-video", style: "{gradient}",
                div { class: "absolute inset-0 grid place-items-center",
                    div { class: "grid size-11 place-items-center rounded-full bg-black/40 opacity-80 backdrop-blur-sm transition-all duration-200 group-hover:scale-110 group-hover:opacity-100",
                        Icon { name: "play", class: "size-4 translate-x-px text-white", stroke_width: 2.0 }
                    }
                }
                span { class: "absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90",
                    "{card.ratio} · {card.res}"
                }
                span { class: "absolute bottom-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white/90",
                    "{card.dur}"
                }
            }
            div { class: "p-3",
                div { class: "truncate text-[13px] font-medium text-white", "{card.title}" }
                div { class: "mt-0.5 text-[11px] text-sub",
                    "{meta}"
                }
            }
        }
    }
}
