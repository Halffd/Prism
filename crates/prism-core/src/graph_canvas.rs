//! Canvas interaction: the view transform, hit-testing and drag state, as
//! pure functions over the graph model.
//!
//! Every surface needs the same arithmetic — "which node did I click",
//! "which socket does this wire start from", "which wire did I click", how a
//! pan or a zoom transforms a point, and what a dropped drag means. Two
//! copies would disagree at some point, and the disagreement would show up
//! as a wire that lands beside a socket on one platform. So it lives here,
//! beside the model it walks, and `cargo test -p prism-core` covers it on
//! the host with no browser at all.
//!
//! Nothing in this module knows about a UI framework, and nothing in it
//! knows about Stable Diffusion: `new_node` takes its defaults from the
//! core's own constants rather than restating them.

use crate::graph::{Graph, GraphNode, NodeDef, NodeValues, Wire, HEADER_H, NODE_WIDTH};
use crate::graph_nodes::node_def;

/// How close (in canvas units) a click must land to grab a socket.
pub const PORT_HIT_SLACK: f64 = 8.0;
/// How close (in canvas units) a click must land to select a wire.
pub const WIRE_HIT_SLACK: f64 = 8.0;
/// How many segments sample a wire when hit-testing its curve.
const WIRE_SEGMENTS: usize = 24;

/// Where the viewport is looking: pan offset in screen pixels and a
/// zoom multiplier. Serialized inside the shared document's `view`, so a
/// canvas reopens where it was left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct View {
    pub pan_x: f64,
    pub pan_y: f64,
    pub zoom: f64,
}

impl Default for View {
    fn default() -> Self {
        View { pan_x: 0.0, pan_y: 0.0, zoom: 1.0 }
    }
}

impl View {
    pub fn new(pan_x: f64, pan_y: f64, zoom: f64) -> Self {
        View { pan_x, pan_y, zoom }
    }

    /// From the shared document's view, with the same field names.
    pub fn from_document(view: &crate::graph_store::GraphView) -> Self {
        View::new(view.pan_x, view.pan_y, view.zoom)
    }

    /// Screen pixel position to canvas coordinates.
    pub fn screen_to_canvas(&self, x: f64, y: f64) -> (f64, f64) {
        ((x - self.pan_x) / self.zoom, (y - self.pan_y) / self.zoom)
    }

    /// Canvas coordinates to screen pixel position.
    pub fn canvas_to_screen(&self, x: f64, y: f64) -> (f64, f64) {
        (self.pan_x + x * self.zoom, self.pan_y + y * self.zoom)
    }

    /// Zoom about a screen pivot, keeping the canvas point beneath it
    /// fixed. Without the pivot the canvas would slide away from the
    /// cursor, which is the difference between a usable zoom and an
    /// infuriating one.
    pub fn zoomed_about(&self, pivot: (f64, f64), factor: f64) -> View {
        let zoom = (self.zoom * factor).clamp(0.2, 3.0);
        let (canvas_x, canvas_y) = self.screen_to_canvas(pivot.0, pivot.1);
        View::new(
            pivot.0 - canvas_x * zoom,
            pivot.1 - canvas_y * zoom,
            zoom,
        )
    }
}

/// A node's box in canvas coordinates.
pub fn node_bounds(node: &crate::graph::GraphNode, def: &NodeDef) -> (f64, f64, f64, f64) {
    (node.x, node.y, node.x + NODE_WIDTH, node.y + crate::graph::node_height(def))
}

/// The topmost node under a canvas point, or `None` for empty canvas.
///
/// Reverse order matters: later nodes draw on top, so the topmost one
/// under the point is the one the user meant to grab.
pub fn hit_node(graph: &Graph, x: f64, y: f64) -> Option<u64> {
    graph.nodes.iter().rev().find_map(|node| {
        let def = node_def(&node.kind)?;
        let (left, top, right, bottom) = node_bounds(node, def);
        (x >= left && x <= right && y >= top && y <= bottom).then_some(node.id)
    })
}

/// Which socket a canvas point is over, if any. `output` distinguishes
/// the right edge (a wire's source) from the left edge (its sink).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortHit {
    pub node_id: u64,
    pub port_id: String,
    pub output: bool,
}

/// The socket under a canvas point, testing every node in reverse draw
/// order so the topmost wins.
pub fn hit_port(graph: &Graph, x: f64, y: f64) -> Option<PortHit> {
    let slack = PORT_HIT_SLACK;
    for node in graph.nodes.iter().rev() {
        let Some(def) = node_def(&node.kind) else {
            continue;
        };
        for port in def.inputs.iter().chain(def.outputs.iter()) {
            let Some((px, py)) = crate::graph::port_position(node, def, port.id) else {
                continue;
            };
            if (x - px).abs() <= slack && (y - py).abs() <= slack {
                return Some(PortHit {
                    node_id: node.id,
                    port_id: port.id.to_string(),
                    output: port.output,
                });
            }
        }
    }
    None
}

/// Distance from a canvas point to the wire's curve, approximated by
/// sampling the bezier. Good enough to tell a click on a wire from a
/// click near one, which is all a canvas needs.
fn wire_distance(from: (f64, f64), to: (f64, f64), at: (f64, f64)) -> f64 {
    let mut best = f64::INFINITY;
    let mut previous = from;
    for step in 1..=WIRE_SEGMENTS {
        let t = step as f64 / WIRE_SEGMENTS as f64;
        let current = crate::graph::wire_bezier_at(from, to, t);
        best = best.min(distance_to_segment(at, previous, current));
        previous = current;
    }
    best
}

/// Distance from a point to the line segment between two points.
fn distance_to_segment(point: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let length_sq = dx * dx + dy * dy;
    if length_sq <= f64::EPSILON {
        return ((point.0 - a.0).powi(2) + (point.1 - a.1).powi(2)).sqrt();
    }
    let t = (((point.0 - a.0) * dx + (point.1 - a.1) * dy) / length_sq).clamp(0.0, 1.0);
    let nearest = (a.0 + t * dx, a.1 + t * dy);
    ((point.0 - nearest.0).powi(2) + (point.1 - nearest.1).powi(2)).sqrt()
}

/// The wire under a canvas point, for click-to-delete. Reverse order so
/// the topmost crossing wins.
pub fn hit_wire(graph: &Graph, x: f64, y: f64) -> Option<usize> {
    for index in (0..graph.wires.len()).rev() {
        let Some((from, to)) = crate::graph::wire_endpoints(graph, &graph.wires[index]) else {
            continue;
        };
        if wire_distance(from, to, (x, y)) <= WIRE_HIT_SLACK {
            return Some(index);
        }
    }
    None
}

/// What the user is doing with the mouse right now. One drag at a time:
/// a canvas either pans, moves one node, or draws one wire.
#[derive(Debug, Clone, PartialEq)]
pub enum Drag {
    /// Empty-space drag: move the viewport.
    Pan { last: (f64, f64) },
    /// Node-header drag: move a node.
    Node { id: u64, last: (f64, f64) },
    /// Socket drag: draw a wire from a socket to wherever the cursor is.
    Wire {
        from_node: u64,
        from_port: String,
        /// The wire is dragged from a source socket, so it ends on an
        /// input; dragging from an input reverses the direction.
        from_output: bool,
        at: (f64, f64),
    },
}

impl Drag {
    /// The wire this drag would make if it dropped on `target`, or `None`
    /// when there is nothing sensible to connect. The direction depends
    /// on which socket the drag started on: an output feeds an input.
    ///
    /// The same three rules the model applies in `wire_is_valid` are
    /// applied here, so the gesture cancels on an impossible connection
    /// rather than offering one the model would silently refuse: the
    /// wrong node, the wrong direction, or a mismatched socket kind.
    pub fn pending_wire(&self, graph: &Graph, target: Option<&PortHit>) -> Option<Wire> {
        let Drag::Wire {
            from_node,
            from_port,
            from_output,
            ..
        } = self
        else {
            return None;
        };
        let target = target?;
        if target.node_id == *from_node {
            return None;
        }
        // Both sockets must exist and carry the same kind of thing.
        let (_, from_kind, _) = graph.port(*from_node, from_port)?;
        let (_, to_kind, _) = graph.port(target.node_id, &target.port_id)?;
        if from_kind != to_kind {
            return None;
        }
        if *from_output {
            (!target.output)
                .then(|| Wire::new(*from_node, from_port, target.node_id, &target.port_id))
        } else {
            target
                .output
                .then(|| Wire::new(target.node_id, &target.port_id, *from_node, from_port))
        }
    }
}

/// A free id not used by any node, so a new node never collides with a
/// pasted or synced one.
pub fn next_free_id(graph: &Graph) -> u64 {
    graph.nodes.iter().map(|n| n.id).max().unwrap_or(0) + 1
}

/// Apply a pan drag to a view, in screen pixels.
pub fn pan_view(view: View, drag: &Drag, at: (f64, f64)) -> View {
    match drag {
        Drag::Pan { last } => View::new(
            view.pan_x + (at.0 - last.0),
            view.pan_y + (at.1 - last.1),
            view.zoom,
        ),
        _ => view,
    }
}

/// Move a node by the pointer delta between two canvas points. Snapping
/// is deliberately absent: a build tool that fights you on placement is
/// worse than one that does not.
pub fn move_node(graph: &mut Graph, id: u64, from: (f64, f64), to: (f64, f64)) {
    let delta_x = to.0 - from.0;
    let delta_y = to.1 - from.1;
    if let Some(node) = graph.node_mut(id) {
        node.x += delta_x;
        node.y += delta_y;
    }
}
// ---------------------------------------------------------------------------
// Tests — run on the host, no browser involved
// ---------------------------------------------------------------------------

/// Fill a Latent node's width and height from the core's size table for a
/// chosen aspect preset.
///
/// Only a preset the core actually offers is applied. The core's size helper
/// falls back to square for anything it does not recognise, so passing an
/// unexpected label through would silently overwrite a size the user typed.
/// Returns whether the sizes changed, so the caller can say so.
pub fn apply_aspect(values: &mut NodeValues, chosen: &str) -> bool {
    if !crate::graph_factory::ASPECT_PRESETS.contains(&chosen) {
        return false;
    }
    let (width, height) = crate::media::a1111_size(Some(chosen));
    values.set_number("width", width as f64);
    values.set_number("height", height as f64);
    true
}

/// Create a node the palette can drop, seeded with the core's defaults.
///
/// The shape (which knobs exist, and a sane starting value for each) comes
/// from the core's factory. The *Stable Diffusion* defaults -- sampler,
/// scheduler, steps, CFG, the 1:1 size -- are the core's own constants, so a
/// node added here starts exactly like one the panel would make, and the
/// canvas never restates a default a second time.
pub fn new_node(id: u64, kind: &str, x: f64, y: f64) -> Option<GraphNode> {
    let mut node = crate::graph_factory::make_node(id, kind, x, y)?;
    match node.kind.as_str() {
        "sampler" => {
            node.values.set_enum("sampler", crate::media::DEFAULT_SAMPLER);
            node.values.set_enum("scheduler", crate::media::DEFAULT_SCHEDULER);
            node.values.set_number("steps", crate::media::LOCAL_SD_STEPS as f64);
            node.values.set_number("cfg", crate::media::LOCAL_SD_CFG);
        }
        "latent" => {
            let (width, height) = crate::media::a1111_size(Some("1:1"));
            node.values.set_number("width", width as f64);
            node.values.set_number("height", height as f64);
        }
        _ => {}
    }
    Some(node)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{node_height, wire_bezier_at, PORT_ROW_H, PORT_START};
    use crate::graph_factory::make_node;

    fn graph_with(parts: &[(u64, &str, f64, f64)]) -> Graph {
        let mut graph = Graph::default();
        for (id, kind, x, y) in parts {
            graph.nodes.push(make_node(*id, kind, *x, *y).expect("known kind"));
        }
        graph
    }

    /// Checkpoint -> Sampler, the model half of a pipeline.
    fn wired_graph() -> Graph {
        let mut graph = graph_with(&[(1, "checkpoint", 0.0, 0.0), (2, "sampler", 400.0, 0.0)]);
        assert!(graph.connect(Wire::new(1, "model", 2, "model")));
        graph
    }

    #[test]
    fn the_transform_round_trips_a_point() {
        let view = View::new(120.0, -60.0, 1.5);
        for point in [(0.0, 0.0), (10.0, 20.0), (-300.0, 512.0)] {
            let canvas = view.screen_to_canvas(point.0, point.1);
            let back = view.canvas_to_screen(canvas.0, canvas.1);
            assert!(
                (back.0 - point.0).abs() < 1e-9 && (back.1 - point.1).abs() < 1e-9,
                "{point:?} did not survive the round trip"
            );
        }
    }

    #[test]
    fn zooming_keeps_the_point_under_the_cursor() {
        let view = View::new(70.0, 40.0, 1.0);
        let pivot = (320.0, 180.0);
        let before = view.screen_to_canvas(pivot.0, pivot.1);

        let zoomed = view.zoomed_about(pivot, 1.25);
        let after = zoomed.screen_to_canvas(pivot.0, pivot.1);

        assert!((before.0 - after.0).abs() < 1e-9, "the cursor slid off its node");
        assert!((before.1 - after.1).abs() < 1e-9, "the cursor slid off its node");
        assert_eq!(zoomed.zoom, 1.25);
    }

    #[test]
    fn zoom_is_clamped_so_the_canvas_stays_usable() {
        let view = View::default();
        assert_eq!(view.zoomed_about((0.0, 0.0), 0.01).zoom, 0.2);
        assert_eq!(view.zoomed_about((0.0, 0.0), 100.0).zoom, 3.0);
    }

    #[test]
    fn node_height_grows_with_ports_and_knobs() {
        let sampler = node_def("sampler").expect("sampler");
        let checkpoint = node_def("checkpoint").expect("checkpoint");
        let prompt = node_def("prompt").expect("prompt");

        // The sampler has four inputs and five knobs; the prompt has one
        // output and two knobs. A wrong height would mis-place every
        // hit-test on a node's lower edge.
        assert!(node_height(sampler) > node_height(checkpoint));
        assert!(node_height(checkpoint) > node_height(prompt));
        assert!(node_height(prompt) > HEADER_H);
    }

    #[test]
    fn a_click_finds_the_topmost_node_and_misses_empty_canvas() {
        let graph = graph_with(&[(1, "prompt", 0.0, 0.0), (2, "prompt", 40.0, 40.0)]);
        // The second prompt draws over the first, so it wins the overlap.
        assert_eq!(hit_node(&graph, 50.0, 50.0), Some(2));
        // Inside the first prompt's box but away from the overlap.
        assert_eq!(hit_node(&graph, 5.0, 5.0), Some(1));
        // Empty canvas below both.
        assert_eq!(hit_node(&graph, 50.0, 900.0), None);

        let empty = Graph::default();
        assert_eq!(hit_node(&empty, 0.0, 0.0), None);
    }

    #[test]
    fn a_socket_is_found_only_near_its_own_edge() {
        let graph = wired_graph();
        // The sampler's first input ("model") sits on its left edge.
        let socket = hit_port(&graph, 400.0, PORT_START + PORT_ROW_H / 2.0);
        assert_eq!(
            socket,
            Some(PortHit {
                node_id: 2,
                port_id: "model".into(),
                output: false
            })
        );

        // The checkpoint's "model" output sits on its right edge.
        let out = hit_port(&graph, NODE_WIDTH, PORT_START + PORT_ROW_H / 2.0);
        assert_eq!(
            out,
            Some(PortHit {
                node_id: 1,
                port_id: "model".into(),
                output: true
            })
        );

        // Just past the slack, nothing is grabbed.
        assert_eq!(
            hit_port(&graph, 400.0 + PORT_HIT_SLACK + 2.0, PORT_START + PORT_ROW_H / 2.0),
            None
        );
    }

    #[test]
    fn a_wire_is_hit_along_its_curve_and_not_off_it() {
        let graph = wired_graph();
        let (from, to) = crate::graph::wire_endpoints(&graph, &graph.wires[0]).expect("wired");
        let mid = wire_bezier_at(from, to, 0.5);

        assert_eq!(hit_wire(&graph, mid.0, mid.1), Some(0));

        // Well off the curve, nothing is selected.
        assert_eq!(hit_wire(&graph, mid.0, mid.1 + 200.0), None);

        // A point just past the slack. The curve runs horizontally
        // through this midpoint, so the miss has to be measured
        // perpendicular to it — moving *along* the curve would still
        // land on the wire, which is exactly what should happen.
        let near = (mid.0, mid.1 + WIRE_HIT_SLACK + 2.0);
        assert_eq!(hit_wire(&graph, near.0, near.1), None);
    }

    #[test]
    fn a_wire_to_a_deleted_node_has_no_endpoints_to_draw() {
        let mut graph = wired_graph();

        // A wire whose target node nothing provides: a hand-edited or
        // half-synced document. There is nothing to draw, so it cannot
        // be hit either.
        graph.wires.push(Wire::new(1, "model", 99, "model"));
        let dangling = graph.wires.len() - 1;
        assert!(crate::graph::wire_endpoints(&graph, &graph.wires[dangling]).is_none());
        assert_eq!(hit_wire(&graph, 300.0, 50.0), Some(0), "the live wire still hits");

        // Deleting a node takes its wires with it, so the normal path
        // never leaves a dangling cable to hit in the first place.
        graph.remove_node(1);
        assert!(graph.wires.is_empty());
        assert_eq!(hit_wire(&graph, 300.0, 50.0), None);
    }

    #[test]
    fn a_wire_drag_offers_only_the_connections_the_model_allows() {
        // The sampler's model input is deliberately left free, so the drag
        // below has somewhere legal to land.
        let mut graph = graph_with(&[(1, "checkpoint", 0.0, 0.0), (2, "sampler", 400.0, 0.0)]);
        let drag = Drag::Wire {
            from_node: 1,
            from_port: "model".into(),
            from_output: true,
            at: (0.0, 0.0),
        };

        // A matching kind on a different node: offered, and the model
        // agrees when the app hands it over.
        let matching = PortHit {
            node_id: 2,
            port_id: "model".into(),
            output: false,
        };
        let wire = drag.pending_wire(&graph, Some(&matching)).expect("a legal wire");
        assert_eq!(wire.from_node, 1);
        assert_eq!(wire.to_node, 2);
        assert_eq!(wire.to_port, "model");
        assert!(graph.connect(wire), "the gesture proposed an illegal wire");

        // A wrong kind is refused by the gesture itself. The model would
        // also refuse it, but a drag that offers a connection the model
        // silently drops reads as a broken canvas rather than a "no".
        let wrong_kind = PortHit {
            node_id: 2,
            port_id: "latent".into(),
            output: false,
        };
        assert!(drag.pending_wire(&graph, Some(&wrong_kind)).is_none());

        // Dropping on the node it started from is refused.
        let self_target = PortHit {
            node_id: 1,
            port_id: "loras".into(),
            output: false,
        };
        assert!(drag.pending_wire(&graph, Some(&self_target)).is_none());

        // Dropping on empty canvas simply cancels.
        assert!(drag.pending_wire(&graph, None).is_none());

        // An output dropped on an output is refused: two sources have
        // nothing to push into each other.
        let out_target = PortHit {
            node_id: 2,
            port_id: "samples".into(),
            output: true,
        };
        assert!(drag.pending_wire(&graph, Some(&out_target)).is_none());
    }

    #[test]
    fn a_wire_drag_from_an_input_runs_the_other_way() {
        // Dragging *out of* an input socket reverses the direction, the
        // way every node editor behaves when you grab the wrong end.
        let mut graph = graph_with(&[(1, "checkpoint", 0.0, 0.0), (2, "sampler", 400.0, 0.0)]);
        let drag = Drag::Wire {
            from_node: 2,
            from_port: "model".into(),
            from_output: false,
            at: (0.0, 0.0),
        };
        let source = PortHit {
            node_id: 1,
            port_id: "model".into(),
            output: true,
        };
        let wire = drag.pending_wire(&graph, Some(&source)).expect("a legal wire");
        assert_eq!(wire.from_node, 1);
        assert_eq!(wire.to_node, 2);
        assert_eq!(wire.to_port, "model");
        assert!(graph.connect(wire), "the reverse drag proposed an illegal wire");
    }

    #[test]
    fn only_a_pan_drag_pans_the_view() {
        let view = View::new(10.0, 20.0, 2.0);
        let panned = pan_view(view, &Drag::Pan { last: (100.0, 50.0) }, (140.0, 30.0));
        assert_eq!(panned, View::new(50.0, 0.0, 2.0));

        // A node drag leaves the viewport alone.
        let node_drag = Drag::Node { id: 1, last: (0.0, 0.0) };
        assert_eq!(pan_view(view, &node_drag, (40.0, 40.0)), view);
    }

    #[test]
    fn moving_a_node_moves_only_that_node() {
        let mut graph = graph_with(&[(1, "prompt", 10.0, 10.0), (2, "prompt", 300.0, 300.0)]);
        move_node(&mut graph, 1, (0.0, 0.0), (25.0, -15.0));

        assert_eq!(graph.node(1).unwrap().x, 35.0);
        assert_eq!(graph.node(1).unwrap().y, -5.0);
        assert_eq!(graph.node(2).unwrap().x, 300.0, "a neighbour moved too");

        // A node that is not there is a no-op rather than a panic.
        move_node(&mut graph, 99, (0.0, 0.0), (10.0, 10.0));
        assert_eq!(graph.nodes.len(), 2);
    }

    #[test]
    fn a_new_id_never_collides_with_an_existing_one() {
        let graph = wired_graph();
        assert_eq!(next_free_id(&graph), 3);
        let empty = Graph::default();
        assert_eq!(next_free_id(&empty), 1);
    }

    #[test]
    fn a_known_aspect_preset_sets_the_size_and_an_unknown_one_does_not() {
        use crate::graph::NodeValues;

        let mut values = NodeValues::default();
        values.set_number("width", 896.0);
        values.set_number("height", 512.0);

        // Landscape: the core's own table decides the pixels.
        assert!(apply_aspect(&mut values, "16:9"));
        let (expected_w, expected_h) = crate::media::a1111_size(Some("16:9"));
        assert_eq!(values.number("width"), Some(expected_w as f64));
        assert_eq!(values.number("height"), Some(expected_h as f64));
        assert!(expected_w > expected_h, "16:9 is landscape");

        // Portrait flips it.
        assert!(apply_aspect(&mut values, "9:16"));
        assert!(
            values.number("height").unwrap() > values.number("width").unwrap(),
            "9:16 is portrait"
        );

        // An unrecognised label changes nothing. The core would fall back to
        // square and quietly overwrite a size the user chose, so the guard
        // matters even though the picker only offers real presets.
        let before = values.clone();
        assert!(!apply_aspect(&mut values, "21:10"));
        assert_eq!(values, before);
        assert!(!apply_aspect(&mut values, ""));
    }

    #[test]
    fn a_new_node_carries_the_core_defaults_not_the_hosts_own() {
        // The sampler defaults come from the core's own constants, so the
        // canvas cannot drift from the panel by restating them.
        let sampler = new_node(1, "sampler", 0.0, 0.0).expect("known kind");
        assert_eq!(sampler.values.enumeration("sampler").unwrap(), crate::media::DEFAULT_SAMPLER);
        assert_eq!(sampler.values.enumeration("scheduler").unwrap(), crate::media::DEFAULT_SCHEDULER);
        assert_eq!(sampler.values.number("steps").unwrap(), crate::media::LOCAL_SD_STEPS as f64);

        // The latent defaults come from the core's size table.
        let (width, height) = crate::media::a1111_size(Some("1:1"));
        let latent = new_node(2, "latent", 0.0, 0.0).expect("known kind");
        assert_eq!(latent.values.number("width").unwrap(), width as f64);
        assert_eq!(latent.values.number("height").unwrap(), height as f64);

        // An unknown kind yields nothing rather than a broken node.
        assert!(new_node(3, "nonsense", 0.0, 0.0).is_none());
    }

    #[test]
    fn a_node_is_dragged_only_from_its_header() {
        let graph = graph_with(&[(1, "prompt", 0.0, 0.0)]);
        // The header band starts a drag.
        assert_eq!(hit_node_header(&graph, 100.0, 5.0), Some(1));
        assert_eq!(hit_node_header(&graph, 100.0, HEADER_H - 1.0), Some(1));
        // Below the header is the body: a knob row, not a drag handle.
        assert_eq!(hit_node_header(&graph, 100.0, HEADER_H + 4.0), None);
        // Outside the node entirely.
        assert_eq!(hit_node_header(&graph, 900.0, 5.0), None);
    }

    #[test]
    fn re_plugging_an_input_replaces_the_wire_already_there() {
        let mut graph = graph_with(&[
            (1, "lora", 0.0, 0.0),
            (2, "checkpoint", 300.0, 0.0),
            (3, "lora", 0.0, 300.0),
        ]);
        // The checkpoint takes its LoRA stack from node 1.
        assert!(plug(&mut graph, Wire::new(1, "loras", 2, "loras")));
        assert_eq!(graph.wires.len(), 1);

        // Moving it to node 3 replaces the wire rather than refusing.
        assert!(plug(&mut graph, Wire::new(3, "loras", 2, "loras")));
        assert_eq!(graph.wires.len(), 1);
        assert_eq!(graph.wires[0].from_node, 3);
    }

    #[test]
    fn a_rejected_plug_leaves_the_existing_wire_alone() {
        let mut graph = graph_with(&[
            (1, "lora", 0.0, 0.0),
            (2, "checkpoint", 300.0, 0.0),
            (3, "latent", 0.0, 300.0),
        ]);
        assert!(plug(&mut graph, Wire::new(1, "loras", 2, "loras")));

        // A wrong-kind wire aimed at the same input is refused, and the
        // incumbent must survive it — a rejected drop is not allowed to
        // cost the user a connection they already had.
        assert!(!plug(&mut graph, Wire::new(3, "latent", 2, "loras")));
        assert_eq!(graph.wires.len(), 1);
        assert_eq!(graph.wires[0].from_node, 1);
    }

    #[test]
    fn the_view_survives_a_trip_through_the_shared_document() {
        let view = View::new(-240.0, 88.0, 1.75);
        let restored = View::from_document(&view.to_document());
        assert_eq!(restored, view);
    }
}

/// The node whose *header band* a point is over — the only part a node can
/// be dragged from. Without it, grabbing a knob would drag the whole node
/// instead of focusing the control the user actually clicked.
pub fn hit_node_header(graph: &Graph, x: f64, y: f64) -> Option<u64> {
    graph.nodes.iter().rev().find_map(|node| {
        node_def(&node.kind)?;
        let within = x >= node.x
            && x <= node.x + NODE_WIDTH
            && y >= node.y
            && y <= node.y + HEADER_H;
        within.then_some(node.id)
    })
}

/// Connect a wire, replacing any wire already feeding that input.
///
/// A node editor re-plugs a socket rather than refusing the second wire:
/// dragging a fresh connection onto an occupied input should *move* the
/// input, not silently do nothing. The model's own `connect` refuses a
/// second wire to the same input, so this drops the incumbent first — and
/// puts it back if the replacement turns out to be illegal, so a rejected
/// drop can never cost the user an existing connection.
pub fn plug(graph: &mut Graph, wire: Wire) -> bool {
    if wire.from_node == wire.to_node {
        return false;
    }
    let occupied = graph
        .wires
        .iter()
        .position(|w| w.to_node == wire.to_node && w.to_port == wire.to_port);
    match occupied {
        // The input is free: the model decides on its own.
        None => graph.connect(wire),
        Some(index) => {
            let incumbent = graph.wires.remove(index);
            if graph.connect(wire) {
                true
            } else {
                graph.wires.insert(index, incumbent);
                false
            }
        }
    }
}

impl View {
    /// Back to the shared document's view, with the same field names.
    pub fn to_document(&self) -> crate::graph_store::GraphView {
        crate::graph_store::GraphView {
            pan_x: self.pan_x,
            pan_y: self.pan_y,
            zoom: self.zoom,
        }
    }
}
