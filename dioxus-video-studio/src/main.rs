//! Video Studio — a high-fidelity AI video generation dashboard UI
//! built with Dioxus (WASM) + Tailwind CSS, wired to the Prism AI core.
//!
//! The app is a routed web app:
//!   `/`         Studio      — the generation dashboard
//!   `/chat`     Chat        — live chat over the configured Prism provider
//!   `/image`    Image       — node-style local image generation panel
//!   `/settings` Settings    — provider / model / API key, persisted
//!
//! Per the Prism single-core boundary design, this host drives its own
//! HTTP (browser fetch, see `api.rs`) and feeds raw bytes into
//! `prism-core`'s transport-free decoders and wire builders.

// Dioxus components use PascalCase by convention.
#![allow(non_snake_case)]

// The `Routable` derive emits an unreachable-call lint from its
// generated fallback code; the routes are all reachable. The lint does
// not respect item-level allows inside the derive expansion, so it is
// allowed at the crate level.
#![allow(unreachable_code)]

mod api;
mod components;
mod icons;
mod state;

use dioxus::prelude::*;
use state::StudioState;

use crate::components::chat_page::Chat;
use crate::components::image_page::Image;
use crate::components::settings_page::Settings;
use crate::components::studio::Studio;

// The `Routable` derive emits an unreachable-call lint from its
// generated fallback code; the routes are all reachable.
#[allow(unreachable_code)]
#[derive(Routable, Clone, PartialEq)]
enum Route {
    #[layout(components::shell::ShellLayout)]
    #[route("/")]
    Studio {},

    #[layout(components::shell::ShellLayout)]
    #[route("/chat")]
    Chat {},

    #[layout(components::shell::ShellLayout)]
    #[route("/image")]
    Image {},

    #[layout(components::shell::ShellLayout)]
    #[route("/settings")]
    Settings {},

    #[route("/:..segments")]
    NotFound { segments: Vec<String> },
}

fn main() {
    dioxus::launch(app);
}

fn app() -> Element {
    // One shared state container for every route: generation results,
    // Prism connection settings, chat transcript.
    use_context_provider(StudioState::new);

    rsx! {
        Router::<Route> {}
    }
}

#[component]
fn NotFound(segments: Vec<String>) -> Element {
    let path = segments.join("/");
    rsx! {
        div { class: "flex min-h-[75vh] flex-1 flex-col items-center justify-center gap-3 p-6 text-center",
            div { class: "text-4xl font-semibold text-white", "404" }
            div { class: "text-[13px] text-sub",
                "No page lives at " span { class: "text-accent font-mono", "/{path}" }
            }
            Link {
                to: Route::Studio {},
                class: "mt-2 rounded-xl bg-linear-to-b from-accent1 to-accent2 px-4 py-2 text-[12px] font-semibold text-white transition-all hover:brightness-110",
                "Back to Studio"
            }
        }
    }
}
