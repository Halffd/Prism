//! Media capability UI (image generation, inpainting, video, 3D model).
//!
//! Thin host over `prism_core::media`: the panel owns no AI logic. It
//! builds a `MediaRequest`, hands it to the core's runtime, and reports
//! the outcome back on the UI thread.

use crate::shared::{AppWindow, State};
use prism_core::media::{
    default_base_url, MediaKind, MediaOutcome, MediaRequest,
};
use slint::{SharedString, VecModel};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::mpsc::{Receiver, TryRecvError};

/// The capabilities the panel offers, in panel order.
pub const MEDIA_KINDS: &[(&str, MediaKind)] = &[
    ("Image", MediaKind::Image),
    ("Inpaint", MediaKind::Inpaint),
    ("Video", MediaKind::Video),
    ("3D model", MediaKind::Model),
];

/// Providers per capability, in panel order.
pub const MEDIA_PROVIDERS: &[(&str, &[&str])] = &[
    ("Image", &["stability"]),
    ("Inpaint", &["stability"]),
    ("Video", &["runway", "kling", "luma"]),
    ("3D model", &["meshy", "tripo"]),
];

/// Where the media panel currently is.
#[derive(Debug)]
pub struct MediaState {
    /// Index into [`MEDIA_KINDS`].
    pub kind_idx: usize,
    /// Index into the current kind's provider list.
    pub provider_idx: usize,
    /// Task id of a request that is still running.
    pub task_id: Option<String>,
    /// Receiver for the in-flight request.
    pub rx: Option<Receiver<MediaOutcome>>,
    /// Provider the in-flight request belongs to.
    pub provider: String,
    /// Base URL the in-flight request belongs to.
    pub base_url: String,
    /// API key the in-flight request belongs to.
    pub api_key: String,
}

impl Default for MediaState {
    fn default() -> Self {
        MediaState {
            kind_idx: 0,
            provider_idx: 0,
            task_id: None,
            rx: None,
            provider: String::new(),
            base_url: String::new(),
            api_key: String::new(),
        }
    }
}

impl MediaState {
    /// The capability currently selected.
    pub fn kind(&self) -> MediaKind {
        MEDIA_KINDS
            .get(self.kind_idx)
            .map(|(_, k)| *k)
            .unwrap_or(MediaKind::Image)
    }

    /// The provider currently selected.
    pub fn provider(&self) -> &'static str {
        let providers = MEDIA_PROVIDERS
            .get(self.kind_idx)
            .map(|(_, p)| *p)
            .unwrap_or(&[]);
        providers
            .get(self.provider_idx)
            .copied()
            .unwrap_or("")
    }

    /// Whether the selected capability takes a source image.
    pub fn needs_image(&self) -> bool {
        matches!(self.kind(), MediaKind::Inpaint | MediaKind::Video | MediaKind::Model)
    }

    /// Whether the selected capability takes a mask image.
    pub fn needs_mask(&self) -> bool {
        matches!(self.kind(), MediaKind::Inpaint)
    }

    /// The provider list for the current capability.
    pub fn provider_labels(&self) -> Vec<SharedString> {
        MEDIA_PROVIDERS
            .get(self.kind_idx)
            .map(|(_, p)| p.iter().map(|s| SharedString::from(*s)).collect())
            .unwrap_or_default()
    }
}

/// Parse a positive integer field, treating empty input as "unset".
pub fn parse_opt_u32(text: &str) -> Option<u32> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<u32>().ok()
}

/// Parse a seed field, treating empty input as "unset".
pub fn parse_opt_u64(text: &str) -> Option<u64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<u64>().ok()
}

/// The API key to use for a media provider.
///
/// Media providers are not part of the chat provider catalogue, so the
/// key comes from the `MEDIA_API_KEY` environment variable or from the
/// provider-specific `<PROVIDER>_API_KEY` variable. An empty key is
/// passed through: local providers do not need one.
pub fn media_api_key(provider: &str) -> String {
    let specific = format!(
        "{}_API_KEY",
        provider.to_uppercase().replace('-', "_")
    );
    if let Ok(v) = std::env::var(&specific) {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    std::env::var("MEDIA_API_KEY")
        .ok()
        .map(|v| v.trim().to_string())
        .unwrap_or_default()
}

/// Build the request for the current panel state.
pub fn build_request(
    media: &MediaState,
    prompt: &str,
    negative_prompt: &str,
    image_url: &str,
    mask_url: &str,
    model: &str,
    aspect_ratio: &str,
    duration: &str,
    seed: &str,
    format: &str,
) -> MediaRequest {
    MediaRequest {
        provider: media.provider().to_string(),
        base_url: default_base_url(media.provider()).to_string(),
        api_key: media_api_key(media.provider()),
        prompt: prompt.trim().to_string(),
        negative_prompt: non_empty(negative_prompt),
        model: non_empty(model),
        image: non_empty(image_url),
        mask: non_empty(mask_url),
        aspect_ratio: non_empty(aspect_ratio),
        duration: parse_opt_u32(duration),
        seed: parse_opt_u64(seed),
        format: non_empty(format),
    }
}

fn non_empty(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Switch capability, resetting the provider to the first one of the new
/// capability and refreshing the panel's provider list.
pub fn select_kind(ui: &AppWindow, state: &Rc<RefCell<State>>, kind_idx: i32) {
    let mut st = state.borrow_mut();
    let idx = kind_idx.clamp(0, MEDIA_KINDS.len() as i32 - 1) as usize;
    st.media.kind_idx = idx;
    st.media.provider_idx = 0;
    st.media.task_id = None;
    let labels = st.media.provider_labels();
    let provider = st.media.provider();
    let needs_image = st.media.needs_image();
    let needs_mask = st.media.needs_mask();
    drop(st);
    ui.set_media_kind_idx(idx as i32);
    ui.set_media_provider_labels(slint::ModelRc::from(Rc::new(VecModel::from(
        labels,
    ))));
    ui.set_media_provider_idx(0);
    ui.set_media_provider(provider.into());
    ui.set_media_needs_image(needs_image);
    ui.set_media_needs_mask(needs_mask);
    ui.set_media_status("".into());
    ui.set_media_result_url("".into());
    ui.set_media_pending(false);
}

/// Switch provider within the current capability.
pub fn select_provider(ui: &AppWindow, state: &Rc<RefCell<State>>, provider_idx: i32) {
    let mut st = state.borrow_mut();
    let max = MEDIA_PROVIDERS
        .get(st.media.kind_idx)
        .map(|(_, p)| p.len())
        .unwrap_or(1)
        .max(1);
    st.media.provider_idx = provider_idx.clamp(0, max as i32 - 1) as usize;
    let provider = st.media.provider();
    drop(st);
    ui.set_media_provider_idx(provider_idx);
    ui.set_media_provider(provider.into());
}

/// Start a media request from the panel's current field values.
pub fn generate(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let mut st = state.borrow_mut();
    if st.media.rx.is_some() {
        // A request is already in flight; don't stack another one.
        return;
    }
    let provider = st.media.provider().to_string();
    if provider.is_empty() {
        drop(st);
        ui.set_media_status("No provider selected.".into());
        return;
    }
    let req = build_request(
        &st.media,
        &ui.get_media_prompt(),
        &ui.get_media_negative_prompt(),
        &ui.get_media_image_url(),
        &ui.get_media_mask_url(),
        &ui.get_media_model(),
        &ui.get_media_aspect_ratio(),
        &ui.get_media_duration(),
        &ui.get_media_seed(),
        &ui.get_media_format(),
    );
    if req.prompt.is_empty() && req.image.is_none() {
        drop(st);
        ui.set_media_status("Enter a prompt first.".into());
        return;
    }
    let kind = st.media.kind();
    let base_url = req.base_url.clone();
    let api_key = req.api_key.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    st.media.rx = Some(rx);
    st.media.provider = provider.clone();
    st.media.base_url = base_url.clone();
    st.media.api_key = api_key.clone();
    st.media.task_id = None;
    drop(st);

    ui.set_media_busy(true);
    ui.set_media_pending(false);
    ui.set_media_status("Working…".into());
    ui.set_media_result_url("".into());

    prism_core::host::spawn_media(kind, req, tx);
}

/// Ask the provider whether a pending task is done yet.
pub fn poll(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let mut st = state.borrow_mut();
    let Some(task_id) = st.media.task_id.clone() else {
        drop(st);
        return;
    };
    let provider = st.media.provider.clone();
    let base_url = st.media.base_url.clone();
    let api_key = st.media.api_key.clone();
    st.media.rx = None;
    drop(st);

    let (tx, rx) = std::sync::mpsc::channel();
    state.borrow_mut().media.rx = Some(rx);
    ui.set_media_busy(true);
    ui.set_media_status("Checking…".into());
    prism_core::host::spawn_media_poll(provider, base_url, api_key, task_id, tx);
}

/// Drain the media outcome channel and update the panel.
pub fn drain(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let mut st = state.borrow_mut();
    let Some(rx) = st.media.rx.take() else {
        return;
    };
    match rx.try_recv() {
        Ok(MediaOutcome::Ready(url)) => {
            st.media.task_id = None;
            drop(st);
            ui.set_media_busy(false);
            ui.set_media_pending(false);
            ui.set_media_status("Done.".into());
            ui.set_media_result_url(url.into());
        }
        Ok(MediaOutcome::Pending(task_id)) => {
            st.media.task_id = Some(task_id);
            drop(st);
            ui.set_media_busy(false);
            ui.set_media_pending(true);
            ui.set_media_status("Still working. Use \"Check status\".".into());
        }
        Ok(MediaOutcome::Failed(reason)) => {
            st.media.task_id = None;
            drop(st);
            ui.set_media_busy(false);
            ui.set_media_pending(false);
            ui.set_media_status(reason.into());
        }
        Err(TryRecvError::Empty) => {
            st.media.rx = Some(rx);
        }
        Err(TryRecvError::Disconnected) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capability_without_a_source_image_does_not_ask_for_one() {
        let media = MediaState::default();
        assert_eq!(media.kind(), MediaKind::Image);
        assert!(!media.needs_image());
        assert!(!media.needs_mask());
    }

    #[test]
    fn inpainting_asks_for_both_a_source_image_and_a_mask() {
        let media = MediaState {
            kind_idx: 1,
            ..MediaState::default()
        };
        assert_eq!(media.kind(), MediaKind::Inpaint);
        assert!(media.needs_image());
        assert!(media.needs_mask());
    }

    #[test]
    fn video_asks_for_a_source_image_but_no_mask() {
        let media = MediaState {
            kind_idx: 2,
            ..MediaState::default()
        };
        assert_eq!(media.kind(), MediaKind::Video);
        assert!(media.needs_image());
        assert!(!media.needs_mask());
    }

    #[test]
    fn switching_capability_resets_the_provider_to_the_first_one() {
        let media = MediaState {
            kind_idx: 2,
            provider_idx: 2,
            ..MediaState::default()
        };
        assert_eq!(media.provider(), "luma");
    }

    #[test]
    fn empty_fields_are_left_unset() {
        let media = MediaState::default();
        let req = build_request(
            &media,
            "  a cat  ",
            "   ",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        );
        assert_eq!(req.prompt, "a cat");
        assert_eq!(req.negative_prompt, None);
        assert_eq!(req.model, None);
        assert_eq!(req.image, None);
        assert_eq!(req.mask, None);
        assert_eq!(req.aspect_ratio, None);
        assert_eq!(req.duration, None);
        assert_eq!(req.seed, None);
        assert_eq!(req.format, None);
    }

    #[test]
    fn numeric_fields_are_parsed_and_empty_ones_stay_unset() {
        assert_eq!(parse_opt_u32("5"), Some(5));
        assert_eq!(parse_opt_u32("  "), None);
        assert_eq!(parse_opt_u32("abc"), None);
        assert_eq!(parse_opt_u64("42"), Some(42));
        assert_eq!(parse_opt_u64(""), None);
    }

    #[test]
    fn a_request_carries_the_selected_provider_and_its_default_url() {
        let media = MediaState {
            kind_idx: 2,
            ..MediaState::default()
        };
        let req = build_request(&media, "a cat", "", "", "", "", "", "", "", "");
        assert_eq!(req.provider, "runway");
        assert_eq!(req.base_url, default_base_url("runway"));
    }
}
