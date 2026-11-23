//! Unit tests for the graph model and the flatten step — no browser, no
//! UI framework, no Stable Diffusion rules.
//! Dioxus, no Stable Diffusion rules.

use super::graph_factory::{default_values, make_node, starter_graph, ASPECT_PRESETS, SCHEDULERS, SAMPLERS};
use super::graph::{
    port_position, wire_path, Graph, GraphNode, LoraEntry, NodeValues, PortKind, Wire, NODE_WIDTH,
};
use super::graph_nodes::{node_def, NODE_DEFS};
use super::graph_request::{seed_locked, to_form, GraphError};

fn node(id: u64, kind: &str, x: f64, y: f64) -> GraphNode {
    make_node(id, kind, x, y).expect("known node kind")
}

fn wire(from_node: u64, from_port: &str, to_node: u64, to_port: &str) -> Wire {
    Wire::new(from_node, from_port, to_node, to_port)
}

#[test]
fn every_node_kind_resolves_and_is_unique() {
    let kinds: Vec<&str> = NODE_DEFS.iter().map(|d| d.kind).collect();
    assert_eq!(kinds.len(), 6);
    let mut sorted = kinds.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), kinds.len());
    for kind in kinds {
        assert!(node_def(kind).is_some(), "node_def({kind}) missing");
    }
}

#[test]
fn a_wire_needs_matching_kinds_output_to_input() {
    let mut graph = Graph::default();
    graph.nodes.push(node(1, "checkpoint", 0.0, 0.0));
    graph.nodes.push(node(2, "prompt", 0.0, 200.0));

    // checkpoint's Model output -> prompt has no Model input: rejected.
    assert!(!graph.connect(wire(1, "model", 2, "conditioning")));

    // Two inputs can never be wired to each other.
    graph.nodes.push(node(3, "sampler", 300.0, 0.0));
    assert!(!graph.connect(wire(3, "model", 2, "conditioning")));

    // Nothing connects to itself.
    assert!(!graph.connect(wire(3, "samples", 3, "model")));

    // Ports that do not exist are rejected.
    assert!(!graph.connect(wire(1, "nope", 3, "model")));
}

#[test]
fn one_input_accepts_one_wire_but_outputs_may_fan_out() {
    let mut graph = Graph::default();
    graph.nodes.push(node(1, "checkpoint", 0.0, 0.0));
    graph.nodes.push(node(2, "latent", 0.0, 200.0));
    graph.nodes.push(node(3, "sampler", 300.0, 0.0));
    graph.nodes.push(node(4, "sampler", 300.0, 300.0));

    let first = wire(1, "model", 3, "model");
    assert!(graph.connect(first.clone()));

    // The same input refuses a second source.
    assert!(!graph.connect(wire(1, "model", 3, "model")));

    // But the same output can feed another sampler.
    assert!(graph.connect(wire(1, "model", 4, "model")));

    // And the reversed duplicate is refused.
    assert!(!graph.connect(first.flipped()));
}

#[test]
fn deleting_a_node_drops_its_wires() {
    let mut graph = starter_graph();
    assert!(graph.wires.len() >= 4);
    let checkpoint_id = graph
        .nodes
        .iter()
        .find(|n| n.kind == "checkpoint")
        .unwrap()
        .id;
    graph.remove_node(checkpoint_id);
    assert!(graph
        .wires
        .iter()
        .all(|w| w.from_node != checkpoint_id && w.to_node != checkpoint_id));
    assert!(graph.node(checkpoint_id).is_none());
}

#[test]
fn port_geometry_puts_inputs_on_the_left_and_outputs_on_the_right() {
    let sampler = node(1, "sampler", 100.0, 200.0);
    let def = node_def("sampler").unwrap();

    let (x_in, y_first) = port_position(&sampler, def, "model").unwrap();
    assert_eq!(x_in, 100.0, "input socket sits on the node's left edge");
    assert!(y_first > 200.0, "first port is below the header");

    let (x_out, _) = port_position(&sampler, def, "samples").unwrap();
    assert_eq!(x_out, 100.0 + NODE_WIDTH, "output socket sits on the right edge");

    // Two input ports are stacked vertically in body order.
    let (_, y_second) = port_position(&sampler, def, "conditioning").unwrap();
    assert!(y_second > y_first);

    assert!(port_position(&sampler, def, "missing").is_none());
}

#[test]
fn wire_path_is_a_cubic_through_both_sockets() {
    let path = wire_path((10.0, 20.0), (110.0, 80.0));
    assert!(path.starts_with("M 10.0 20.0"), "{path}");
    assert!(path.contains(" C "), "{path}");
    // Both endpoints appear in the path.
    assert!(path.ends_with("110.0 80.0"), "{path}");
    // Control points sit between the endpoints horizontally.
    assert!(path.contains("60.0 20.0"), "{path}");
    assert!(path.contains("60.0 80.0"), "{path}");
}

#[test]
fn the_starter_graph_prewires_the_recognizable_path() {
    let graph = starter_graph();
    let kinds: Vec<&str> = graph.nodes.iter().map(|n| n.kind.as_str()).collect();
    assert_eq!(kinds, vec!["checkpoint", "lora", "prompt", "sampler", "latent", "seed"]);

    let sampler = graph.nodes.iter().find(|n| n.kind == "sampler").unwrap();
    let fed: Vec<&str> = graph
        .inputs_of(sampler.id)
        .iter()
        .map(|w| w.to_port.as_str())
        .collect();
    assert!(fed.contains(&"model"));
    assert!(fed.contains(&"conditioning"));
    assert!(fed.contains(&"latent"));
    // The seed node is deliberately left unwired: an empty seed means
    // "random", which is the friendlier first run.
    assert!(!fed.contains(&"seed"));
}

#[test]
fn flatten_reads_knobs_across_wires() {
    let mut graph = starter_graph();

    let prompt_id = graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;
    graph
        .node_mut(prompt_id)
        .unwrap()
        .values
        .set_text("prompt", " a lighthouse in fog ");
    graph
        .node_mut(prompt_id)
        .unwrap()
        .values
        .set_text("negative", "blur");

    let latent_id = graph.nodes.iter().find(|n| n.kind == "latent").unwrap().id;
    graph.node_mut(latent_id).unwrap().values.set_number("width", 768.0);
    graph
        .node_mut(latent_id)
        .unwrap()
        .values
        .set_number("height", 512.0);
    graph.node_mut(latent_id).unwrap().values.set_number("batch", 4.0);

    let checkpoint_id = graph
        .nodes
        .iter()
        .find(|n| n.kind == "checkpoint")
        .unwrap()
        .id;
    graph
        .node_mut(checkpoint_id)
        .unwrap()
        .values
        .set_text("checkpoint", "sd-v1-5");
    graph
        .node_mut(checkpoint_id)
        .unwrap()
        .values
        .set_text("vae", "vae-ft-mse");
    graph
        .node_mut(checkpoint_id)
        .unwrap()
        .values
        .set_number("clip_skip", 2.0);

    let sampler_id = graph.nodes.iter().find(|n| n.kind == "sampler").unwrap().id;
    graph
        .node_mut(sampler_id)
        .unwrap()
        .values
        .set_enum("sampler", "dpmpp_2m");
    graph
        .node_mut(sampler_id)
        .unwrap()
        .values
        .set_enum("scheduler", "karras");
    graph
        .node_mut(sampler_id)
        .unwrap()
        .values
        .set_number("steps", 32.0);
    graph
        .node_mut(sampler_id)
        .unwrap()
        .values
        .set_number("cfg", 9.5);
    graph
        .node_mut(sampler_id)
        .unwrap()
        .values
        .set_number("denoise", 0.8);

    // Wire a seed node in with a value.
    let seed_id = graph.nodes.iter().find(|n| n.kind == "seed").unwrap().id;
    graph.node_mut(seed_id).unwrap().values.set_text("seed", "4242");
    assert!(graph.connect(wire(seed_id, "seed", sampler_id, "seed")));

    // The LoRA stack is already wired into the checkpoint; give it a row.
    let lora_id = graph.nodes.iter().find(|n| n.kind == "lora").unwrap().id;
    graph.node_mut(lora_id).unwrap().values.loras.push(LoraEntry {
        name: "ink.pt".into(),
        weight: "0.75".into(),
    });

    let form = to_form(&graph, "native").expect("a fully wired graph flattens");
    assert_eq!(form.provider, "native");
    assert_eq!(form.prompt, "a lighthouse in fog");
    assert_eq!(form.negative_prompt, "blur");
    assert_eq!(form.checkpoint, "sd-v1-5");
    assert_eq!(form.vae, "vae-ft-mse");
    assert_eq!(form.clip_skip, "2");
    assert_eq!(form.sampler, "dpmpp_2m");
    assert_eq!(form.scheduler, "karras");
    assert_eq!(form.steps, "32");
    assert_eq!(form.cfg, "9.5");
    assert_eq!(form.denoise, "0.80");
    assert_eq!(form.width, "768");
    assert_eq!(form.height, "512");
    assert_eq!(form.batch, "4");
    assert_eq!(form.seed, "4242");
    assert_eq!(form.loras.len(), 1);
    assert_eq!(form.loras[0].name, "ink.pt");
    assert_eq!(form.loras[0].weight, "0.75");
}

#[test]
fn an_unwired_lora_row_never_reaches_the_request() {
    let mut graph = starter_graph();

    let lora_id = graph.nodes.iter().find(|n| n.kind == "lora").unwrap().id;
    graph.node_mut(lora_id).unwrap().values.loras.push(LoraEntry {
        name: "unwired.pt".into(),
        weight: "0.5".into(),
    });

    let prompt_id = graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;
    graph.node_mut(prompt_id).unwrap().values.set_text("prompt", "x");

    // The starter graph already wires LoRA -> Checkpoint -> sampler, so
    // the row is in scope; detach it and the row disappears.
    let checkpoint_id = graph
        .nodes
        .iter()
        .find(|n| n.kind == "checkpoint")
        .unwrap()
        .id;
    let checkpoint_lora_wire = graph
        .inputs_of(checkpoint_id)
        .into_iter()
        .find(|w| w.to_port == "loras")
        .unwrap()
        .clone();
    graph.wires.retain(|w| *w != checkpoint_lora_wire);

    let form = to_form(&graph, "native").unwrap();
    assert!(form.loras.is_empty(), "unwired LoRA rows must not reach the request");

    // Re-wire it and the row is in scope again.
    assert!(graph.connect(checkpoint_lora_wire));
    let form = to_form(&graph, "native").unwrap();
    assert_eq!(form.loras.len(), 1);
}

#[test]
fn a_graph_without_a_sampler_or_prompt_reports_why() {
    let graph = Graph::default();
    assert_eq!(to_form(&graph, "native"), Err(GraphError::NoSampler));

    // A sampler with no prompt attached.
    let mut graph = starter_graph();
    let sampler_id = graph.nodes.iter().find(|n| n.kind == "sampler").unwrap().id;
    let prompt_wire = graph
        .inputs_of(sampler_id)
        .into_iter()
        .find(|w| w.to_port == "conditioning")
        .unwrap()
        .clone();
    graph.wires.retain(|w| *w != prompt_wire);
    assert_eq!(to_form(&graph, "native"), Err(GraphError::NoPrompt));

    // A prompt that is attached but blank.
    assert!(graph.connect(prompt_wire));
    let prompt_id = graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;
    graph
        .node_mut(prompt_id)
        .unwrap()
        .values
        .set_text("prompt", "  ");
    assert_eq!(to_form(&graph, "native"), Err(GraphError::NoPromptText));

    assert_eq!(
        GraphError::NoSampler.to_string(),
        "Add a KSampler node to generate."
    );
}

#[test]
fn a_graph_without_a_latent_node_still_generates() {
    let mut graph = starter_graph();
    let latent_id = graph.nodes.iter().find(|n| n.kind == "latent").unwrap().id;
    let sampler_id = graph.nodes.iter().find(|n| n.kind == "sampler").unwrap().id;
    let latent_wire = graph
        .inputs_of(sampler_id)
        .into_iter()
        .find(|w| w.to_port == "latent")
        .unwrap()
        .clone();
    graph.wires.retain(|w| *w != latent_wire);
    graph.remove_node(latent_id);

    let prompt_id = graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;
    graph.node_mut(prompt_id).unwrap().values.set_text("prompt", "x");

    let form = to_form(&graph, "native").unwrap();
    assert_eq!(form.batch, "1");
    // Blank width/height: the core falls back to its default size.
    assert_eq!(form.width, "");
    assert_eq!(form.height, "");
}

#[test]
fn the_seed_lock_reads_from_the_wired_seed_node() {
    let mut graph = starter_graph();
    let sampler_id = graph.nodes.iter().find(|n| n.kind == "sampler").unwrap().id;
    let seed_id = graph.nodes.iter().find(|n| n.kind == "seed").unwrap().id;

    graph.connect(wire(seed_id, "seed", sampler_id, "seed"));

    assert!(!seed_locked(&graph));
    graph
        .node_mut(seed_id)
        .unwrap()
        .values
        .set_text("seed_locked", "locked");
    assert!(seed_locked(&graph));

    // Detach it and the lock is gone with the wire.
    graph.wires.clear();
    assert!(!seed_locked(&graph));
}

#[test]
fn default_values_are_sane_for_every_kind() {
    let empty = NodeValues::default();
    assert!(empty.text("checkpoint").is_none());
    for kind in ["checkpoint", "lora", "prompt", "sampler", "latent", "seed"] {
        let node = node(9, kind, 0.0, 0.0);
        assert_eq!(node.kind, kind);
        assert_eq!(node.values, default_values(kind));
    }
}

#[test]
fn the_tables_the_palette_offers_are_complete_and_sane() {
    assert_eq!(SAMPLERS.len(), 9);
    assert_eq!(SCHEDULERS.len(), 7);
    assert_eq!(ASPECT_PRESETS, vec!["1:1", "4:3", "3:4", "16:9", "9:16"]);
    // Port kinds on the sampler line up with the families they carry.
    let sampler = node_def("sampler").unwrap();
    let kinds: Vec<PortKind> = sampler.inputs.iter().map(|p| p.kind).collect();
    assert_eq!(
        kinds,
        vec![
            PortKind::Model,
            PortKind::Conditioning,
            PortKind::Latent,
            PortKind::Seed,
        ]
    );
    let seed = node_def("seed").unwrap();
    assert_eq!(seed.outputs[0].kind, PortKind::Seed);
}