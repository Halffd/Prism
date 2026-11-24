//! Unit tests for the graph store: round-trips, corruption handling,
//! validation and the merge that keeps two apps on one canvas.

use super::graph::{
    Graph, GraphNode, LoraEntry, NodeValues, Wire, NODE_WIDTH,
};
use super::graph_factory::{make_node, starter_graph};
use super::graph_store::{
    apply_and_save, default_graph_root, graph_path, is_valid, load, merge, problems, save,
    GraphDocument, GraphProblem,
};
use super::storage::{FsStorage, Storage};
use std::fs;

/// A temp dir that cleans itself up.
fn tmp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("prism-graph-test-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn the_default_graph_root_honours_the_environment() {
    // Asserts whichever branch is live, so a host (or CI) that configures
    // PRISM_GRAPH_ROOT is not pushed down the fallback path by this test.
    match std::env::var("PRISM_GRAPH_ROOT") {
        Ok(raw) if !raw.trim().is_empty() => {
            assert_eq!(default_graph_root(), std::path::PathBuf::from(raw.trim()));
        }
        _ => {
            let root = default_graph_root();
            assert!(
                root.ends_with("prism-data/graph"),
                "{root:?} should be the checkout-local fallback"
            );
        }
    }
}

fn doc_with(graph: Graph, updated_at: u64) -> GraphDocument {
    GraphDocument::new(graph, updated_at)
}

#[test]
fn a_document_round_trips_through_json() {
    let doc = GraphDocument::new(starter_graph(), 1_700_000_000_000);
    let json = doc.to_json();
    assert!(json.contains("\"app\":\"prism\""));

    let parsed = GraphDocument::from_json(&json).expect("our own JSON parses back");
    assert_eq!(parsed, doc);
    assert_eq!(parsed.graph.nodes.len(), doc.graph.nodes.len());
    assert_eq!(parsed.graph.wires.len(), doc.graph.wires.len());
}

#[test]
fn a_missing_or_corrupt_file_yields_the_starter_drawing() {
    let root = tmp_dir("corrupt");
    let storage = FsStorage;

    // No file at all: a synthetic starter drawing with no write time.
    let fresh = load(&storage, &root, 42);
    assert_eq!(fresh.graph.nodes.len(), 6);
    assert_eq!(fresh.updated_at, 0, "a never-written document has no write time");
    assert!(is_valid(&fresh));

    // A file that is not JSON.
    let path = graph_path(&root);
    storage.write_atomic(&path, "not json").unwrap();
    let recovered = load(&storage, &root, 99);
    assert_eq!(recovered.graph.nodes.len(), 6);
    assert_eq!(recovered.updated_at, 0);

    // JSON, but not a Prism graph document.
    storage.write_atomic(&path, "{\"app\":\"something-else\"}").unwrap();
    let rejected = load(&storage, &root, 100);
    assert_eq!(rejected.graph.nodes.len(), 6);
    assert_eq!(rejected.updated_at, 0);

    // A Prism document whose graph is malformed.
    storage
        .write_atomic(&path, "{\"app\":\"prism\",\"graph\":{\"nodes\":\"nope\"}}")
        .unwrap();
    let broken = load(&storage, &root, 101);
    assert_eq!(broken.graph.nodes.len(), 6);
    assert_eq!(broken.updated_at, 0);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn saving_stamps_the_version_and_timestamp() {
    let root = tmp_dir("stamp");
    let storage = FsStorage;

    let doc = GraphDocument::new(starter_graph(), 1);
    let saved = save(&storage, &root, &doc, 12_345).expect("write");
    assert_eq!(saved.updated_at, 12_345);
    assert_eq!(saved.version, super::graph_store::GRAPH_FORMAT_VERSION);
    assert_eq!(saved.app, "prism");

    // The bytes on disk are what we hand back.
    let text = fs::read_to_string(graph_path(&root)).unwrap();
    let reloaded = GraphDocument::from_json(&text).unwrap();
    assert_eq!(reloaded, saved);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn an_empty_graph_or_a_dangling_wire_is_a_problem() {
    let empty = doc_with(Graph::default(), 1);
    assert_eq!(problems(&empty), vec![GraphProblem::Empty]);
    assert!(!is_valid(&empty));

    // Duplicate node ids.
    let mut graph = starter_graph();
    let clone = graph.nodes[0].clone();
    let duplicate_id = clone.id;
    graph.nodes.push(clone);
    let dup = doc_with(graph, 1);
    assert!(problems(&dup).contains(&GraphProblem::DuplicateNode(duplicate_id)));
    assert!(!is_valid(&dup));

    // A wire to a node that is not in the document.
    let mut graph = starter_graph();
    graph.wires.push(Wire::new(9999, "model", 1, "model"));
    let dangling = doc_with(graph, 1);
    assert!(problems(&dangling).contains(&GraphProblem::WireToMissingNode(9999)));
    assert!(!is_valid(&dangling));

    // A wire to a port the node does not have.
    let mut graph = starter_graph();
    let sampler_id = graph.nodes.iter().find(|n| n.kind == "sampler").unwrap().id;
    let checkpoint_id = graph
        .nodes
        .iter()
        .find(|n| n.kind == "checkpoint")
        .unwrap()
        .id;
    graph
        .wires
        .push(Wire::new(checkpoint_id, "no-such-port", sampler_id, "model"));
    let bad_port = doc_with(graph, 1);
    assert!(problems(&bad_port)
        .iter()
        .any(|p| matches!(p, GraphProblem::WireToMissingPort(id, _) if *id == checkpoint_id)));
    assert!(!is_valid(&bad_port));

    // The starter drawing is valid.
    assert!(is_valid(&doc_with(starter_graph(), 1)));
}

#[test]
fn the_newer_document_wins_its_nodes_and_its_edits() {
    let base = doc_with(starter_graph(), 100);
    let prompt_id = base.graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;

    // The incoming document is newer and edits a prompt plus adds a node.
    let mut incoming = base.clone();
    incoming.updated_at = 200;
    incoming
        .graph
        .node_mut(prompt_id)
        .unwrap()
        .values
        .set_text("prompt", "a newer prompt");
    let mut extra: GraphNode = make_node(1001, "seed", 700.0, 700.0).unwrap();
    extra.values.set_text("seed", "77");
    incoming.graph.nodes.push(extra.clone());

    let merged = merge(&base, &incoming);
    assert_eq!(
        merged.graph.nodes.len(),
        incoming.graph.nodes.len(),
        "the newer document's node set is authoritative"
    );
    assert_eq!(
        merged
            .graph
            .node(prompt_id)
            .unwrap()
            .values
            .text("prompt"),
        Some("a newer prompt"),
        "the newer edit wins"
    );
    assert_eq!(merged.updated_at, 200, "the newer timestamp is kept");
    assert!(is_valid(&merged));
}

#[test]
fn a_deletion_travels_to_the_other_app() {
    let base = doc_with(starter_graph(), 100);
    let prompt_id = base.graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;

    // The newer document deleted the prompt node.
    let mut incoming = base.clone();
    incoming.updated_at = 250;
    incoming.graph.remove_node(prompt_id);

    let merged = merge(&base, &incoming);
    assert!(
        merged.graph.node(prompt_id).is_none(),
        "a delete written by a newer peer must not be resurrected"
    );
    assert!(
        merged
            .graph
            .wires
            .iter()
            .all(|w| w.from_node != prompt_id && w.to_node != prompt_id),
        "its wires go with it"
    );
    assert!(is_valid(&merged));
}

#[test]
fn a_stale_document_adds_nothing() {
    let base = doc_with(starter_graph(), 500);

    // The local copy has an edit and is newer.
    let mut local = base.clone();
    let lora_id = local.graph.nodes.iter().find(|n| n.kind == "lora").unwrap().id;
    local.graph.node_mut(lora_id).unwrap().values.loras.push(LoraEntry {
        name: "local.pt".into(),
        weight: "0.9".into(),
    });

    // The peer's write is older and unrelated.
    let mut stale = base.clone();
    stale.updated_at = 100;

    let merged = merge(&local, &stale);
    assert_eq!(
        merged.graph.node(lora_id).unwrap().values.loras.len(),
        1,
        "the local edit survives a stale peer"
    );
    assert_eq!(merged.updated_at, 500);
}

#[test]
fn an_older_document_cannot_roll_back_a_newer_local_edit() {
    let base = doc_with(starter_graph(), 500);
    let prompt_id = base.graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;

    let mut local = base.clone();
    local
        .graph
        .node_mut(prompt_id)
        .unwrap()
        .values
        .set_text("prompt", "the local edit");

    // The remote copy is stale and still holds the old text.
    let mut incoming = base.clone();
    incoming.updated_at = 250;
    incoming
        .graph
        .node_mut(prompt_id)
        .unwrap()
        .values
        .set_text("prompt", "the stale text");

    let merged = merge(&local, &incoming);
    assert_eq!(
        merged.graph.node(prompt_id).unwrap().values.text("prompt"),
        Some("the local edit"),
        "a stale peer must not roll back the newer local value"
    );
}

#[test]
fn a_merge_drops_wires_whose_endpoints_vanished() {
    let base = doc_with(starter_graph(), 100);
    let prompt_id = base.graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;

    // The local copy has prompt -> sampler; the incoming (newer) copy
    // still has the node but lost the wire.
    let mut incoming = base.clone();
    incoming.updated_at = 300;
    let sampler_id = incoming
        .graph
        .nodes
        .iter()
        .find(|n| n.kind == "sampler")
        .unwrap()
        .id;
    incoming
        .graph
        .wires
        .retain(|w| !(w.to_node == sampler_id && w.to_port == "conditioning"));

    let merged = merge(&base, &incoming);
    assert_eq!(merged.updated_at, 300);
    assert!(merged.graph.node(prompt_id).is_some());
    assert!(
        merged
            .graph
            .wires
            .iter()
            .all(|w| !(w.to_node == sampler_id && w.to_port == "conditioning")),
        "a wire the newer peer dropped is not resurrected"
    );
    assert!(is_valid(&merged));
}

#[test]
fn a_merge_adopts_a_wire_the_local_copy_never_saw() {
    let base = doc_with(starter_graph(), 100);
    let prompt_id = base.graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;
    let sampler_id = base.graph.nodes.iter().find(|n| n.kind == "sampler").unwrap().id;
    let _ = (prompt_id, sampler_id);

    // Locally, detach the prompt and stamp ourselves as the older write.
    let mut local = base.clone();
    let prompt_wire = local
        .graph
        .inputs_of(sampler_id)
        .into_iter()
        .find(|w| w.to_port == "conditioning")
        .unwrap()
        .clone();
    local.graph.wires.retain(|w| *w != prompt_wire);
    local.updated_at = 150;

    // The peer kept the wire and wrote later, so it is authoritative.
    let mut peer = base.clone();
    peer.updated_at = 200;

    let merged = merge(&local, &peer);
    assert!(
        merged.graph.wires.contains(&prompt_wire),
        "a wire the newer peer still has is kept"
    );
    assert!(is_valid(&merged));
}

#[test]
fn applying_an_invalid_document_leaves_the_local_one_intact() {
    let root = tmp_dir("invalid-apply");
    let storage = FsStorage;
    let local = doc_with(starter_graph(), 500);

    let broken = GraphDocument::new(Graph::default(), 900);
    let saved = apply_and_save(&storage, &root, &local, &broken, 999).unwrap();

    assert_eq!(saved.graph.nodes.len(), local.graph.nodes.len());
    assert_eq!(saved.updated_at, 999);
    assert!(is_valid(&saved));

    // A valid incoming document is merged in.
    let mut improved = doc_with(starter_graph(), 600);
    let prompt_id = improved
        .graph
        .nodes
        .iter()
        .find(|n| n.kind == "prompt")
        .unwrap()
        .id;
    improved
        .graph
        .node_mut(prompt_id)
        .unwrap()
        .values
        .set_text("prompt", "from the wire");
    let saved = apply_and_save(&storage, &root, &local, &improved, 1000).unwrap();
    assert_eq!(
        saved.graph.node(prompt_id).unwrap().values.text("prompt"),
        Some("from the wire")
    );

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn the_document_carries_the_view_so_a_reopen_lands_where_you_left_off() {
    let mut doc = doc_with(starter_graph(), 1);
    doc.view.pan_x = -240.0;
    doc.view.pan_y = 88.0;
    doc.view.zoom = 1.5;

    let parsed = GraphDocument::from_json(&doc.to_json()).unwrap();
    assert_eq!(parsed.view.pan_x, -240.0);
    assert_eq!(parsed.view.pan_y, 88.0);
    assert_eq!(parsed.view.zoom, 1.5);
}

#[test]
fn a_foreign_json_document_is_rejected() {
    assert!(GraphDocument::from_json("{}").is_none());
    assert!(GraphDocument::from_json("not json at all").is_none());
    assert!(GraphDocument::from_json("{\"app\":\"other\",\"graph\":{}}").is_none());
}

#[test]
fn a_merge_never_produces_an_invalid_document() {
    // Property-ish: apply a sequence of increasingly fresh documents and
    // require every intermediate result to stay renderable.
    let base = doc_with(starter_graph(), 100);
    let prompt_id = base.graph.nodes.iter().find(|n| n.kind == "prompt").unwrap().id;
    let lora_id = base.graph.nodes.iter().find(|n| n.kind == "lora").unwrap().id;

    // 1. An edit arrives.
    let mut edited = base.clone();
    edited.updated_at = 200;
    edited.graph.node_mut(lora_id).unwrap().values.loras.push(LoraEntry {
        name: "extra.pt".into(),
        weight: "0.4".into(),
    });

    // 2. A stale document arrives out of order; the newer edit survives.
    let mut stale = base.clone();
    stale.updated_at = 150;

    // 3. The prompt is deleted.
    let mut deleted = edited.clone();
    deleted.updated_at = 300;
    deleted.graph.remove_node(prompt_id);

    // 4. A node is added on top of the deletion.
    let mut added = deleted.clone();
    added.updated_at = 400;
    added.graph.nodes.push(make_node(2001, "seed", 40.0, 40.0).unwrap());

    let order = [edited, stale, deleted, added];
    let expected_after_delete = order[order.len() - 1].graph.nodes.len();

    let mut current = base.clone();
    for variant in &order {
        current = merge(&current, variant);
        assert!(is_valid(&current), "merge produced an invalid document");
    }
    assert!(current.graph.node(prompt_id).is_none(), "the delete stuck");
    assert_eq!(current.graph.nodes.len(), expected_after_delete);
}

#[test]
fn a_node_value_survives_a_serialization_round_trip() {
    let mut doc = doc_with(starter_graph(), 1);
    let sampler_id = doc.graph.nodes.iter().find(|n| n.kind == "sampler").unwrap().id;
    doc.graph
        .node_mut(sampler_id)
        .unwrap()
        .values
        .set_enum("sampler", "dpmpp_2m_sde");
    let mut blank = NodeValues::default();
    blank.set_number("cfg", 9.5);

    let parsed = GraphDocument::from_json(&doc.to_json()).unwrap();
    assert_eq!(
        parsed
            .graph
            .node(sampler_id)
            .unwrap()
            .values
            .enumeration("sampler"),
        Some("dpmpp_2m_sde")
    );
    let _ = (NODE_WIDTH, blank);
}