//! The six node definitions of the image graph, and the factory that
//! lays out a starting drawing.
//!
//! The field set mirrors the Slint image studio's parameter panel one for
//! one, so the two surfaces expose the same knobs rather than diverging.
//! Nothing here contains a Stable Diffusion rule: samplers, schedulers,
//! clamps and defaults all belong to the core. These definitions say
//! *which* knobs exist and what a node can connect to.

use super::graph::{Knob, NodeDef, NodeFamily, Port, PortKind};

/// One LoRA row in the LoRA node (name + weight, kept as typed).
pub const LORA_ROW_KNOB: Knob = Knob::text("lora_rows", "LoRA rows");

/// `[Checkpoint Loader]` — the model side of a graph.
static CHECKPOINT_PORTS_IN: &[Port] = &[Port {
    id: "loras",
    label: "LoRA stack",
    kind: PortKind::Model,
    output: false,
}];

static CHECKPOINT_PORTS_OUT: &[Port] = &[Port {
    id: "model",
    label: "Model",
    kind: PortKind::Model,
    output: true,
}];

static CHECKPOINT_KNOBS: &[Knob] = &[
    Knob::text("checkpoint", "Checkpoint"),
    Knob::text("vae", "VAE"),
    Knob::number("clip_skip", "CLIP skip"),
];

/// `[Prompt]` — positive and negative conditioning.
static PROMPT_PORTS_OUT: &[Port] = &[Port {
    id: "conditioning",
    label: "Conditioning",
    kind: PortKind::Conditioning,
    output: true,
}];

static PROMPT_KNOBS: &[Knob] = &[
    Knob::text("prompt", "Positive"),
    Knob::text("negative", "Negative"),
];

/// `[LoRA Stack]` — the adapter rows feeding a checkpoint.
static LORA_PORTS_OUT: &[Port] = &[Port {
    id: "loras",
    label: "Adapters",
    kind: PortKind::Model,
    output: true,
}];

static LORA_KNOBS: &[Knob] = &[LORA_ROW_KNOB];

/// `[KSampler]` — sampler, scheduler, steps, cfg, denoise, plus its
/// four inputs (model, conditioning, latent, seed).
static SAMPLER_PORTS_IN: &[Port] = &[
    Port {
        id: "model",
        label: "Model",
        kind: PortKind::Model,
        output: false,
    },
    Port {
        id: "conditioning",
        label: "Conditioning",
        kind: PortKind::Conditioning,
        output: false,
    },
    Port {
        id: "latent",
        label: "Latent",
        kind: PortKind::Latent,
        output: false,
    },
    Port {
        id: "seed",
        label: "Seed",
        kind: PortKind::Seed,
        output: false,
    },
];

static SAMPLER_PORTS_OUT: &[Port] = &[Port {
    id: "samples",
    label: "Samples",
    kind: PortKind::Sampler,
    output: true,
}];

static SAMPLER_KNOBS: &[Knob] = &[
    Knob::enumeration("sampler", "Sampler"),
    Knob::enumeration("scheduler", "Scheduler"),
    Knob::number("steps", "Steps"),
    Knob::number("cfg", "CFG"),
    Knob::percent("denoise", "Denoise"),
];

/// `[Empty Latent]` — width/height and batch, with aspect presets.
static LATENT_PORTS_OUT: &[Port] = &[Port {
    id: "latent",
    label: "Latent",
    kind: PortKind::Latent,
    output: true,
}];

static LATENT_KNOBS: &[Knob] = &[
    Knob::number("width", "Width"),
    Knob::number("height", "Height"),
    Knob::number("batch", "Batch"),
    Knob::enumeration("aspect", "Aspect"),
];

/// `[Seed]` — the seed with its reuse lock.
static SEED_PORTS_OUT: &[Port] = &[Port {
    id: "seed",
    label: "Seed",
    kind: PortKind::Seed,
    output: true,
}];

static SEED_KNOBS: &[Knob] = &[
    Knob::text("seed", "Seed (empty = random)"),
    Knob::text("seed_locked", "Locked"),
];

const CHECKPOINT: NodeDef = NodeDef {
    kind: "checkpoint",
    title: "Checkpoint Loader",
    family: NodeFamily::Model,
    inputs: CHECKPOINT_PORTS_IN,
    outputs: CHECKPOINT_PORTS_OUT,
    knobs: CHECKPOINT_KNOBS,
};

const LORA: NodeDef = NodeDef {
    kind: "lora",
    title: "LoRA Stack",
    family: NodeFamily::Model,
    inputs: &[],
    outputs: LORA_PORTS_OUT,
    knobs: LORA_KNOBS,
};

const PROMPT: NodeDef = NodeDef {
    kind: "prompt",
    title: "Prompt",
    family: NodeFamily::Prompt,
    inputs: &[],
    outputs: PROMPT_PORTS_OUT,
    knobs: PROMPT_KNOBS,
};

const SAMPLER: NodeDef = NodeDef {
    kind: "sampler",
    title: "KSampler",
    family: NodeFamily::Sampler,
    inputs: SAMPLER_PORTS_IN,
    outputs: SAMPLER_PORTS_OUT,
    knobs: SAMPLER_KNOBS,
};

const LATENT: NodeDef = NodeDef {
    kind: "latent",
    title: "Empty Latent",
    family: NodeFamily::Latent,
    inputs: &[],
    outputs: LATENT_PORTS_OUT,
    knobs: LATENT_KNOBS,
};

const SEED: NodeDef = NodeDef {
    kind: "seed",
    title: "Seed",
    family: NodeFamily::Seed,
    inputs: &[],
    outputs: SEED_PORTS_OUT,
    knobs: SEED_KNOBS,
};

/// Every node type, in the palette order the graph offers them.
pub const NODE_DEFS: &[&NodeDef] = &[&CHECKPOINT, &LORA, &PROMPT, &SAMPLER, &LATENT, &SEED];

/// Look up a definition by its kind id.
pub fn node_def(kind: &str) -> Option<&'static NodeDef> {
    NODE_DEFS.iter().copied().find(|d| d.kind == kind)
}