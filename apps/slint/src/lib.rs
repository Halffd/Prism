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
