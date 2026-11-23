//! Flattening a drawn graph into the request a host consumes.
//!
//! The graph is read in pipeline order: find the sampler node, then pull
//! its model / conditioning / latent inputs across their wires and their
//! knobs into a flat form. Seed attaches to the sampler directly (the
//! seed node is optional — an empty seed field means "random").
//!
//! The output mirrors the browser host's `ImageForm`:
//! (`apps/web/src/studio/media.ts`): the same field names, the same
//! "blank means none" conventions, so the host's generation path needs
//! no changes and the core still owns every clamp. What this module adds
//! is *which* node feeds which — the part of the request a parameter
//! panel cannot express.

use serde::{Deserialize, Serialize};

use super::graph::Graph;
use super::graph_nodes::node_def;

/// One LoRA row as the host expects it (name plus weight as typed).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoraForm {
    pub name: String,
    pub weight: String,
}

/// The flat form built from the graph. Field-for-field the host's
/// `ImageForm`, minus `base_url` (the host fills that from the backend
/// and the user's settings).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GraphForm {
    pub provider: String,
    pub checkpoint: String,
    pub vae: String,
    pub clip_skip: String,
    pub loras: Vec<LoraForm>,
    pub prompt: String,
    pub negative_prompt: String,
    pub sampler: String,
    pub scheduler: String,
    pub steps: String,
    pub cfg: String,
    pub denoise: String,
    pub width: String,
    pub height: String,
    pub batch: String,
    pub seed: String,
}

/// Why a graph cannot be generated from yet. The UI shows these as
/// status text instead of guessing at a broken request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    NoSampler,
    NoPrompt,
    NoPromptText,
}

impl std::fmt::Display for GraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GraphError::NoSampler => write!(f, "Add a KSampler node to generate."),
            GraphError::NoPrompt => write!(f, "Connect a Prompt node to the KSampler."),
            GraphError::NoPromptText => write!(f, "Write a prompt first."),
        }
    }
}

impl std::error::Error for GraphError {}

/// Read a number knob as the panel's own string, so the host parses it
/// with its own rules (and the core clamps it). Integers print without a
/// decimal tail; a fractional knob (CFG's 0.1 steps) keeps it.
fn number_as_text(node: &super::graph::GraphNode, id: &str) -> Option<String> {
    let value = node.values.number(id)?;
    if !value.is_finite() {
        return None;
    }
    let rounded = value.round();
    if (value - rounded).abs() < 1e-9 {
        Some(format!("{}", rounded as i64))
    } else {
        // Trim the noise of binary floats (7.300000000000001 → 7.3).
        let text = format!("{value:.3}");
        Some(text.trim_end_matches('0').trim_end_matches('.').to_string())
    }
}

/// Read a percent knob (0..1) the same way, at core's precision.
fn percent_as_text(node: &super::graph::GraphNode, id: &str) -> Option<String> {
    let value = node.values.number(id)?;
    if value.is_finite() {
        Some(format!("{:.2}", value))
    } else {
        None
    }
}

/// A knob as displayed, for the node body: its label, control type and
/// current value. Used by the app to render rows without re-deriving ids.
#[derive(Debug, Clone)]
pub struct KnobRow {
    pub id: &'static str,
    pub label: &'static str,
    pub control: &'static str,
    pub value: String,
    /// Extra choices for an enum control (sampler, scheduler, aspect).
    pub options: Vec<&'static str>,
    /// For a text control, the placeholder shown when empty.
    pub placeholder: String,
    /// True when the row is a toggle (the seed lock).
    pub toggle: bool,
}

/// Collect the rows a node should render, with values filled in.
pub fn knob_rows(node: &super::graph::GraphNode) -> Vec<KnobRow> {
    let Some(def) = node_def(&node.kind) else {
        return Vec::new();
    };
    def.knobs
        .iter()
        .map(|knob| {
            let (mut value, options, mut placeholder, mut toggle) = match knob.control {
                "text" => (node.values.text(knob.id).map(String::from).unwrap_or_default(), Vec::new(), String::new(), false),
                "number" => (
                    number_as_text(node, knob.id).unwrap_or_default(),
                    Vec::new(),
                    String::new(),
                    false,
                ),
                "percent" => (
                    node
                        .values
                        .number(knob.id)
                        .map(|v| format!("{:.2}", v))
                        .unwrap_or_default(),
                    Vec::new(),
                    String::new(),
                    false,
                ),
                "enum" => {
                    let current = node
                        .values
                        .enumeration(knob.id)
                        .map(String::from)
                        .unwrap_or_default();
                    let choices = match knob.id {
                        "sampler" => super::graph_factory::SAMPLERS.to_vec(),
                        "scheduler" => super::graph_factory::SCHEDULERS.to_vec(),
                        "aspect" => super::graph_factory::ASPECT_PRESETS.to_vec(),
                        _ => Vec::new(),
                    };
                    (current, choices, String::new(), false)
                }
                _ => (String::new(), Vec::new(), String::new(), false),
            };
            if knob.id == "seed_locked" {
                value = node
                    .values
                    .text(knob.id)
                    .unwrap_or("unlocked")
                    .to_string();
                toggle = true;
            }
            if knob.id == "seed" && value.is_empty() {
                placeholder.push_str("empty = random");
            }
            KnobRow {
                id: knob.id,
                label: knob.label,
                control: knob.control,
                value,
                options,
                placeholder,
                toggle,
            }
        })
        .collect()
}

/// Find the node that feeds a sampler input, across one hop.
fn upstream<'a>(graph: &'a Graph, sampler_id: u64, port: &str) -> Option<&'a super::graph::GraphNode> {
    let wire = graph
        .inputs_of(sampler_id)
        .into_iter()
        .find(|w| w.to_port == port)?;
    graph.node(wire.from_node)
}

/// Flatten a graph into the host's form.
pub fn to_form(graph: &Graph, provider: &str) -> Result<GraphForm, GraphError> {
    let sampler = graph
        .nodes
        .iter()
        .find(|n| n.kind == "sampler")
        .ok_or(GraphError::NoSampler)?;

    let mut form = GraphForm {
        provider: provider.to_string(),
        ..Default::default()
    };

    // Sampler knobs.
    form.sampler = sampler.values.enumeration("sampler").unwrap_or("euler").to_string();
    form.scheduler = sampler
        .values
        .enumeration("scheduler")
        .unwrap_or("normal")
        .to_string();
    form.steps = number_as_text(sampler, "steps").unwrap_or_else(|| "20".into());
    form.cfg = number_as_text(sampler, "cfg").unwrap_or_else(|| "7".into());
    form.denoise = percent_as_text(sampler, "denoise").unwrap_or_else(|| "1.00".into());

    // Prompt: must be connected and non-blank.
    let prompt_node = upstream(graph, sampler.id, "conditioning").ok_or(GraphError::NoPrompt)?;
    form.prompt = prompt_node.values.text("prompt").unwrap_or("").trim().to_string();
    form.negative_prompt = prompt_node
        .values
        .text("negative")
        .unwrap_or("")
        .to_string();
    if form.prompt.is_empty() {
        return Err(GraphError::NoPromptText);
    }

    // Latent: size and batch come from the connected node, else the
    // sampler's own (a graph may simply omit the node).
    if let Some(latent) = upstream(graph, sampler.id, "latent") {
        form.width = number_as_text(latent, "width").unwrap_or_default();
        form.height = number_as_text(latent, "height").unwrap_or_default();
        form.batch = number_as_text(latent, "batch").unwrap_or_else(|| "1".into());
    } else {
        form.batch = "1".into();
    }

    // Model: checkpoint/VAE/CLIP skip/LoRA rows, from the connected node.
    if let Some(model) = upstream(graph, sampler.id, "model") {
        form.checkpoint = model.values.text("checkpoint").unwrap_or("").to_string();
        form.vae = model.values.text("vae").unwrap_or("").to_string();
        form.clip_skip = number_as_text(model, "clip_skip").unwrap_or_else(|| "1".into());
        form.loras = lora_rows_of(graph, model);
    }

    // Seed: the connected seed node wins; otherwise the sampler's own
    // field (kept empty on a fresh canvas to mean "random").
    if let Some(seed_node) = upstream(graph, sampler.id, "seed") {
        form.seed = seed_node.values.text("seed").unwrap_or("").trim().to_string();
    }

    Ok(form)
}

/// The LoRA rows that reach the sampler: a LoRA node wired straight into
/// the sampler, plus the rows on a wired LoRA node feeding a checkpoint.
/// Rows are deduplicated by name, first wire wins.
fn lora_rows_of(graph: &Graph, model_node: &super::graph::GraphNode) -> Vec<LoraForm> {
    let mut rows: Vec<LoraForm> = Vec::new();

    let mut push = |name: &str, weight: &str| {
        let name = name.trim();
        if name.is_empty() {
            return;
        }
        if rows.iter().any(|r| r.name == name) {
            return;
        }
        rows.push(LoraForm {
            name: name.to_string(),
            weight: weight.trim().to_string(),
        });
    };

    // A LoRA node feeding the sampler's model input directly.
    if let Some(direct) = upstream(graph, model_node.id, "model") {
        if direct.kind == "lora" {
            for row in &direct.values.loras {
                push(&row.name, &row.weight);
            }
        }
    }

    // A LoRA node feeding the checkpoint's `loras` input.
    for wire in graph.inputs_of(model_node.id) {
        if wire.to_port != "loras" {
            continue;
        }
        if let Some(node) = graph.node(wire.from_node) {
            if node.kind == "lora" {
                for row in &node.values.loras {
                    push(&row.name, &row.weight);
                }
            }
        }
    }

    // The checkpoint node itself may carry inline rows.
    for row in &model_node.values.loras {
        push(&row.name, &row.weight);
    }

    rows
}

/// Is the seed locked? Reads the wired seed node, so the app can freeze
/// the dice without tracking a parallel boolean.
pub fn seed_locked(graph: &Graph) -> bool {
    let Some(sampler) = graph.nodes.iter().find(|n| n.kind == "sampler") else {
        return false;
    };
    let Some(seed_node) = upstream(graph, sampler.id, "seed") else {
        return false;
    };
    seed_node
        .values
        .text("seed_locked")
        .map(|v| v == "locked")
        .unwrap_or(false)
}