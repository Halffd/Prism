//! Unit tests for the graph model and the flatten step — no browser, no
//! UI framework, no Stable Diffusion rules.

use super::graph_factory::{default_values, make_node, starter_graph, ASPECT_PRESETS, SCHEDULERS, SAMPLERS};
use super::graph::{
    port_position, wire_bezier, wire_bezier_at, wire_path, Graph, GraphNode, LoraEntry, NodeValues,
    PortKind, Wire, NODE_WIDTH,
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
fn the_bezier_control_points_bend_horizontally_toward_the_gap() {
    // Every surface draws from these four points — the Dioxus canvas's SVG
    // string, the Slint canvas's sampled polyline, and hit-testing. One
    // definition means they cannot draw different wires.
    let (start, c1, c2, end) = wire_bezier((10.0, 20.0), (110.0, 80.0));
    assert_eq!(start, (10.0, 20.0));
    assert_eq!(end, (110.0, 80.0));
    // Half the horizontal gap (100 / 2 = 50), leaving each socket flat.
    assert_eq!(c1, (60.0, 20.0));
    assert_eq!(c2, (60.0, 80.0));
}

#[test]
fn a_narrow_gap_still_gets_a_usable_bend() {
    // Under 80px of gap, half the gap would be a hairpin, so the bend
    // floors at 40px — the reason a short wire still reads as a cable.
    let from = (100.0, 50.0);
    let to = (140.0, 50.0);
    let (start, c1, _, _) = wire_bezier(from, to);
    assert_eq!(c1.0 - start.0, 40.0);
    assert_eq!(c1.1, start.1, "the control point leaves horizontally");
}

#[test]
fn the_sampled_curve_starts_and_ends_on_the_sockets() {
    // A polyline is not exact, but its first and last samples must be, or a
    // wire visibly detaches from the socket it came from.
    let from = (10.0, 20.0);
    let to = (110.0, 80.0);
    assert_eq!(wire_bezier_at(from, to, 0.0), from);
    assert_eq!(wire_bezier_at(from, to, 1.0), to);

    // The midpoint sits exactly on the chord here, because each control
    // point is level with its own socket — that is worth stating, since it
    // is the one place a chord and this curve agree. A quarter of the way
    // in, the curve has already dipped below the straight line, which is
    // what makes a wire read as a cable rather than a chord.
    let mid = wire_bezier_at(from, to, 0.5);
    assert_eq!(mid, (60.0, 50.0));
    let quarter = wire_bezier_at(from, to, 0.25);
    assert_ne!(quarter, (35.0, 35.0));
    assert!(quarter.1 < 35.0, "the curve dips below the chord: {quarter:?}");

    // The SVG path and the sampled curve agree: the string's control points
    // are the ones the sampler walks.
    let path = wire_path(from, to);
    assert!(path.starts_with("M 10.0 20.0"), "{path}");
    assert!(path.contains("60.0 20.0"), "{path}");
    assert!(path.ends_with("110.0 80.0"), "{path}");
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
/// The form-to-request mapping is the seam every surface crosses, so its
/// tests live beside the mapper in `graph_request`, not in one host.
#[cfg(test)]
mod mapping_tests {
    use super::*;
    use crate::graph_factory::make_node;
    use crate::graph_request::{to_form, to_media_request, GraphForm, LoraForm};
    use crate::media::NATIVE_ID;

    /// A fully wired canvas: LoRA -> Checkpoint -> Sampler, with a Prompt
    /// and an Empty Latent, and all knobs filled in.
    fn wired_form() -> GraphForm {
        let mut graph = crate::graph::Graph::default();
        graph.nodes.push(make_node(1, "lora", 0.0, 0.0).unwrap());
        graph.nodes.push(make_node(2, "checkpoint", 0.0, 200.0).unwrap());
        graph.nodes.push(make_node(3, "prompt", 0.0, 400.0).unwrap());
        graph.nodes.push(make_node(4, "latent", 0.0, 600.0).unwrap());
        graph.nodes.push(make_node(5, "sampler", 400.0, 200.0).unwrap());
        graph.connect(crate::graph::Wire::new(1, "loras", 2, "loras"));
        graph.connect(crate::graph::Wire::new(2, "model", 5, "model"));
        graph.connect(crate::graph::Wire::new(3, "conditioning", 5, "conditioning"));
        graph.connect(crate::graph::Wire::new(4, "latent", 5, "latent"));

        graph.node_mut(1).unwrap().values.loras.push(
            crate::graph::LoraEntry {
                name: "detail.pt".into(),
                weight: "0.6".into(),
            },
        );
        graph.node_mut(2).unwrap().values.set_text("checkpoint", "sd15.safetensors");
        graph.node_mut(2).unwrap().values.set_number("clip_skip", 2.0);
        graph.node_mut(3).unwrap().values.set_text("prompt", "a lighthouse in fog");
        graph.node_mut(4).unwrap().values.set_number("width", 768.0);
        graph.node_mut(4).unwrap().values.set_number("height", 512.0);
        graph.node_mut(5).unwrap().values.set_enum("sampler", "dpmpp_2m");
        graph.node_mut(5).unwrap().values.set_number("cfg", 9.5);
        graph.node_mut(5).unwrap().values.set_number("denoise", 0.85);

        crate::graph_request::to_form(&graph, NATIVE_ID).expect("a wired graph flattens")
    }

    #[test]
    fn a_flattened_form_maps_onto_the_core_request() {
        let form = wired_form();
        let request = to_media_request(&form, "http://127.0.0.1:7861/").expect("maps");

        assert_eq!(request.provider, "native");
        assert_eq!(request.prompt, "a lighthouse in fog");
        assert_eq!(request.model.as_deref(), Some("sd15.safetensors"));
        assert_eq!(request.width, Some(768));
        assert_eq!(request.height, Some(512));
        assert_eq!(request.clip_skip, Some(2));
        assert_eq!(request.steps, Some(20));
        assert_eq!(request.batch, Some(1));
        // A fractional CFG survives the mapping: this is where a naive
        // integer cast would quietly turn 9.5 into 9.
        assert_eq!(request.cfg, Some(9.5));
        assert_eq!(request.denoise, Some(0.85));
        assert_eq!(request.sampler.as_deref(), Some("dpmpp_2m"));
        assert_eq!(request.loras.len(), 1);
        assert_eq!(request.loras[0].name, "detail.pt");
        assert_eq!(request.loras[0].weight, 0.6);
    }

    #[test]
    fn a_blank_seed_is_left_for_the_core_to_resolve() {
        let form = wired_form();
        assert!(form.seed.trim().is_empty());
        let request = to_media_request(&form, "").expect("maps");
        // The canvas does not invent a seed: the native renderer derives
        // one, and A1111 sends -1.
        assert_eq!(request.seed, None);
    }

    #[test]
    fn blank_fields_become_none_rather_than_empty_strings() {
        let mut form = wired_form();
        form.checkpoint = "  ".into();
        form.vae = String::new();
        form.negative_prompt = String::new();
        let request = to_media_request(&form, "").expect("maps");
        assert_eq!(request.model, None);
        assert_eq!(request.vae, None);
        assert_eq!(request.negative_prompt, None);
    }

    #[test]
    fn a_blank_size_is_allowed_but_a_nonsense_one_is_not() {
        // Blank: the core falls back to the aspect ratio.
        let mut form = wired_form();
        form.width = String::new();
        form.height = "   ".into();
        let request = to_media_request(&form, "").expect("maps");
        assert_eq!(request.width, None);

        // Nonsense: an error, not a silent zero.
        form.height = "tall".into();
        let error = to_media_request(&form, "").expect_err("a bad size");
        assert!(error.contains("Height"), "{error}");
    }

    #[test]
    fn a_malformed_cfg_is_reported_rather_than_silently_dropped() {
        let mut form = wired_form();
        form.cfg = "high".into();
        let error = to_media_request(&form, "").expect_err("a bad cfg");
        assert!(error.contains("CFG"), "{error}");
        // And a legitimate fractional cfg still works.
        form.cfg = "7.5".into();
        assert_eq!(to_media_request(&form, "").unwrap().cfg, Some(7.5));
    }

    #[test]
    fn a_lora_weight_defaults_to_the_trained_strength() {
        let mut form = wired_form();
        form.loras = vec![
            crate::graph_request::LoraForm {
                name: "styled.pt".into(),
                weight: String::new(),
            },
            crate::graph_request::LoraForm {
                name: " ".into(),
                weight: "0.8".into(),
            },
        ];
        let request = to_media_request(&form, "").expect("maps");
        // The named LoRA keeps the core's default; the nameless one is
        // dropped because a LoRA with no name cannot be loaded.
        assert_eq!(request.loras.len(), 1);
        assert_eq!(request.loras[0].name, "styled.pt");
        assert_eq!(request.loras[0].weight, 1.0);
    }

    #[test]
    fn the_native_body_builds_from_the_mapped_request() {
        // The mapping has to reach a body the core can actually send; a
        // field set that parses but produces an empty body would pass the
        // shape tests above and still generate nothing.
        let form = wired_form();
        let request = to_media_request(&form, "").expect("maps");
        let body = crate::media::a1111_txt2img_body(&request);
        assert_eq!(
            body["prompt"], "a lighthouse in fog <lora:detail.pt:0.6>",
            "A1111 has no LoRA column, so the core folds the rows into the prompt \
             as <lora> tags — the canvas must not re-state that rule"
        );
        assert_eq!(body["width"], 768);
        assert_eq!(body["cfg_scale"], 9.5);
        // A blank seed reaches the wire as A1111's "random".
        assert_eq!(body["seed"], -1);

        // The core's own accessors agree with the shape the canvas sent:
        // the fractional CFG survives, and the size comes back as set.
        assert_eq!(crate::media::sd_cfg(&request), 9.5);
        assert_eq!(crate::media::sd_steps(&request), 20);
        assert_eq!(crate::media::sd_size(&request), (768, 512));
        assert_eq!(crate::media::sd_sampler(&request), "dpmpp_2m");
    }
}