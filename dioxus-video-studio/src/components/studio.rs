//! The `/` route: the generation dashboard — control panel on the
//! left, workspace on the right (stacked below on small screens).

use dioxus::prelude::*;

use crate::components::generation_panel::GenerationPanel;
use crate::components::workspace::Workspace;

pub fn Studio() -> Element {
    rsx! {
        div { class: "flex min-w-0 flex-1 flex-col lg:flex-row",
            GenerationPanel {}
            Workspace {}
        }
    }
}
