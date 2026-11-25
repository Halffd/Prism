//! The canvas graph model: nodes, typed ports, wires and the flattening
//! step that turns a drawn graph into a media request.
//!
//! This module is deliberately free of any UI framework and of any
//! Stable Diffusion rule. It knows *shape* — where a knob lives, which
//! port feeds which, what a wire between two ports means — and nothing
//! about pixels. The request it produces is handed to a host (the
//! browser web app through the WASM bridge, or a native server), which
//! owns every clamp, default and wire body. Keeping that split means the
//! graph is testable without a browser and can never drift from the
//! core's SD rules.

use serde::{Deserialize, Serialize};

use crate::graph_nodes::node_def;

/// Node logic color, in the ComfyUI visual language (model / prompt /
/// sampler / latent / seed families). Presentation only — the `.dslx`
/// markup reads it to tint a node header, and nothing else looks at it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeFamily {
    /// Model-loading nodes (checkpoint, VAE, LoRA).
    Model,
    /// Conditioning nodes (prompt, negative prompt).
    Prompt,
    /// Sampling nodes (sampler, scheduler, steps, cfg, denoise).
    Sampler,
    /// Latent-space nodes (size, batch).
    Latent,
    /// Seed nodes.
    Seed,
}

impl NodeFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeFamily::Model => "model",
            NodeFamily::Prompt => "prompt",
            NodeFamily::Sampler => "sampler",
            NodeFamily::Latent => "latent",
            NodeFamily::Seed => "seed",
        }
    }
}

/// What a port carries. A wire is only legal between a matching pair,
/// so the graph knows which attachments mean anything and rejects the
/// rest (the same discipline as ComfyUI's typed sockets).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PortKind {
    /// A checkpoint/VAE/adapter reference.
    Model,
    /// Text that conditions the sample.
    Conditioning,
    /// Sampler settings.
    Sampler,
    /// A width/height pair.
    Latent,
    /// An integer seed.
    Seed,
}

/// One socket on a node. `id` is unique within the node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Port {
    pub id: &'static str,
    pub label: &'static str,
    pub kind: PortKind,
    pub output: bool,
}

/// The parameter each node exposes. The value is kept as a string in the
/// panel's own units (numbers as typed, enums as ids) and parsed by the
/// host when the request is built — same contract as the Slint image
/// studio, so both surfaces stay symmetric.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Knob {
    pub id: &'static str,
    pub label: &'static str,
    /// "text" | "number" | "enum" | "percent"
    pub control: &'static str,
}

impl Knob {
    pub const fn text(id: &'static str, label: &'static str) -> Self {
        Knob { id, label, control: "text" }
    }
    pub const fn number(id: &'static str, label: &'static str) -> Self {
        Knob { id, label, control: "number" }
    }
    pub const fn percent(id: &'static str, label: &'static str) -> Self {
        Knob { id, label, control: "percent" }
    }
    pub const fn enumeration(id: &'static str, label: &'static str) -> Self {
        Knob { id, label, control: "enum" }
    }
}

/// A node definition: what the panel renders, before any state.
#[derive(Debug, Clone)]
pub struct NodeDef {
    pub kind: &'static str,
    pub title: &'static str,
    pub family: NodeFamily,
    pub inputs: &'static [Port],
    pub outputs: &'static [Port],
    pub knobs: &'static [Knob],
}

/// One LoRA row, mirroring the panel: name plus a weight kept as typed.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct LoraEntry {
    pub name: String,
    pub weight: String,
}

/// Every knob value a node holds, by `Knob::id`. The keys are owned
/// strings because a graph round-trips through localStorage, and
/// `&'static str` cannot be deserialized.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NodeValues {
    pub text: Vec<(String, String)>,
    pub numbers: Vec<(String, f64)>,
    pub enums: Vec<(String, String)>,
    pub loras: Vec<LoraEntry>,
}

impl NodeValues {
    pub fn text(&self, id: &str) -> Option<&str> {
        self.text.iter().find(|(k, _)| *k == id).map(|(_, v)| v.as_str())
    }

    pub fn number(&self, id: &str) -> Option<f64> {
        self.numbers.iter().find(|(k, _)| *k == id).map(|(_, v)| *v)
    }

    pub fn enumeration(&self, id: &str) -> Option<&str> {
        self.enums.iter().find(|(k, _)| *k == id).map(|(_, v)| v.as_str())
    }

    /// Set a control's value, replacing any previous entry for that id.
    pub fn set_text(&mut self, id: &str, value: impl Into<String>) {
        if let Some(slot) = self.text.iter_mut().find(|(k, _)| k == id) {
            slot.1 = value.into();
        } else {
            self.text.push((id.to_string(), value.into()));
        }
    }

    /// Mutable access to a text value's string, for in-place toggles.
    pub fn text_mut(&mut self, id: &str) -> Option<&mut String> {
        self.text
            .iter_mut()
            .find(|(k, _)| k == id)
            .map(|(_, v)| v)
    }

    pub fn set_number(&mut self, id: &str, value: f64) {
        if let Some(slot) = self.numbers.iter_mut().find(|(k, _)| k == id) {
            slot.1 = value;
        } else {
            self.numbers.push((id.to_string(), value));
        }
    }

    pub fn set_enum(&mut self, id: &str, value: impl Into<String>) {
        if let Some(slot) = self.enums.iter_mut().find(|(k, _)| k == id) {
            slot.1 = value.into();
        } else {
            self.enums.push((id.to_string(), value.into()));
        }
    }
}

/// A node placed on the canvas: which definition, where, and its knob
/// values. Identity is the `id`; wires refer to it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: u64,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub values: NodeValues,
}

/// A wire between one output port and one input port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wire {
    pub from_node: u64,
    pub from_port: String,
    pub to_node: u64,
    pub to_port: String,
}

impl Wire {
    /// Build a wire from static port ids (the node definitions use
    /// `&'static str`), converting to the owned form the graph stores.
    pub fn new(
        from_node: u64,
        from_port: &str,
        to_node: u64,
        to_port: &str,
    ) -> Wire {
        Wire {
            from_node,
            from_port: from_port.to_string(),
            to_node,
            to_port: to_port.to_string(),
        }
    }

    /// The flip of a wire, for direction-independent comparisons.
    pub fn flipped(&self) -> Wire {
        Wire {
            from_node: self.to_node,
            from_port: self.to_port.clone(),
            to_node: self.from_node,
            to_port: self.from_port.clone(),
        }
    }
}

/// The whole drawing: nodes plus wires. Pure data, so it can be
/// serialized into localStorage and back without a browser.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub wires: Vec<Wire>,
}

impl Graph {
    pub fn node(&self, id: u64) -> Option<&GraphNode> {
        self.nodes.iter().find(|n| n.id == id)
    }

    pub fn node_mut(&mut self, id: u64) -> Option<&mut GraphNode> {
        self.nodes.iter_mut().find(|n| n.id == id)
    }

    /// The port behind a node id + port id, or `None` if the node or port
    /// does not exist.
    pub fn port(&self, node_id: u64, port_id: &str) -> Option<(NodeFamily, PortKind, bool)> {
        let node = self.node(node_id)?;
        let def = node_def(&node.kind)?;
        let port = def
            .inputs
            .iter()
            .chain(def.outputs.iter())
            .find(|p| p.id == port_id)?;
        Some((def.family, port.kind, port.output))
    }

    /// Is this wire legal? A wire must connect an output to an input of
    /// the same kind, never a node to itself, and never duplicate or
    /// contradict an existing wire.
    pub fn wire_is_valid(&self, wire: &Wire) -> bool {
        if wire.from_node == wire.to_node {
            return false;
        }
        let Some((_, from_kind, from_is_output)) = self.port(wire.from_node, &wire.from_port) else {
            return false;
        };
        let Some((_, to_kind, to_is_output)) = self.port(wire.to_node, &wire.to_port) else {
            return false;
        };
        if !from_is_output || to_is_output || from_kind != to_kind {
            return false;
        }
        // A given input accepts one wire; an output may fan out.
        if self.wires.iter().any(|w| w.to_node == wire.to_node && w.to_port == wire.to_port) {
            return false;
        }
        // Refuse an exact or reversed duplicate.
        !self
            .wires
            .iter()
            .any(|w| w == wire || *w == wire.flipped())
    }

    /// Add a wire when it is legal. Returns whether it was added, so the
    /// UI can show a one-frame "rejected" pulse on the port.
    pub fn connect(&mut self, wire: Wire) -> bool {
        if self.wire_is_valid(&wire) {
            self.wires.push(wire);
            true
        } else {
            false
        }
    }

    /// Remove every wire touching a node, when the node is deleted.
    pub fn remove_node(&mut self, node_id: u64) {
        self.nodes.retain(|n| n.id != node_id);
        self.wires
            .retain(|w| w.from_node != node_id && w.to_node != node_id);
    }

    /// Wires whose input half lives on this node (what feeds it).
    pub fn inputs_of(&self, node_id: u64) -> Vec<&Wire> {
        self.wires
            .iter()
            .filter(|w| w.to_node == node_id)
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Port coordinates — the only place the graph touches pixels
// ---------------------------------------------------------------------------

/// Node box metrics, shared by the markup and the geometry helpers so a
/// wire lands exactly on a rendered socket.
pub const NODE_WIDTH: f64 = 248.0;
pub const HEADER_H: f64 = 30.0;
pub const PORT_ROW_H: f64 = 24.0;
pub const PORT_START: f64 = HEADER_H + 8.0;
pub const PORT_DOT: f64 = 11.0;
/// Height of one knob row inside a node body. Presentation, but every
/// surface draws the same row height, which is what makes a node's box
/// (and therefore its hit area) agree.
pub const KNOB_ROW_H: f64 = 26.0;
/// Breathing room below the last knob.
pub const NODE_BODY_PAD: f64 = 8.0;

/// How tall a node of this kind draws.
///
/// Both canvases need this — to lay the box out and to know where a click
/// stops hitting it — so it lives beside `port_position` rather than in
/// either surface's markup.
pub fn node_height(def: &NodeDef) -> f64 {
    let port_rows = def.inputs.len().max(def.outputs.len()) as f64;
    // Ports start at PORT_START; a node with none starts its knobs there.
    let ports = if port_rows == 0.0 {
        0.0
    } else {
        PORT_START + port_rows * PORT_ROW_H
    };
    let knobs = def.knobs.len() as f64 * KNOB_ROW_H;
    HEADER_H + ports + knobs + NODE_BODY_PAD * 2.0
}

/// Where a port's socket sits, relative to its node's top-left. Inputs
/// sit on the left edge, outputs on the right.
pub fn port_position(
    node: &GraphNode,
    def: &NodeDef,
    port_id: &str,
) -> Option<(f64, f64)> {
    let input_idx = def.inputs.iter().position(|p| p.id == port_id);
    let output_idx = def.outputs.iter().position(|p| p.id == port_id);
    let (row, on_left) = match (input_idx, output_idx) {
        (Some(i), _) => (i, true),
        (_, Some(i)) => (i, false),
        _ => return None,
    };
    let y = node.y + PORT_START + (row as f64) * PORT_ROW_H + PORT_ROW_H / 2.0;
    let x = if on_left {
        node.x
    } else {
        node.x + NODE_WIDTH
    };
    Some((x, y))
}

/// The endpoints a wire draws between, or `None` when either is missing.
///
/// A hand-edited or half-synced document can carry a wire whose node was
/// deleted. There is nothing to draw, and nothing to hit.
pub fn wire_endpoints(graph: &Graph, wire: &Wire) -> Option<((f64, f64), (f64, f64))> {
    let from_node = graph.node(wire.from_node)?;
    let from_def = node_def(&from_node.kind)?;
    let from = port_position(from_node, from_def, &wire.from_port)?;
    let to_node = graph.node(wire.to_node)?;
    let to_def = node_def(&to_node.kind)?;
    let to = port_position(to_node, to_def, &wire.to_port)?;
    Some((from, to))
}

/// The bezier a wire follows: start, two control points, end.
///
/// Shared by every surface so the Dioxus canvas's SVG `d` string, the Slint
/// canvas's sampled polyline and the hit-testing curve are the same curve.
/// The control points extend horizontally by half the horizontal gap (at
/// least 40px) so the wire reads as a cable rather than a hairpin.
///
/// They extend *toward the destination*, which matters as soon as a wire
/// runs right-to-left — an output on a node's left feeding a node drawn
/// further left, as the LoRA stack does into the checkpoint's adapter port.
/// Adding a fixed +bend to the start and -bend to the end there makes the
/// curve bulge backwards and cross itself.
pub fn wire_bezier(from: (f64, f64), to: (f64, f64)) -> ((f64, f64), (f64, f64), (f64, f64), (f64, f64)) {
    let dx = (to.0 - from.0).abs();
    let bend = (dx * 0.5).max(40.0);
    let direction = if to.0 >= from.0 { 1.0 } else { -1.0 };
    let c1 = (from.0 + bend * direction, from.1);
    let c2 = (to.0 - bend * direction, to.1);
    (from, c1, c2, to)
}

/// A point on a wire's curve at parameter `t` (0 = source socket).
///
/// A Slint canvas cannot build a `Path` from data, so it draws the wire as
/// a polyline sampled through here — which is also what hit-testing walks.
pub fn wire_bezier_at(from: (f64, f64), to: (f64, f64), t: f64) -> (f64, f64) {
    let (p0, c1, c2, p3) = wire_bezier(from, to);
    let u = 1.0 - t;
    (
        u * u * u * p0.0 + 3.0 * u * u * t * c1.0 + 3.0 * u * t * t * c2.0 + t * t * t * p3.0,
        u * u * u * p0.1 + 3.0 * u * u * t * c1.1 + 3.0 * u * t * t * c2.1 + t * t * t * p3.1,
    )
}

/// A cubic bezier through two socket points, in the flat `SVG` path syntax
/// Dioxus renders for wires.
pub fn wire_path(from: (f64, f64), to: (f64, f64)) -> String {
    let (p0, c1, c2, p3) = wire_bezier(from, to);
    format!(
        "M {:.1} {:.1} C {:.1} {:.1}, {:.1} {:.1}, {:.1} {:.1}",
        p0.0, p0.1, c1.0, c1.1, c2.0, c2.1, p3.0, p3.1
    )
}