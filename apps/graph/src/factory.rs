//! Creating nodes and laying out the starting drawing.
//!
//! Defaults here are the *shape* of the starting canvas, not SD rules:
//! the sampler/scheduler/steps/cfg ids come from core (`media_defaults`),
//! and the size presets are the same label set the Slint panel ships.
//! The host fills whatever is missing from the core's defaults before a
//! request is built, so nothing here needs a second copy of a constant.

use super::graph::{Graph, GraphNode, NodeFamily, NodeValues};
use super::nodes::node_def;

/// Aspect presets, matching the Slint panel's label set. The pixels come
/// from core (`a1111_size`), which understands any `w:h` string.
pub const ASPECT_PRESETS: &[&str] = &["1:1", "4:3", "3:4", "16:9", "9:16"];

/// Sampler ids offered by the Latent/Sampler comboboxes. These are the
/// core's KSampler ids; the A1111 mapping translates display names.
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

/// Backends, in panel order: the in-process native renderer first, then
/// the local installs. Ids match `prism_core::media`.
pub const BACKENDS: &[(&str, &str)] = &[
    ("native", "Native (built-in)"),
    ("a1111", "Automatic1111"),
    ("comfyui", "ComfyUI"),
];

/// The default knob values a fresh node starts with: the ids the panel
/// renders, and a starting value for each. `sampler`, `scheduler`,
/// `steps`, `cfg`, `width` and `height` are overwritten by the core's
/// defaults when the graph mounts, so they only need a sane first paint.
pub fn default_values(kind: &str) -> NodeValues {
    let is_seed = matches!(kind, "seed");
    let mut values = NodeValues::default();
    match kind {
        "checkpoint" => {
            values.set_text("checkpoint", "");
            values.set_text("vae", "");
            values.set_number("clip_skip", 1.0);
        }
        "lora" => {}
        "prompt" => {
            values.set_text("prompt", "");
            values.set_text("negative", "");
        }
        "sampler" => {
            values.set_enum("sampler", "euler");
            values.set_enum("scheduler", "normal");
            values.set_number("steps", 20.0);
            values.set_number("cfg", 7.0);
            values.set_number("denoise", 1.0);
        }
        "latent" => {
            values.set_number("width", 512.0);
            values.set_number("height", 512.0);
            values.set_number("batch", 1.0);
            values.set_enum("aspect", "1:1");
        }
        "seed" => {
            values.set_text("seed", "");
            values.set_text("seed_locked", if is_seed { "unlocked" } else { "unlocked" });
        }
        _ => {}
    }
    values
}

/// Create a node of `kind` at a canvas position.
pub fn make_node(id: u64, kind: &str, x: f64, y: f64) -> Option<GraphNode> {
    let def = node_def(kind)?;
    Some(GraphNode {
        id,
        kind: def.kind.to_string(),
        x,
        y,
        values: default_values(def.kind),
    })
}

/// Where the palette drops a new node: staggered so repeated additions
/// do not stack exactly on each other.
pub fn drop_spot(count: usize, origin_x: f64, origin_y: f64) -> (f64, f64) {
    let step = (count % 5) as f64;
    (origin_x + step * 28.0, origin_y + step * 28.0)
}

/// The drawing a first-time visitor sees: a recognizable pipeline —
/// LoRA stack feeding Checkpoint, Prompt and Latent feeding KSampler,
/// Seed beside it — pre-wired, with the same node order the palette
/// lists. The host replaces the placeholder knob values with the core's
/// defaults on mount.
pub fn starter_graph() -> Graph {
    let mut graph = Graph::default();
    let mut next_id = 1u64;

    let mut add = |kind: &str, x: f64, y: f64| -> GraphNode {
        let node = make_node(next_id, kind, x, y).expect("known node kind");
        next_id += 1;
        graph.nodes.push(node.clone());
        node
    };

    let checkpoint = add("checkpoint", 40.0, 40.0);
    let lora = add("lora", 40.0, 300.0);
    let prompt = add("prompt", 40.0, 520.0);
    let sampler = add("sampler", 420.0, 180.0);
    let latent = add("latent", 40.0, 700.0);
    // The seed node is placed but deliberately left unwired: an empty
    // seed field means "random", which is the friendlier first run.
    add("seed", 420.0, 430.0);

    // Pre-wire the recognizable path; each of these is legal, so a fresh
    // canvas shows a working pipeline and not an empty field.
    graph.connect(crate::graph::Wire::new(
        lora.id,
        "loras",
        checkpoint.id,
        "loras",
    ));
    graph.connect(crate::graph::Wire::new(
        checkpoint.id,
        "model",
        sampler.id,
        "model",
    ));
    graph.connect(crate::graph::Wire::new(
        prompt.id,
        "conditioning",
        sampler.id,
        "conditioning",
    ));
    graph.connect(crate::graph::Wire::new(
        latent.id,
        "latent",
        sampler.id,
        "latent",
    ));

    graph
}

/// The family color a node header wears, matching the Slint panel's
/// accents so the two surfaces read the same.
pub fn family_color(_family: NodeFamily) -> &'static str {
    // Presentation belongs to the stylesheet; the graph only needs the
    // family to group ports. Kept as a function so call sites document
    // intent without the markup depending on it.
    "accent"
}