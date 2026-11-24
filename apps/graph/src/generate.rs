#![cfg(target_arch = "wasm32")]

//! Driving a flattened canvas into images.
//!
//! The mapping from a flattened form to the core's request lives in
//! `prism_core::graph_request::to_media_request`, because the Slint canvas
//! needs the identical one — a canvas that built a different `MediaRequest`
//! for the same drawing would send different bytes for the same picture.
//! Its tests are in the core too.
//!
//! What is left here is browser-only: the `fetch` calls that POST to a local
//! install and the in-process renderer's data URL. Every rule (defaults,
//! clamps, sampler names, request bodies, seed resolution, response parsing)
//! stays a core function; this module only moves bytes.

use prism_core::graph_request::{to_media_request, GraphForm};
use prism_core::media::MediaRequest;

/// One generated image, ready for an `<img>`.
#[derive(Debug, Clone)]
pub struct GeneratedImage {
    /// A `data:` URL or a remote URL — both render in an `<img src>`.
    pub url: String,
    pub label: String,
}

/// Generate from a canvas. The native backend renders in-process; the remote
/// backends POST to the local install and parse the reply with the core's
/// own parsers.
#[cfg(target_arch = "wasm32")]
pub async fn generate(
    form: &GraphForm,
    base_url: &str,
) -> Result<Vec<GeneratedImage>, String> {
    let request = to_media_request(form, base_url)?;
    match form.provider.as_str() {
        prism_core::media::NATIVE_ID => render_native(&request),
        prism_core::media::A1111_ID => render_a1111(&request).await,
        other => Err(format!("the {other} backend is not wired into this canvas yet")),
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