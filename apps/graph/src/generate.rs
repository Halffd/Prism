//! Turning a drawn canvas into images.
//!
//! The flatten step (`prism_core::graph_request::to_form`) already lives in
//! the core; this module maps that form onto the core's own `MediaRequest`
//! and drives the backends. Every rule stays where it belongs: defaults,
//! clamps, sampler names, request bodies, seed resolution and response
//! parsing are all core functions. The canvas only moves bytes.
//!
//! The mapping is a pure function so `cargo test -p prism-graph` can cover
//! it on the host; only the `fetch` calls are wasm-only.

use prism_core::graph_request::GraphForm;
use prism_core::media::{LoraSpec, MediaRequest};

/// One generated image, ready for an `<img>`.
#[derive(Debug, Clone)]
pub struct GeneratedImage {
    /// A `data:` URL or a remote URL — both render in an `<img src>`.
    pub url: String,
    pub label: String,
}

/// Trim a form string to `None` when it is blank, matching the host's
/// "blank means none" convention.
fn text_or_none(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn parse_f64(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

fn parse_u32(value: &str) -> Option<u32> {
    value.trim().parse::<u32>().ok()
}

/// Parse an optional whole number. Blank is `Ok(None)`; a non-number is an
/// error naming the knob, so the user is told which field to fix.
fn required_u32(raw: &str, label: &str) -> Result<Option<u32>, String> {
    if raw.trim().is_empty() {
        return Ok(None);
    }
    parse_u32(raw).map(Some).ok_or_else(|| format!("{label} is not a whole number: {raw:?}"))
}

/// Same, for the decimal knobs (CFG's 0.1 steps, denoise strength).
fn required_f64(raw: &str, label: &str) -> Result<Option<f64>, String> {
    if raw.trim().is_empty() {
        return Ok(None);
    }
    parse_f64(raw).map(Some).ok_or_else(|| format!("{label} is not a number: {raw:?}"))
}

/// Map a flattened form onto the core's request shape.
///
/// A blank seed becomes `None` and the core decides: the native renderer
/// derives one deterministically from the prompt and the clock, and A1111
/// sends `-1` for "random". Restating that rule here would let the canvas
/// and the panel disagree about what an empty seed means.
///
/// A malformed number is an error rather than a silent zero: a user who
/// typed "abc" into CFG should be told, not handed a guidance scale of 0.
pub fn to_media_request(form: &GraphForm, base_url: &str) -> Result<MediaRequest, String> {
    let mut request = MediaRequest {
        provider: form.provider.clone(),
        base_url: base_url.trim().to_string(),
        prompt: form.prompt.clone(),
        negative_prompt: text_or_none(&form.negative_prompt),
        model: text_or_none(&form.checkpoint),
        vae: text_or_none(&form.vae),
        ..Default::default()
    };

    request.clip_skip = required_u32(&form.clip_skip, "CLIP skip")?;
    request.steps = required_u32(&form.steps, "Steps")?;
    request.batch = required_u32(&form.batch, "Batch")?;
    request.cfg = required_f64(&form.cfg, "CFG")?;
    request.denoise = required_f64(&form.denoise, "Denoise")?;

    // A blank size is `None`, and the core falls back to the aspect ratio
    // the Latent node owns. A non-blank nonsense size is still an error.
    request.width = required_u32(&form.width, "Width")?;
    request.height = required_u32(&form.height, "Height")?;

    if !form.sampler.trim().is_empty() {
        request.sampler = Some(form.sampler.trim().to_string());
    }
    if !form.scheduler.trim().is_empty() {
        request.scheduler = Some(form.scheduler.trim().to_string());
    }

    for lora in &form.loras {
        let name = lora.name.trim();
        if name.is_empty() {
            continue;
        }
        // A blank weight is the adapter's trained strength, which is 1.0.
        let weight = if lora.weight.trim().is_empty() {
            1.0
        } else {
            match parse_f64(&lora.weight) {
                Some(value) => value,
                None => {
                    return Err(format!(
                        "the weight for LoRA {name:?} is not a number: {:?}",
                        lora.weight
                    ))
                }
            }
        };
        request.loras.push(LoraSpec {
            name: name.to_string(),
            weight,
        });
    }

    Ok(request)
}

/// Generate from a canvas. The native backend renders in-process; the
/// remote backends POST to the local install and parse the reply with the
/// core's own parsers.
#[cfg(target_arch = "wasm32")]
pub async fn generate(
    form: &GraphForm,
    base_url: &str,
) -> Result<Vec<GeneratedImage>, String> {
    let request = to_media_request(form, base_url)?;
    match form.provider.as_str() {
        prism_core::media::NATIVE_ID => render_native(&request),
        prism_core::media::A1111_ID => render_a1111(&request).await,
        other => Err(format!(
            "the {other} backend is not wired into this canvas yet"
        )),
    }
}

/// In-process render: one call, since the core lays a batch out as a
/// contact sheet and resolves the seed itself.
#[cfg(target_arch = "wasm32")]
fn render_native(request: &MediaRequest) -> Result<Vec<GeneratedImage>, String> {
    let url = prism_core::native_sd::png_data_url(request)?;
    Ok(vec![GeneratedImage {
        url,
        label: "native preview".to_string(),
    }])
}

/// POST to a local A1111 install and decode the base64 images it returns.
#[cfg(target_arch = "wasm32")]
async fn render_a1111(request: &MediaRequest) -> Result<Vec<GeneratedImage>, String> {
    let body = prism_core::media::a1111_txt2img_body(request);
    let base = request.base_url.trim_end_matches('/');
    let text = post_json(&format!("{base}/sdapi/v1/txt2img"), &body).await?;
    Ok(prism_core::media::a1111_images(&text)?
        .into_iter()
        .enumerate()
        .map(|(index, url)| GeneratedImage {
            url,
            label: format!("a1111 result {}", index + 1),
        })
        .collect())
}

/// POST a JSON body and read the text reply back.
#[cfg(target_arch = "wasm32")]
async fn post_json(url: &str, body: &serde_json::Value) -> Result<String, String> {
    let response = gloo_net::http::Request::post(url)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .map_err(|error| format!("could not build the request: {error:?}"))?
        .send()
        .await
        .map_err(|error| format!("could not reach {url}: {error:?}"))?;
    if !response.ok() {
        return Err(format!("{} from {url}", response.status()));
    }
    response
        .text()
        .await
        .map_err(|error| format!("could not read the reply: {error:?}"))
}

// ---------------------------------------------------------------------------
// Tests — run on the host, no browser involved
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use prism_core::graph_factory::make_node;
    use prism_core::media::NATIVE_ID;

    /// A fully wired canvas: LoRA -> Checkpoint -> Sampler, with a Prompt
    /// and an Empty Latent, and all knobs filled in.
    fn wired_form() -> GraphForm {
        let mut graph = prism_core::graph::Graph::default();
        graph.nodes.push(make_node(1, "lora", 0.0, 0.0).unwrap());
        graph.nodes.push(make_node(2, "checkpoint", 0.0, 200.0).unwrap());
        graph.nodes.push(make_node(3, "prompt", 0.0, 400.0).unwrap());
        graph.nodes.push(make_node(4, "latent", 0.0, 600.0).unwrap());
        graph.nodes.push(make_node(5, "sampler", 400.0, 200.0).unwrap());
        graph.connect(prism_core::graph::Wire::new(1, "loras", 2, "loras"));
        graph.connect(prism_core::graph::Wire::new(2, "model", 5, "model"));
        graph.connect(prism_core::graph::Wire::new(3, "conditioning", 5, "conditioning"));
        graph.connect(prism_core::graph::Wire::new(4, "latent", 5, "latent"));

        graph.node_mut(1).unwrap().values.loras.push(
            prism_core::graph::LoraEntry {
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

        prism_core::graph_request::to_form(&graph, NATIVE_ID).expect("a wired graph flattens")
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
            prism_core::graph_request::LoraForm {
                name: "styled.pt".into(),
                weight: String::new(),
            },
            prism_core::graph_request::LoraForm {
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
        let body = prism_core::media::a1111_txt2img_body(&request);
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
        assert_eq!(prism_core::media::sd_cfg(&request), 9.5);
        assert_eq!(prism_core::media::sd_steps(&request), 20);
        assert_eq!(prism_core::media::sd_size(&request), (768, 512));
        assert_eq!(prism_core::media::sd_sampler(&request), "dpmpp_2m");
    }
}