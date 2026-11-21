//! Shell layout: the sidebar plus an `<Outlet>` for the active route,
//! wrapped in the dark app chrome. The drawer state lives in the shared
//! context so the panel's hamburger can open it too.

use dioxus::prelude::*;

use crate::components::sidebar::Sidebar;
use crate::state::StudioState;
use crate::Route;

#[component]
pub fn ShellLayout() -> Element {
    let mut state = use_context::<StudioState>();
    let sidebar_open = state.drawer_open();

    rsx! {
        div { class: "relative flex h-dvh flex-col overflow-y-auto bg-app text-white lg:flex-row lg:overflow-hidden",

            // Mobile backdrop for the sidebar drawer
            if sidebar_open {
                div {
                    class: "fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden",
                    onclick: move |_| state.sidebar_open.set(false),
                }
            }

            Sidebar {}

            Outlet::<Route> {}
        }
    }
}
