//! Image studio surface: a ComfyUI-style parameter panel with node
//! sections (Checkpoint / LoRA / Prompt / Sampler / Latent / Output)
//! over the local backends — the in-process preview renderer, optional
//! real Candle inference, an Automatic1111 install, or a ComfyUI install.
//!
//! Like the rest of the host, state lives here; `ui/app.slint` is
//! presentation only. Native renders run on a worker thread and report
//! back through a channel drained by the timer pump (Slint handles are
//! not `Send`). Remote providers reuse the media pipeline
//! (`host::spawn_media`) and — when the provider answers with a task id
//! (ComfyUI) — poll it automatically until the image is ready.

use crate::shared::{AppWindow, State};
use prism_core::media::{
    default_base_url, sd_batch, LoraSpec, MediaKind, MediaOutcome, MediaRequest, A1111_ID,
    COMFYUI_ID, MAX_BATCH, NATIVE_ID,
};
#[cfg(feature = "candle-sd")]
use prism_core::media::CANDLE_ID;
use slint::{ModelRc, VecModel};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::mpsc::{channel, Receiver, TryRecvError};
#[cfg(feature = "candle-sd")]
use std::collections::HashMap;
#[cfg(feature = "candle-sd")]
use std::path::Path;
#[cfg(feature = "candle-sd")]
use std::sync::{Arc, Mutex, OnceLock};

// ---------------------------------------------------------------------------
// Tables (what the node sections offer)
// ---------------------------------------------------------------------------

/// The local backends, in panel order. The native renderer needs
/// nothing installed; Candle needs local weights in the Base URL field;
/// the other two point at local installs.
pub const PROVIDERS: &[(&str, &str)] = &[
    (NATIVE_ID, "Native (built-in)"),
    #[cfg(feature = "candle-sd")]
    (CANDLE_ID, "Candle (real SD)"),
    (A1111_ID, "Automatic1111"),
    (COMFYUI_ID, "ComfyUI"),
];

/// Canonical sampler ids — exactly what ComfyUI's KSampler takes; the
/// A1111 mapping translates them to display names.
pub const SAMPLERS: &[&str] = &[
    "euler",
    "euler_ancestral",
    "dpmpp_2m",
    "dpmpp_2m_sde",
    "ddim",
    "uni_pc",
    "lms",
    "heun",
    "dpm_2",
];

/// Scheduler ids (ComfyUI's KSampler `scheduler` input).
pub const SCHEDULERS: &[&str] = &[
    "normal",
    "karras",
    "exponential",
    "sgm_uniform",
    "simple",
    "ddim_uniform",
    "beta",
];

/// Cap: LoRA rows in the panel, and images kept in the result grid.
pub const MAX_LORAS: usize = 8;
pub const MAX_RESULTS: usize = 12;

/// Aspect-ratio presets offered by the Latent node (ComfyUI's empty
/// latent is derived from one of these plus a dimension class).
pub const ASPECT_PRESETS: &[(&str, u32, u32)] = &[
    ("1:1", 512, 512),
    ("4:3", 640, 480),
    ("3:4", 480, 640),
    ("16:9", 640, 360),
    ("9:16", 360, 640),
];

/// Slider ranges / defaults (mirroring the core's local-SD defaults).
pub const DEFAULT_STEPS: f64 = 20.0;
pub const DEFAULT_CFG: f64 = 7.0;

/// How often the pump polls an async provider task, and the pump tick.
pub const POLL_INTERVAL_MS: u32 = 2000;
pub const TICK_MS: u32 = 50;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// One event from the native render thread.
pub enum ImageEvent {
    Done(Vec<ImageTile>),
    Failed(String),
}

/// One finished image. `rgba` holds the pixels when the native
/// renderer produced them; `url` holds the remote/data URL otherwise.
#[derive(Debug, Clone, Default)]
pub struct ImageTile {
    pub label: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// One LoRA row in the panel (weight kept as typed, parsed on generate).
#[derive(Debug, Clone, PartialEq)]
pub struct LoraEntry {
    pub name: String,
    pub weight: String,
}

/// Where a pending async task lives, so the pump can poll it.
#[derive(Debug, Clone, Default)]
pub struct PollCtx {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
}

/// Where the image studio currently is.
#[derive(Debug)]
pub struct ImageState {
    pub provider_idx: usize,
    pub sampler_idx: usize,
    pub scheduler_idx: usize,
    pub loras: Vec<LoraEntry>,
    pub busy: bool,
    pub status: String,
    /// Native render results, drained by the pump.
    pub rx: Option<Receiver<ImageEvent>>,
    /// Remote provider outcomes (`host::spawn_media` / `..._poll`).
    pub rx_outcome: Option<Receiver<MediaOutcome>>,
    /// Poll context for an async provider task (ComfyUI).
    pub poll: Option<PollCtx>,
    pub task_id: Option<String>,
    /// Countdown (ms) until the next poll.
    pub poll_wait_ms: u32,
    /// True when the seed field is locked for reuse.
    pub seed_locked: bool,
    /// Finished images, newest first.
    pub tiles: Vec<ImageTile>,
}

impl Default for ImageState {
    fn default() -> Self {
        ImageState {
            provider_idx: 0,
            sampler_idx: 0,
            scheduler_idx: 0,
            loras: Vec::new(),
            busy: false,
            status: String::new(),
            rx: None,
            rx_outcome: None,
            poll: None,
            task_id: None,
            poll_wait_ms: POLL_INTERVAL_MS,
            seed_locked: false,
            tiles: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested below)
// ---------------------------------------------------------------------------

pub fn provider_id(idx: usize) -> &'static str {
    PROVIDERS.get(idx).map(|(id, _)| *id).unwrap_or(NATIVE_ID)
}

pub fn provider_label(id: &str) -> &'static str {
    PROVIDERS
        .iter()
        .find(|(p, _)| *p == id)
        .map(|(_, label)| *label)
        .unwrap_or("backend")
}

pub fn sampler_id(idx: usize) -> &'static str {
    SAMPLERS.get(idx).copied().unwrap_or(SAMPLERS[0])
}

pub fn scheduler_id(idx: usize) -> &'static str {
    SCHEDULERS.get(idx).copied().unwrap_or(SCHEDULERS[0])
}

/// A seed from the panel: empty means "random" (None).
pub fn parse_seed(text: &str) -> Option<u64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<u64>()
        .ok()
        .or_else(|| t.parse::<i64>().ok().filter(|v| *v >= 0).map(|v| v as u64))
}

/// A pixel size from the panel: empty means "use the aspect default".
/// Clamping/rounding to SD's grid happens in the core (`sd_size`).
pub fn parse_size(text: &str) -> Option<u32> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<u32>().ok()
}

pub fn clamp_steps(steps: f64) -> u32 {
    let steps = if steps.is_finite() { steps } else { DEFAULT_STEPS };
    (steps.round() as i64).clamp(1, 150) as u32
}

pub fn clamp_cfg(cfg: f64) -> f64 {
    if cfg.is_finite() {
        cfg.clamp(0.0, 30.0)
    } else {
        DEFAULT_CFG
    }
}

pub fn clamp_denoise(denoise: f64) -> f64 {
    if denoise.is_finite() {
        denoise.clamp(0.0, 1.0)
    } else {
        1.0
    }
}

pub fn clamp_batch(batch: i32) -> u32 {
    batch.clamp(1, MAX_BATCH as i32) as u32
}

pub fn clamp_clip_skip(clip_skip: i32) -> u32 {
    clip_skip.clamp(1, 12) as u32
}

/// Look up an aspect preset by its display text ("16:9"), returning the
/// width/height it should write into the Latent node.
pub fn aspect_preset(ratio: &str) -> Option<(u32, u32)> {
    ASPECT_PRESETS
        .iter()
        .find(|(label, _, _)| *label == ratio.trim())
        .map(|(_, width, height)| (*width, *height))
}

/// A LoRA weight: empty means 1.0 (the trained strength).
pub fn parse_weight(text: &str) -> f64 {
    let t = text.trim();
    if t.is_empty() {
        return 1.0;
    }
    t.parse::<f64>().unwrap_or(1.0).clamp(-2.0, 2.0)
}

/// A fresh random seed (system time, mixed).
pub fn random_seed() -> u64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0xC0FF_EE00);
    nanos ^ nanos.rotate_left(31) ^ 0x9E37_79B9_7F4A_7C15
}

/// The panel's text/knob fields, collected for `build_request`.
pub struct PanelFields<'a> {
    pub prompt: &'a str,
    pub negative: &'a str,
    pub model: &'a str,
    pub vae: &'a str,
    pub seed: &'a str,
    pub width: &'a str,
    pub height: &'a str,
    pub base_url: &'a str,
    pub steps: f64,
    pub cfg: f64,
    pub denoise: f64,
    pub batch: i32,
    pub clip_skip: i32,
}

/// Build the core `MediaRequest` from the panel state and fields.
pub fn build_request(img: &ImageState, f: &PanelFields) -> MediaRequest {
    let provider = provider_id(img.provider_idx);
    MediaRequest {
        provider: provider.to_string(),
        base_url: non_empty(f.base_url)
            .map(|b| b.trim_end_matches('/').to_string())
            .unwrap_or_else(|| default_base_url(provider).to_string()),
        api_key: crate::shared::media::media_api_key(provider),
        prompt: f.prompt.trim().to_string(),
        negative_prompt: non_empty(f.negative),
        model: non_empty(f.model),
        vae: non_empty(f.vae),
        seed: parse_seed(f.seed),
        steps: Some(clamp_steps(f.steps)),
        cfg: Some(clamp_cfg(f.cfg)),
        sampler: Some(sampler_id(img.sampler_idx).to_string()),
        scheduler: Some(scheduler_id(img.scheduler_idx).to_string()),
        denoise: Some(clamp_denoise(f.denoise)),
        batch: Some(clamp_batch(f.batch)),
        width: parse_size(f.width),
        height: parse_size(f.height),
        clip_skip: Some(clamp_clip_skip(f.clip_skip)),
        loras: img
            .loras
            .iter()
            .filter(|l| !l.name.trim().is_empty())
            .map(|l| LoraSpec {
                name: l.name.trim().to_string(),
                weight: parse_weight(&l.weight),
            })
            .collect(),
        ..Default::default()
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

/// Render a request with the in-process engine, one tile per batch
/// cell (each with its own seed, so the grid shows distinct images).
pub fn render_native(req: &MediaRequest) -> Result<Vec<ImageTile>, String> {
    let batch = sd_batch(req);
    let mut req = req.clone();
    req.batch = Some(1);
    let mut base_seed = req.seed.unwrap_or_else(random_seed);
    let mut tiles = Vec::new();
    for _ in 0..batch {
        req.seed = Some(base_seed);
        base_seed = base_seed.wrapping_add(1);
        let image = prism_core::native_sd::render(&req)?;
        tiles.push(ImageTile {
            label: format!("seed {}", req.seed.unwrap_or(0)),
            width: image.width,
            height: image.height,
            rgba: image.rgba,
            url: String::new(),
        });
    }
    Ok(tiles)
}

/// Render a request with real Candle weights, one tile per batch cell.
/// `base_url` is the local Diffusers-style model directory and `model`
/// optionally selects `v1-5` / `v2-1` / `sdxl` / `sdxl-turbo`.
#[cfg(feature = "candle-sd")]
pub fn render_candle(req: &MediaRequest) -> Result<Vec<ImageTile>, String> {
    let pipeline = candle_pipeline(req)?;
    let batch = sd_batch(req);
    let mut req = req.clone();
    req.batch = Some(1);
    let mut base_seed = req.seed.unwrap_or_else(random_seed);
    let mut tiles = Vec::new();
    for _ in 0..batch {
        req.seed = Some(base_seed);
        base_seed = base_seed.wrapping_add(1);
        let image = pipeline.render(&req)?;
        tiles.push(ImageTile {
            label: format!("seed {}", req.seed.unwrap_or(0)),
            width: image.width,
            height: image.height,
            rgba: image.rgba,
            url: String::new(),
        });
    }
    Ok(tiles)
}

#[cfg(feature = "candle-sd")]
fn candle_pipeline(req: &MediaRequest) -> Result<Arc<prism_core::candle_sd::CandleSd>, String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<prism_core::candle_sd::CandleSd>>>> =
        OnceLock::new();
    let raw = req.base_url.trim();
    if raw.is_empty() {
        return Err("enter a local model directory in the Base URL field".to_string());
    }
    let path = Path::new(raw.strip_prefix("file://").unwrap_or(raw));
    let version = req
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let key = format!("{}|{}", path.display(), version.unwrap_or("auto"));

    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(pipeline) = cache
        .lock()
        .map_err(|_| "Candle model cache lock poisoned".to_string())?
        .get(&key)
    {
        return Ok(Arc::clone(pipeline));
    }
    let mut cache = cache
        .lock()
        .map_err(|_| "Candle model cache lock poisoned".to_string())?;
    if let Some(pipeline) = cache.get(&key) {
        return Ok(Arc::clone(pipeline));
    }
    let pipeline = Arc::new(prism_core::candle_sd::CandleSd::load(path, version)?);
    cache.insert(key, Arc::clone(&pipeline));
    Ok(pipeline)
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

pub fn init(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    ui.set_image_provider_labels(label_model(PROVIDERS.iter().map(|(_, l)| *l)));
    ui.set_image_sampler_labels(label_model(SAMPLERS.iter().copied()));
    ui.set_image_scheduler_labels(label_model(SCHEDULERS.iter().copied()));
    ui.set_image_aspect_labels(label_model(ASPECT_PRESETS.iter().map(|(l, _, _)| *l)));
    let st = state.borrow();
    ui.set_image_provider_idx(st.image.provider_idx as i32);
    ui.set_image_sampler_idx(st.image.sampler_idx as i32);
    ui.set_image_scheduler_idx(st.image.scheduler_idx as i32);
    ui.set_image_provider(provider_id(st.image.provider_idx).into());
    ui.set_image_steps(DEFAULT_STEPS as f32);
    ui.set_image_cfg(DEFAULT_CFG as f32);
    ui.set_image_seed_locked(st.image.seed_locked);
    let loras = st.image.loras.clone();
    drop(st);
    refresh_loras(ui, &loras);
}

fn label_model(labels: impl Iterator<Item = &'static str>) -> ModelRc<slint::SharedString> {
    ModelRc::from(Rc::new(VecModel::from(
        labels.map(slint::SharedString::from).collect::<Vec<_>>(),
    )))
}

pub fn select_provider(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, PROVIDERS.len() as i32 - 1) as usize;
    state.borrow_mut().image.provider_idx = idx;
    ui.set_image_provider_idx(idx as i32);
    ui.set_image_provider(provider_id(idx).into());
}

pub fn select_sampler(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, SAMPLERS.len() as i32 - 1) as usize;
    state.borrow_mut().image.sampler_idx = idx;
    ui.set_image_sampler_idx(idx as i32);
}

pub fn select_scheduler(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, SCHEDULERS.len() as i32 - 1) as usize;
    state.borrow_mut().image.scheduler_idx = idx;
    ui.set_image_scheduler_idx(idx as i32);
}

/// Roll a fresh random seed into the seed field. A locked seed stays put,
/// so repeated generations reuse the same value.
pub fn seed_random(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    if state.borrow().image.seed_locked {
        return;
    }
    ui.set_image_seed(random_seed().to_string().into());
}

/// Apply an aspect preset to the width/height fields. Unknown ratios are
/// ignored so a typo never blanks the user's manual dimensions.
pub fn aspect_selected(ui: &AppWindow, ratio: &str) {
    if let Some((width, height)) = aspect_preset(ratio) {
        ui.set_image_width(width.to_string().into());
        ui.set_image_height(height.to_string().into());
    }
}

/// Toggle the seed's reuse lock and expose the new state to the panel.
/// When locked, the dice is disabled so a generation keeps the seed.
pub fn seed_lock_toggle(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let locked = {
        let mut st = state.borrow_mut();
        st.image.seed_locked = !st.image.seed_locked;
        st.image.seed_locked
    };
    ui.set_image_seed_locked(locked);
}

pub fn batch_step(ui: &AppWindow, delta: i32) {
    let value = (ui.get_image_batch() + delta).clamp(1, MAX_BATCH as i32);
    ui.set_image_batch(value);
}

pub fn clip_step(ui: &AppWindow, delta: i32) {
    let value = (ui.get_image_clip_skip() + delta).clamp(1, 12);
    ui.set_image_clip_skip(value);
}

pub fn lora_add(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let rows = {
        let mut st = state.borrow_mut();
        if st.image.loras.len() >= MAX_LORAS {
            return;
        }
        st.image.loras.push(LoraEntry {
            name: String::new(),
            weight: "1.0".to_string(),
        });
        st.image.loras.clone()
    };
    refresh_loras(ui, &rows);
}

pub fn lora_remove(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let rows = {
        let mut st = state.borrow_mut();
        let idx = idx as usize;
        if idx < st.image.loras.len() {
            st.image.loras.remove(idx);
        }
        st.image.loras.clone()
    };
    refresh_loras(ui, &rows);
}

/// Edits update the state only: refreshing the model on every
/// keystroke would reset the LineEdit's cursor.
pub fn lora_name_edited(state: &Rc<RefCell<State>>, idx: i32, text: &str) {
    let mut st = state.borrow_mut();
    if let Some(row) = st.image.loras.get_mut(idx as usize) {
        row.name = text.to_string();
    }
}

pub fn lora_weight_edited(state: &Rc<RefCell<State>>, idx: i32, text: &str) {
    let mut st = state.borrow_mut();
    if let Some(row) = st.image.loras.get_mut(idx as usize) {
        row.weight = text.to_string();
    }
}

fn refresh_loras(ui: &AppWindow, rows: &[LoraEntry]) {
    ui.set_image_loras(ModelRc::from(Rc::new(VecModel::from(
        rows.iter()
            .map(|l| crate::shared::ImageLoraRow {
                name: l.name.as_str().into(),
                weight: l.weight.as_str().into(),
            })
            .collect::<Vec<_>>(),
    ))));
}

/// Start a generation: native renders on a worker thread; remote
/// providers go through the media pipeline.
pub fn generate(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    // Collect the panel's values first (the UI borrow must end before
    // the state borrow).
    let prompt = ui.get_image_prompt();
    let negative = ui.get_image_negative();
    let model = ui.get_image_model();
    let vae = ui.get_image_vae();
    let seed = ui.get_image_seed();
    let width = ui.get_image_width();
    let height = ui.get_image_height();
    let base_url = ui.get_image_base_url();
    let fields = PanelFields {
        prompt: prompt.as_str(),
        negative: negative.as_str(),
        model: model.as_str(),
        vae: vae.as_str(),
        seed: seed.as_str(),
        width: width.as_str(),
        height: height.as_str(),
        base_url: base_url.as_str(),
        steps: f64::from(ui.get_image_steps()),
        cfg: f64::from(ui.get_image_cfg()),
        denoise: f64::from(ui.get_image_denoise()),
        batch: ui.get_image_batch(),
        clip_skip: ui.get_image_clip_skip(),
    };

    let mut st = state.borrow_mut();
    if st.image.busy {
        return;
    }
    if fields.prompt.trim().is_empty() {
        st.image.status = "Enter a prompt first.".to_string();
        let status = st.image.status.clone();
        drop(st);
        ui.set_image_status(status.into());
        return;
    }
    let req = build_request(&st.image, &fields);
    let provider = provider_id(st.image.provider_idx).to_string();
    st.image.busy = true;
    st.image.status = "Rendering…".to_string();
    st.image.task_id = None;
    st.image.poll = None;
    st.image.poll_wait_ms = POLL_INTERVAL_MS;
    drop(st);

    ui.set_image_busy(true);
    ui.set_image_status("Rendering…".into());

    let candle = {
        #[cfg(feature = "candle-sd")]
        {
            provider == CANDLE_ID
        }
        #[cfg(not(feature = "candle-sd"))]
        {
            false
        }
    };

    if provider == NATIVE_ID || candle {
        let (tx, rx) = channel::<ImageEvent>();
        state.borrow_mut().image.rx = Some(rx);
        // Both in-process engines are pure CPU over owned data, so a plain
        // thread keeps the UI responsive for big batches.
        std::thread::spawn(move || {
            #[cfg(feature = "candle-sd")]
            let rendered = if provider == CANDLE_ID {
                render_candle(&req)
            } else {
                render_native(&req)
            };
            #[cfg(not(feature = "candle-sd"))]
            let rendered = render_native(&req);
            let event = match rendered {
                Ok(tiles) => ImageEvent::Done(tiles),
                Err(e) => ImageEvent::Failed(e),
            };
            let _ = tx.send(event);
        });
    } else {
        let (tx, rx) = channel::<MediaOutcome>();
        {
            let mut st = state.borrow_mut();
            st.image.rx_outcome = Some(rx);
            st.image.poll = Some(PollCtx {
                provider: provider.clone(),
                base_url: req.base_url.clone(),
                api_key: req.api_key.clone(),
            });
        }
        prism_core::host::spawn_media(MediaKind::Image, req, tx);
    }
}

/// Advance one pump tick: land native results, forward remote
/// outcomes, and poll async providers on the interval.
pub fn drain(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    drain_native(ui, state);
    drain_remote(ui, state);
    tick_poll(ui, state);
}

fn drain_native(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let mut st = state.borrow_mut();
    let Some(rx) = st.image.rx.take() else {
        return;
    };
    match rx.try_recv() {
        Ok(ImageEvent::Done(tiles)) => {
            let n = tiles.len();
            let img = &mut st.image;
            img.busy = false;
            img.task_id = None;
            img.poll = None;
            for tile in tiles {
                img.tiles.insert(0, tile);
            }
            img.tiles.truncate(MAX_RESULTS);
            img.status = format!("{n} image{} ready.", if n == 1 { "" } else { "s" });
            let status = img.status.clone();
            drop(st);
            ui.set_image_busy(false);
            ui.set_image_status(status.into());
            refresh_results(ui, state);
        }
        Ok(ImageEvent::Failed(e)) => {
            let img = &mut st.image;
            img.busy = false;
            img.status = e.clone();
            drop(st);
            ui.set_image_busy(false);
            ui.set_image_status(e.into());
        }
        Err(TryRecvError::Empty) => {
            st.image.rx = Some(rx);
        }
        Err(TryRecvError::Disconnected) => {}
    }
}

fn drain_remote(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let mut st = state.borrow_mut();
    let Some(rx) = st.image.rx_outcome.take() else {
        return;
    };
    match rx.try_recv() {
        Ok(MediaOutcome::Ready(url)) => {
            let img = &mut st.image;
            img.busy = false;
            img.task_id = None;
            img.poll = None;
            let label = format!("{} result", provider_label(provider_id(img.provider_idx)));
            img.tiles.insert(
                0,
                ImageTile {
                    label,
                    url,
                    ..Default::default()
                },
            );
            img.tiles.truncate(MAX_RESULTS);
            img.status = "1 image ready.".to_string();
            drop(st);
            ui.set_image_busy(false);
            ui.set_image_status("1 image ready.".into());
            refresh_results(ui, state);
        }
        Ok(MediaOutcome::Pending(task_id)) => {
            let img = &mut st.image;
            img.task_id = Some(task_id);
            img.poll_wait_ms = POLL_INTERVAL_MS;
            img.status = "Queued — the install is rendering…".to_string();
            let status = img.status.clone();
            drop(st);
            ui.set_image_status(status.into());
        }
        Ok(MediaOutcome::Failed(e)) => {
            let img = &mut st.image;
            img.busy = false;
            img.task_id = None;
            img.poll = None;
            drop(st);
            ui.set_image_busy(false);
            ui.set_image_status(e.into());
        }
        Err(TryRecvError::Empty) => {
            st.image.rx_outcome = Some(rx);
        }
        Err(TryRecvError::Disconnected) => {}
    }
}

fn tick_poll(_ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let (ctx, task_id) = {
        let mut st = state.borrow_mut();
        let img = &mut st.image;
        let (Some(poll), Some(task_id)) = (img.poll.clone(), img.task_id.clone()) else {
            return;
        };
        if !img.busy {
            return;
        }
        if img.poll_wait_ms > TICK_MS {
            img.poll_wait_ms -= TICK_MS;
            return;
        }
        img.poll_wait_ms = POLL_INTERVAL_MS;
        (poll, task_id)
    };
    let (tx, rx) = channel::<MediaOutcome>();
    state.borrow_mut().image.rx_outcome = Some(rx);
    prism_core::host::spawn_media_poll(ctx.provider, ctx.base_url, ctx.api_key, task_id, tx);
}

// ---------------------------------------------------------------------------
// Result grid
// ---------------------------------------------------------------------------

fn refresh_results(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let tiles = state.borrow().image.tiles.clone();
    ui.set_image_tiles(ModelRc::from(Rc::new(VecModel::from(
        tiles
            .iter()
            .map(|t| crate::shared::ImageTileUi {
                image: tile_image(t),
                label: t.label.as_str().into(),
                url: t.url.as_str().into(),
            })
            .collect::<Vec<_>>(),
    ))));
}

fn tile_image(tile: &ImageTile) -> slint::Image {
    if !tile.rgba.is_empty() {
        if let Ok(image) = rgba_image(&tile.rgba, tile.width, tile.height) {
            return image;
        }
    }
    if tile.url.starts_with("data:") {
        if let Ok(image) = data_url_image(&tile.url) {
            return image;
        }
    }
    empty_image()
}

/// Wrap raw RGBA8 bytes as a Slint image (the native renderer's output).
pub fn rgba_image(rgba: &[u8], width: u32, height: u32) -> Result<slint::Image, String> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(format!(
            "pixel buffer is {} bytes, expected {expected} for {width}x{height}",
            rgba.len()
        ));
    }
    let mut buffer = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(width, height);
    buffer.make_mut_bytes().copy_from_slice(rgba);
    Ok(slint::Image::from_rgba8(buffer))
}

/// Decode a PNG/JPEG data URL into a Slint image. The core has no
/// decoder, so the bytes go through a cache file and Slint's own
/// image decoders (`image-decoders` ships with the desktop backend).
fn data_url_image(url: &str) -> Result<slint::Image, String> {
    let (bytes, mime) = prism_core::media::decode_data_url(url)?.ok_or("not a data URL")?;
    let ext = match mime.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    };
    let dir = std::env::temp_dir().join("prism-image-studio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create image cache: {e}"))?;
    let path = dir.join(format!("{:016x}.{ext}", fnv1a(url)));
    std::fs::write(&path, &bytes).map_err(|e| format!("cannot cache image: {e}"))?;
    slint::Image::load_from_path(&path).map_err(|_| "unsupported image format".to_string())
}

fn empty_image() -> slint::Image {
    let mut buffer = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(1, 1);
    buffer.make_mut_bytes().copy_from_slice(&[0, 0, 0, 0]);
    slint::Image::from_rgba8(buffer)
}

fn fnv1a(text: &str) -> u64 {
    let mut hash = 0xCBF2_9CE4_8422_2325u64;
    for byte in text.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> ImageState {
        ImageState::default()
    }

    fn fields() -> PanelFields<'static> {
        PanelFields {
            prompt: "a fox in snow",
            negative: "blurry",
            model: "",
            vae: "",
            seed: "42",
            width: "",
            height: "",
            base_url: "",
            steps: 30.0,
            cfg: 5.5,
            denoise: 1.0,
            batch: 2,
            clip_skip: 2,
        }
    }

    #[test]
    fn table_lookups_clamp_to_the_first_entry() {
        assert_eq!(provider_id(0), NATIVE_ID);
        #[cfg(feature = "candle-sd")]
        {
            assert_eq!(provider_id(1), CANDLE_ID);
            assert_eq!(provider_id(2), A1111_ID);
            assert_eq!(provider_id(3), COMFYUI_ID);
            assert_eq!(provider_label(CANDLE_ID), "Candle (real SD)");
        }
        #[cfg(not(feature = "candle-sd"))]
        {
            assert_eq!(provider_id(1), A1111_ID);
            assert_eq!(provider_id(2), COMFYUI_ID);
        }
        assert_eq!(provider_id(99), NATIVE_ID);
        assert_eq!(sampler_id(0), "euler");
        assert_eq!(sampler_id(99), "euler");
        assert_eq!(scheduler_id(1), "karras");
        assert_eq!(scheduler_id(99), "normal");
        assert_eq!(provider_label("native"), "Native (built-in)");
    }

    #[cfg(feature = "candle-sd")]
    #[test]
    fn candle_render_reports_missing_weights() {
        let mut img = state();
        img.provider_idx = 1;
        let mut f = fields();
        f.base_url = "/nonexistent/prism-candle-sd";
        let req = build_request(&img, &f);
        let error = render_candle(&req).unwrap_err();
        assert!(error.contains("tokenizer"), "{error}");
    }

    #[test]
    fn seed_parsing_accepts_positive_and_rejects_rest() {
        assert_eq!(parse_seed("42"), Some(42));
        assert_eq!(parse_seed(" 7 "), Some(7));
        assert_eq!(parse_seed("-1"), None);
        assert_eq!(parse_seed("abc"), None);
        assert_eq!(parse_seed(""), None);
    }

    #[test]
    fn knobs_are_clamped() {
        assert_eq!(clamp_steps(0.0), 1);
        assert_eq!(clamp_steps(99_999.0), 150);
        assert_eq!(clamp_steps(20.4), 20);
        assert_eq!(clamp_cfg(99.0), 30.0);
        assert_eq!(clamp_denoise(2.0), 1.0);
        assert_eq!(clamp_batch(0), 1);
        assert_eq!(clamp_batch(99), MAX_BATCH);
        assert_eq!(clamp_clip_skip(0), 1);
        assert_eq!(clamp_clip_skip(99), 12);
        assert_eq!(parse_weight(""), 1.0);
        assert_eq!(parse_weight("0.8"), 0.8);
        assert_eq!(parse_weight("nonsense"), 1.0);
    }

    #[test]
    fn build_request_maps_the_whole_panel() {
        let mut img = state();
        img.sampler_idx = 2; // dpmpp_2m
        img.scheduler_idx = 1; // karras
        img.loras = vec![LoraEntry {
            name: "detail.safetensors".into(),
            weight: "0.8".into(),
        }];
        let req = build_request(&img, &fields());
        assert_eq!(req.provider, NATIVE_ID);
        assert_eq!(req.prompt, "a fox in snow");
        assert_eq!(req.negative_prompt.as_deref(), Some("blurry"));
        assert_eq!(req.seed, Some(42));
        assert_eq!(req.steps, Some(30));
        assert_eq!(req.cfg, Some(5.5));
        assert_eq!(req.sampler.as_deref(), Some("dpmpp_2m"));
        assert_eq!(req.scheduler.as_deref(), Some("karras"));
        assert_eq!(req.batch, Some(2));
        assert_eq!(req.clip_skip, Some(2));
        assert_eq!(req.loras.len(), 1);
        assert_eq!(req.loras[0].weight, 0.8);
        // Default base URL of the provider is filled in.
        assert_eq!(req.base_url, default_base_url(NATIVE_ID));
    }

    #[test]
    fn empty_rows_and_blank_loras_are_dropped() {
        let mut img = state();
        img.loras = vec![
            LoraEntry {
                name: "  ".into(),
                weight: "0.5".into(),
            },
            LoraEntry {
                name: "real.safetensors".into(),
                weight: String::new(),
            },
        ];
        let req = build_request(&img, &fields());
        assert_eq!(req.loras.len(), 1);
        assert_eq!(req.loras[0].name, "real.safetensors");
        assert_eq!(req.loras[0].weight, 1.0);
    }

    #[test]
    fn an_explicit_base_url_wins_over_the_default() {
        let mut f = fields();
        f.base_url = "http://127.0.0.1:7899/";
        let req = build_request(&state(), &f);
        assert_eq!(req.base_url, "http://127.0.0.1:7899");
    }

    #[test]
    fn native_render_produces_one_tile_per_batch_cell() {
        let mut img = state();
        img.provider_idx = 0;
        let mut f = fields();
        f.seed = "11";
        f.batch = 3;
        let mut req = build_request(&img, &f);
        // 64px is the core's minimum dimension.
        req.width = Some(64);
        req.height = Some(80);
        req.steps = Some(4);
        let tiles = render_native(&req).unwrap();
        assert_eq!(tiles.len(), 3);
        assert!(tiles.iter().all(|t| t.width == 64 && t.height == 80));
        assert_eq!(tiles[0].rgba.len(), 64 * 80 * 4);
        // Distinct seeds per cell, deterministic per seed.
        assert_ne!(tiles[0].rgba, tiles[1].rgba);
        let again = render_native(&req).unwrap();
        assert_eq!(again[0].rgba, tiles[0].rgba);
    }

    #[test]
    fn random_seed_is_never_zero() {
        for _ in 0..100 {
            assert_ne!(random_seed(), 0);
        }
    }

    #[test]
    fn aspect_presets_are_looked_up_by_label() {
        assert_eq!(aspect_preset("1:1"), Some((512, 512)));
        assert_eq!(aspect_preset(" 16:9 "), Some((640, 360)));
        assert_eq!(aspect_preset("21:9"), None);
        // Every preset is positive and distinct.
        let mut labels: Vec<&str> = ASPECT_PRESETS.iter().map(|(l, _, _)| *l).collect();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(labels.len(), ASPECT_PRESETS.len());
        assert!(ASPECT_PRESETS.iter().all(|(_, w, h)| *w > 0 && *h > 0));
    }

    #[test]
    fn rgba_image_rejects_a_wrong_buffer() {
        assert!(rgba_image(&[0; 4], 2, 2).is_err());
        assert!(rgba_image(&[0; 16], 2, 2).is_ok());
    }
}
