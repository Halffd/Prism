//! The graph store: where a canvas document lives between apps.
//!
//! Every surface (Slint, Dioxus/web, CLI, TUI, the browser extension)
//! edits the *same* graph. This module is the boundary that makes that
//! true: it owns the on-disk document, the sync version, the merge that
//! happens when two apps touched the same canvas, and the validation
//! that rejects a document a host would render broken.
//!
//! Storage follows the same rule as `conversations` and `settings`: the
//! core writes through the injected `Storage` trait, atomically, and a
//! corrupt file falls back to defaults rather than a panic. A host never
//! hand-builds the JSON, and a browser never keeps a private copy.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::graph::Graph;
use super::storage::Storage;

/// Document format version. Bumped when a release changes the shape, so a
/// reader can migrate instead of guessing at a stale file.
pub const GRAPH_FORMAT_VERSION: u32 = 1;

/// The file name inside Prism's storage root.
pub const GRAPH_FILE_NAME: &str = "graph.json";

/// A saved canvas: the drawing plus what the pane was showing when it
/// was last left, so reopening an app restores the same view instead of
/// a different zoom on the same graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphDocument {
    #[serde(default = "default_app")]
    pub app: String,
    #[serde(default = "default_version")]
    pub version: u32,
    /// When this document was last written, epoch ms.
    #[serde(default)]
    pub updated_at: u64,
    pub graph: Graph,
    /// Pan offset and zoom, so a reopen lands where the user left off.
    #[serde(default)]
    pub view: GraphView,
}

/// Canvas view transform. Purely presentation state, but persisted with
/// the document so a shared session looks the same on every screen.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GraphView {
    #[serde(default)]
    pub pan_x: f64,
    #[serde(default)]
    pub pan_y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

impl Default for GraphView {
    fn default() -> Self {
        GraphView { pan_x: 0.0, pan_y: 0.0, zoom: default_zoom() }
    }
}

fn default_app() -> String {
    "prism".into()
}

fn default_version() -> u32 {
    GRAPH_FORMAT_VERSION
}

fn default_zoom() -> f64 {
    1.0
}

impl GraphDocument {
    /// A fresh document around a graph, stamped now.
    pub fn new(graph: Graph, now_ms: u64) -> Self {
        GraphDocument {
            app: default_app(),
            version: GRAPH_FORMAT_VERSION,
            updated_at: now_ms,
            graph,
            view: GraphView::default(),
        }
    }

    /// Is this a Prism graph document at all?
    pub fn is_prism_document(raw: &serde_json::Value) -> bool {
        raw.get("app").and_then(|v| v.as_str()) == Some("prism")
    }

    /// Parse a document JSON. Missing fields take defaults (the shape
    /// grew), `None` only when the JSON is not a graph document or the
    /// drawing itself is malformed.
    pub fn from_json(text: &str) -> Option<GraphDocument> {
        let raw: serde_json::Value = serde_json::from_str(text).ok()?;
        if !GraphDocument::is_prism_document(&raw) {
            return None;
        }
        Some(GraphDocument {
            app: "prism".into(),
            version: raw.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
            updated_at: raw.get("updated_at").and_then(|v| v.as_u64()).unwrap_or(0),
            graph: serde_json::from_value(raw.get("graph")?.clone()).ok()?,
            view: raw
                .get("view")
                .and_then(|v| serde_json::from_value::<GraphView>(v.clone()).ok())
                .unwrap_or_default(),
        })
    }

    /// Serialize to the wire/file form.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

/// What a document must satisfy to be renderable. A store refuses a
/// document that would draw a broken canvas, so a bad write cannot
/// poison every other app's view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphProblem {
    /// No node on the canvas.
    Empty,
    /// A node id appears twice.
    DuplicateNode(u64),
    /// A wire refers to a node that is not in the document.
    WireToMissingNode(u64),
    /// A wire refers to a port its node does not have.
    WireToMissingPort(u64, String),
}

impl std::fmt::Display for GraphProblem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GraphProblem::Empty => write!(f, "graph has no nodes"),
            GraphProblem::DuplicateNode(id) => write!(f, "node {id} appears twice"),
            GraphProblem::WireToMissingNode(id) => {
                write!(f, "wire refers to missing node {id}")
            }
            GraphProblem::WireToMissingPort(id, port) => {
                write!(f, "node {id} has no port {port}")
            }
        }
    }
}

impl std::error::Error for GraphProblem {}

/// Every reason a document cannot be shown. An empty list means valid.
pub fn problems(doc: &GraphDocument) -> Vec<GraphProblem> {
    let mut found = Vec::new();
    if doc.graph.nodes.is_empty() {
        found.push(GraphProblem::Empty);
    }
    let mut seen: Vec<u64> = Vec::new();
    for node in &doc.graph.nodes {
        if !seen.contains(&node.id) {
            seen.push(node.id);
        } else {
            found.push(GraphProblem::DuplicateNode(node.id));
        }
    }
    for wire in &doc.graph.wires {
        for endpoint in [wire.from_node, wire.to_node] {
            if doc.graph.node(endpoint).is_none() {
                found.push(GraphProblem::WireToMissingNode(endpoint));
            }
        }
        if doc.graph.port(wire.from_node, &wire.from_port).is_none() {
            found.push(GraphProblem::WireToMissingPort(wire.from_node, wire.from_port.clone()));
        }
        if doc.graph.port(wire.to_node, &wire.to_port).is_none() {
            found.push(GraphProblem::WireToMissingPort(wire.to_node, wire.to_port.clone()));
        }
    }
    found
}

/// Is this document renderable?
pub fn is_valid(doc: &GraphDocument) -> bool {
    problems(doc).is_empty()
}

/// Merge a document that arrived over the API with the local one.
///
/// The rule is last-writer-wins on the whole document, which is the only
/// rule that lets a *deletion* travel. A three-way union of nodes cannot
/// tell "this peer has not seen the node" from "this peer deleted it",
/// so a union silently resurrects everything. Instead: the document
/// with the newer `updated_at` is authoritative for its nodes and wires,
/// and every wire it carries is re-validated before the result is kept.
/// A stale document therefore adds nothing, and a fresh one deletes.
///
/// On an exact tie the two documents are combined, so two apps writing
/// within the same millisecond do not silently drop each other's work:
/// nodes union (newer values win on a collision) and wires union with
/// duplicate collapse.
pub fn merge(base: &GraphDocument, incoming: &GraphDocument) -> GraphDocument {
    if incoming.updated_at < base.updated_at {
        // The peer is stale: the local document wins, but a wire the peer
        // still has is not a reason to keep one we dropped.
        return base.clone();
    }
    if incoming.updated_at > base.updated_at {
        // The peer is fresh: it is authoritative, including deletions.
        let mut merged = incoming.clone();
        drop_dead_wires(&mut merged.graph);
        return merged;
    }

    // A tie: union both sides rather than picking a loser.
    let mut merged = incoming.clone();
    let mut nodes = base.graph.nodes.clone();
    for node in &incoming.graph.nodes {
        match nodes.iter_mut().find(|n| n.id == node.id) {
            Some(slot) => *slot = node.clone(),
            None => nodes.push(node.clone()),
        }
    }
    merged.graph.nodes = nodes;
    for wire in &base.graph.wires {
        if !merged.graph.wires.iter().any(|w| w == wire) {
            merged.graph.wires.push(wire.clone());
        }
    }
    drop_dead_wires(&mut merged.graph);
    merged
}

/// Remove wires whose endpoint vanished or whose port no longer exists,
/// so a merged document can never render a dangling cable.
fn drop_dead_wires(graph: &mut crate::graph::Graph) {
    let mut index = 0;
    while index < graph.wires.len() {
        let wire = graph.wires[index].clone();
        let alive = graph.port(wire.from_node, &wire.from_port).is_some()
            && graph.port(wire.to_node, &wire.to_port).is_some();
        if alive {
            index += 1;
        } else {
            graph.wires.remove(index);
        }
    }
}
// ---------------------------------------------------------------------------
// Persistence — atomic, default-on-corrupt, exactly like `conversations`
// ---------------------------------------------------------------------------

/// Where the graph document lives inside Prism's storage root.
pub fn graph_path(root: &Path) -> PathBuf {
    root.join(GRAPH_FILE_NAME)
}

/// Where the shared graph document is stored.
///
/// `PRISM_GRAPH_ROOT` wins when it is set; otherwise a `prism-data` dir
/// beside the working directory, which keeps a checkout usable with no
/// configuration at all. Explicitly a fallback, not the recommended setup.
///
/// One definition, so the native server that serves the document and the
/// native surfaces that read it cannot disagree about where it lives.
pub fn default_graph_root() -> PathBuf {
    if let Ok(root) = std::env::var("PRISM_GRAPH_ROOT") {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("prism-data")
        .join("graph")
}

/// Load the shared graph. A missing file, or one that no longer parses,
/// yields the starter drawing rather than a panic: a fresh install and a
/// corrupted one both deserve a usable canvas.
///
/// A fallback document carries `updated_at: 0` because it was never
/// written. Stamping it with "now" would make the drawing a client was
/// handed look stale the moment a second read happened, silently
/// discarding that client's first edit.
pub fn load<S: Storage>(storage: &S, root: &Path, _now_ms: u64) -> GraphDocument {
    let path = graph_path(root);
    let parsed = storage
        .read_to_string(&path)
        .ok()
        .and_then(|text| GraphDocument::from_json(&text))
        .filter(|doc| is_valid(doc));
    match parsed {
        Some(doc) => doc,
        None => GraphDocument {
            updated_at: 0,
            ..GraphDocument::new(super::graph_factory::starter_graph(), 0)
        },
    }
}

/// Save the shared graph, stamping it with `now_ms` so a peer can tell
/// which of two writes is newer. An unwritable save is reported, never
/// silently swallowed: a host should tell the user their canvas is not
/// being synced.
pub fn save<S: Storage>(
    storage: &S,
    root: &Path,
    doc: &GraphDocument,
    now_ms: u64,
) -> std::io::Result<GraphDocument> {
    let mut next = doc.clone();
    next.app = default_app();
    next.version = GRAPH_FORMAT_VERSION;
    next.updated_at = now_ms;
    let path = graph_path(root);
    storage.write_atomic(&path, &next.to_json())?;
    Ok(next)
}

/// Apply a document that arrived over the API and persist the result, so
/// the next open app sees the merged drawing rather than the one this app
/// happened to have in memory.
pub fn apply_and_save<S: Storage>(
    storage: &S,
    root: &Path,
    local: &GraphDocument,
    incoming: &GraphDocument,
    now_ms: u64,
) -> std::io::Result<GraphDocument> {
    let merged = if is_valid(incoming) {
        merge(local, incoming)
    } else {
        local.clone()
    };
    save(storage, root, &merged, now_ms)
}
