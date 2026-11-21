//! The `/image` route: a ComfyUI-style parameter panel for local image
//! generation — node sections (Checkpoint / LoRA / Prompt / Sampler /
//! Latent / Seed) over three backends: the in-process Rust renderer, an
//! Automatic1111 install, or a ComfyUI install.
//!
//! The browser owns the sockets (`api::FetchTransport`); every request
//! body and response is built/parsed by `prism-core`. All state lives in
//! Rust in `ImageUi` below — the markup is only a projection of it. No
//! credits, costs or paywalls live here: these are local installs.

use dioxus::prelude::*;
use prism_core::media::{
    default_base_url, LoraSpec, MediaRequest, A1111_ID, COMFYUI_ID, DEFAULT_SAMPLER,
    DEFAULT_SCHEDULER, LOCAL_SD_CFG, LOCAL_SD_STEPS, MAX_BATCH, NATIVE_ID,
};

use crate::api::{self, GeneratedImage};
use crate::components::ui::DropdownMenu;
use crate::icons::Icon;

// ---------------------------------------------------------------------------
// Tables (what the node sections offer)
// ---------------------------------------------------------------------------

const PROVIDERS: [(&str, &str); 3] = [
    (NATIVE_ID, "Native (built-in)"),
    (A1111_ID, "Automatic1111"),
    (COMFYUI_ID, "ComfyUI"),
];

/// Canonical sampler ids — exactly what ComfyUI's KSampler takes; the
/// A1111 wire builder maps them to display names.
const SAMPLERS: [&str; 9] = [
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
const SCHEDULERS: [&str; 7] = [
    "normal",
    "karras",
    "exponential",
    "sgm_uniform",
    "simple",
    "ddim_uniform",
    "beta",
];

const MAX_LORAS: usize = 8;
const MAX_RESULTS: usize = 12;

fn provider_label(id: &str) -> &'static str {
    PROVIDERS
        .iter()
        .find(|(key, _)| *key == id)
        .map(|(_, label)| *label)
        .unwrap_or("backend")
}

fn provider_id(label: &str) -> &'static str {
    PROVIDERS
        .iter()
        .find(|(_, value)| *value == label)
        .map(|(id, _)| *id)
        .unwrap_or(NATIVE_ID)
}

fn provider_labels() -> Vec<String> {
    PROVIDERS.iter().map(|(_, label)| label.to_string()).collect()
}

fn sampler_labels() -> Vec<String> {
    SAMPLERS.iter().map(|s| s.to_string()).collect()
}

fn scheduler_labels() -> Vec<String> {
    SCHEDULERS.iter().map(|s| s.to_string()).collect()
}

// ---------------------------------------------------------------------------
// State (all in Rust; the markup just projects it)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct LoraUi {
    pub name: String,
    pub weight: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImageUi {
    pub provider: String,
    pub checkpoint: String,
    pub vae: String,
    pub clip_skip: u32,
    pub prompt: String,
    pub negative: String,
    pub sampler: String,
    pub scheduler: String,
    pub steps: u32,
    pub cfg: f64,
    pub denoise: f64,
    pub batch: u32,
    pub width: String,
    pub height: String,
    pub seed: String,
    pub base_url: String,
    pub loras: Vec<LoraUi>,
    pub tiles: Vec<GeneratedImage>,
    pub busy: bool,
    pub status: String,
}

impl ImageUi {
    fn new() -> Self {
        ImageUi {
            provider: NATIVE_ID.to_string(),
            checkpoint: String::new(),
            vae: String::new(),
            clip_skip: 1,
            prompt: String::new(),
            negative: String::new(),
            sampler: DEFAULT_SAMPLER.to_string(),
            scheduler: DEFAULT_SCHEDULER.to_string(),
            steps: LOCAL_SD_STEPS,
            cfg: LOCAL_SD_CFG,
            denoise: 1.0,
            batch: 1,
            width: String::new(),
            height: String::new(),
            seed: String::new(),
            base_url: String::new(),
            loras: Vec::new(),
            tiles: Vec::new(),
            busy: false,
            status: String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

fn non_empty(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

fn parse_u32(text: &str) -> Option<u32> {
    let t = text.trim();
    if t.is_empty() {
        None
    } else {
        t.parse::<u32>().ok()
    }
}

fn parse_seed(text: &str) -> Option<u64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<u64>()
        .ok()
        .or_else(|| t.parse::<i64>().ok().filter(|v| *v >= 0).map(|v| v as u64))
}

fn parse_weight(text: &str) -> f64 {
    let t = text.trim();
    if t.is_empty() {
        return 1.0;
    }
    t.parse::<f64>().unwrap_or(1.0).clamp(-2.0, 2.0)
}

fn random_seed() -> u64 {
    let nanos = js_sys::Date::now() as u64;
    nanos ^ nanos.rotate_left(31) ^ 0x9E37_79B9_7F4A_7C15
}

/// Collect the whole panel into the core's transport-free request.
fn build_request(form: &ImageUi) -> MediaRequest {
    MediaRequest {
        provider: form.provider.clone(),
        base_url: non_empty(&form.base_url)
            .map(|url| url.trim_end_matches('/').to_string())
            .unwrap_or_else(|| default_base_url(&form.provider).to_string()),
        prompt: form.prompt.trim().to_string(),
        negative_prompt: non_empty(&form.negative),
        model: non_empty(&form.checkpoint),
        vae: non_empty(&form.vae),
        seed: parse_seed(&form.seed),
        steps: Some(form.steps),
        cfg: Some(form.cfg),
        sampler: Some(form.sampler.clone()),
        scheduler: Some(form.scheduler.clone()),
        denoise: Some(form.denoise),
        batch: Some(form.batch.clamp(1, MAX_BATCH)),
        width: parse_u32(&form.width),
        height: parse_u32(&form.height),
        clip_skip: Some(form.clip_skip.clamp(1, 12)),
        loras: form
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

/// Start a generation: validate, flip the busy flag, then let the async
/// boundary do the work and land the results back into the same state.
fn generate(mut form: Signal<ImageUi>) {
    let snapshot = form();
    if snapshot.busy {
        return;
    }
    if snapshot.prompt.trim().is_empty() {
        form.write().status = "Enter a prompt first.".to_string();
        return;
    }

    let mut request = build_request(&snapshot);
    if request.seed.is_none() {
        let seed = random_seed();
        request.seed = Some(seed);
        form.write().seed = seed.to_string();
    }
    {
        let mut guard = form.write();
        guard.busy = true;
        guard.status = "Rendering…".to_string();
    }

    spawn(async move {
        let result = api::generate_images(request).await;
        let mut guard = form.write();
        guard.busy = false;
        match result {
            Ok(tiles) => {
                let n = tiles.len();
                guard.status = format!("{} image{} ready.", n, if n == 1 { "" } else { "s" });
                guard.tiles.splice(0..0, tiles);
                guard.tiles.truncate(MAX_RESULTS);
            }
            Err(e) => guard.status = e,
        }
    });
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/// A node-style parameter group (ComfyUI's node bodies).
#[derive(Props, Clone, PartialEq)]
struct NodeSectionProps {
    title: &'static str,
    children: Element,
}

fn NodeSection(props: NodeSectionProps) -> Element {
    rsx! {
        div { class: "rounded-xl border border-edge bg-input/50 p-3",
            div { class: "mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-accent",
                "{props.title}"
            }
            div { class: "space-y-2", {props.children} }
        }
    }
}

#[derive(Props, Clone, PartialEq)]
struct FieldLabelProps {
    label: &'static str,
}

fn FieldLabel(props: FieldLabelProps) -> Element {
    rsx! {
        label { class: "block text-[10.5px] font-medium text-sub", "{props.label}" }
    }
}

/// A small − value + stepper for integer knobs (batch, CLIP skip).
#[derive(Props, Clone, PartialEq)]
struct StepperProps {
    value: u32,
    min: u32,
    max: u32,
    on_step: Callback<i32>,
}

fn Stepper(props: StepperProps) -> Element {
    rsx! {
        div { class: "flex items-center gap-1",
            button {
                class: "grid size-6 place-items-center rounded-md border border-edge bg-input text-sub transition-colors hover:text-white disabled:opacity-40",
                disabled: props.value <= props.min,
                onclick: move |_| props.on_step.call(-1),
                Icon { name: "minus", class: "size-3" }
            }
            span { class: "min-w-8 flex-1 rounded-md border border-edge bg-app py-1 text-center text-[11px] font-semibold text-white",
                "{props.value}"
            }
            button {
                class: "grid size-6 place-items-center rounded-md border border-edge bg-input text-sub transition-colors hover:text-white disabled:opacity-40",
                disabled: props.value >= props.max,
                onclick: move |_| props.on_step.call(1),
                Icon { name: "plus", class: "size-3" }
            }
        }
    }
}

/// A labeled range slider with a live numeric readout.
#[derive(Props, Clone, PartialEq)]
struct SliderProps {
    label: &'static str,
    value: f64,
    min: f64,
    max: f64,
    step: f64,
    decimals: u32,
    on_change: Callback<f64>,
}

fn Slider(props: SliderProps) -> Element {
    let digits = props.decimals as usize;
    let readout = format!("{:.*}", digits, props.value);
    rsx! {
        div { class: "space-y-1",
            div { class: "flex items-center justify-between",
                FieldLabel { label: props.label }
                span { class: "text-[10.5px] font-semibold text-white", "{readout}" }
            }
            input {
                r#type: "range",
                class: "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-edge accent-accent",
                min: "{props.min}",
                max: "{props.max}",
                step: "{props.step}",
                value: "{props.value}",
                oninput: move |e| {
                    if let Ok(value) = e.value().parse::<f64>() {
                        props.on_change.call(value);
                    }
                },
            }
        }
    }
}

pub fn Image() -> Element {
    let mut form = use_signal(ImageUi::new);
    let f = form();

    let provider_label = provider_label(&f.provider);
    let base_placeholder = default_base_url(&f.provider);
    let status_style = if f.status.contains("ready") {
        "text-emerald-400"
    } else {
        "text-sub"
    };

    rsx! {
        section { class: "flex min-h-[75vh] min-w-0 flex-1 flex-col lg:h-full lg:min-h-0 lg:flex-row",

            // ---- Parameter panel (node sections) ----------------------------
            aside { class: "w-full shrink-0 space-y-3 overflow-y-auto border-b border-edge bg-panel p-3 lg:w-[368px] lg:border-b-0 lg:border-r",

                div { class: "space-y-0.5",
                    h1 { class: "text-[17px] font-semibold text-white", "Image Studio" }
                    p { class: "text-[11.5px] text-sub",
                        "Local backends — no cloud, no credits. Every knob on one panel."
                    }
                }

                // Backend
                div { class: "space-y-1.5",
                    FieldLabel { label: "Backend" }
                    DropdownMenu {
                        options: provider_labels(),
                        selected: provider_label.to_string(),
                        menu_class: "left-0 top-full mt-1 w-full",
                        on_select: move |label: String| {
                            form.write().provider = provider_id(&label).to_string();
                        },
                        span { class: "truncate", "{provider_label}" }
                    }
                }

                // Checkpoint
                NodeSection { title: "Checkpoint",
                    div { class: "space-y-1",
                        FieldLabel { label: "Checkpoint" }
                        input {
                            r#type: "text",
                            class: "w-full rounded-lg border border-edge bg-app px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                            placeholder: "install default",
                            value: "{f.checkpoint}",
                            oninput: move |e| form.write().checkpoint = e.value(),
                        }
                    }
                    div { class: "space-y-1",
                        FieldLabel { label: "VAE" }
                        input {
                            r#type: "text",
                            class: "w-full rounded-lg border border-edge bg-app px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                            placeholder: "checkpoint's built-in VAE",
                            value: "{f.vae}",
                            oninput: move |e| form.write().vae = e.value(),
                        }
                    }
                    div { class: "space-y-1",
                        FieldLabel { label: "CLIP skip" }
                        Stepper {
                            value: f.clip_skip,
                            min: 1,
                            max: 12,
                            on_step: move |delta: i32| {
                                let mut guard = form.write();
                                let next = (guard.clip_skip as i64 + delta as i64).clamp(1, 12);
                                guard.clip_skip = next as u32;
                            },
                        }
                    }
                }

                // LoRA
                NodeSection { title: "LoRA",
                    if f.loras.is_empty() {
                        p { class: "text-[11px] text-sub/60", "No adapters attached." }
                    }
                    for (i, lora) in f.loras.iter().enumerate() {
                        {
                            let name_value = lora.name.clone();
                            let weight_value = lora.weight.clone();
                            rsx! {
                                div { key: "{i}", class: "flex items-center gap-1.5",
                                    input {
                                        r#type: "text",
                                        class: "min-w-0 flex-1 rounded-lg border border-edge bg-app px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                                        placeholder: "lora name",
                                        value: "{name_value}",
                                        oninput: move |e| form.write().loras[i].name = e.value(),
                                    }
                                    input {
                                        r#type: "text",
                                        class: "w-14 rounded-lg border border-edge bg-app px-2 py-1.5 text-center text-[11px] text-white outline-none focus:border-accent/60",
                                        value: "{weight_value}",
                                        oninput: move |e| form.write().loras[i].weight = e.value(),
                                    }
                                    button {
                                        class: "grid size-7 shrink-0 place-items-center rounded-lg border border-edge bg-input text-sub transition-colors hover:text-white",
                                        title: "Remove adapter",
                                        onclick: move |_| { form.write().loras.remove(i); },
                                        Icon { name: "close", class: "size-3.5" }
                                    }
                                }
                            }
                        }
                    }
                    button {
                        class: "flex w-full items-center justify-center gap-1.5 rounded-lg border border-edge bg-input py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-white/5 disabled:opacity-50",
                        disabled: f.loras.len() >= MAX_LORAS,
                        onclick: move |_| {
                            let mut guard = form.write();
                            if guard.loras.len() < MAX_LORAS {
                                guard.loras.push(LoraUi { name: String::new(), weight: "1.0".to_string() });
                            }
                        },
                        Icon { name: "plus", class: "size-3.5" }
                        if f.loras.len() >= MAX_LORAS { "Max 8 adapters" } else { "Add LoRA" }
                    }
                }

                // Prompt
                NodeSection { title: "Prompt",
                    div { class: "space-y-1",
                        FieldLabel { label: "Positive" }
                        textarea {
                            class: "min-h-[64px] w-full resize-y rounded-lg border border-edge bg-app px-2.5 py-2 text-[12px] leading-relaxed text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                            placeholder: "Describe the image…",
                            value: "{f.prompt}",
                            oninput: move |e| form.write().prompt = e.value(),
                        }
                    }
                    div { class: "space-y-1",
                        FieldLabel { label: "Negative" }
                        textarea {
                            class: "min-h-[44px] w-full resize-y rounded-lg border border-edge bg-app px-2.5 py-2 text-[12px] leading-relaxed text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                            placeholder: "What to avoid…",
                            value: "{f.negative}",
                            oninput: move |e| form.write().negative = e.value(),
                        }
                    }
                }

                // Sampler
                NodeSection { title: "Sampler",
                    div { class: "space-y-1",
                        FieldLabel { label: "Sampler" }
                        DropdownMenu {
                            options: sampler_labels(),
                            selected: f.sampler.clone(),
                            menu_class: "left-0 top-full mt-1 w-56",
                            on_select: move |value: String| form.write().sampler = value,
                            span { class: "truncate", "{f.sampler}" }
                        }
                    }
                    div { class: "space-y-1",
                        FieldLabel { label: "Scheduler" }
                        DropdownMenu {
                            options: scheduler_labels(),
                            selected: f.scheduler.clone(),
                            menu_class: "left-0 top-full mt-1 w-56",
                            on_select: move |value: String| form.write().scheduler = value,
                            span { class: "truncate", "{f.scheduler}" }
                        }
                    }
                    Slider {
                        label: "Steps", value: f.steps as f64,
                        min: 1.0, max: 150.0, step: 1.0, decimals: 0,
                        on_change: move |v: f64| form.write().steps = v.round() as u32,
                    }
                    Slider {
                        label: "CFG", value: f.cfg,
                        min: 0.0, max: 30.0, step: 0.1, decimals: 1,
                        on_change: move |v: f64| form.write().cfg = v,
                    }
                    Slider {
                        label: "Denoise", value: f.denoise,
                        min: 0.0, max: 1.0, step: 0.01, decimals: 2,
                        on_change: move |v: f64| form.write().denoise = v,
                    }
                }

                // Latent
                NodeSection { title: "Latent",
                    div { class: "grid grid-cols-2 gap-2",
                        div { class: "space-y-1",
                            FieldLabel { label: "Width" }
                            input {
                                r#type: "text", inputmode: "numeric",
                                class: "w-full rounded-lg border border-edge bg-app px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                                placeholder: "512",
                                value: "{f.width}",
                                oninput: move |e| form.write().width = e.value(),
                            }
                        }
                        div { class: "space-y-1",
                            FieldLabel { label: "Height" }
                            input {
                                r#type: "text", inputmode: "numeric",
                                class: "w-full rounded-lg border border-edge bg-app px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                                placeholder: "512",
                                value: "{f.height}",
                                oninput: move |e| form.write().height = e.value(),
                            }
                        }
                    }
                    div { class: "space-y-1",
                        FieldLabel { label: "Batch" }
                        Stepper {
                            value: f.batch, min: 1, max: MAX_BATCH,
                            on_step: move |delta: i32| {
                                let mut guard = form.write();
                                let next = (guard.batch as i64 + delta as i64).clamp(1, MAX_BATCH as i64);
                                guard.batch = next as u32;
                            },
                        }
                    }
                }

                // Seed
                NodeSection { title: "Seed",
                    div { class: "flex items-end gap-1.5",
                        div { class: "min-w-0 flex-1 space-y-1",
                            FieldLabel { label: "Seed" }
                            input {
                                r#type: "text", inputmode: "numeric",
                                class: "w-full rounded-lg border border-edge bg-app px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                                placeholder: "random",
                                value: "{f.seed}",
                                oninput: move |e| form.write().seed = e.value(),
                            }
                        }
                        button {
                            class: "grid size-8 shrink-0 place-items-center rounded-lg border border-edge bg-input text-accent transition-colors hover:bg-white/5",
                            title: "Random seed",
                            onclick: move |_| form.write().seed = random_seed().to_string(),
                            Icon { name: "sparkles", class: "size-4" }
                        }
                    }
                    if f.provider != NATIVE_ID {
                        div { class: "space-y-1",
                            FieldLabel { label: "Base URL" }
                            input {
                                r#type: "text",
                                class: "w-full rounded-lg border border-edge bg-app px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-sub/60 focus:border-accent/60",
                                placeholder: "{base_placeholder}",
                                value: "{f.base_url}",
                                oninput: move |e| form.write().base_url = e.value(),
                            }
                            p { class: "text-[10px] leading-snug text-sub/60",
                                "The install must allow browser requests (CORS)."
                            }
                        }
                    }
                }

                // Generate
                button {
                    class: "flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-accent1 to-accent2 text-[13px] font-bold text-white shadow-[0_0_24px_rgba(176,38,255,0.35)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
                    disabled: f.busy,
                    onclick: move |_| generate(form),
                    Icon { name: "sparkles", class: "size-4" }
                    if f.busy { "Generating…" } else { "Generate" }
                }
                if !f.status.is_empty() {
                    p { class: "text-[11px] leading-snug {status_style}", "{f.status}" }
                }
            }

            // ---- Output grid -------------------------------------------------
            div { class: "flex min-w-0 flex-1 flex-col bg-app",
                div { class: "flex h-11 shrink-0 items-center gap-3 border-b border-edge px-3",
                    h2 { class: "text-[12px] font-semibold text-white", "Output" }
                    div { class: "flex-1" }
                    span { class: "text-[11px] text-sub",
                        if f.busy { "Rendering…" } else { "{f.tiles.len()} images" }
                    }
                }

                if f.tiles.is_empty() && !f.busy {
                    div { class: "flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-2 p-6 text-center",
                        div { class: "grid size-12 place-items-center rounded-2xl border border-edge bg-input/60",
                            Icon { name: "image", class: "size-6 text-sub" }
                        }
                        div { class: "text-[18px] font-semibold text-white", "No images yet" }
                        div { class: "text-[12px] text-sub",
                            "Pick a backend, write a prompt, and hit Generate."
                        }
                    }
                }

                if f.busy {
                    div { class: "flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3 text-center",
                        div { class: "text-[14px] font-semibold text-accent", "Sampling…" }
                        div { class: "text-[11px] text-sub",
                            "Images land here as the backend finishes."
                        }
                        div { class: "h-1 w-44 overflow-hidden rounded-full bg-input",
                            div { class: "animate-shimmer h-full w-1/2 rounded-full bg-accent" }
                        }
                    }
                }

                if !f.tiles.is_empty() && !f.busy {
                    div { class: "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3",
                        for (i, tile) in f.tiles.iter().enumerate() {
                            {
                                let src = tile.url.clone();
                                let label = tile.label.clone();
                                rsx! {
                                    figure { key: "{i}", class: "overflow-hidden rounded-xl border border-edge bg-panel",
                                        div { class: "aspect-square w-full bg-app",
                                            img {
                                                src: "{src}",
                                                alt: "{label}",
                                                class: "h-full w-full object-contain",
                                            }
                                        }
                                        figcaption { class: "truncate px-2.5 py-2 text-[10.5px] font-medium text-accent",
                                            "{label}"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
