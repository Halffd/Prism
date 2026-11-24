//! Canvas node-graph surface: the same drawing the Dioxus studio edits,
//! over the core.
//!
//! State lives here; `ui/app.slint` is presentation only. Everything that
//! can be reasoned about without a window is already in the core — the view
//! transform, hit-testing, drag state and the flatten step
//! (`prism_core::graph_canvas`, `graph_request`) — and is tested there on
//! the host. What is left is the part that genuinely needs a surface:
//! turning state into Slint models, and driving generation.
//!
//! Two choices keep the markup thin:
//!
//! - The models arrive in **screen pixels**. Pan and zoom are applied when
//!   the rows are built, so the `.slint` never needs a `transform` — which
//!   in Slint cannot compose a scale and a translate onto one element and
//!   would fight the text sizes besides.
//! - A wire is drawn as a polyline sampled from the core's bezier, because
//!   Slint's `Path` cannot be built from data: its `commands` are
//!   compile-time. The curve itself is the core's, so this surface and the
//!   Dioxus one draw the same cable.

use crate::shared::image::{render_native, tile_for_canvas, ImageEvent, ImageTile};
use crate::shared::{
    AppWindow, CanvasAspectUi, CanvasComboUi, CanvasInkUi, CanvasKnobUi, CanvasLoraUi,
    CanvasNodeUi, CanvasPaletteUi, State,
};
use prism_core::graph::{node_height, wire_bezier_at, wire_endpoints, HEADER_H, NODE_WIDTH};
use prism_core::graph_canvas::{
    apply_aspect, hit_node_header, hit_port, hit_wire, move_node, new_node, next_free_id,
    pan_view, plug, Drag, View,
};
use prism_core::graph_factory::drop_spot;
use prism_core::graph_nodes::node_def;
use prism_core::graph_request::{knob_rows, to_form, to_media_request};
use prism_core::graph_store::{default_graph_root, load, save as save_document, GraphView};
use prism_core::media::{MediaOutcome, A1111_ID, NATIVE_ID};
use prism_core::storage::FsStorage;
use slint::{ModelRc, VecModel};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::mpsc::{self, Receiver, TryRecvError};

/// Header accents, matching the Image Studio panel and the Dioxus canvas.
fn node_color(kind: &str) -> slint::Color {
    let rgb = |hex: u32| {
        slint::Color::from_rgb_u8(
            ((hex >> 16) & 0xff) as u8,
            ((hex >> 8) & 0xff) as u8,
            (hex & 0xff) as u8,
        )
    };
    match kind {
        "checkpoint" => rgb(0xb026ff),
        "lora" => rgb(0x22c55e),
        "prompt" => rgb(0x38bdf8),
        "sampler" => rgb(0xf59e0b),
        "latent" => rgb(0x06b6d4),
        "seed" => rgb(0xf43f5e),
        _ => rgb(0x94a3b8),
    }
}

/// Straight runs a wire is drawn as. More is smoother; this is past the
/// point where a bezier is distinguishable from its polyline at any zoom a
/// canvas is useful at.
const WIRE_SEGMENTS: usize = 16;

/// Pointer gestures the `.slint` reports, as one integer.
const POINTER_DOWN: i32 = 1;
const POINTER_MOVE: i32 = 2;
const POINTER_UP: i32 = 3;

/// The canvas surface's state.
pub struct CanvasState {
    /// The shared drawing.
    pub graph: prism_core::graph::Graph,
    /// Where the canvas is looking. Shared-document type, on purpose.
    pub view: GraphView,
    pub selected: Option<u64>,
    /// The gesture in flight.
    pub gesture: Option<Drag>,
    /// True once the pointer has moved: a gesture that never moved is a
    /// click, and a click cuts a wire rather than panning.
    pub moved: bool,
    pub status: String,
    /// Backend index into `BACKENDS`.
    pub provider: usize,
    /// In-process render results, drained by the timer pump.
    pub rx_native: Option<Receiver<ImageEvent>>,
    /// Remote provider outcomes (`host::spawn_media`).
    pub rx_remote: Option<Receiver<MediaOutcome>>,
    pub busy: bool,
    /// Finished images, newest last.
    pub tiles: Vec<ImageTile>,
    /// Where the shared document lives on this host.
    pub graph_root: std::path::PathBuf,
}

/// The local backends the canvas offers: the in-process renderer needs
/// nothing installed, Automatic1111 points at a local install. Same ids as
/// the core, so a request built here is byte-identical.
pub const BACKENDS: &[(&str, &str)] = &[
    (NATIVE_ID, "Native (built-in)"),
    (A1111_ID, "Automatic1111"),
];

impl Default for CanvasState {
    fn default() -> Self {
        let root = default_graph_root();
        let loaded = load(&FsStorage, &root, 0);
        CanvasState {
            graph: loaded.graph,
            view: loaded.view,
            selected: None,
            gesture: None,
            moved: false,
            status: "Loaded the shared canvas.".to_string(),
            provider: 0,
            rx_native: None,
            rx_remote: None,
            busy: false,
            tiles: Vec::new(),
            graph_root: root,
        }
    }
}
impl CanvasState {
    /// The provider id the canvas generates with.
    fn provider_id(&self) -> String {
        BACKENDS
            .get(self.provider)
            .map(|(id, _)| *id)
            .unwrap_or(NATIVE_ID)
            .to_string()
    }

    /// Is the selected node's seed locked? Reads the node rather than a
    /// parallel boolean, so a lock cannot disagree with the drawing.
    fn seed_locked(&self) -> bool {
        self.selected
            .and_then(|id| self.graph.node(id))
            .and_then(|node| node.values.text("seed_locked"))
            .map(|v| v == "locked")
            .unwrap_or(false)
    }
}

/// Canvas pixels to screen pixels.
fn to_screen(pan_x: f64, pan_y: f64, zoom: f64, at: (f64, f64)) -> (f32, f32) {
    (
        (pan_x + at.0 * zoom) as f32,
        (pan_y + at.1 * zoom) as f32,
    )
}

/// A 3px dot, so a join between runs reads as continuous.
fn dot_at(point: (f32, f32)) -> CanvasInkUi {
    CanvasInkUi {
        x: point.0 - 1.5,
        y: point.1 - 1.5,
        w: 3.0,
        h: 3.0,
    }
}

/// The ink for one run of a polyline, ending in a dot at its destination.
fn ink_between(a: (f32, f32), b: (f32, f32)) -> Vec<CanvasInkUi> {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let mut ink = Vec::new();
    if dx.abs() >= dy.abs() {
        // A horizontal run: a bar at this row, spanning the change in x.
        ink.push(CanvasInkUi {
            x: a.0.min(b.0),
            y: a.1 - 1.0,
            w: dx.abs(),
            h: 2.0,
        });
    } else {
        // A vertical run: a bar at this column, spanning the change in y.
        ink.push(CanvasInkUi {
            x: a.0 - 1.0,
            y: a.1.min(b.1),
            w: 2.0,
            h: dy.abs(),
        });
    }
    ink.push(dot_at(b));
    ink
}

/// Rebuild every canvas row from the current state.
pub fn refresh(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let st = state.borrow();
    let canvas = &st.canvas;
    let zoom = canvas.view.zoom;
    let (pan_x, pan_y) = (canvas.view.pan_x, canvas.view.pan_y);

    // Nodes, in screen pixels.
    let nodes: Vec<CanvasNodeUi> = canvas
        .graph
        .nodes
        .iter()
        .filter_map(|node| {
            let def = node_def(&node.kind)?;
            Some(CanvasNodeUi {
                id: node.id as i32,
                title: def.title.into(),
                color: node_color(&node.kind),
                x: to_screen(pan_x, pan_y, zoom, (node.x, node.y)).0,
                y: to_screen(pan_x, pan_y, zoom, (node.x, node.y)).1,
                width: (NODE_WIDTH * zoom) as f32,
                height: (node_height(def) * zoom) as f32,
                header_h: (HEADER_H * zoom) as f32,
            })
        })
        .collect();
    ui.set_canvas_nodes(ModelRc::from(Rc::new(VecModel::from(nodes))));

    // Wires: each one sampled into the ink of a polyline.
    let mut ink = Vec::new();
    for wire in &canvas.graph.wires {
        let Some((from, to)) = wire_endpoints(&canvas.graph, wire) else {
            continue;
        };
        let start = to_screen(pan_x, pan_y, zoom, from);
        ink.push(dot_at(start));
        let mut previous = start;
        for step in 1..=WIRE_SEGMENTS {
            let t = step as f64 / WIRE_SEGMENTS as f64;
            let point = wire_bezier_at(from, to, t);
            let next = to_screen(pan_x, pan_y, zoom, (point.0, point.1));
            ink.extend(ink_between(previous, next));
            previous = next;
        }
    }
    ui.set_canvas_ink(ModelRc::from(Rc::new(VecModel::from(ink))));

    // The selected node's knobs, straight from the core's table.
    let knobs: Vec<CanvasKnobUi> = canvas
        .selected
        .and_then(|id| canvas.graph.node(id))
        .map(|node| {
            knob_rows(node)
                .into_iter()
                .map(|row| CanvasKnobUi {
                    id: row.id.into(),
                    label: row.label.into(),
                    control: row.control.into(),
                    value: row.value.as_str().into(),
                    toggle: row.toggle,
                })
                .collect()
        })
        .unwrap_or_default();
    ui.set_canvas_knobs(ModelRc::from(Rc::new(VecModel::from(knobs))));

    // Enum knobs as comboboxes, with the selection as an index so the
    // markup never has to search a model for a value.
    let mut combos: Vec<CanvasComboUi> = Vec::new();
    let mut aspects: Vec<CanvasAspectUi> = Vec::new();
    if let Some(node) = canvas.selected.and_then(|id| canvas.graph.node(id)) {
        for row in knob_rows(node) {
            if !row.options.is_empty() {
                let selected_index = row
                    .options
                    .iter()
                    .position(|option| *option == row.value)
                    .unwrap_or(0);
                if row.id == "aspect" {
                    for (index, ratio) in row.options.iter().enumerate() {
                        aspects.push(CanvasAspectUi {
                            ratio: (*ratio).into(),
                            selected: index == selected_index,
                        });
                    }
                    continue;
                }
                combos.push(CanvasComboUi {
                    knob: row.id.into(),
                    // A struct field holds a model, so the choices travel as
                    // one `ModelRc` rather than a packed string.
                    values: ModelRc::from(Rc::new(VecModel::from(
                        row.options
                            .iter()
                            .map(|option| slint::SharedString::from(*option))
                            .collect::<Vec<_>>(),
                    ))),
                    selected_index: selected_index as i32,
                });
            }
        }
    }
    ui.set_canvas_combos(ModelRc::from(Rc::new(VecModel::from(combos))));
    ui.set_canvas_aspects(ModelRc::from(Rc::new(VecModel::from(aspects))));

    // The selected node's LoRA rows.
    let loras: Vec<CanvasLoraUi> = canvas
        .selected
        .and_then(|id| canvas.graph.node(id))
        .map(|node| {
            node.values
                .loras
                .iter()
                .map(|row| CanvasLoraUi {
                    name: row.name.as_str().into(),
                    weight: row.weight.as_str().into(),
                })
                .collect()
        })
        .unwrap_or_default();
    ui.set_canvas_loras(ModelRc::from(Rc::new(VecModel::from(loras))));

    ui.set_canvas_tiles(ModelRc::from(Rc::new(VecModel::from(
        canvas
            .tiles
            .iter()
            .map(tile_for_canvas)
            .collect::<Vec<_>>(),
    ))));
    ui.set_canvas_status(canvas.status.as_str().into());
    ui.set_canvas_zoom(format!("{:.0}%", canvas.view.zoom * 100.0).into());
    ui.set_canvas_has_selection(canvas.selected.is_some());
    ui.set_canvas_seed_locked(canvas.seed_locked());
    ui.set_canvas_busy(canvas.busy);
}

/// Populate the static tables and push the first frame.
pub fn init(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    ui.set_canvas_backends(ModelRc::from(Rc::new(VecModel::from(
        BACKENDS
            .iter()
            .map(|(_, label)| slint::SharedString::from(*label))
            .collect::<Vec<_>>(),
    ))));
    ui.set_canvas_palette(ModelRc::from(Rc::new(VecModel::from(
        prism_core::graph_nodes::NODE_DEFS
            .iter()
            .map(|def| CanvasPaletteUi {
                kind: def.kind.into(),
                title: def.title.into(),
                color: node_color(def.kind),
            })
            .collect::<Vec<_>>(),
    ))));
    ui.set_canvas_provider(state.borrow().canvas.provider as i32);
    refresh(ui, state);
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

/// One pointer event from the canvas. The `.slint` reports a press, a move
/// and a release with element-relative coordinates; everything a gesture
/// means is decided here, on the core's shared hit-testing.
pub fn pointer(ui: &AppWindow, state: &Rc<RefCell<State>>, kind: i32, x: f32, y: f32) {
    let mut st = state.borrow_mut();
    let canvas = &mut st.canvas;
    let (cx, cy) = View::from_document(&canvas.view).screen_to_canvas(x as f64, y as f64);

    match kind {
        POINTER_DOWN => {
            // A socket starts a wire.
            if let Some(port) = hit_port(&canvas.graph, cx, cy) {
                canvas.gesture = Some(Drag::Wire {
                    from_node: port.node_id,
                    from_port: port.port_id,
                    from_output: port.output,
                    at: (cx, cy),
                });
                return;
            }
            // A header moves a node. A body is left to its own knobs, so
            // grabbing a knob never drags the whole node.
            if let Some(id) = hit_node_header(&canvas.graph, cx, cy) {
                canvas.selected = Some(id);
                canvas.moved = false;
                canvas.gesture = Some(Drag::Node { id, last: (cx, cy) });
                return;
            }
            // Empty canvas pans — and remembers that nothing has moved yet.
            canvas.selected = None;
            canvas.moved = false;
            canvas.gesture = Some(Drag::Pan { last: (x as f64, y as f64) });
        }
        POINTER_MOVE => {
            canvas.moved = true;
            let Some(gesture) = canvas.gesture.clone() else {
                return;
            };
            match gesture {
                Drag::Pan { .. } => {
                    let now = View::from_document(&canvas.view);
                    let next = pan_view(now, &gesture, (x as f64, y as f64));
                    canvas.view = next.to_document();
                    canvas.gesture = Some(Drag::Pan { last: (x as f64, y as f64) });
                }
                Drag::Node { id, last } => {
                    move_node(&mut canvas.graph, id, last, (cx, cy));
                    canvas.gesture = Some(Drag::Node { id, last: (cx, cy) });
                }
                Drag::Wire {
                    from_node,
                    from_port,
                    from_output,
                    ..
                } => {
                    canvas.gesture = Some(Drag::Wire {
                        from_node,
                        from_port,
                        from_output,
                        at: (cx, cy),
                    });
                }
            }
        }
        POINTER_UP => {
            let Some(gesture) = canvas.gesture.take() else {
                return;
            };
            if matches!(gesture, Drag::Wire { .. }) {
                // Dropped on a socket: the core's own validation decides
                // whether the connection means anything.
                let target = hit_port(&canvas.graph, cx, cy);
                if let Some(wire) = gesture.pending_wire(&canvas.graph, target.as_ref()) {
                    if plug(&mut canvas.graph, wire) {
                        canvas.status = "Wired.".into();
                    } else {
                        canvas.status = "That socket stays free.".into();
                    }
                }
            } else if !canvas.moved {
                // A click that never moved cuts the wire beneath it — but a
                // click after a drag must not.
                if let Some(index) = hit_wire(&canvas.graph, cx, cy) {
                    canvas.graph.wires.remove(index);
                    canvas.status = "Wire removed.".into();
                }
            }
        }
        _ => {}
    }
    drop(st);
    refresh(ui, state);
}

/// Wheel over the canvas: zoom about the pointer, so the point under the
/// cursor stays under the cursor.
pub fn zoom(ui: &AppWindow, state: &Rc<RefCell<State>>, x: f32, y: f32, delta: f32) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        // Wheel down zooms out, wheel up zooms in.
        let factor = if delta > 0.0 { 1.0 / 1.1 } else { 1.1 };
        let now = View::from_document(&canvas.view);
        canvas.view = now.zoomed_about((x as f64, y as f64), factor).to_document();
    }
    refresh(ui, state);
}

/// Drop a new node of `kind` onto the canvas.
pub fn add_node(ui: &AppWindow, state: &Rc<RefCell<State>>, kind: &str) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let id = next_free_id(&canvas.graph);
        let (x, y) = drop_spot(canvas.graph.nodes.len(), 40.0, 40.0);
        match new_node(id, kind, x, y) {
            Some(node) => {
                canvas.graph.nodes.push(node);
                canvas.selected = Some(id);
                canvas.status = format!("Added {}.", node_title(kind));
            }
            None => canvas.status = format!("Unknown node: {kind}"),
        }
    }
    refresh(ui, state);
}

/// A knob of the selected node was edited. The value stays a string in the
/// node's own units, exactly as the panel keeps it.
pub fn knob_edited(ui: &AppWindow, state: &Rc<RefCell<State>>, knob: &str, value: &str) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        // The node itself says which control kind this is, so the core's
        // table stays the only list of control kinds.
        let control = canvas
            .graph
            .node(id)
            .and_then(|node| {
                knob_rows(node)
                    .into_iter()
                    .find(|row| row.id == knob)
                    .map(|row| row.control.to_string())
            });
        let Some(target) = canvas.graph.node_mut(id) else {
            return;
        };
        if control.as_deref() == Some("number") {
            // A number knob keeps its value numeric, so the flatten step
            // never has to guess what a half-typed "7." meant. An
            // unterminated number is kept as text and reported when the
            // request is built.
            match value.trim().parse::<f64>() {
                Ok(number) => target.values.set_number(knob, number),
                Err(_) => target.values.set_text(knob, value),
            }
        } else {
            target.values.set_text(knob, value);
        }
    }
    refresh(ui, state);
}

/// An aspect preset was chosen on the Latent node. The core's size table
/// fills in width and height, and refuses a ratio it does not know.
pub fn aspect_selected(ui: &AppWindow, state: &Rc<RefCell<State>>, ratio: &str) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        let Some(target) = canvas.graph.node_mut(id) else {
            return;
        };
        target.values.set_enum("aspect", ratio);
        if apply_aspect(&mut target.values, ratio) {
            canvas.status = format!("Aspect {ratio} set the size.");
        } else {
            canvas.status = format!("{ratio} is not a preset the core knows.");
        }
    }
    refresh(ui, state);
}

/// Roll the selected seed node's dice, unless it is locked.
///
/// The randomness is the host's own `random_seed`, so the canvas and the
/// Image Studio draw from one place rather than two generators.
pub fn seed_roll(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        let Some(target) = canvas.graph.node_mut(id) else {
            return;
        };
        if target.values.text("seed_locked").unwrap_or("") == "locked" {
            canvas.status = "The seed is locked.".into();
            return;
        }
        target
            .values
            .set_text("seed", crate::shared::image::random_seed().to_string());
        canvas.status = "Seed rolled.".into();
    }
    refresh(ui, state);
}

/// Flip the selected node's seed lock.
pub fn seed_lock_toggle(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        let Some(target) = canvas.graph.node_mut(id) else {
            return;
        };
        let locked = target.values.text("seed_locked").unwrap_or("") == "locked";
        target
            .values
            .set_text("seed_locked", if locked { "unlocked" } else { "locked" });
        canvas.status = if locked {
            "Seed unlocked.".into()
        } else {
            "Seed locked.".into()
        };
    }
    refresh(ui, state);
}

/// Remove the selected node, and the wires that fed it.
pub fn delete_selected(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        canvas.graph.remove_node(id);
        canvas.selected = None;
        canvas.gesture = None;
        canvas.status = "Node removed.".into();
    }
    refresh(ui, state);
}

/// Edit one LoRA row of the selected node.
pub fn lora_edited(ui: &AppWindow, state: &Rc<RefCell<State>>, index: i32, name: &str, weight: &str) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        let Some(target) = canvas.graph.node_mut(id) else {
            return;
        };
        if let Some(row) = target.values.loras.get_mut(index as usize) {
            row.name = name.to_string();
            row.weight = weight.to_string();
        }
    }
    refresh(ui, state);
}

/// Add or remove a LoRA row on the selected node.
pub fn lora_add(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        let Some(target) = canvas.graph.node_mut(id) else {
            return;
        };
        target.values.loras.push(prism_core::graph::LoraEntry {
            name: String::new(),
            weight: "0.8".into(),
        });
    }
    refresh(ui, state);
}

pub fn lora_remove(ui: &AppWindow, state: &Rc<RefCell<State>>, index: i32) {
    {
        let mut st = state.borrow_mut();
        let canvas = &mut st.canvas;
        let Some(id) = canvas.selected else { return };
        let Some(target) = canvas.graph.node_mut(id) else {
            return;
        };
        let index = index as usize;
        if index < target.values.loras.len() {
            target.values.loras.remove(index);
        }
    }
    refresh(ui, state);
}

/// Choose the backend the canvas generates with.
///
/// The `.slint` reports the label a `ComboBox` hands back, so this maps it
/// back to the same table the picker was built from rather than a second
/// list of labels.
pub fn select_backend(ui: &AppWindow, state: &Rc<RefCell<State>>, label: &str) {
    let idx = BACKENDS
        .iter()
        .position(|(_, backend)| *backend == label)
        .unwrap_or(0);
    state.borrow_mut().canvas.provider = idx;
    ui.set_canvas_provider(idx as i32);
}

// ---------------------------------------------------------------------------
// Generate + save
// ---------------------------------------------------------------------------

/// Generate from the canvas. The flatten step and the request mapping are
/// both the core's; the native renderer runs on a thread so a big batch
/// cannot stall the window, and a remote install is driven through the same
/// host path the Image Studio uses.
pub fn generate(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let (provider, request) = {
        let st = state.borrow();
        let canvas = &st.canvas;
        let provider = canvas.provider_id();
        let base = prism_core::media::default_base_url(&provider).to_string();
        let form = match to_form(&canvas.graph, &provider) {
            Ok(form) => form,
            Err(reason) => {
                drop(st);
                ui.set_canvas_status(reason.to_string().into());
                return;
            }
        };
        match to_media_request(&form, &base) {
            Ok(request) => (provider, request),
            Err(reason) => {
                drop(st);
                ui.set_canvas_status(reason.into());
                return;
            }
        }
    };

    {
        let mut st = state.borrow_mut();
        st.canvas.busy = true;
        st.canvas.status = "Rendering…".to_string();
    }
    ui.set_canvas_busy(true);
    ui.set_canvas_status("Rendering…".into());

    if provider == NATIVE_ID {
        let (tx, rx) = mpsc::channel::<ImageEvent>();
        state.borrow_mut().canvas.rx_native = Some(rx);
        // The in-process renderer is pure CPU over owned data, so a plain
        // thread keeps the window responsive for big batches.
        std::thread::spawn(move || {
            let tiles = render_native(&request);
            let event = match tiles {
                Ok(tiles) => ImageEvent::Done(tiles),
                Err(reason) => ImageEvent::Failed(reason),
            };
            let _ = tx.send(event);
        });
    } else {
        let (tx, rx) = mpsc::channel::<MediaOutcome>();
        state.borrow_mut().canvas.rx_remote = Some(rx);
        prism_core::host::spawn_media(
            prism_core::media::MediaKind::Image,
            request,
            tx,
        );
    }
}

/// Save the canvas into the shared document, so the next surface that opens
/// it — and the server that serves it over `/v1/graph` — sees this drawing
/// and this view.
pub fn save(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let (graph, view, root) = {
        let st = state.borrow();
        let canvas = &st.canvas;
        (canvas.graph.clone(), canvas.view, canvas.graph_root.clone())
    };
    let mut document = prism_core::graph_store::GraphDocument::new(graph, 0);
    document.view = view;
    match save_document(&FsStorage, &root, &document, now_millis()) {
        Ok(_) => {
            state.borrow_mut().canvas.status = "Saved the shared canvas.".into();
        }
        Err(reason) => {
            state.borrow_mut().canvas.status = format!("Could not save: {reason}");
        }
    }
    refresh(ui, state);
}

/// Epoch milliseconds, for the `updated_at` a save must carry.
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Timer pump
// ---------------------------------------------------------------------------

/// Advance one pump tick: land in-process renders, then remote outcomes.
pub fn drain(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    drain_native(ui, state);
    drain_remote(ui, state);
}

fn drain_native(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let Some(rx) = state.borrow_mut().canvas.rx_native.take() else {
        return;
    };
    match rx.try_recv() {
        Ok(ImageEvent::Done(tiles)) => {
            let count = tiles.len();
            {
                let mut st = state.borrow_mut();
                let canvas = &mut st.canvas;
                canvas.busy = false;
                for tile in tiles {
                    canvas.tiles.insert(0, tile);
                }
                canvas
                    .tiles
                    .truncate(crate::shared::image::MAX_RESULTS);
                canvas.status = format!("{count} image(s) ready.");
            }
            refresh(ui, state);
        }
        Ok(ImageEvent::Failed(reason)) => {
            let mut st = state.borrow_mut();
            st.canvas.busy = false;
            st.canvas.status = reason.clone();
            drop(st);
            ui.set_canvas_busy(false);
            ui.set_canvas_status(reason.into());
        }
        Err(TryRecvError::Empty) => {
            state.borrow_mut().canvas.rx_native = Some(rx);
        }
        Err(TryRecvError::Disconnected) => {}
    }
}

fn drain_remote(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let Some(rx) = state.borrow_mut().canvas.rx_remote.take() else {
        return;
    };
    match rx.try_recv() {
        Ok(MediaOutcome::Ready(url)) => {
            let label = {
                let st = state.borrow();
                let provider = st.canvas.provider_id();
                format!("{} result", backend_label(&provider))
            };
            {
                let mut st = state.borrow_mut();
                let canvas = &mut st.canvas;
                canvas.busy = false;
                canvas.tiles.insert(
                    0,
                    ImageTile {
                        label,
                        url,
                        ..Default::default()
                    },
                );
                canvas
                    .tiles
                    .truncate(crate::shared::image::MAX_RESULTS);
                canvas.status = "1 image ready.".into();
            }
            refresh(ui, state);
        }
        Ok(MediaOutcome::Pending(task)) => {
            let mut st = state.borrow_mut();
            st.canvas.busy = true;
            st.canvas.status = format!("Queued — the install is rendering ({task}).");
            drop(st);
            ui.set_canvas_status(format!("Queued — the install is rendering ({task}).").into());
        }
        Ok(MediaOutcome::Failed(reason)) => {
            let mut st = state.borrow_mut();
            st.canvas.busy = false;
            st.canvas.status = reason.clone();
            drop(st);
            ui.set_canvas_busy(false);
            ui.set_canvas_status(reason.into());
        }
        Err(TryRecvError::Empty) => {
            state.borrow_mut().canvas.rx_remote = Some(rx);
        }
        Err(TryRecvError::Disconnected) => {}
    }
}

/// A backend's display label, from the same table the picker shows.
fn backend_label(id: &str) -> &'static str {
    BACKENDS
        .iter()
        .find(|(backend, _)| *backend == id)
        .map(|(_, label)| *label)
        .unwrap_or("backend")
}

/// A node's title, from the core's own table.
fn node_title(kind: &str) -> &'static str {
    node_def(kind).map(|def| def.title).unwrap_or("Node")
}
