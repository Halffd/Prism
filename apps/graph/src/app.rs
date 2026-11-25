//! The canvas: node palette, pan/zoom, drag-and-drop wiring and Generate.
//!
//! Everything here is presentation. The interaction arithmetic lives in
//! `crate::canvas` (tested on the host), the flatten-to-request mapping in
//! `crate::generate` (also tested), and every Stable Diffusion rule stays
//! in `prism-core`.
//!
//! Two idioms keep it honest. Markup reads a *snapshot* cloned at the top of
//! the render, so no event handler runs while a read guard is alive — that
//! is the failure a canvas hits first. And every per-node editor receives
//! the `graph` signal as a parameter, so a handler can write to the one node
//! it owns without a leftover stub that does nothing.

use dioxus::prelude::*;

use prism_core::graph::{Graph, GraphNode, LoraEntry, HEADER_H, NODE_WIDTH, PORT_START};
use prism_core::graph_nodes::node_def;
use prism_core::graph_request::{knob_rows, to_form, KnobRow};
use prism_core::graph_store::GraphDocument;

use crate::canvas::{self, Drag, View};
use crate::generate::{self, GeneratedImage};

/// The node header accents, matching the Slint Image Studio's panel so the
/// two surfaces read as the same product.
fn node_color(kind: &str) -> &'static str {
    match kind {
        "checkpoint" => "#b026ff",
        "lora" => "#22c55e",
        "prompt" => "#38bdf8",
        "sampler" => "#f59e0b",
        "latent" => "#06b6d4",
        "seed" => "#f43f5e",
        _ => "#94a3b8",
    }
}

const CANVAS_BG: &str = "#0b0d14";
const PANEL_BG: &str = "#12141c";
const WIRE_COLOR: &str = "#b026ff";
const TEXT_DIM: &str = "#8b90a3";

/// The shared document a save writes: this canvas's graph plus the view it
/// was left at, so a reopen lands where the user left off.
fn document_of(graph: &Graph, view: View) -> GraphDocument {
    let mut document = GraphDocument::new(graph.clone(), 0);
    document.view = view.to_document();
    document
}

/// A dice roll, for the seed node. The core resolves an *empty* seed, so a
/// lock only has to keep the field from changing.
fn roll_seed() -> String {
    let roll = (js_sys::Math::random() * 2_147_483_647.0).round() as i64;
    roll.max(0).to_string()
}

#[allow(non_snake_case)]
pub fn App() -> Element {
    // ---- state -----------------------------------------------------------
    let mut graph = use_signal(prism_core::graph_factory::starter_graph);
    let mut view = use_signal(View::default);
    let mut drag = use_signal(|| None as Option<Drag>);
    let mut selected = use_signal(|| None as Option<u64>);
    let mut status = use_signal(String::new);
    // `images` and `provider` need no `mut` here: `toolbar` receives copies and
    // declares the `mut` it needs on its own parameters.
    let images = use_signal(Vec::<GeneratedImage>::new);
    let provider = use_signal(|| prism_core::media::NATIVE_ID.to_string());
    // A gesture that never moved is a click: it cuts a wire, or deselects.
    let mut moved = use_signal(|| false);

    // ---- load the shared document, once ---------------------------------
    use_future(move || async move {
        match crate::sync::fetch_document(crate::sync::DEFAULT_BASE).await {
            Ok(document) => {
                graph.set(document.graph);
                view.set(View::from_document(&document.view));
                status.set("Loaded the canvas shared with every Prism app.".into());
            }
            Err(reason) => {
                graph.set(prism_core::graph_factory::starter_graph());
                status.set(format!("Starting a new canvas: {reason}"));
            }
        }
    });

    // ---- the canvas, which takes the whole workspace --------------------
    rsx! {
        div {
            style: "display: flex; flex-direction: column; height: 100vh; font-family: Inter, system-ui, sans-serif; background: {CANVAS_BG}; color: #e6e8ef;",
            {toolbar(graph, view, status, images, provider)},

            div {
                style: "display: flex; flex: 1; min-height: 0;",
                div {
                    style: "position: relative; flex: 1; overflow: hidden; background: radial-gradient(circle at 1px 1px, #1e222e 1px, transparent 0) 0 0 / 28px 28px, {CANVAS_BG};",
                    // One set of gestures for the whole canvas: a node's own
                    // knob controls stop propagation, so a click that lands on
                    // an input never also pans.
                    onmousedown: move |evt| {
                        let (at_x, at_y) = element_point(&evt);
                        let (cx, cy) = view.read().screen_to_canvas(at_x, at_y);
                        let current = graph.read().clone();

                        // 1. A socket starts a wire.
                        if let Some(port) = canvas::hit_port(&current, cx, cy) {
                            drag.set(Some(Drag::Wire {
                                from_node: port.node_id,
                                from_port: port.port_id.clone(),
                                from_output: port.output,
                                at: (cx, cy),
                            }));
                            return;
                        }
                        // 2. A header moves a node. A body is left to its knobs.
                        if let Some(id) = canvas::hit_node_header(&current, cx, cy) {
                            selected.set(Some(id));
                            drag.set(Some(Drag::Node { id, last: (cx, cy) }));
                            return;
                        }
                        // 3. Empty canvas: pan, and remember that nothing moved.
                        selected.set(None);
                        moved.set(false);
                        drag.set(Some(Drag::Pan { last: (at_x, at_y) }));
                    },
                    onmousemove: move |evt| {
                        let Some(active) = drag.read().clone() else { return };
                        moved.set(true);
                        let (at_x, at_y) = element_point(&evt);
                        let (cx, cy) = view.read().screen_to_canvas(at_x, at_y);
                        match active {
                            Drag::Pan { .. } => {
                                let now = *view.read();
                                view.set(canvas::pan_view(now, &active, (at_x, at_y)));
                                drag.set(Some(Drag::Pan { last: (at_x, at_y) }));
                            }
                            Drag::Node { id, last, .. } => {
                                canvas::move_node(&mut graph.write(), id, last, (cx, cy));
                                drag.set(Some(Drag::Node { id, last: (cx, cy) }));
                            }
                            Drag::Wire { from_node, from_port, from_output, .. } => {
                                drag.set(Some(Drag::Wire {
                                    from_node,
                                    from_port,
                                    from_output,
                                    at: (cx, cy),
                                }));
                            }
                        }
                    },
                    onmouseup: move |evt| {
                        let Some(active) = drag.read().clone() else { return };
                        drag.set(None);
                        let (at_x, at_y) = element_point(&evt);
                        let (cx, cy) = view.read().screen_to_canvas(at_x, at_y);

                        if matches!(active, Drag::Wire { .. }) {
                            let current = graph.read().clone();
                            let target = canvas::hit_port(&current, cx, cy);
                            if let Some(wire) = active.pending_wire(&current, target.as_ref()) {
                                if canvas::plug(&mut graph.write(), wire) {
                                    status.set("Wired.".into());
                                } else {
                                    status.set("That socket stays free.".into());
                                }
                            }
                        } else if !*moved.read() {
                            // A click that never moved removes the wire beneath
                            // it — but a click after a drag must not.
                            let current = graph.read().clone();
                            if let Some(index) = canvas::hit_wire(&current, cx, cy) {
                                graph.write().wires.remove(index);
                                status.set("Wire removed.".into());
                            }
                        }
                    },
                    onwheel: move |evt| {
                        evt.prevent_default();
                        // A wheel event carries its own coordinates; it is not
                        // a mouse event, so it does not share the helper.
                        let (at_x, at_y) = {
                            let point = evt.data.coordinates().element();
                            (point.x, point.y)
                        };
                        // Wheel down zooms out, wheel up zooms in.
                        let dy = evt.data.delta().strip_units().y;
                        let factor = if dy > 0.0 { 1.0 / 1.1 } else { 1.1 };
                        // Bind the new view before setting: the read guard has
                        // to be released first, or the write contends with it.
                        let next = view.read().zoomed_about((at_x, at_y), factor);
                        view.set(next);
                    },

                    {canvas_layers(graph, selected, view, drag, status)},
                }
                {output_panel(images)},
            }
        }
    }
}

/// The transformed content: wires beneath nodes, and the wire a drag is
/// drawing right now.
fn canvas_layers(
    graph: Signal<Graph>,
    selected: Signal<Option<u64>>,
    view: Signal<View>,
    drag: Signal<Option<Drag>>,
    status: Signal<String>,
) -> Element {
    let snapshot = graph.read().clone();
    let view_now = *view.read();
    let active = drag.read().clone();

    rsx! {
        div {
            style: "position: absolute; left: 0; top: 0; transform-origin: 0 0; transform: translate({view_now.pan_x}px, {view_now.pan_y}px) scale({view_now.zoom});",
            svg {
                style: "position: absolute; left: 0; top: 0; overflow: visible; width: 1px; height: 1px; pointer-events: none;",
                for wire in snapshot.wires.iter() {
                    if let Some((from, to)) = prism_core::graph::wire_endpoints(&snapshot, wire) {
                        path {
                            key: "wire-{wire.from_node}-{wire.from_port}-{wire.to_node}-{wire.to_port}",
                            d: "{prism_core::graph::wire_path(from, to)}",
                            style: "fill: none; stroke: {WIRE_COLOR}; stroke-width: 3; stroke-linecap: round;",
                        }
                    }
                }
                if let Some(Drag::Wire { from_node, from_port, at, .. }) = &active {
                    if let Some(node) = snapshot.node(*from_node) {
                        if let Some(def) = node_def(&node.kind) {
                            if let Some((from_x, from_y)) =
                                prism_core::graph::port_position(node, def, from_port)
                            {
                                path {
                                    key: "drag-wire{from_node}",
                                    d: "{prism_core::graph::wire_path((from_x, from_y), *at)}",
                                    style: "fill: none; stroke: {WIRE_COLOR}; stroke-width: 2.5; stroke-dasharray: 6 5; opacity: 0.85;",
                                }
                            }
                        }
                    }
                }
            }

            for node in snapshot.nodes.iter() {
                div {
                    key: "node-{node.id}",
                    style: "position: absolute; left: {node.x}px; top: {node.y}px; width: {NODE_WIDTH}px; border-radius: 8px; overflow: hidden; border: 1px solid #2a2f3f; box-shadow: 0 6px 18px rgba(0,0,0,0.45); pointer-events: none;",
                    div {
                        style: "height: {HEADER_H}px; padding: 0 10px; display: flex; align-items: center; background: {node_color(&node.kind)}; color: #0b0d14; font-size: 12px; font-weight: 700; cursor: grab;",
                        "{node_title(&node.kind)}"
                    }
                    div {
                        style: "background: {PANEL_BG};",
                        {node_sockets(node.kind.as_str())}
                        {node_knobs(node, graph)},
                    }
                    // A selected node gets a halo, so the selection is legible.
                    if Some(node.id) == *selected.read() {
                        div {
                            style: "position: absolute; inset: 0; border: 2px solid {node_color(&node.kind)}; border-radius: 8px; pointer-events: none;",
                        }
                    }
                }
            }

            // The corner: what the canvas last did, then the zoom. The
            // status is the only place a failed sync or a refused
            // generation ever surfaces, so it has to actually render.
            div {
                style: "position: absolute; left: 12px; bottom: 10px; font-size: 11px; color: {TEXT_DIM}; pointer-events: none;",
                "{status.read()}"
                " · "
                "{status_line(view_now, snapshot.nodes.len())}"
            }
        }
    }
}

/// Palette, backend choice, Generate and Save.
#[allow(clippy::too_many_arguments)]
fn toolbar(
    mut graph: Signal<Graph>,
    mut view: Signal<View>,
    mut status: Signal<String>,
    mut images: Signal<Vec<GeneratedImage>>,
    mut provider: Signal<String>,
) -> Element {
    rsx! {
        div {
            style: "display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: {PANEL_BG}; border-bottom: 1px solid #232735; flex-wrap: wrap;",
            h2 { style: "margin: 0 12px 0 0; font-size: 15px; font-weight: 650; color: #fff;", "Node Studio" }
            for kind in ["checkpoint", "lora", "prompt", "sampler", "latent", "seed"] {
                button {
                    key: "add-{kind}",
                    style: "padding: 5px 9px; border-radius: 6px; border: 1px solid #2a2f3f; background: #191c26; color: {node_color(kind)}; cursor: pointer; font-size: 12px;",
                    onclick: move |_| {
                        let id = canvas::next_free_id(&graph.read());
                        let (x, y) = prism_core::graph_factory::drop_spot(
                            graph.read().nodes.len(), 40.0, 40.0,
                        );
                        if let Some(node) = canvas::new_node(id, kind, x, y) {
                            graph.write().nodes.push(node);
                        }
                    },
                    "+ {node_title(kind)}"
                }
            }
            div {
                style: "margin-left: auto; display: flex; align-items: center; gap: 8px;",
                label { style: "font-size: 11px; color: {TEXT_DIM};", "Backend" }
                select {
                    style: "padding: 5px 8px; border-radius: 6px; border: 1px solid #2a2f3f; background: #191c26; color: #e6e8ef; font-size: 12px;",
                    value: "{provider.read()}",
                    onchange: move |evt| provider.set(evt.value()),
                    option { value: "native", "Native (built-in)" }
                    option { value: "a1111", "Automatic1111" }
                }
                button {
                    style: "padding: 6px 12px; border-radius: 6px; border: none; background: {WIRE_COLOR}; color: #fff; font-weight: 600; cursor: pointer; font-size: 12px;",
                    onclick: move |_| {
                        let drawn = graph.read().clone();
                        let backend = provider.read().clone();
                        match to_form(&drawn, &backend) {
                            Ok(form) => {
                                status.set("Generating…".into());
                                let base = crate::sync::DEFAULT_BASE.to_string();
                                dioxus::core::spawn(async move {
                                    match generate::generate(&form, &base).await {
                                        Ok(rendered) => {
                                            let count = rendered.len();
                                            images.set(rendered);
                                            status.set(format!("Generated {count} image(s)."));
                                        }
                                        Err(reason) => status.set(reason),
                                    }
                                });
                            }
                            Err(reason) => status.set(reason.to_string()),
                        }
                    },
                    "Generate"
                }
                button {
                    style: "padding: 6px 12px; border-radius: 6px; border: 1px solid #2a2f3f; background: #191c26; color: #e6e8ef; cursor: pointer; font-size: 12px;",
                    onclick: move |_| {
                        let document = document_of(&graph.read(), *view.read());
                        dioxus::core::spawn(async move {
                            status.set("Saving the shared canvas…".into());
                            match crate::sync::save_document(
                                crate::sync::DEFAULT_BASE,
                                &document,
                            )
                            .await
                            {
                                Ok(saved) => {
                                    graph.set(saved.graph);
                                    view.set(View::from_document(&saved.view));
                                    status.set("Saved the shared canvas.".into());
                                }
                                Err(reason) => status.set(format!("Could not save: {reason}")),
                            }
                        });
                    },
                    "Save"
                }
            }
        }
    }
}

/// The node's sockets, drawn straight from its port table.
fn node_sockets(kind: &str) -> Element {
    let def = node_def(kind);
    let inputs = def.map(|d| d.inputs).unwrap_or(&[]);
    let outputs = def.map(|d| d.outputs).unwrap_or(&[]);
    rsx! {
        div {
            style: "display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; min-height: {PORT_START - HEADER_H}px;",
            div { style: "display: flex; flex-direction: column; gap: 4px;",
                for port in inputs.iter() {
                    {port_dot(kind, port.label, false)}
                }
            }
            div { style: "display: flex; flex-direction: column; gap: 4px; align-items: flex-end;",
                for port in outputs.iter() {
                    {port_dot(kind, port.label, true)}
                }
            }
        }
    }
}

/// One socket dot with its label, offset to sit exactly on the node edge.
fn port_dot(kind: &str, label: &'static str, output: bool) -> Element {
    let color = node_color(kind);
    rsx! {
        div {
            style: "display: flex; align-items: center; gap: 6px; font-size: 10px; color: {TEXT_DIM};",
            if !output {
                div {
                    style: "width: 11px; height: 11px; border-radius: 50%; border: 2px solid {color}; background: {PANEL_BG}; margin-left: -17px; flex: 0 0 auto;",
                }
            }
            "{label}"
            if output {
                div {
                    style: "width: 11px; height: 11px; border-radius: 50%; border: 2px solid {color}; background: {PANEL_BG}; margin-right: -17px; flex: 0 0 auto;",
                }
            }
        }
    }
}

/// A node's editable body: the knob rows the core reports for it, plus the
/// LoRA and seed editors whose shapes the core does not render.
fn node_knobs(node: &GraphNode, graph: Signal<Graph>) -> Element {
    let rows = knob_rows(node);
    let node_id = node.id;
    let is_lora = node.kind == "lora";
    let is_seed = node.kind == "seed";

    rsx! {
        div { style: "padding: 6px 10px 10px; display: flex; flex-direction: column; gap: 6px;",
            for row in rows.iter().cloned() {
                {knob_control(row, node_id, graph)}
            }

            if is_lora { {lora_editor(node, graph)} }
            if is_seed { {seed_editor(node, graph)} }
        }
    }
}

/// One knob row, by value.
///
/// Each row is owned rather than borrowed because a Dioxus event handler
/// must be `'static`: a closure that borrowed a row from a local `Vec` would
/// not compile. Owning the row also means the handler's `move` captures are
/// the plain `&'static str` ids, so nothing escapes the render scope.
fn knob_control(row: KnobRow, node_id: u64, mut graph: Signal<Graph>) -> Element {
    let id = row.id;
    let control = row.control;
    let toggle = row.toggle;

    rsx! {
        div { key: "{row.id}", style: "display: flex; flex-direction: column; gap: 3px;",
            label { style: "font-size: 10px; color: {TEXT_DIM};", "{row.label}" }
            if control == "enum" {
                select {
                    style: "padding: 4px 6px; border-radius: 5px; border: 1px solid #2a2f3f; background: #191c26; color: #e6e8ef; font-size: 11px; pointer-events: auto;",
                    onmousedown: soak_gesture,
                    value: "{row.value}",
                    oninput: move |evt| {
                        if let Some(target) = graph.write().node_mut(node_id) {
                            target.values.set_enum(id, evt.value());
                            // An aspect preset is not just a label: the pixels it
                            // means come from the core's size table, so choosing
                            // one also fills in width and height. Without this the
                            // Latent node would offer a control that does nothing.
                            // The helper refuses an unknown label, because the
                            // core's size table would otherwise fall back to
                            // square and overwrite a size the user typed.
                            if id == "aspect" {
                                canvas::apply_aspect(&mut target.values, &evt.value());
                            }
                        }
                    },
                    for option in row.options.iter().copied() {
                        option { key: "{option}", value: "{option}", selected: "{option == row.value}", "{option}" }
                    }
                }
            } else if toggle {
                button {
                    style: "padding: 4px 8px; border-radius: 5px; border: 1px solid #2a2f3f; cursor: pointer; font-size: 11px; text-align: left; pointer-events: auto;",
                    onmousedown: soak_gesture,
                    onclick: move |_| flip_seed_lock(graph, node_id),
                    "Seed locked: {row.value}"
                }
            } else {
                input {
                    // Keyed by the knob, never by its value: a value key would
                    // remount the input on every keystroke and steal focus
                    // mid-word.
                    key: "{row.id}",
                    style: "padding: 4px 6px; border-radius: 5px; border: 1px solid #2a2f3f; background: #191c26; color: #e6e8ef; font-size: 11px; pointer-events: auto;",
                    r#type: "text",
                    onmousedown: soak_gesture,
                    placeholder: "{row.placeholder}",
                    value: "{row.value}",
                    oninput: move |evt| {
                        let raw = evt.value();
                        if let Some(target) = graph.write().node_mut(node_id) {
                            // A number knob keeps its value numeric, so the
                            // flatten step never has to guess what a half-typed
                            // "7." meant. An unterminated number is kept as
                            // text and reported when the request is built.
                            if control == "number" {
                                match raw.trim().parse::<f64>() {
                                    Ok(value) => target.values.set_number(id, value),
                                    Err(_) => target.values.set_text(id, raw),
                                }
                            } else {
                                target.values.set_text(id, raw);
                            }
                        }
                    },
                }
            }
        }
    }
}

/// The LoRA node's rows: a name, a weight, and a way to remove one. Adding
/// a row is the only place the canvas builds a `LoraEntry`, because the
/// core does not render one.
fn lora_editor(node: &GraphNode, mut graph: Signal<Graph>) -> Element {
    let node_id = node.id;
    rsx! {
        div { style: "margin-top: 4px; display: flex; flex-direction: column; gap: 4px;",
            for (index, row) in node.values.loras.iter().enumerate() {
                div { key: "lora-{index}", style: "display: flex; gap: 4px; align-items: center;",
                    input {
                        style: "flex: 1; min-width: 0; padding: 4px 6px; border-radius: 5px; border: 1px solid #2a2f3f; background: #191c26; color: #e6e8ef; font-size: 11px; pointer-events: auto;",
                        r#type: "text",
                        onmousedown: soak_gesture,
                        placeholder: "lora name",
                        value: "{row.name}",
                        oninput: move |evt| {
                            if let Some(target) = graph.write().node_mut(node_id) {
                                if let Some(slot) = target.values.loras.get_mut(index) {
                                    slot.name = evt.value();
                                }
                            }
                        },
                    }
                    input {
                        style: "width: 54px; padding: 4px 6px; border-radius: 5px; border: 1px solid #2a2f3f; background: #191c26; color: #e6e8ef; font-size: 11px; pointer-events: auto;",
                        r#type: "text",
                        onmousedown: soak_gesture,
                        placeholder: "0.8",
                        value: "{row.weight}",
                        oninput: move |evt| {
                            if let Some(target) = graph.write().node_mut(node_id) {
                                if let Some(slot) = target.values.loras.get_mut(index) {
                                    slot.weight = evt.value();
                                }
                            }
                        },
                    }
                    button {
                        style: "padding: 3px 7px; border-radius: 5px; border: 1px solid #2a2f3f; background: #191c26; color: {TEXT_DIM}; cursor: pointer; font-size: 11px; pointer-events: auto;",
                        onmousedown: soak_gesture,
                        onclick: move |_| {
                            if let Some(target) = graph.write().node_mut(node_id) {
                                if index < target.values.loras.len() {
                                    target.values.loras.remove(index);
                                }
                            }
                        },
                        "×"
                    }
                }
            }
            button {
                style: "padding: 4px 8px; border-radius: 5px; border: 1px dashed #2a2f3f; background: transparent; color: {TEXT_DIM}; cursor: pointer; font-size: 11px; pointer-events: auto;",
                onmousedown: soak_gesture,
                onclick: move |_| {
                    if let Some(target) = graph.write().node_mut(node_id) {
                        target.values.loras.push(LoraEntry {
                            name: String::new(),
                            weight: "0.8".into(),
                        });
                    }
                },
                "+ Add LoRA"
            }
        }
    }
}

/// The seed node's extra controls: a dice that respects the lock, because a
/// locked seed has to survive an accidental roll, and the lock itself.
fn seed_editor(node: &GraphNode, mut graph: Signal<Graph>) -> Element {
    let node_id = node.id;
    let locked = node.values.text("seed_locked").unwrap_or("") == "locked";
    rsx! {
        div { style: "display: flex; gap: 4px; align-items: center;",
            button {
                style: "padding: 4px 8px; border-radius: 5px; border: 1px solid #2a2f3f; cursor: pointer; font-size: 11px; pointer-events: auto;",
                onmousedown: soak_gesture,
                disabled: locked,
                onclick: move |_| {
                    if let Some(target) = graph.write().node_mut(node_id) {
                        if target.values.text("seed_locked").unwrap_or("") == "locked" {
                            return;
                        }
                        target.values.set_text("seed", roll_seed());
                    }
                },
                "Roll"
            }
            button {
                style: "padding: 4px 8px; border-radius: 5px; border: 1px solid #2a2f3f; cursor: pointer; font-size: 11px; pointer-events: auto;",
                onmousedown: soak_gesture,
                onclick: move |_| flip_seed_lock(graph, node_id),
                if locked { "Unlock seed" } else { "Lock seed" }
            }
        }
    }
}

/// Flip the seed node's lock. Kept as a helper so the row button and the
/// row label cannot disagree about what a lock is.
fn flip_seed_lock(mut graph: Signal<Graph>, node_id: u64) {
    if let Some(target) = graph.write().node_mut(node_id) {
        let next = if target.values.text("seed_locked").unwrap_or("") == "locked" {
            "unlocked"
        } else {
            "locked"
        };
        target.values.set_text("seed_locked", next);
    }
}

/// Keep a node control's own gesture from also driving the canvas.
///
/// Without this, pressing into a knob input would bubble to the canvas and
/// start a pan, so selecting text in a field would drag the whole viewport
/// away. A shared function keeps the intent stated once instead of being
/// repeated — and quietly forgotten — on each control.
fn soak_gesture(evt: Event<MouseData>) {
    evt.stop_propagation();
}

/// The last results, plus the empty state that explains where to start.
fn output_panel(images: Signal<Vec<GeneratedImage>>) -> Element {
    rsx! {
        div {
            style: "width: 300px; flex: 0 0 300px; overflow-y: auto; padding: 12px; background: {PANEL_BG}; border-left: 1px solid #232735;",
            div { style: "font-size: 11px; color: {TEXT_DIM}; margin-bottom: 8px;", "OUTPUT" }
            if images.read().is_empty() {
                div { style: "font-size: 12px; color: {TEXT_DIM}; line-height: 1.5;",
                    "Press Generate. The native backend renders in-process; A1111 posts to a local install."
                }
            }
            for image in images.read().iter() {
                div {
                    key: "{image.label}",
                    style: "margin-bottom: 12px;",
                    img {
                        src: "{image.url}",
                        style: "width: 100%; border-radius: 6px; border: 1px solid #2a2f3f; display: block;",
                    }
                    div { style: "font-size: 10px; color: {TEXT_DIM}; margin-top: 4px;", "{image.label}" }
                }
            }
        }
    }
}

/// A pointer position in canvas bounding-box coordinates. Dioxus hands the
/// coordinates relative to whichever element raised the event, so binding
/// one handler to the canvas container and reading *its* box is the only way
/// a pointer position means the same thing everywhere.
fn element_point(evt: &Event<MouseData>) -> (f64, f64) {
    let point = evt.data.coordinates().element();
    (point.x, point.y)
}

/// The corner label: the zoom, so a canvas that has drifted has a way back.
fn status_line(view: View, node_count: usize) -> String {
    format!("{node_count} nodes · {:.0}% zoom", view.zoom * 100.0)
}

/// A node's display title, from the core's own table.
fn node_title(kind: &str) -> &'static str {
    node_def(kind).map(|def| def.title).unwrap_or("Node")
}