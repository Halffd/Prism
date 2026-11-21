//! Middle control panel: tabs, mode + model cards, prompt composer,
//! settings row and the unrestricted Generate action.

use dioxus::prelude::*;

use crate::components::ui::{Badge, DropdownMenu, IconButton, ToggleSwitch};
use crate::icons::Icon;
use crate::state::StudioState;

const TABS: [(&str, &str); 5] = [
    ("video", "Video"),
    ("image", "Image"),
    ("audio", "Audio"),
    ("character", "Character"),
    ("world", "World"),
];

const MODES: [&str; 4] = [
    "Text to Video",
    "Image to Video",
    "First & Last Frame",
    "Lip Sync",
];

/// Visual model cards: feature chips, a spec line (resolution | duration)
/// and a hue-driven vibe thumbnail — model choice becomes shopping, not
/// a dropdown. No credits, no discounts, no cost numbers anywhere.
#[derive(Clone, Copy)]
struct ModelDef {
    name: &'static str,
    /// "480-4k | 4-30s" style spec line.
    spec: &'static str,
    features: &'static [&'static str],
    /// "" for none; "Top pick" / "Fast" / "New" (muted or neon badge).
    badge: &'static str,
    /// Base hue for the vibe thumbnail gradient.
    hue: u16,
}

const MODEL_DEFS: [ModelDef; 5] = [
    ModelDef {
        name: "Seedance 2.5",
        spec: "480-4k | 4-30s",
        features: &["Reference", "Start-End", "Audio"],
        badge: "Top pick",
        hue: 275,
    },
    ModelDef {
        name: "Seedance 1.0 Pro",
        spec: "720-1080p | 5-10s",
        features: &["Reference", "Audio"],
        badge: "",
        hue: 210,
    },
    ModelDef {
        name: "Hailuo 2.3",
        spec: "768-1080p | 6-10s",
        features: &["Reference"],
        badge: "",
        hue: 335,
    },
    ModelDef {
        name: "Kling 2.5 Turbo",
        spec: "720-1080p | 3-10s",
        features: &["Reference", "Start-End"],
        badge: "Fast",
        hue: 160,
    },
    ModelDef {
        name: "Veo 3.1",
        spec: "720-4k | 4-8s",
        features: &["Reference", "Audio"],
        badge: "New",
        hue: 35,
    },
];

const RATIOS: [&str; 3] = ["16:9", "9:16", "1:1"];
const RESOLUTIONS: [&str; 3] = ["480p", "720p", "1080p"];
const DURATIONS: [&str; 2] = ["5s", "10s"];

pub fn GenerationPanel() -> Element {
    // ---- state ------------------------------------------------------------
    let mut state = use_context::<StudioState>();
    let mut generations = state.generations;

    let mut active_tab = use_signal(|| "video".to_string());
    let mut mode = use_signal(|| "Text to Video".to_string());
    let mut model = use_signal(|| "Seedance 2.5".to_string());
    let mut prompt = use_signal(String::new);
    let mut audio_on = use_signal(|| true);
    let mut auto_polish = use_signal(|| true);
    let mut quantity = use_signal(|| 1u8);
    let mut panel_mode = use_signal(|| "tools");
    let mut aspect = use_signal(|| "16:9".to_string());
    let mut resolution = use_signal(|| "480p".to_string());
    let mut duration = use_signal(|| "5s".to_string());
    let mut output_open = use_signal(|| false);
    let mut model_open = use_signal(|| false);

    // ---- derived values (read once per render) ------------------------------
    let active_tab_v = active_tab();
    let mode_v = mode();
    let model_v = model();
    let prompt_v = prompt();
    let audio_on_v = audio_on();
    let auto_polish_v = auto_polish();
    let qty = quantity();
    let panel_mode_v = panel_mode();
    let aspect_v = aspect();
    let resolution_v = resolution();
    let duration_v = duration();
    let output_open_v = output_open();
    let model_open_v = model_open();

    // The selected model's card data drives the trigger thumbnail/spec.
    let selected_model = MODEL_DEFS
        .iter()
        .find(|m| m.name == model_v)
        .copied()
        .unwrap_or(MODEL_DEFS[0]);
    let model_trigger_gradient = model_gradient(selected_model.hue);
    let model_chevron = if model_open_v {
        "size-3.5 shrink-0 text-sub transition-transform duration-200 rotate-180"
    } else {
        "size-3.5 shrink-0 text-sub transition-transform duration-200"
    };

    let mut generating = state.generating;
    let generating_v = generating();
    let audio_icon_name = if audio_on_v {
        "volume-2"
    } else {
        "volume-x"
    };
    let audio_icon_class = if audio_on_v {
        "size-4 text-accent"
    } else {
        "size-4 text-sub"
    };
    let audio_label_class = if audio_on_v {
        "text-[12px] font-medium text-white"
    } else {
        "text-[12px] font-medium text-sub"
    };
    let audio_label = if audio_on_v {
        "Audio On"
    } else {
        "Audio Off"
    };
    let generate_style = if generating_v {
        "cursor-wait opacity-70"
    } else {
        ""
    };

    // ---- generate (unrestricted: no credits, no cost, no limits) -----------
    let on_generate = move |_| {
        if generating() {
            return;
        }
        generating.set(true);

        let qty = quantity().clamp(1, 8) as usize;
        let prompt_text = prompt().trim().to_string();
        let base_title = if prompt_text.is_empty() {
            String::new()
        } else {
            prompt_text.chars().take(48).collect::<String>()
        };
        let ratio = aspect().clone();
        let res = resolution().clone();
        let dur = duration().clone();
        let model_used = model().clone();
        let start_index = generations.read().len() as u16;

        spawn(async move {
            // Simulated render time — the action itself is free & unlimited.
            gloo_timers::future::TimeoutFuture::new(2_400).await;
            for i in 0..qty {
                let title = if base_title.is_empty() {
                    format!("Untitled generation {}", start_index as usize + i + 1)
                } else {
                    base_title.clone()
                };
                generations.write().push(crate::components::workspace::VideoCard {
                    title,
                    ratio: ratio.clone(),
                    res: res.clone(),
                    dur: dur.clone(),
                    model: model_used.clone(),
                    hue: (start_index + i as u16 * 47) % 360,
                });
            }
            generating.set(false);
        });
    };

    rsx! {
        aside { class: "flex w-full shrink-0 flex-col border-edge bg-panel lg:h-full lg:w-[380px] lg:border-r xl:w-[400px]",

            // ---- Tabs ----------------------------------------------------
            div { class: "flex h-12 shrink-0 items-stretch gap-0.5 border-b border-edge px-2 pt-1.5",
                IconButton {
                    icon: "menu",
                    label: "Open sidebar",
                    class: "mr-1 self-center lg:hidden",
                    on_press: move |_| state.sidebar_open.toggle(),
                }
                for (id, label) in TABS {
                    {
                        let is_active = active_tab_v == id;
                        let style = if is_active {
                            "text-white after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-linear-to-r after:from-accent1 after:to-accent"
                        } else {
                            "text-sub hover:text-white"
                        };
                        rsx! {
                            button {
                                key: "{id}",
                                class: "relative flex-1 rounded-t-lg px-1 pb-2.5 pt-1.5 text-[12px] font-medium transition-colors {style}",
                                onclick: move |_| active_tab.set(id.to_string()),
                                "{label}"
                            }
                        }
                    }
                }
            }

            // ---- Scrollable form ------------------------------------------
            div { class: "flex-1 space-y-3 overflow-y-auto p-3",

                // Mode card: "Text to Video" with thumbnail + chevron
                DropdownMenu {
                    options: MODES.iter().map(|m| m.to_string()).collect(),
                    selected: mode_v.clone(),
                    on_select: move |v: String| mode.set(v),
                    menu_class: "left-0 right-0 top-full mt-1",
                    button_class: "w-full",
                    div { class: "flex w-full items-center gap-2.5 rounded-xl border border-edge bg-input/70 p-2 text-left transition-colors duration-150 hover:border-white/20",
                        div { class: "grid size-10 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent2 to-accent",
                            Icon { name: "sparkles", class: "size-4 text-white", stroke_width: 1.9 }
                        }
                        div { class: "min-w-0 flex-1",
                            div { class: "truncate text-[13px] font-semibold text-white", "{mode_v}" }
                            div { class: "text-[11px] text-sub", "Prompt-driven generation" }
                        }
                    }
                }

                // Model selector — visual cards, not a text dropdown
                div { class: "relative",
                    button {
                        class: "flex w-full items-center gap-2.5 rounded-xl border border-edge bg-input/70 p-2 text-left transition-colors duration-150 hover:border-white/20",
                        onclick: move |_| model_open.toggle(),
                        div {
                            class: "relative size-9 shrink-0 overflow-hidden rounded-lg",
                            style: "{model_trigger_gradient}",
                            div { class: "absolute inset-0 grid place-items-center",
                                Icon { name: "play", class: "size-3 text-white/85", stroke_width: 2.0 }
                            }
                        }
                        div { class: "min-w-0 flex-1",
                            div { class: "text-[11px] text-sub", "Model" }
                            div { class: "truncate text-[13px] font-semibold text-white",
                                "{model_v}"
                            }
                        }
                        Icon { name: "chevron-down", class: model_chevron }
                    }

                    if model_open_v {
                        // Click-away catcher
                        div { class: "fixed inset-0 z-30", onclick: move |_| model_open.set(false) }

                        // Model card menu
                        div { class: "absolute left-0 right-0 top-full z-40 mt-1 space-y-1 rounded-xl border border-edge bg-panel p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.6)]",
                            for m in MODEL_DEFS {
                                {
                                    let is_selected = m.name == model_v;
                                    let card_style = if is_selected {
                                        "border-accent/60 bg-accent/10"
                                    } else {
                                        "border-edge hover:border-white/20 hover:bg-white/[0.04]"
                                    };
                                    let thumb = model_gradient(m.hue);
                                    let badge_variant = if m.badge == "New" { "new" } else { "" };
                                    let mut model_set = model;
                                    rsx! {
                                        button {
                                            key: "{m.name}",
                                            class: "flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors duration-150 {card_style}",
                                            onclick: move |_| {
                                                model_set.set(m.name.to_string());
                                                model_open.set(false);
                                            },
                                            div {
                                                class: "relative size-12 shrink-0 overflow-hidden rounded-lg",
                                                style: "{thumb}",
                                                div { class: "absolute inset-0 grid place-items-center",
                                                    div { class: "grid size-6 place-items-center rounded-full bg-black/40 backdrop-blur-sm",
                                                        Icon { name: "play", class: "size-2.5 translate-x-px text-white", stroke_width: 2.0 }
                                                    }
                                                }
                                            }
                                            div { class: "min-w-0 flex-1",
                                                div { class: "flex items-center gap-1.5",
                                                    span { class: "truncate text-[12.5px] font-semibold text-white",
                                                        "{m.name}"
                                                    }
                                                    if !m.badge.is_empty() {
                                                        Badge { label: m.badge, variant: badge_variant }
                                                    }
                                                }
                                                div { class: "mt-0.5 text-[10.5px] tabular-nums text-sub",
                                                    "{m.spec}"
                                                }
                                                div { class: "mt-1.5 flex flex-wrap gap-1",
                                                    for f in m.features {
                                                        span { class: "inline-flex items-center gap-1 rounded-md border border-edge bg-input/60 px-1.5 py-0.5 text-[9.5px] font-medium text-sub",
                                                            Icon {
                                                                name: feature_icon(f),
                                                                class: "size-2.5 shrink-0 text-accent/80",
                                                            }
                                                            "{f}"
                                                        }
                                                    }
                                                }
                                            }
                                            if is_selected {
                                                Icon {
                                                    name: "check",
                                                    class: "mt-1 size-3.5 shrink-0 text-accent",
                                                    stroke_width: 2.2,
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Prompt composer
                div { class: "rounded-xl border border-edge bg-input/70",
                    div { class: "px-3 pt-3 text-[13px] font-semibold text-white",
                        "Describe your video"
                    }

                    // Visual references — dashed purple box with overlapping thumbs
                    div { class: "mx-3 mt-2.5 rounded-lg border border-dashed border-accent/60 bg-accent/[0.06] p-2.5 transition-colors duration-150 hover:bg-accent/[0.1]",
                        div { class: "flex items-center gap-2.5",
                            div { class: "flex -space-x-3",
                                div { class: "size-8 shrink-0 rounded-md bg-linear-to-br from-fuchsia-500/70 to-purple-900/80 ring-2 ring-input" }
                                div { class: "size-8 shrink-0 rounded-md bg-linear-to-br from-indigo-500/60 to-slate-900/80 ring-2 ring-input" }
                                div { class: "grid size-8 shrink-0 place-items-center rounded-md bg-linear-to-br from-purple-500/50 to-neutral-900/80 ring-2 ring-input",
                                    Icon { name: "plus", class: "size-3.5 text-white/80" }
                                }
                            }
                            div { class: "min-w-0 flex-1",
                                div { class: "flex flex-wrap items-center gap-1.5",
                                    span { class: "text-[12px] font-medium text-white",
                                        "Add visual references"
                                    }
                                    span { class: "text-[11px] text-sub", "Optional" }
                                    span { class: "rounded bg-white/10 px-1 text-[10px] font-medium leading-4 text-sub",
                                        "0/50"
                                    }
                                }
                                div { class: "mt-0.5 text-[10.5px] leading-4 text-sub/80",
                                    "JPEG / PNG / WEBP · up to 30 MB each · max 50 files"
                                }
                            }
                            Icon { name: "plus", class: "size-4 shrink-0 text-accent" }
                        }
                    }

                    // Prompt text area
                    textarea {
                        class: "min-h-[110px] w-full resize-none bg-transparent px-3 pb-1 pt-3 text-[13px] leading-relaxed text-white outline-none placeholder:text-sub/70",
                        placeholder: "Enter text to freely combine reference assets and generate a video.",
                        value: "{prompt_v}",
                        oninput: move |e| prompt.set(e.value()),
                    }

                    // Prompt toolbar + Auto Polish
                    div { class: "flex items-center gap-0.5 px-2 pb-2",
                        IconButton { icon: "camera", label: "Add shot", on_press: move |_| {} }
                        IconButton { icon: "crop", label: "Framing", on_press: move |_| {} }
                        IconButton { icon: "wand", label: "Enhance prompt", on_press: move |_| {} }
                        IconButton {
                            icon: "trash",
                            label: "Clear prompt",
                            on_press: move |_| prompt.set(String::new()),
                        }
                        div { class: "ml-auto flex items-center gap-2 pr-1",
                            span { class: "text-[11px] text-sub", "Auto Polish" }
                            ToggleSwitch {
                                on: auto_polish_v,
                                on_toggle: move |_| auto_polish.toggle(),
                            }
                        }
                    }
                }

                // Settings row: Audio + Output
                div { class: "flex items-center justify-between rounded-xl border border-edge bg-input/70 px-3 py-2.5",

                    // Audio toggle (left)
                    div {
                        class: "flex cursor-pointer select-none items-center gap-2",
                        onclick: move |_| audio_on.toggle(),
                        Icon {
                            name: audio_icon_name,
                            class: audio_icon_class,
                        }
                        span { class: "{audio_label_class}",
                            "{audio_label}"
                        }
                        ToggleSwitch {
                            on: audio_on_v,
                            accent: "pink",
                            on_toggle: move |_| audio_on.toggle(),
                        }
                    }

                    // Output settings dropdown (right)
                    div { class: "relative",
                        button {
                            class: "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors duration-150 hover:bg-white/5",
                            onclick: move |_| output_open.toggle(),
                            Icon { name: "sliders", class: "size-4 text-sub" }
                            span { class: "font-medium text-white",
                                "{aspect_v} | {resolution_v} | {duration_v}"
                            }
                            Icon { name: "chevron-down", class: "size-3.5 text-sub" }
                        }

                        if output_open_v {
                            div {
                                class: "fixed inset-0 z-30",
                                onclick: move |_| output_open.set(false),
                            }
                            div { class: "absolute right-0 top-full z-40 mt-1 w-64 space-y-3 rounded-xl border border-edge bg-panel p-3 shadow-[0_16px_48px_rgba(0,0,0,0.6)]",

                                SettingGroup { label: "Aspect ratio" }
                                div { class: "flex flex-wrap gap-1.5",
                                    for r in RATIOS {
                                        SettingChip {
                                            key: "{r}",
                                            label: r,
                                            selected: aspect_v == r,
                                            on_press: move |_| aspect.set(r.to_string()),
                                        }
                                    }
                                }

                                SettingGroup { label: "Resolution" }
                                div { class: "flex flex-wrap gap-1.5",
                                    for r in RESOLUTIONS {
                                        SettingChip {
                                            key: "{r}",
                                            label: r,
                                            selected: resolution_v == r,
                                            on_press: move |_| resolution.set(r.to_string()),
                                        }
                                    }
                                }

                                SettingGroup { label: "Duration" }
                                div { class: "flex flex-wrap gap-1.5",
                                    for d in DURATIONS {
                                        SettingChip {
                                            key: "{d}",
                                            label: d,
                                            selected: duration_v == d,
                                            on_press: move |_| duration.set(d.to_string()),
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ---- Generation action ------------------------------------------
            div { class: "shrink-0 space-y-3 border-t border-edge p-3",

                div { class: "flex items-center gap-2",
                    // Quantity stepper
                    div { class: "flex h-10 shrink-0 items-center rounded-xl border border-edge bg-input/70",
                        button {
                            class: "grid h-full w-9 place-items-center rounded-l-xl text-sub transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-sub",
                            disabled: qty <= 1,
                            "aria-label": "Fewer videos",
                            onclick: move |_| {
                                let q = quantity();
                                if q > 1 {
                                    quantity.set(q - 1);
                                }
                            },
                            Icon { name: "minus", class: "size-4" }
                        }
                        div { class: "w-12 text-center text-[12px] font-semibold tabular-nums text-white",
                            "{qty}/8"
                        }
                        button {
                            class: "grid h-full w-9 place-items-center rounded-r-xl text-sub transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-sub",
                            disabled: qty >= 8,
                            "aria-label": "More videos",
                            onclick: move |_| {
                                let q = quantity();
                                if q < 8 {
                                    quantity.set(q + 1);
                                }
                            },
                            Icon { name: "plus", class: "size-4" }
                        }
                    }

                    // Generate — free & unlimited, strictly no cost/credits label
                    button {
                        class: "flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-b from-accent1 to-accent2 text-[13px] font-semibold text-white shadow-[0_4px_24px_rgba(176,38,255,0.35)] transition-all duration-200 hover:brightness-110 active:scale-[0.99] {generate_style}",
                        onclick: on_generate,
                        Icon { name: "sparkles", class: "size-4", stroke_width: 1.9 }
                        {if generating_v { "Generating…" } else { "Generate" }}
                    }
                }

                // Chat / Tools pill toggle
                div { class: "mx-auto flex w-fit items-center rounded-full border border-edge bg-input/70 p-1",
                    for (id, label) in [("chat", "Chat"), ("tools", "Tools")] {
                        {
                            let is_active = panel_mode_v == id;
                            let style = if is_active {
                                "bg-white/10 text-white shadow-inner"
                            } else {
                                "text-sub hover:text-white"
                            };
                            rsx! {
                                button {
                                    key: "{id}",
                                    class: "rounded-full px-5 py-1 text-[12px] font-medium transition-colors duration-150 {style}",
                                    onclick: move |_| panel_mode.set(id),
                                    "{label}"
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
// Model card helpers
// ---------------------------------------------------------------------------

/// Tiny icon for a model feature chip.
fn feature_icon(feature: &str) -> &'static str {
    match feature {
        "Reference" => "image",
        "Start-End" => "play",
        "Audio" => "mic",
        _ => "sparkles",
    }
}

/// Vivid vibe gradient for a model's thumbnail, hue-driven like the
/// workspace tiles.
fn model_gradient(hue: u16) -> String {
    let hue2 = (hue + 50) % 360;
    format!(
        "background-image: linear-gradient(140deg, hsl({hue}, 55%, 24%), hsl({hue2}, 68%, 40%))"
    )
}

// ---------------------------------------------------------------------------
// Small local helpers for the output settings popover
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
struct SettingGroupProps {
    label: &'static str,
}

fn SettingGroup(props: SettingGroupProps) -> Element {
    rsx! {
        div { class: "text-[10px] font-semibold uppercase tracking-[0.12em] text-sub/60",
            "{props.label}"
        }
    }
}

#[derive(Props, Clone, PartialEq)]
struct SettingChipProps {
    label: &'static str,
    selected: bool,
    on_press: EventHandler<()>,
}

fn SettingChip(props: SettingChipProps) -> Element {
    let style = if props.selected {
        "border-accent/70 bg-accent/10 text-white"
    } else {
        "border-edge text-sub hover:border-white/20 hover:text-white"
    };
    rsx! {
        button {
            class: "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150 {style}",
            onclick: move |_| props.on_press.call(()),
            "{props.label}"
        }
    }
}
