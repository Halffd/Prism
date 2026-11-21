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
    use slint::Model;
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
