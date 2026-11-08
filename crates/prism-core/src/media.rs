//! Media capabilities: image generation, inpainting, video generation
//! and 3D model generation.
//!
//! These are the non-chat capabilities. They share the core's rules: the
//! core never opens sockets itself (hosts inject a `Transport`), request
//! bodies are built by pure functions so that every target sends the same
//! bytes, and a failure is a value, not a panic.
//!
//! Every provider here is reached over HTTP with a JSON body and returns
//! either a media URL or a task that has to be polled. The polling is left
//! to the host: the core answers one step at a time so that a host can
//! drive it from a UI thread without blocking.

use crate::transport::{HttpRequest, Transport};
use serde::{Deserialize, Serialize};

/// Which media capability a request belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaKind {
    /// Text to image.
    Image,
    /// Image editing with a mask.
    Inpaint,
    /// Text to video.
    Video,
    /// Text to 3D model.
    Model,
}

/// A request for any media capability.
///
/// One shape covers all four capabilities: the fields that do not apply to
/// a capability are simply not set. This keeps one transport path and one
/// result type instead of four near-identical ones.
#[derive(Debug, Clone, Default)]
pub struct MediaRequest {
    /// Provider id (`stability`, `runway`, `meshy`, …).
    pub provider: String,
    /// Base URL of the provider's API.
    pub base_url: String,
    /// Bearer token for the provider.
    pub api_key: String,
    /// The prompt the media is generated from.
    pub prompt: String,
    /// Negative prompt, where the provider supports one.
    pub negative_prompt: Option<String>,
    /// Model id, where the provider selects one by name.
    pub model: Option<String>,
    /// Source image, as a data URL or a remote URL. Used by inpainting
    /// and by image-to-video / image-to-3D.
    pub image: Option<String>,
    /// Mask image, as a data URL. Used by inpainting.
    pub mask: Option<String>,
    /// Output aspect ratio, e.g. `16:9`.
    pub aspect_ratio: Option<String>,
    /// Clip duration in seconds.
    pub duration: Option<u32>,
    /// Random seed.
    pub seed: Option<u64>,
    /// Output format, e.g. `glb` for 3D models.
    pub format: Option<String>,
}

/// What a media request produced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind", content = "value")]
pub enum MediaOutcome {
    /// The media is ready. The value is a URL the host can fetch or show.
    Ready(String),
    /// The provider is still working. The value is a task id to poll.
    Pending(String),
    /// The provider failed. The value is the reason.
    Failed(String),
}

impl MediaOutcome {
    /// Whether the media is ready.
    pub fn is_ready(&self) -> bool {
        matches!(self, MediaOutcome::Ready(_))
    }

    /// Whether the provider is still working.
    pub fn is_pending(&self) -> bool {
        matches!(self, MediaOutcome::Pending(_))
    }

    /// The task id, when the provider is still working.
    pub fn task_id(&self) -> Option<&str> {
        match self {
            MediaOutcome::Pending(id) => Some(id.as_str()),
            _ => None,
        }
    }

    /// The media URL, when the media is ready.
    pub fn url(&self) -> Option<&str> {
        match self {
            MediaOutcome::Ready(url) => Some(url.as_str()),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/// Stability image-generation request body (`POST /v2beta/stable-image/generate`).
pub fn stability_image_body(req: &MediaRequest) -> serde_json::Value {
    serde_json::json!({
        "prompt": req.prompt,
        "output_format": "png",
    })
}

/// Stability inpainting request body.
///
/// The image and the mask are sent as multipart form fields in the real
/// API; the JSON body here carries the textual fields, and the host adds
/// the binary parts. `multipart_fields` lists the parts in order so that
/// every target builds the same multipart body.
pub fn stability_inpaint_fields(req: &MediaRequest) -> Vec<(String, String)> {
    let mut fields = vec![
        ("prompt".to_string(), req.prompt.clone()),
        ("output_format".to_string(), "png".to_string()),
    ];
    if let Some(neg) = &req.negative_prompt {
        fields.push(("negative_prompt".to_string(), neg.clone()));
    }
    fields
}

/// Runway video-generation request body (`POST /v1/image_to_video`).
pub fn runway_video_body(req: &MediaRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "promptText": req.prompt,
        "ratio": req.aspect_ratio.clone().unwrap_or_else(|| "16:9".to_string()),
        "duration": req.duration.unwrap_or(5),
    });
    if let Some(seed) = req.seed {
        body["seed"] = serde_json::json!(seed);
    }
    if let Some(image) = &req.image {
        body["promptImage"] = serde_json::json!(image);
    }
    body
}

/// Meshy 3D-model request body (`POST /v2/text-to-3d`).
pub fn meshy_model_body(req: &MediaRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "mode": "text_to_3d",
        "prompt": req.prompt,
        "art_style": "realistic",
        "negative_prompt": "low quality, low resolution, bad anatomy",
    });
    if let Some(image) = &req.image {
        body["mode"] = serde_json::json!("image_to_3d");
        body["image_url"] = serde_json::json!(image);
    }
    body
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/// Pull a media URL out of a provider response.
///
/// The providers disagree about where the URL lives, so the known keys are
/// tried in order. A response that carries none of them is a failure, not
/// an empty success.
pub fn parse_media_url(body: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON: {e}"))?;
    for key in ["url", "image", "output", "video"] {
        if let Some(s) = v.get(key).and_then(|i| i.as_str()) {
            if !s.is_empty() {
                return Ok(s.to_string());
            }
        }
    }
    // Nested shapes: `{ "output": { "url": ... } }` and
    // `{ "data": [{ "url": ... }] }`.
    for key in ["output", "data", "result"] {
        match v.get(key) {
            Some(serde_json::Value::Object(map)) => {
                if let Some(s) = map.get("url").and_then(|i| i.as_str()) {
                    if !s.is_empty() {
                        return Ok(s.to_string());
                    }
                }
            }
            Some(serde_json::Value::Array(items)) => {
                for item in items {
                    if let Some(s) = item.get("url").and_then(|i| i.as_str()) {
                        if !s.is_empty() {
                            return Ok(s.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Err("no media URL in response".to_string())
}

/// Pull a task id out of a provider response.
///
/// Providers that work asynchronously answer with a task id first; the
/// host polls with it until the task is done.
pub fn parse_task_id(body: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON: {e}"))?;
    for key in ["task_id", "taskId", "id", "result"] {
        if let Some(s) = v.get(key).and_then(|i| i.as_str()) {
            if !s.is_empty() {
                return Ok(s.to_string());
            }
        }
    }
    if let Some(s) = v
        .get("result")
        .and_then(|r| r.get("task_id"))
        .and_then(|i| i.as_str())
    {
        if !s.is_empty() {
            return Ok(s.to_string());
        }
    }
    Err("no task id in response".to_string())
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

/// Default base URL of a media provider.
pub fn default_base_url(provider: &str) -> &'static str {
    match provider {
        "stability" => "https://api.stability.ai/v2beta",
        "huggingface" => "https://api-inference.huggingface.co/models",
        "fireworks" => "https://api.fireworks.ai/inference/v1",
        "runway" => "https://api.dev.runwayml.com/v1",
        "kling" => "https://api.klingai.com/v1",
        "luma" => "https://api.lumalabs.ai/dream-machine/v1",
        "meshy" => "https://api.meshy.ai/v2",
        "tripo" => "https://api.tripo3d.ai/v2/openapi",
        _ => "",
    }
}

/// Whether the provider works asynchronously (it answers with a task id
/// that has to be polled).
pub fn is_async_provider(provider: &str) -> bool {
    matches!(
        provider,
        "runway" | "kling" | "luma" | "meshy" | "tripo"
    )
}

/// Sends a media request and reads the provider's answer.
///
/// A provider that works asynchronously answers with a task id, which is
/// returned as `Pending`. The host polls with [`poll_media`] until the
/// task is done.
pub async fn run_media<T: Transport + ?Sized>(
    transport: &T,
    kind: MediaKind,
    req: &MediaRequest,
) -> Result<MediaOutcome, String> {
    let base = if req.base_url.trim().is_empty() {
        default_base_url(&req.provider).to_string()
    } else {
        req.base_url.trim().trim_end_matches('/').to_string()
    };
    if base.is_empty() {
        return Err(format!("unknown media provider: {}", req.provider));
    }

    let (url, body, extra_headers) = match kind {
        MediaKind::Image => (
            match req.provider.as_str() {
                "stability" => format!("{base}/stable-image/generate"),
                _ => format!("{base}"),
            },
            stability_image_body(req),
            Vec::new(),
        ),
        MediaKind::Inpaint => (
            format!("{base}/stable-image/edit/inpaint"),
            serde_json::json!({}),
            Vec::new(),
        ),
        MediaKind::Video => (
            match req.provider.as_str() {
                "runway" => format!("{base}/image_to_video"),
                "kling" => format!("{base}/videos/image2video"),
                "luma" => format!("{base}/generations"),
                _ => format!("{base}"),
            },
            runway_video_body(req),
            vec![("X-Runway-Version".to_string(), "2024-11-06".to_string())],
        ),
        MediaKind::Model => (
            match req.provider.as_str() {
                "meshy" => format!("{base}/text-to-3d"),
                "tripo" => format!("{base}/task"),
                _ => format!("{base}"),
            },
            meshy_model_body(req),
            Vec::new(),
        ),
    };

    let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
    if !req.api_key.is_empty() {
        headers.push(("Authorization".to_string(), format!("Bearer {}", req.api_key)));
    }
    headers.extend(extra_headers);

    let http_req = HttpRequest {
        url,
        headers,
        body: Some(body.to_string()),
    };
    let resp = transport.post_body(http_req).await?;
    let text = String::from_utf8_lossy(&resp).to_string();

    if is_async_provider(&req.provider) {
        match parse_task_id(&text) {
            Ok(id) => Ok(MediaOutcome::Pending(id)),
            // A provider that is supposed to work asynchronously may still
            // answer with the finished media.
            Err(_) => parse_media_url(&text)
                .map(MediaOutcome::Ready)
                .map_err(|e| format!("{e}: {}", truncate(&text, 200))),
        }
    } else {
        parse_media_url(&text)
            .map(MediaOutcome::Ready)
            .map_err(|e| format!("{e}: {}", truncate(&text, 200)))
    }
}

/// Asks an asynchronous provider about a task.
///
/// Returns `Ready` once the task is done and `Pending` while it is still
/// running. A provider that reports the task as failed answers `Failed`.
pub async fn poll_media<T: Transport + ?Sized>(
    transport: &T,
    provider: &str,
    base_url: &str,
    api_key: &str,
    task_id: &str,
) -> Result<MediaOutcome, String> {
    let base = if base_url.trim().is_empty() {
        default_base_url(provider).to_string()
    } else {
        base_url.trim().trim_end_matches('/').to_string()
    };
    let url = match provider {
        "runway" => format!("{base}/tasks/{task_id}"),
        "kling" => format!("{base}/videos/image2video/{task_id}"),
        "luma" => format!("{base}/generations/{task_id}"),
        "meshy" => format!("{base}/meshy-3d/text-to-3d/{task_id}"),
        "tripo" => format!("{base}/task/{task_id}"),
        other => return Err(format!("unknown media provider: {other}")),
    };

    let mut headers = Vec::new();
    if !api_key.is_empty() {
        headers.push(("Authorization".to_string(), format!("Bearer {}", api_key)));
    }
    headers.push(("X-Runway-Version".to_string(), "2024-11-06".to_string()));

    let http_req = HttpRequest {
        url,
        headers,
        body: None,
    };
    let resp = transport.get_body(http_req).await?;
    let text = String::from_utf8_lossy(&resp).to_string();

    // A task that failed says so in its status.
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    if let Some(status) = v.get("status").and_then(|s| s.as_str()) {
        let status = status.to_ascii_lowercase();
        if status == "failed" || status == "error" || status == "cancelled" {
            let reason = v
                .get("failure_reason")
                .or_else(|| v.get("error"))
                .and_then(|e| e.as_str())
                .unwrap_or(status.as_str());
            return Ok(MediaOutcome::Failed(reason.to_string()));
        }
        if status == "succeeded" || status == "completed" || status == "done" {
            return parse_media_url(&text)
                .map(MediaOutcome::Ready)
                .map_err(|e| format!("{e}: {}", truncate(&text, 200)));
        }
    }

    // Providers that do not report a status answer with the media once
    // it is there.
    match parse_media_url(&text) {
        Ok(url) => Ok(MediaOutcome::Ready(url)),
        Err(_) => Ok(MediaOutcome::Pending(task_id.to_string())),
    }
}

/// Truncate an error excerpt on a char boundary.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &s[..cut])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_plain_url() {
        assert_eq!(
            parse_media_url(r#"{"url":"https://cdn.test/a.png"}"#).unwrap(),
            "https://cdn.test/a.png"
        );
    }

    #[test]
    fn parses_a_nested_url() {
        assert_eq!(
            parse_media_url(r#"{"output":{"url":"https://cdn.test/b.png"}}"#).unwrap(),
            "https://cdn.test/b.png"
        );
    }

    #[test]
    fn parses_a_url_in_a_list() {
        assert_eq!(
            parse_media_url(r#"{"data":[{"url":"https://cdn.test/c.png"}]}"#).unwrap(),
            "https://cdn.test/c.png"
        );
    }

    #[test]
    fn a_response_without_a_url_is_a_failure() {
        assert!(parse_media_url(r#"{"status":"queued"}"#).is_err());
    }

    #[test]
    fn a_broken_body_is_a_failure() {
        assert!(parse_media_url("not json").is_err());
    }

    #[test]
    fn parses_task_ids_in_the_shapes_providers_use() {
        assert_eq!(parse_task_id(r#"{"id":"t1"}"#).unwrap(), "t1");
        assert_eq!(parse_task_id(r#"{"task_id":"t2"}"#).unwrap(), "t2");
        assert_eq!(parse_task_id(r#"{"result":"t3"}"#).unwrap(), "t3");
    }

    #[test]
    fn a_response_without_a_task_id_is_a_failure() {
        assert!(parse_task_id(r#"{"status":"queued"}"#).is_err());
    }

    #[test]
    fn image_body_carries_the_prompt() {
        let req = MediaRequest {
            provider: "stability".into(),
            prompt: "a red fox".into(),
            ..Default::default()
        };
        let body = stability_image_body(&req);
        assert_eq!(body["prompt"], "a red fox");
        assert_eq!(body["output_format"], "png");
    }

    #[test]
    fn video_body_carries_the_prompt_and_ratio() {
        let req = MediaRequest {
            provider: "runway".into(),
            prompt: "a wave".into(),
            aspect_ratio: Some("9:16".into()),
            ..Default::default()
        };
        let body = runway_video_body(&req);
        assert_eq!(body["promptText"], "a wave");
        assert_eq!(body["ratio"], "9:16");
        assert_eq!(body["duration"], 5);
    }

    #[test]
    fn video_body_carries_the_seed_when_given() {
        let req = MediaRequest {
            provider: "runway".into(),
            prompt: "a wave".into(),
            seed: Some(42),
            ..Default::default()
        };
        assert_eq!(runway_video_body(&req)["seed"], 42);
    }

    #[test]
    fn model_body_switches_to_image_mode_with_an_image() {
        let req = MediaRequest {
            provider: "meshy".into(),
            prompt: "a chair".into(),
            image: Some("data:image/png;base64,AAA".into()),
            ..Default::default()
        };
        let body = meshy_model_body(&req);
        assert_eq!(body["mode"], "image_to_3d");
        assert_eq!(body["image_url"], "data:image/png;base64,AAA");
    }

    #[test]
    fn inpaint_fields_carry_the_prompt_and_the_negative_prompt() {
        let req = MediaRequest {
            provider: "stability".into(),
            prompt: "a red fox".into(),
            negative_prompt: Some("blurry".into()),
            ..Default::default()
        };
        let fields = stability_inpaint_fields(&req);
        assert!(fields.contains(&("prompt".to_string(), "a red fox".to_string())));
        assert!(fields.contains(&("negative_prompt".to_string(), "blurry".to_string())));
    }

    #[test]
    fn outcomes_expose_their_state() {
        let ready = MediaOutcome::Ready("https://cdn.test/a.png".into());
        assert!(ready.is_ready());
        assert_eq!(ready.url(), Some("https://cdn.test/a.png"));
        assert_eq!(ready.task_id(), None);

        let pending = MediaOutcome::Pending("t1".into());
        assert!(pending.is_pending());
        assert_eq!(pending.task_id(), Some("t1"));
        assert_eq!(pending.url(), None);
    }
}
