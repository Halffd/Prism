//! Android library entry point for Slint.
//! This crate is a cdylib linked with Slint's Android backend.
//! The Android entry point is `android_main` below, called by the
//! `slint` backend-android-activity-06 runtime.

mod shared;

#[cfg(target_os = "android")]
use slint::android::AndroidApp;

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "C" fn android_main(app: AndroidApp) {
    slint::android::init(app).expect("failed to init Slint Android backend");
    shared::run_ui();
}
