//! Reusable UI primitives: Badge, IconButton, SidebarItem, ToolButton,
//! ToggleSwitch, DropdownMenu and SectionHeader.

use dioxus::prelude::*;

use crate::icons::Icon;

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct BadgeProps {
    pub label: &'static str,
    /// "new" -> neon purple highlight, anything else -> muted neutral pill.
    #[props(default)]
    pub variant: &'static str,
}

pub fn Badge(props: BadgeProps) -> Element {
    let style = if props.variant == "new" {
        "border-accent/40 bg-accent/15 text-accent"
    } else {
        "border-white/10 bg-white/[0.07] text-sub"
    };
    rsx! {
        span { class: "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none {style}",
            if props.variant == "new" {
                span { class: "size-1 rounded-full bg-accent" }
            }
            "{props.label}"
        }
    }
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct IconButtonProps {
    pub icon: &'static str,
    #[props(default)]
    pub label: &'static str,
    #[props(default)]
    pub class: &'static str,
    #[props(default)]
    pub active: bool,
    pub on_press: EventHandler<()>,
}

pub fn IconButton(props: IconButtonProps) -> Element {
    let active_style = if props.active {
        "bg-white/10 text-white"
    } else {
        ""
    };
    rsx! {
        button {
            class: "grid size-8 shrink-0 place-items-center rounded-lg text-sub transition-colors duration-150 hover:bg-white/5 hover:text-white {active_style} {props.class}",
            title: "{props.label}",
            "aria-label": "{props.label}",
            onclick: move |_| props.on_press.call(()),
            Icon { name: props.icon, class: "size-[17px]" }
        }
    }
}

// ---------------------------------------------------------------------------
// SidebarItem
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct SidebarItemProps {
    pub icon: &'static str,
    pub label: &'static str,
    #[props(default)]
    pub badge: &'static str,
    #[props(default)]
    pub badge_variant: &'static str,
    #[props(default)]
    pub active: bool,
    pub on_press: EventHandler<()>,
}

pub fn SidebarItem(props: SidebarItemProps) -> Element {
    let item_style = if props.active {
        "bg-white/[0.07] text-white"
    } else {
        "text-sub hover:bg-white/5 hover:text-white"
    };
    let icon_class = if props.active {
        "size-[17px] shrink-0 text-accent"
    } else {
        "size-[17px] shrink-0 text-sub group-hover:text-white"
    };
    rsx! {
        button {
            class: "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-150 {item_style}",
            onclick: move |_| props.on_press.call(()),
            Icon { name: props.icon, class: icon_class }
            span { class: "truncate", "{props.label}" }
            if !props.badge.is_empty() {
                span { class: "ml-auto", Badge { label: props.badge, variant: props.badge_variant } }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// ToolButton
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct ToolButtonProps {
    pub icon: &'static str,
    pub label: &'static str,
    #[props(default)]
    pub active: bool,
    pub on_press: EventHandler<()>,
}

pub fn ToolButton(props: ToolButtonProps) -> Element {
    let style = if props.active {
        // Active tool: purple glow border + slightly lighter background.
        "border-accent/70 bg-accent/10 text-white shadow-[0_0_18px_rgba(176,38,255,0.35)]"
    } else {
        "border-edge bg-input/60 text-sub hover:border-white/20 hover:bg-input hover:text-white"
    };
    rsx! {
        button {
            class: "flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-[11px] font-medium transition-all duration-200 {style}",
            onclick: move |_| props.on_press.call(()),
            Icon { name: props.icon, class: "size-[19px]" }
            span { class: "w-full truncate text-center", "{props.label}" }
        }
    }
}

// ---------------------------------------------------------------------------
// ToggleSwitch
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct ToggleSwitchProps {
    #[props(default = true)]
    pub on: bool,
    /// "pink" -> pink/purple gradient (audio), default -> purple gradient.
    #[props(default)]
    pub accent: &'static str,
    pub on_toggle: EventHandler<()>,
}

pub fn ToggleSwitch(props: ToggleSwitchProps) -> Element {
    let track = if props.on {
        match props.accent {
            "pink" => "border-transparent bg-linear-to-r from-pink-500 to-accent",
            _ => "border-transparent bg-linear-to-r from-accent1 to-accent",
        }
    } else {
        "border-white/15 bg-white/10"
    };
    let knob = if props.on {
        "translate-x-4"
    } else {
        "translate-x-0"
    };
    rsx! {
        button {
            class: "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200 {track}",
            "aria-pressed": "{props.on}",
            onclick: move |_| props.on_toggle.call(()),
            span { class: "absolute left-0.5 top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-transform duration-200 {knob}" }
        }
    }
}

// ---------------------------------------------------------------------------
// DropdownMenu
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct DropdownMenuProps {
    pub options: Vec<String>,
    pub selected: String,
    pub on_select: Callback<String>,
    /// Positioning classes for the floating menu, e.g. "left-0 top-full mt-1 w-44".
    pub menu_class: &'static str,
    /// Classes for the trigger button.
    #[props(default = "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-white hover:bg-white/5")]
    pub button_class: &'static str,
    pub children: Element,
}

pub fn DropdownMenu(props: DropdownMenuProps) -> Element {
    let mut open = use_signal(|| false);
    let chevron_class = if open() {
        "size-3.5 shrink-0 text-sub transition-transform duration-200 rotate-180"
    } else {
        "size-3.5 shrink-0 text-sub transition-transform duration-200"
    };
    let items: Vec<(String, bool)> = props
        .options
        .iter()
        .map(|o| (o.clone(), *o == props.selected))
        .collect();

    rsx! {
        div { class: "relative",
            button {
                class: "{props.button_class}",
                onclick: move |_| open.toggle(),
                {props.children}
                Icon {
                    name: "chevron-down",
                    class: chevron_class,
                }
            }

            if open() {
                // Click-away catcher
                div { class: "fixed inset-0 z-30", onclick: move |_| open.set(false) }
                div { class: "absolute z-40 min-w-40 overflow-hidden rounded-xl border border-edge bg-panel p-1 shadow-[0_16px_48px_rgba(0,0,0,0.6)] {props.menu_class}",
                    for (option, selected) in items {
                        {let click_option = option.clone(); let option_style = if selected {"bg-accent/10 text-white"} else {"text-sub hover:bg-white/5 hover:text-white"}; rsx! {
                            button {
                                key: "{option}",
                                class: "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors {option_style}",
                                onclick: move |_| {
                                    props.on_select.call(click_option.clone());
                                    open.set(false);
                                },
                                span { class: "truncate", "{option}" }
                                if selected {
                                    Icon { name: "sparkles", class: "size-3.5 text-accent" }
                                }
                            }
                        }}
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

#[derive(Props, Clone, PartialEq)]
pub struct SectionHeaderProps {
    pub label: &'static str,
}

pub fn SectionHeader(props: SectionHeaderProps) -> Element {
    rsx! {
        div { class: "px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sub/60",
            "{props.label}"
        }
    }
}
