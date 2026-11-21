//! Left sidebar: project switcher, Home, Agents, Tools grid, Assets,
//! Inspire and the footer (chat + language + settings). Router-aware:
//! Home and Chat Mode navigate; the rest keep in-page state.

use dioxus::prelude::*;

use crate::components::ui::{IconButton, SectionHeader, SidebarItem, ToolButton};
use crate::icons::Icon;
use crate::state::StudioState;
use crate::Route;

const AGENTS: [(&str, &str); 2] = [
    ("message-square", "Chat Mode"),
    ("clapperboard", "Director Mode"),
];

const TOOLS: [(&str, &str); 6] = [
    ("video", "Video"),
    ("image", "Image"),
    ("globe", "World"),
    ("user", "Character"),
    ("mic", "Audio"),
    ("puzzle", "Plugins"),
];

const ASSETS: [(&str, &str, &str, &str); 5] = [
    ("folder", "Director Projects", "", ""),
    ("user", "Character & World", "", ""),
    ("briefcase", "Brand kit", "", ""),
    ("film", "Media", "", ""),
    ("workflow", "Workflows", "Beta", ""),
];

const INSPIRE: [(&str, &str, &str, &str); 2] = [
    ("template", "Templates", "", ""),
    ("zap", "Arena", "New", "new"),
];

pub fn Sidebar() -> Element {
    let mut state = use_context::<StudioState>();
    let mut active_tool = use_signal(|| "video");
    let mut active_nav = use_signal(|| String::new());

    let route = use_route::<Route>();
    let nav = navigator();
    let home_active = route == Route::Studio {};
    let chat_active = route == Route::Chat {};
    let image_active = route == Route::Image {};
    let settings_active = route == Route::Settings {};

    let open = state.drawer_open();
    let drawer_style = if open {
        "fixed inset-y-0 left-0 z-40 flex shadow-[0_0_80px_rgba(0,0,0,0.9)]"
    } else {
        "hidden"
    };

    rsx! {
        aside { class: "w-[250px] shrink-0 flex-col border-r border-edge bg-panel lg:static lg:flex {drawer_style}",

            // ---- Header: project switcher ---------------------------------
            div { class: "flex h-14 shrink-0 items-center justify-between border-b border-edge px-3",
                button {
                    class: "group flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/5",
                    onclick: move |_| {
                        nav.push(Route::Studio {});
                        state.sidebar_open.set(false);
                    },
                    div { class: "grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent1 to-accent2",
                        Icon { name: "clapperboard", class: "size-4 text-white", stroke_width: 1.9 }
                    }
                    span { class: "min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-white",
                        "Personal Project"
                    }
                    Icon { name: "chevron-down", class: "size-3.5 shrink-0 text-sub" }
                }
                IconButton {
                    icon: "close",
                    label: "Close sidebar",
                    class: "lg:hidden",
                    on_press: move |_| state.sidebar_open.set(false),
                }
            }

            // ---- Navigation ------------------------------------------------
            nav { class: "flex-1 space-y-4 overflow-y-auto px-2.5 py-3",

                SidebarItem {
                    icon: "home",
                    label: "Home",
                    active: home_active,
                    on_press: move |_| {
                        nav.push(Route::Studio {});
                        state.sidebar_open.set(false);
                    },
                }

                // AGENTS
                SectionHeader { label: "Agents" }
                for (icon, label) in AGENTS {
                    {
                        let is_chat = label == "Chat Mode";
                        let nav_chat = nav.clone();
                        rsx! {
                            SidebarItem {
                                key: "{label}",
                                icon: icon,
                                label: label,
                                active: if is_chat { chat_active } else { active_nav() == label },
                                on_press: move |_| {
                                    if is_chat {
                                        nav_chat.push(Route::Chat {});
                                    } else {
                                        active_nav.set(label.to_string());
                                    }
                                    state.sidebar_open.set(false);
                                },
                            }
                        }
                    }
                }

                // TOOLS
                SectionHeader { label: "Tools" }
                div { class: "grid grid-cols-3 gap-1.5",
                    for (id, label) in TOOLS {
                        {
                            // Only Image has a destination today; the
                            // other Tools stay in-page selections.
                            let is_image = id == "image";
                            let tool_nav = nav.clone();
                            let tool_active = if is_image { image_active } else { active_tool() == id };
                            rsx! {
                                ToolButton {
                                    key: "{id}",
                                    icon: id,
                                    label: label,
                                    active: tool_active,
                                    on_press: move |_| {
                                        active_tool.set(id);
                                        if is_image {
                                            tool_nav.push(Route::Image {});
                                        }
                                        state.sidebar_open.set(false);
                                    },
                                }
                            }
                        }
                    }
                }

                // ASSETS
                SectionHeader { label: "Assets" }
                for (icon, label, badge, variant) in ASSETS {
                    SidebarItem {
                        key: "{label}",
                        icon: icon,
                        label: label,
                        badge: badge,
                        badge_variant: variant,
                        active: active_nav() == label,
                        on_press: move |_| {
                            active_nav.set(label.to_string());
                            state.sidebar_open.set(false);
                        },
                    }
                }

                // INSPIRE
                SectionHeader { label: "Inspire" }
                for (icon, label, badge, variant) in INSPIRE {
                    SidebarItem {
                        key: "{label}",
                        icon: icon,
                        label: label,
                        badge: badge,
                        badge_variant: variant,
                        active: active_nav() == label,
                        on_press: move |_| {
                            active_nav.set(label.to_string());
                            state.sidebar_open.set(false);
                        },
                    }
                }
            }

            // ---- Footer -----------------------------------------------------
            div { class: "flex h-12 shrink-0 items-center gap-1 border-t border-edge px-3",
                IconButton {
                    icon: "message-square",
                    label: "Chat",
                    active: chat_active,
                    on_press: move |_| {
                        nav.push(Route::Chat {});
                        state.sidebar_open.set(false);
                    },
                }
                IconButton { icon: "globe", label: "Language: English", on_press: move |_| {} }
                IconButton {
                    icon: "settings",
                    label: "Settings",
                    class: "ml-auto",
                    active: settings_active,
                    on_press: move |_| {
                        nav.push(Route::Settings {});
                        state.sidebar_open.set(false);
                    },
                }
            }
        }
    }
}
