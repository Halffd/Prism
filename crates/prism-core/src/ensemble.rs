//! Multi-model orchestration: fan-out completions, councils, and debates.
//!
//! These are the same primitives the old Ink TUI exposed as
//! "multi-send", "council" and "debate", implemented over the core
//! transport instead of a Node-only client. Every surface (CLI, Slint,
//! future hosts) passes resolved [`CompletionTarget`]s, so provider
//! keys, base URLs and custom endpoints resolve exactly like a normal
//! chat turn.

use crate::client::ChatMessage;
use crate::providers;
use crate::settings::Settings;
use crate::transport::{HttpRequest, Transport};
use serde::{Deserialize, Serialize};

/// One concrete model endpoint a fan-out can call.
#[derive(Debug, Clone, PartialEq)]
pub struct CompletionTarget {
    /// Display label ("OpenAI", "gpt-4o", …).
    pub label: String,
    /// Provider id (`openai`, `ollama`, a custom id).
    pub provider: String,
    /// OpenAI-compatible base URL, no trailing slash.
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: Option<u32>,
    /// Static provider headers (custom providers only).
    pub headers: Vec<(String, String)>,
}

impl CompletionTarget {
    /// Resolve one provider into a callable target. `model` empty falls
    /// back to the provider's default. `None` for unknown providers.
    pub fn from_settings(settings: &Settings, provider: &str, model: &str) -> Option<Self> {
        let resolved = settings.resolve_provider(provider)?;
        let model = if !model.trim().is_empty() {
            model.trim().to_string()
        } else if !resolved.default_model.trim().is_empty() {
            resolved.default_model.clone()
        } else {
            crate::catalog::snapshot()
                .providers
                .get(provider)
                .and_then(|p| p.default_model())
                .unwrap_or("")
                .to_string()
        };
        if model.is_empty() {
            return None;
        }
        Some(CompletionTarget {
            label: resolved.label.clone(),
            provider: resolved.id.clone(),
            base_url: resolved.base_url.clone(),
            api_key: settings.key_for(provider),
            model,
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
            headers: resolved
                .headers
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        })
    }

    /// The configured primary provider/model.
    pub fn primary(settings: &Settings) -> Option<Self> {
        Self::from_settings(settings, &settings.provider, &settings.model)
    }
}

/// Targets for a fan-out: the primary first, then every other provider
/// that has a usable key (or needs none), capped at `max`.
pub fn settings_targets(settings: &Settings, max: usize) -> Vec<CompletionTarget> {
    let mut out = Vec::new();
    if let Some(primary) = CompletionTarget::primary(settings) {
        out.push(primary);
    }
    for def in providers::PROVIDERS {
        if out.len() >= max || def.id == settings.provider {
            continue;
        }
        let key = settings.key_for(def.id);
        if def.needs_key && key.trim().is_empty() {
            continue;
        }
        if let Some(target) = CompletionTarget::from_settings(settings, def.id, "") {
            out.push(target);
        }
    }
    for id in settings.custom_providers.keys() {
        if out.len() >= max {
            break;
        }
        if out.iter().any(|t| &t.provider == id) {
            continue;
        }
        if let Some(target) = CompletionTarget::from_settings(settings, id, "") {
            out.push(target);
        }
    }
    out.truncate(max);
    out
}

/// One non-streaming chat completion. The full body is awaited and the
/// assistant text returned; providers that stream by default are asked
/// for `stream: false` explicitly.
pub async fn complete<T: Transport + ?Sized>(
    transport: &T,
    target: &CompletionTarget,
    system: &str,
    messages: &[ChatMessage],
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let mut wire: Vec<serde_json::Value> = Vec::new();
    if !system.trim().is_empty() {
        wire.push(serde_json::json!({ "role": "system", "content": system.trim() }));
    }
    for message in messages {
        wire.push(crate::client::wire_message(message));
    }
    let mut body = serde_json::json!({
        "model": target.model,
        "messages": wire,
        "temperature": target.temperature,
        "stream": false,
    });
    let limit = max_tokens.or(target.max_tokens);
    if let Some(limit) = limit {
        body["max_tokens"] = serde_json::json!(limit);
    }
    let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
    if !target.api_key.trim().is_empty() {
        headers.push((
            "Authorization".to_string(),
            format!("Bearer {}", target.api_key.trim()),
        ));
    }
    headers.extend(target.headers.iter().cloned());
    let req = HttpRequest {
        url: providers::chat_completions_url(&target.base_url),
        headers,
        body: Some(body.to_string()),
    };
    let raw = transport.post_body(req).await?;
    parse_completion(&String::from_utf8_lossy(&raw))
}

/// Parse an OpenAI-compatible non-streaming completion body.
pub fn parse_completion(body: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("completion json: {e}"))?;
    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("provider error");
        return Err(message.to_string());
    }
    let Some(choice) = value
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
    else {
        return Err("completion has no choices".into());
    };
    if let Some(message) = choice.get("message") {
        if let Some(text) = message.get("content").and_then(content_text) {
            return Ok(text.trim().to_string());
        }
    }
    if let Some(text) = choice.get("text").and_then(|t| t.as_str()) {
        return Ok(text.trim().to_string());
    }
    Err("completion has no text".into())
}

/// `content` is a string in the common shape, but some providers return
/// `[{ "type": "text", "text": "…" }]`.
fn content_text(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    let parts = value.as_array()?;
    let mut out = String::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
            out.push_str(text);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// One member's contribution to a fan-out.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MemberResponse {
    pub label: String,
    pub provider: String,
    pub model: String,
    pub content: String,
    pub error: Option<String>,
}

impl MemberResponse {
    pub fn ok(&self) -> bool {
        self.error.is_none()
    }
}

fn response_from(target: &CompletionTarget, result: Result<String, String>) -> MemberResponse {
    match result {
        Ok(content) => MemberResponse {
            label: target.label.clone(),
            provider: target.provider.clone(),
            model: target.model.clone(),
            content,
            error: None,
        },
        Err(error) => MemberResponse {
            label: target.label.clone(),
            provider: target.provider.clone(),
            model: target.model.clone(),
            content: String::new(),
            error: Some(error),
        },
    }
}

/// Send the same prompt (and optional history) to every target.
pub async fn multi_send<T: Transport + ?Sized>(
    transport: &T,
    targets: &[CompletionTarget],
    system: &str,
    history: &[ChatMessage],
    prompt: &str,
) -> Vec<MemberResponse> {
    let mut out = Vec::with_capacity(targets.len());
    for target in targets {
        let mut messages = history.to_vec();
        messages.push(ChatMessage::text("user", prompt));
        let result = complete(transport, target, system, &messages, None).await;
        out.push(response_from(target, result));
    }
    out
}

/// How a council picks its answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VotingStrategy {
    /// One judge reads every response and picks a winner.
    SingleJudge,
    /// Every member votes for another member; most votes wins.
    PeerVote,
    /// One judge writes the consolidated answer.
    Consensus,
}

impl VotingStrategy {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "single-judge" | "single" | "judge" => Some(Self::SingleJudge),
            "peer-vote" | "peer" | "vote" => Some(Self::PeerVote),
            "consensus" => Some(Self::Consensus),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::SingleJudge => "single-judge",
            Self::PeerVote => "peer-vote",
            Self::Consensus => "consensus",
        }
    }
}

/// A completed council.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CouncilResponse {
    pub strategy: String,
    pub responses: Vec<MemberResponse>,
    /// Winning member label (or the judge label for consensus).
    pub winner: String,
    pub winner_content: String,
    /// The judge's raw verdict/consolidation, or a fallback note.
    pub verdict: String,
    pub judge_error: Option<String>,
}

/// Run the members, then apply the voting strategy. A judge is required
/// for `single-judge`/`consensus` to do more than pick the first valid
/// answer; without one the response says so instead of pretending.
pub async fn council<T: Transport + ?Sized>(
    transport: &T,
    members: &[CompletionTarget],
    prompt: &str,
    strategy: VotingStrategy,
    judge: Option<&CompletionTarget>,
) -> Result<CouncilResponse, String> {
    if members.is_empty() {
        return Err("council needs at least one member".into());
    }
    let responses = multi_send(transport, members, "", &[], prompt).await;
    let valid: Vec<usize> = responses
        .iter()
        .enumerate()
        .filter(|(_, r)| r.ok() && !r.content.trim().is_empty())
        .map(|(i, _)| i)
        .collect();
    if valid.is_empty() {
        return Ok(CouncilResponse {
            strategy: strategy.label().to_string(),
            responses,
            winner: String::new(),
            winner_content: String::new(),
            verdict: "every council member failed".into(),
            judge_error: None,
        });
    }

    let mut response = match strategy {
        VotingStrategy::SingleJudge => {
            let (winner_index, verdict, judge_error) =
                judge_member(transport, judge, &responses, &valid, false).await;
            let winner = responses[winner_index].label.clone();
            let winner_content = responses[winner_index].content.clone();
            CouncilResponse {
                strategy: strategy.label().to_string(),
                winner,
                winner_content,
                verdict,
                judge_error,
                responses,
            }
        }
        VotingStrategy::Consensus => {
            let (judge_target, judge_missing) = match judge {
                Some(target) => (target.clone(), None),
                None => (
                    members[valid[0]].clone(),
                    Some("no judge configured; used the first member".to_string()),
                ),
            };
            let transcript = council_transcript(&responses);
            let ask = format!(
                "Synthesize one final answer to the user's request from these member responses. \
                 Keep every correct fact, resolve disagreements explicitly, and do not mention the \
                 mechanics of this council.\n\nRequest:\n{prompt}\n\nResponses:\n{transcript}"
            );
            match complete(
                transport,
                &judge_target,
                "You are the council's consolidating judge.",
                &[ChatMessage::text("user", &ask)],
                None,
            )
            .await
            {
                Ok(text) => CouncilResponse {
                    strategy: strategy.label().to_string(),
                    responses,
                    winner: judge_target.label.clone(),
                    winner_content: text.clone(),
                    verdict: text,
                    judge_error: judge_missing,
                },
                Err(e) => {
                    let winner = responses[valid[0]].label.clone();
                    let winner_content = responses[valid[0]].content.clone();
                    CouncilResponse {
                        strategy: strategy.label().to_string(),
                        winner,
                        winner_content,
                        responses,
                        verdict: "judge failed; used the first valid response".into(),
                        judge_error: Some(e),
                    }
                }
            }
        }
        VotingStrategy::PeerVote => {
            let mut tally = vec![0usize; responses.len()];
            let labels: Vec<String> = responses.iter().map(|r| r.label.clone()).collect();
            let mut vote_errors = Vec::new();
            for &index in &valid {
                let voter = &responses[index];
                let ask = format!(
                    "Vote for the response that best answers the request. Reply with exactly one \
                     of these labels and nothing else: {}.\n\nRequest:\n{prompt}\n\nResponses:\n{}",
                    labels.join(", "),
                    council_transcript(&responses)
                );
                let voter_target = members[index].clone();
                match complete(
                    transport,
                    &voter_target,
                    &format!("You are {}, a council member voting on your peers.", voter.label),
                    &[ChatMessage::text("user", &ask)],
                    None,
                )
                .await
                {
                    Ok(vote) => {
                        if let Some(pos) = match_label(&vote, &labels) {
                            tally[pos] += 1;
                            continue;
                        }
                        vote_errors.push(format!("{}: unrecognized vote {vote:?}", voter.label));
                    }
                    Err(e) => vote_errors.push(format!("{}: {e}", voter.label)),
                }
                // A member that cannot vote still prefers someone else;
                // abstain rather than skewing toward itself.
            }
            let winner = tally
                .iter()
                .enumerate()
                .filter(|(i, _)| valid.contains(i))
                .max_by_key(|(_, votes)| *votes)
                .map(|(i, _)| i)
                .unwrap_or(valid[0]);
            let winner_label = responses[winner].label.clone();
            let winner_content = responses[winner].content.clone();
            CouncilResponse {
                strategy: strategy.label().to_string(),
                winner: winner_label,
                winner_content,
                responses,
                verdict: format!("peer vote totals: {tally:?}"),
                judge_error: if vote_errors.is_empty() {
                    None
                } else {
                    Some(vote_errors.join("; "))
                },
            }
        }
    };
    // Never report an empty verdict when a judge returned one.
    if response.verdict.trim().is_empty() {
        response.verdict = "no verdict text".into();
    }
    Ok(response)
}

async fn judge_member<T: Transport + ?Sized>(
    transport: &T,
    judge: Option<&CompletionTarget>,
    responses: &[MemberResponse],
    valid: &[usize],
    consensus: bool,
) -> (usize, String, Option<String>) {
    let Some(judge) = judge else {
        return (
            valid[0],
            "no judge configured; used the first valid response".into(),
            None,
        );
    };
    let labels: Vec<&str> = valid.iter().map(|&i| responses[i].label.as_str()).collect();
    let mode = if consensus {
        "Write the single best answer that resolves the disagreements."
    } else {
        "Pick the best response and explain the choice."
    };
    let ask = format!(
        "{mode}\nReply with JSON only: {{\"winner\":\"<one of: {}>\",\"verdict\":\"<why>\"}}.\n\nResponses:\n{}",
        labels.join(", "),
        council_transcript(responses)
    );
    match complete(
        transport,
        judge,
        "You are the council's judge.",
        &[ChatMessage::text("user", &ask)],
        None,
    )
    .await
    {
        Ok(raw) => {
            let value = extract_json(&raw);
            let winner = value
                .as_ref()
                .and_then(|v| v.get("winner"))
                .and_then(|w| w.as_str())
                .and_then(|w| match_label(w, &responses.iter().map(|r| r.label.clone()).collect::<Vec<_>>()))
                .filter(|i| valid.contains(i))
                .unwrap_or(valid[0]);
            let verdict = value
                .as_ref()
                .and_then(|v| v.get("verdict"))
                .and_then(|v| v.as_str())
                .unwrap_or(raw.trim())
                .to_string();
            (winner, verdict, None)
        }
        Err(e) => (
            valid[0],
            "judge failed; used the first valid response".into(),
            Some(e),
        ),
    }
}

fn council_transcript(responses: &[MemberResponse]) -> String {
    let mut out = String::new();
    for response in responses {
        match &response.error {
            Some(error) => out.push_str(&format!(
                "[{}] ({} failed: {error})\n",
                response.label, response.model
            )),
            None => out.push_str(&format!(
                "[{}] ({}):\n{}\n\n",
                response.label, response.model, response.content
            )),
        }
    }
    out
}

/// Case-insensitive label lookup, also accepting a label embedded in a
/// sentence ("I choose Claude").
pub fn match_label(text: &str, labels: &[String]) -> Option<usize> {
    let lower = text.to_lowercase();
    if let Some((i, _)) = labels
        .iter()
        .enumerate()
        .find(|(_, label)| label.to_lowercase() == lower.trim())
    {
        return Some(i);
    }
    labels
        .iter()
        .enumerate()
        .find(|(_, label)| lower.contains(&label.to_lowercase()))
        .map(|(i, _)| i)
}

fn extract_json(raw: &str) -> Option<serde_json::Value> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    serde_json::from_str(&raw[start..=end]).ok()
}

/// One debate speaker and the position they argue.
#[derive(Debug, Clone)]
pub struct DebateParticipant {
    pub target: CompletionTarget,
    /// Free-form stance ("support", "oppose", "the moon is cheese").
    pub stance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DebateTurn {
    pub speaker: String,
    pub provider: String,
    pub stance: String,
    pub content: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DebateResponse {
    pub turns: Vec<DebateTurn>,
    pub summary: String,
    pub summary_error: Option<String>,
}

/// Alternating debate: each participant sees every earlier turn and
/// argues their stance. The judge (optional) writes the closing summary.
pub async fn debate<T: Transport + ?Sized>(
    transport: &T,
    participants: &[DebateParticipant],
    topic: &str,
    max_turns: usize,
    judge: Option<&CompletionTarget>,
) -> Result<DebateResponse, String> {
    if participants.is_empty() {
        return Err("debate needs at least one participant".into());
    }
    let max_turns = max_turns.max(1);
    let mut turns: Vec<DebateTurn> = Vec::new();
    for turn_index in 0..max_turns {
        let participant = &participants[turn_index % participants.len()];
        let mut prompt = format!("Debate topic: {topic}\n\nYour position: {}.\n", participant.stance);
        if turns.is_empty() {
            prompt.push_str("\nOpen the debate with your strongest argument.");
        } else {
            prompt.push_str("\nEarlier turns:\n");
            for turn in &turns {
                prompt.push_str(&format!(
                    "[{} — {}]: {}\n\n",
                    turn.speaker, turn.stance, turn.content
                ));
            }
            prompt.push_str(
                "Respond directly to the strongest opposing point and advance your position. \
                 Never concede your assigned stance.",
            );
        }
        let result = complete(
            transport,
            &participant.target,
            &format!(
                "You are debating as {}. Keep each turn under 180 words.",
                participant.target.label
            ),
            &[ChatMessage::text("user", &prompt)],
            Some(400),
        )
        .await;
        turns.push(match result {
            Ok(content) => DebateTurn {
                speaker: participant.target.label.clone(),
                provider: participant.target.provider.clone(),
                stance: participant.stance.clone(),
                content,
                error: None,
            },
            Err(error) => DebateTurn {
                speaker: participant.target.label.clone(),
                provider: participant.target.provider.clone(),
                stance: participant.stance.clone(),
                content: String::new(),
                error: Some(error),
            },
        });
    }

    let transcript = debate_transcript(&turns);
    let (summary, summary_error) = match judge {
        Some(judge) => match complete(
            transport,
            judge,
            "You are the debate's neutral judge.",
            &[ChatMessage::text(
                "user",
                &format!(
                    "Summarize this debate: strongest arguments on each side, where they \
                     disagree, and a reasoned verdict.\n\nTopic: {topic}\n\n{transcript}"
                ),
            )],
            Some(600),
        )
        .await
        {
            Ok(text) => (text, None),
            Err(e) => (String::new(), Some(e)),
        },
        None => (String::new(), None),
    };
    Ok(DebateResponse {
        turns,
        summary,
        summary_error,
    })
}

fn debate_transcript(turns: &[DebateTurn]) -> String {
    turns
        .iter()
        .map(|turn| match &turn.error {
            Some(error) => format!("[{} — {}] (failed: {error})", turn.speaker, turn.stance),
            None => format!("[{} — {}]: {}", turn.speaker, turn.stance, turn.content),
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

// ---- formatting shared by every surface --------------------------------

pub fn format_multi(prompt: &str, responses: &[MemberResponse]) -> String {
    let mut out = format!("Multi-send: {prompt}\n");
    for response in responses {
        out.push_str(&format!(
            "\n━━ {} · {} ━━\n",
            response.label, response.model
        ));
        match &response.error {
            Some(error) => out.push_str(&format!("error: {error}\n")),
            None => {
                out.push_str(response.content.trim());
                out.push('\n');
            }
        }
    }
    out
}

pub fn format_council(response: &CouncilResponse) -> String {
    let mut out = format!("Council ({}) — winner: {}\n", response.strategy, response.winner);
    out.push_str("\nVerdict:\n");
    out.push_str(response.verdict.trim());
    out.push_str("\n\nAnswer:\n");
    out.push_str(response.winner_content.trim());
    out.push_str("\n\nMembers:\n");
    for member in &response.responses {
        match &member.error {
            Some(error) => out.push_str(&format!("  {} · {} — error: {error}\n", member.label, member.model)),
            None => out.push_str(&format!("  {} · {} — {} chars\n", member.label, member.model, member.content.chars().count())),
        }
    }
    if let Some(error) = &response.judge_error {
        out.push_str(&format!("\njudge note: {error}\n"));
    }
    out
}

pub fn format_debate(topic: &str, response: &DebateResponse) -> String {
    let mut out = format!("Debate: {topic}\n");
    for (i, turn) in response.turns.iter().enumerate() {
        out.push_str(&format!(
            "\n━━ {}. {} — {} ━━\n",
            i + 1,
            turn.speaker,
            turn.stance
        ));
        match &turn.error {
            Some(error) => out.push_str(&format!("error: {error}\n")),
            None => {
                out.push_str(turn.content.trim());
                out.push('\n');
            }
        }
    }
    if !response.summary.trim().is_empty() {
        out.push_str("\n━━ Judge summary ━━\n");
        out.push_str(response.summary.trim());
        out.push('\n');
    }
    if let Some(error) = &response.summary_error {
        out.push_str(&format!("\njudge error: {error}\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use crate::transport::ByteStream;
    use std::sync::Mutex;

    /// Canned transport: the closure sees the request and returns the
    /// full body. Records every call for assertions.
    struct Mock {
        seen: Mutex<Vec<HttpRequest>>,
        answer: Box<dyn Fn(&HttpRequest) -> Result<String, String> + Send + Sync>,
    }

    impl Mock {
        fn new(
            answer: impl Fn(&HttpRequest) -> Result<String, String> + Send + Sync + 'static,
        ) -> Self {
            Mock {
                seen: Mutex::new(Vec::new()),
                answer: Box::new(answer),
            }
        }
        fn calls(&self) -> usize {
            self.seen.lock().unwrap().len()
        }
    }

    #[async_trait]
    impl Transport for Mock {
        async fn post_stream(&self, _req: HttpRequest) -> Result<ByteStream, String> {
            Err("stream not used".into())
        }
        async fn post_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
            self.seen.lock().unwrap().push(req.clone());
            (self.answer)(&req).map(String::into_bytes)
        }
        async fn get_body(&self, _req: HttpRequest) -> Result<Vec<u8>, String> {
            Err("get not used".into())
        }
    }

    fn completion(text: &str) -> String {
        serde_json::json!({
            "choices": [{ "message": { "role": "assistant", "content": text } }]
        })
        .to_string()
    }

    fn target(label: &str) -> CompletionTarget {
        CompletionTarget {
            label: label.into(),
            provider: label.to_lowercase(),
            base_url: format!("http://{label}.test/v1"),
            api_key: "k".into(),
            model: format!("{label}-model"),
            temperature: 0.2,
            max_tokens: Some(64),
            headers: Vec::new(),
        }
    }

    #[test]
    fn parses_string_and_part_content() {
        assert_eq!(parse_completion(&completion("hello")).unwrap(), "hello");
        let parts = serde_json::json!({
            "choices": [{ "message": { "content": [
                { "type": "text", "text": "a" }, { "type": "text", "text": "b" }
            ] } }]
        })
        .to_string();
        assert_eq!(parse_completion(&parts).unwrap(), "ab");
        let error = serde_json::json!({ "error": { "message": "rate limited" } }).to_string();
        assert_eq!(parse_completion(&error).unwrap_err(), "rate limited");
    }

    #[tokio::test]
    async fn multi_send_calls_every_target_and_keeps_errors() {
        let mock = Mock::new(|req| {
            let body = req.body.clone().unwrap_or_default();
            if body.contains("Bad-model") {
                Err("boom".into())
            } else {
                Ok(completion("answer"))
            }
        });
        let bad = target("Bad");
        let responses = multi_send(&mock, &[target("One"), bad], "sys", &[], "prompt").await;
        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0].content, "answer");
        assert_eq!(responses[1].error.as_deref(), Some("boom"));
        assert_eq!(mock.calls(), 2);
        assert!(format_multi("p", &responses).contains("One"));
    }

    #[tokio::test]
    async fn council_judge_picks_the_named_member() {
        let mock = Mock::new(|req| {
            let body = req.body.clone().unwrap_or_default();
            if body.contains("You are the council's judge") {
                Ok(completion(r#"{"winner":"Two","verdict":"more complete"}"#))
            } else if body.contains("second answer") {
                Ok(completion("second answer"))
            } else {
                Ok(completion("first answer"))
            }
        });
        let result = council(
            &mock,
            &[target("One"), target("Two")],
            "second answer please",
            VotingStrategy::SingleJudge,
            Some(&target("Judge")),
        )
        .await
        .unwrap();
        assert_eq!(result.winner, "Two");
        assert_eq!(result.winner_content, "second answer");
        assert_eq!(result.verdict, "more complete");
        assert_eq!(result.strategy, "single-judge");
        assert!(format_council(&result).contains("winner: Two"));
    }

    #[tokio::test]
    async fn council_falls_back_when_the_judge_fails() {
        let mock = Mock::new(|req| {
            if req.body.as_deref().unwrap_or("").contains("judge") {
                Err("judge down".into())
            } else {
                Ok(completion("usable"))
            }
        });
        let result = council(
            &mock,
            &[target("One"), target("Two")],
            "q",
            VotingStrategy::Consensus,
            Some(&target("Judge")),
        )
        .await
        .unwrap();
        assert_eq!(result.winner_content, "usable");
        assert_eq!(result.judge_error.as_deref(), Some("judge down"));
    }

    #[tokio::test]
    async fn peer_vote_counts_labels() {
        let mock = Mock::new(|req| {
            let body = req.body.clone().unwrap_or_default();
            if body.contains("voting on your peers") {
                if body.contains("You are One") {
                    Ok(completion("Two"))
                } else {
                    Ok(completion("Two"))
                }
            } else {
                Ok(completion("member text"))
            }
        });
        let result = council(
            &mock,
            &[target("One"), target("Two")],
            "q",
            VotingStrategy::PeerVote,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.winner, "Two");
        assert!(result.verdict.contains("peer vote"));
    }

    #[tokio::test]
    async fn debate_alternates_and_summarizes() {
        let mock = Mock::new(|req| {
            let body = req.body.clone().unwrap_or_default();
            if body.contains("neutral judge") {
                Ok(completion("judge summary"))
            } else {
                Ok(completion("a turn"))
            }
        });
        let participants = vec![
            DebateParticipant {
                target: target("One"),
                stance: "support".into(),
            },
            DebateParticipant {
                target: target("Two"),
                stance: "oppose".into(),
            },
        ];
        let result = debate(&mock, &participants, "topic", 4, Some(&target("Judge")))
            .await
            .unwrap();
        assert_eq!(result.turns.len(), 4);
        assert_eq!(result.turns[0].speaker, "One");
        assert_eq!(result.turns[1].speaker, "Two");
        assert_eq!(result.summary, "judge summary");
        assert!(format_debate("topic", &result).contains("Judge summary"));
    }
}
