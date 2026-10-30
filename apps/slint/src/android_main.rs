// Android entry point for Slint app.
// This is called by the `slint` crate's Android backend (i-slint-backend-android-activity).
// It must call `slint::android_main` with a component builder closure.

use slint::android_main;

#[no_mangle]
fn android_main(app: slint::android::AndroidApp) {
    android_main(app, || {
        // The same AppWindow logic as desktop main()
        let ui = AppWindow::new().expect("failed to create AppWindow");

        let lines_model: Rc<VecModel<ChatLine>> = Rc::new(VecModel::from(Vec::new()));
        ui.set_transcript(ModelRc::from(lines_model.clone()));

        let state = Rc::new(RefCell::new(State::new()));

        // ---- initial property sync ----
        {
            let st = state.borrow();
            // (same initial sync as main.rs, factored out if needed)
        }

        // ---- callbacks + timer pump ----
        // (same callback wiring as main.rs)

        let timer = slint::Timer::default();
        {
            let ui_w = ui.as_weak();
            let state_c = state.clone();
            let lines_c = lines_model.clone();
            timer.start(
                slint::TimerMode::Repeated,
                std::time::Duration::from_millis(50),
                move || {
                    let Some(ui) = ui_w.upgrade() else { return };
                    drain_events(&ui, &state_c, &lines_c);
                    drain_models(&ui, &state_c);
                },
            );
        }

        ui.run().expect("slint event loop failed");
    });
}

// Re-export the shared types/functions so this file compiles.
// The actual implementations are in shared.rs.
mod main_impl {
    pub use crate::shared::{
        AppWindow, ChatLine, Line, State, ChatRow, KeyRow,
        effective_model, model_hint, cached_models, key_rows, gpu_label, ctx_label,
        parse_opt_u32, parse_opt_f32, refresh_transcript, refresh_chats, push_system,
        require_idle, persist_current, finalize_thinking, drain_events, drain_models,
        send, ollama_root_url, host, conversations, thinking, providers, PROVIDERS,
        COMPUTE_LEVELS, GPU_LAYER_CYCLE, CONTEXT_TOKEN_CYCLE, Connection, Settings,
    };
}

use main_impl::*;

