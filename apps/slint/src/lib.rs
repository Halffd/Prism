//! Prism library entry points.
//!
//! The Android entry point lives here because Slint's Android backend
//! (backend-android-activity-06) requires an `android_main` symbol in a
//! cdylib. Desktop builds run `src/main.rs`. Both call
//! `shared::run_ui()`, which owns the whole UI setup (window, callbacks,
//! timers) — one code path for every platform.
//!
//! `run_ui` is referenced from both entry points, so the lib target is
//! never dead code: the binary target uses it via main(), and the cdylib
//! uses it via android_main() on Android. On non-Android desktop lib
//! checks, this desktop entry keeps the reference graph alive so the
//! media poll/drain wiring (and everything else) does not warn as dead.

mod features;
mod shared;

#[cfg(target_os = "android")]
use slint::android::AndroidApp;

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn android_main(app: AndroidApp) {
    slint::android::init(app).expect("failed to init Slint Android backend");
    shared::run_ui();
}

/// Desktop entry point (used when built as a lib by tooling/tests; the
/// real desktop binary uses src/main.rs).
#[cfg(not(target_os = "android"))]
#[no_mangle]
pub extern "C" fn prism_slint_main() {
    shared::run_ui();
}

#[cfg(test)]
mod headless_tests {
    //! Window-creation smoke test on the no-render testing backend:
    //! proves the compiled .slint (types, properties, callbacks) really
    //! instantiates, without needing a display.

    use crate::shared::AppWindow;
    use slint::{ComponentHandle, Model};
    use std::cell::RefCell;
    use std::rc::Rc;

    #[test]
    fn the_window_builds_and_plumbs_properties() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        // A sample of the studio plumbing: set and read back.
        ui.set_studio_model_idx(2);
        assert_eq!(ui.get_studio_model_idx(), 2);
        ui.set_studio_quantity(3);
        assert_eq!(ui.get_studio_quantity(), 3);
        ui.set_studio_status("test".into());
        assert_eq!(ui.get_studio_status(), "test");
    }

    #[test]
    fn the_studio_generates_and_lands_tiles_headless() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        let state = Rc::new(RefCell::new(crate::shared::State::new()));
        crate::shared::studio::init(&ui, &state);

        // Model cards are populated from the core table.
        assert_eq!(ui.get_studio_models().row_count(), 5);

        // Generate with an empty prompt is refused.
        ui.set_studio_prompt("".into());
        crate::shared::studio::generate(&ui, &state);
        assert!(!ui.get_studio_busy());
        assert_eq!(ui.get_studio_status(), "Enter a prompt first.");

        // A prompt starts the render; draining the pump lands the tile.
        ui.set_studio_prompt("a neon city flyover".into());
        crate::shared::studio::generate(&ui, &state);
        assert!(ui.get_studio_busy());
        for _ in 0..60 {
            crate::shared::studio::drain(&ui, &state);
        }
        assert!(!ui.get_studio_busy());
        assert_eq!(ui.get_studio_tiles().row_count(), 1);
        assert!(ui.get_studio_status().contains("ready"));
    }

    #[test]
    fn the_tool_rail_retitles_the_workspace_headless() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        let state = Rc::new(RefCell::new(crate::shared::State::new()));
        crate::shared::studio::init(&ui, &state);

        // Seeded from Rust, not hardcoded in markup.
        assert_eq!(ui.get_studio_tool_labels().row_count(), 6);
        assert_eq!(ui.get_studio_folder_labels().row_count(), 4);
        assert_eq!(ui.get_studio_tool_title(), "Text to Video");

        // Switching a pill moves the heading with it.
        crate::shared::studio::select_tool(&ui, &state, 1);
        assert_eq!(ui.get_studio_tool(), 1);
        assert_eq!(ui.get_studio_tool_title(), "Text to Image");
        crate::shared::studio::select_tool(&ui, &state, 4);
        assert_eq!(ui.get_studio_tool_title(), "Audio Studio");

        // Out of range clamps instead of panicking.
        crate::shared::studio::select_tool(&ui, &state, 99);
        assert_eq!(ui.get_studio_tool(), 5);
    }

    #[test]
    fn the_reference_zone_caps_and_clears_headless() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        let state = Rc::new(RefCell::new(crate::shared::State::new()));
        crate::shared::studio::init(&ui, &state);

        assert_eq!(ui.get_studio_refs(), 0);
        crate::shared::studio::ref_add(&ui, &state, 3);
        assert_eq!(ui.get_studio_refs(), 3);
        // A mass drop cannot push past the zone's cap.
        crate::shared::studio::ref_add(&ui, &state, 999);
        assert_eq!(ui.get_studio_refs(), 50);
        // Clearing returns the counter, and the prompt survives it.
        ui.set_studio_prompt("a lighthouse in fog".into());
        crate::shared::studio::refs_clear(&ui, &state);
        assert_eq!(ui.get_studio_refs(), 0);
        assert_eq!(ui.get_studio_prompt(), "a lighthouse in fog");
    }

    #[test]
    fn the_library_search_filters_and_clears_headless() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        let state = Rc::new(RefCell::new(crate::shared::State::new()));
        crate::shared::studio::init(&ui, &state);

        ui.set_studio_prompt("a neon city flyover".into());
        crate::shared::studio::generate(&ui, &state);
        for _ in 0..60 {
            crate::shared::studio::drain(&ui, &state);
        }
        assert_eq!(ui.get_studio_tiles().row_count(), 1);

        // A query that matches nothing empties the visible set but leaves
        // the library intact.
        crate::shared::studio::query_edited(&ui, &state, "zzz");
        assert_eq!(ui.get_studio_visible_tiles().row_count(), 0);
        assert_eq!(ui.get_studio_tiles().row_count(), 1);

        // A matching query brings the tile back.
        crate::shared::studio::query_edited(&ui, &state, "neon");
        assert_eq!(ui.get_studio_visible_tiles().row_count(), 1);

        // Clearing empties the library and reports it.
        crate::shared::studio::tiles_clear(&ui, &state);
        assert_eq!(ui.get_studio_tiles().row_count(), 0);
        assert_eq!(ui.get_studio_status(), "Library cleared.");
    }

    #[test]
    fn the_window_width_drives_the_drawers() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        let state = Rc::new(RefCell::new(crate::shared::State::new()));
        crate::shared::studio::init(&ui, &state);

        // A wide window lays the rail and the library out as columns.
        ui.window().set_size(slint::LogicalSize::new(1400.0, 900.0));
        crate::shared::studio::poll_narrow(&ui);
        assert!(!ui.get_studio_narrow());
        assert_eq!(ui.get_studio_width(), 1400.0);

        // Below the threshold the outer columns become drawers; above it
        // they are columns again. The width also feeds the narrow top bar,
        // whose own layout width is zero.
        ui.window().set_size(slint::LogicalSize::new(430.0, 800.0));
        crate::shared::studio::poll_narrow(&ui);
        assert!(ui.get_studio_narrow());
        assert_eq!(ui.get_studio_width(), 430.0);

        crate::shared::studio::set_drawer(&ui, &state, 1);
        assert_eq!(ui.get_studio_drawer(), 1);
        crate::shared::studio::set_drawer(&ui, &state, 2);
        assert_eq!(ui.get_studio_drawer(), 2);
        crate::shared::studio::set_drawer(&ui, &state, 0);
        assert_eq!(ui.get_studio_drawer(), 0);

        ui.window().set_size(slint::LogicalSize::new(1400.0, 900.0));
        crate::shared::studio::poll_narrow(&ui);
        assert!(!ui.get_studio_narrow());
        assert_eq!(ui.get_studio_width(), 1400.0);
    }

    #[test]
    fn the_image_studio_refuses_an_empty_prompt_headless() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        let state = Rc::new(RefCell::new(crate::shared::State::new()));
        crate::shared::image::init(&ui, &state);

        // Provider/sampler/scheduler tables are populated.
        assert_eq!(
            ui.get_image_provider_labels().row_count(),
            crate::shared::image::PROVIDERS.len()
        );
        assert_eq!(ui.get_image_sampler_labels().row_count(), 9);
        assert_eq!(ui.get_image_scheduler_labels().row_count(), 7);

        // An empty prompt is refused.
        ui.set_image_prompt("".into());
        crate::shared::image::generate(&ui, &state);
        assert!(!ui.get_image_busy());
        assert_eq!(ui.get_image_status(), "Enter a prompt first.");

        // The steppers clamp their range through the callbacks.
        ui.set_image_batch(8);
        crate::shared::image::batch_step(&ui, 1);
        assert_eq!(ui.get_image_batch(), 8);
        crate::shared::image::batch_step(&ui, -9);
        assert_eq!(ui.get_image_batch(), 1);
        ui.set_image_clip_skip(12);
        crate::shared::image::clip_step(&ui, 1);
        assert_eq!(ui.get_image_clip_skip(), 12);
    }

// ---- canvas node graph -----------------------------------------------------

#[test]
fn the_canvas_renders_the_shared_document_as_screen_rows() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().expect("AppWindow must build headless");
    let state = Rc::new(RefCell::new(crate::shared::State::new()));
    crate::shared::graph::init(&ui, &state);

    // The palette is the core's own table, not a hand-written list.
    assert_eq!(ui.get_canvas_palette().row_count(), 6);
    // The starter drawing is on the canvas; the pre-wired pipeline draws
    // wires, so the segment model is not empty.
    assert_eq!(ui.get_canvas_nodes().row_count(), 6);
    assert!(
        ui.get_canvas_ink().row_count() > 0,
        "the starter graph's wires should be drawn"
    );
    // Nothing is selected yet, so the inspector is empty.
    assert!(!ui.get_canvas_has_selection());
    assert_eq!(ui.get_canvas_knobs().row_count(), 0);
    assert!(ui.get_canvas_status().contains("shared canvas"));
    // The zoom label is a percentage a person can read.
    assert_eq!(ui.get_canvas_zoom(), "100%");
}

#[test]
fn the_palette_adds_a_node_and_selects_it() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().expect("AppWindow must build headless");
    let state = Rc::new(RefCell::new(crate::shared::State::new()));
    crate::shared::graph::init(&ui, &state);

    crate::shared::graph::add_node(&ui, &state, "seed");
    assert_eq!(ui.get_canvas_nodes().row_count(), 7);
    assert!(ui.get_canvas_has_selection());
    // The seed node's knobs appear in the inspector.
    assert!(ui.get_canvas_knobs().row_count() > 0);

    // An unknown kind is reported rather than silently dropped.
    let before = ui.get_canvas_nodes().row_count();
    crate::shared::graph::add_node(&ui, &state, "nonsense");
    assert_eq!(ui.get_canvas_nodes().row_count(), before);
    assert!(ui.get_canvas_status().contains("Unknown node"));
}

#[test]
fn a_click_on_the_canvas_cuts_the_wire_beneath_it() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().expect("AppWindow must build headless");
    let state = Rc::new(RefCell::new(crate::shared::State::new()));
    crate::shared::graph::init(&ui, &state);

    // The starter graph's checkpoint -> sampler wire runs from the checkpoint's
    // right edge (288, 90) to the sampler's left edge (420, 230), so its
    // midpoint is empty canvas a click can reach — which is exactly where a
    // wire is easiest to click and hardest to aim at by hand.
    let before = ui.get_canvas_ink().row_count();
    crate::shared::graph::pointer(&ui, &state, 1, 354.0, 160.0);
    crate::shared::graph::pointer(&ui, &state, 3, 354.0, 160.0);
    assert!(
        ui.get_canvas_ink().row_count() < before,
        "a click on a wire should cut it: {} -> {}",
        before,
        ui.get_canvas_ink().row_count()
    );
    assert!(ui.get_canvas_status().contains("Wire removed"));

    // A click in genuinely empty canvas cuts nothing.
    let after = ui.get_canvas_ink().row_count();
    crate::shared::graph::pointer(&ui, &state, 1, 20.0, 20.0);
    crate::shared::graph::pointer(&ui, &state, 3, 20.0, 20.0);
    assert_eq!(ui.get_canvas_ink().row_count(), after);
    assert!(!ui.get_canvas_has_selection());
}

#[test]
fn the_canvas_refuses_to_generate_from_a_blank_prompt() {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().expect("AppWindow must build headless");
    let state = Rc::new(RefCell::new(crate::shared::State::new()));
    crate::shared::graph::init(&ui, &state);

    // The starter graph has a Prompt node with no text in it, so the
    // flatten step reports which node needs writing instead of building a
    // request that would generate nothing.
    crate::shared::graph::generate(&ui, &state);
    assert!(!ui.get_canvas_busy(), "a refusal must not start a render");
    assert!(
        ui.get_canvas_status().contains("prompt"),
        "{} should say which node needs text",
        ui.get_canvas_status()
    );
}

#[test]
fn the_image_studio_renders_native_tiles_headless() {
        i_slint_backend_testing::init_no_event_loop();
        let ui = AppWindow::new().expect("AppWindow must build headless");
        let state = Rc::new(RefCell::new(crate::shared::State::new()));
        crate::shared::image::init(&ui, &state);

        // A small, fast render: two cells at 64px, 4 steps.
        ui.set_image_prompt("a fox in snow".into());
        ui.set_image_negative("blurry".into());
        ui.set_image_seed("11".into());
        ui.set_image_batch(2);
        ui.set_image_width("64".into());
        ui.set_image_height("64".into());
        ui.set_image_steps(4.0);
        crate::shared::image::generate(&ui, &state);
        assert!(ui.get_image_busy());

        // The native render runs on a worker thread; pump until it lands.
        for _ in 0..2000 {
            crate::shared::image::drain(&ui, &state);
            if !ui.get_image_busy() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(!ui.get_image_busy());
        assert_eq!(ui.get_image_tiles().row_count(), 2);
        assert_eq!(ui.get_image_status(), "2 images ready.");

        // LoRA rows: add two, remove one; the model follows.
        crate::shared::image::lora_add(&ui, &state);
        crate::shared::image::lora_add(&ui, &state);
        assert_eq!(ui.get_image_loras().row_count(), 2);
        crate::shared::image::lora_name_edited(&state, 0, "detail.safetensors");
        crate::shared::image::lora_weight_edited(&state, 0, "0.7");
        crate::shared::image::lora_remove(&ui, &state, 1);
        assert_eq!(ui.get_image_loras().row_count(), 1);
    }
}
