//! The non-interactive CLI commands: search, tag, archive, fork,
//! export and import.
//!
//! These are the same operations the GUI offers, driven from a shell
//! so a script can search a history, tag a chat, or take a backup
//! without a terminal UI. They read and write the same conversation
//! store as the TUI and the desktop app.

use prism_core::backup::{self, ImportMode};
use prism_core::conversations::{self, Conversation};
use prism_core::search::{self, SearchQuery, SearchSort};
use prism_core::session_ops;

/// Every conversation in the store.
fn load_all() -> Vec<Conversation> {
    let mut out = Vec::new();
    for meta in prism_core::host::list_conversations() {
        if let Some(conv) = prism_core::host::load_conversation(&meta.id) {
            out.push(conv);
        }
    }
    out
}

/// Every conversation in the store.
///
/// The same loader the commands use, exposed so a test can run the same
/// search the CLI runs.
pub fn load_conversations_for_test() -> Vec<Conversation> {
    load_all()
}

/// Find one conversation by id or by a prefix of its id.
fn find_one(conversations: &[Conversation], needle: &str) -> Option<Conversation> {
    if let Some(conv) = conversations.iter().find(|c| c.id == needle) {
        return Some(conv.clone());
    }
    conversations
        .iter()
        .find(|c| c.id.starts_with(needle))
        .cloned()
}

/// `prism search [QUERY]` — search every chat.
pub fn search_cli(args: &[String]) -> anyhow::Result<()> {
    let mut query = String::new();
    let mut regex = false;
    let mut case_sensitive = false;
    let mut role: Option<String> = None;
    let mut tag: Option<String> = None;
    let mut unread_only = false;
    let mut include_archived = false;
    let mut sort = SearchSort::Newest;
    let mut limit = 50usize;

    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--regex" => regex = true,
            "--case-sensitive" => case_sensitive = true,
            "--unread" => unread_only = true,
            "--include-archived" => include_archived = true,
            "--role" => role = it.next().cloned(),
            "--tag" => tag = it.next().cloned(),
            "--limit" => {
                limit = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .ok_or_else(|| anyhow::anyhow!("--limit needs a number"))?
            }
            "--sort" => {
                sort = match it.next().as_deref().map(|s| s.as_str()) {
                    Some("oldest") => SearchSort::Oldest,
                    Some("title") => SearchSort::Title,
                    Some("newest") | None => SearchSort::Newest,
                    Some(other) => anyhow::bail!("unknown sort: {other}"),
                }
            }
            other if other.starts_with("--") => anyhow::bail!("unknown flag: {other}"),
            other => {
                if !query.is_empty() {
                    query.push(' ');
                }
                query.push_str(other);
            }
        }
    }

    let conversations = load_all();
    let hits = search::search(
        &conversations,
        &SearchQuery {
            text: query,
            regex,
            case_sensitive,
            role,
            tag,
            unread_only,
            include_archived,
            file_filter: None,
            limit,
            sort,
        },
    );

    if hits.is_empty() {
        println!("No matches.");
        return Ok(());
    }

    for hit in &hits {
        println!(
            "{}  {}  #{}  {}",
            &hit.conversation_id[..hit.conversation_id.len().min(8)],
            hit.role,
            hit.message_index,
            hit.preview
        );
    }
    println!("\n{} match(es).", hits.len());
    Ok(())
}

/// `prism tag <chat> <tag>` — add a tag to a chat.
pub fn tag_cli(args: &[String]) -> anyhow::Result<()> {
    let (chat, tag) = match args {
        [chat, tag, ..] => (chat, tag),
        _ => anyhow::bail!("usage: prism tag <chat-id> <tag>"),
    };
    let conversations = load_all();
    let Some(mut conv) = find_one(&conversations, chat) else {
        anyhow::bail!("no chat with id {chat}");
    };
    if !conv.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
        conv.tags.push(tag.clone());
    }
    prism_core::host::save_conversation(&conv).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("Tagged {} with {tag}.", conv.id);
    Ok(())
}

/// `prism untag <chat> <tag>` — remove a tag from a chat.
pub fn untag_cli(args: &[String]) -> anyhow::Result<()> {
    let (chat, tag) = match args {
        [chat, tag, ..] => (chat, tag),
        _ => anyhow::bail!("usage: prism untag <chat-id> <tag>"),
    };
    let conversations = load_all();
    let Some(mut conv) = find_one(&conversations, chat) else {
        anyhow::bail!("no chat with id {chat}");
    };
    conv.tags.retain(|t| !t.eq_ignore_ascii_case(tag));
    prism_core::host::save_conversation(&conv).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("Untagged {}.", conv.id);
    Ok(())
}

/// `prism archive <chat>` / `prism unarchive <chat>`.
pub fn archive_cli(args: &[String], archived: bool) -> anyhow::Result<()> {
    let chat = match args {
        [chat, ..] => chat,
        _ => anyhow::bail!("usage: prism archive <chat-id>"),
    };
    let conversations = load_all();
    let Some(mut conv) = find_one(&conversations, chat) else {
        anyhow::bail!("no chat with id {chat}");
    };
    conv.archived = archived;
    prism_core::host::save_conversation(&conv).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!(
        "{} {}.",
        conv.id,
        if archived { "archived" } else { "unarchived" }
    );
    Ok(())
}

/// `prism read <chat>` / `prism unread <chat>`.
pub fn read_cli(args: &[String], read: bool) -> anyhow::Result<()> {
    let chat = match args {
        [chat, ..] => chat,
        _ => anyhow::bail!("usage: prism read <chat-id>"),
    };
    let conversations = load_all();
    let Some(mut conv) = find_one(&conversations, chat) else {
        anyhow::bail!("no chat with id {chat}");
    };
    conv.read = read;
    prism_core::host::save_conversation(&conv).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("{} {}.", conv.id, if read { "read" } else { "unread" });
    Ok(())
}

/// `prism fork <chat> <message-index>` — branch a chat at a message.
pub fn fork_cli(args: &[String]) -> anyhow::Result<()> {
    let (chat, index) = match args {
        [chat, index, ..] => (
            chat,
            index
                .parse::<usize>()
                .map_err(|_| anyhow::anyhow!("message index must be a number"))?,
        ),
        _ => anyhow::bail!("usage: prism fork <chat-id> <message-index>"),
    };
    let conversations = load_all();
    let Some(source) = find_one(&conversations, chat) else {
        anyhow::bail!("no chat with id {chat}");
    };
    let fork = session_ops::fork_branch(
        &source,
        index,
        conversations::new_id(),
        conversations::now_ms(),
    );
    prism_core::host::save_conversation(&fork).map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("Forked {} at message {index} into {}.", source.id, fork.id);
    Ok(())
}

/// `prism export <path>` — write every chat to a backup file.
pub fn export_cli(args: &[String]) -> anyhow::Result<()> {
    let path = match args {
        [path, ..] => path,
        _ => anyhow::bail!("usage: prism export <path.json>"),
    };
    let conversations = load_all();
    let json = backup::export_json(&conversations, conversations::now_ms())?;
    std::fs::write(path, json)?;
    println!("Exported {} chat(s) to {path}.", conversations.len());
    Ok(())
}

/// `prism import <path> [--replace]` — read a backup file back.
pub fn import_cli(args: &[String]) -> anyhow::Result<()> {
    let mut path = None;
    let mut mode = ImportMode::Merge;
    for arg in args {
        match arg.as_str() {
            "--replace" => mode = ImportMode::Replace,
            other => path = Some(other.to_string()),
        }
    }
    let Some(path) = path else {
        anyhow::bail!("usage: prism import <path.json> [--replace]");
    };
    let raw = std::fs::read_to_string(&path)?;
    let mut existing = load_all();
    match backup::import_backup(&raw, &mut existing, mode) {
        Ok(backup::ImportOutcome::Imported { count, migrated }) => {
            for conv in &existing {
                prism_core::host::save_conversation(conv).map_err(|e| anyhow::anyhow!("{e}"))?;
            }
            println!(
                "Imported {count} chat(s){}.",
                if migrated { " (migrated)" } else { "" }
            );
            Ok(())
        }
        Ok(backup::ImportOutcome::Corrupt { reason }) => {
            anyhow::bail!("import failed: {reason}")
        }
        Ok(backup::ImportOutcome::Unsupported { version }) => anyhow::bail!(
            "import failed: this file was written by a newer Prism (format {version})"
        ),
        Err(backup::ImportOutcome::Corrupt { reason }) => {
            anyhow::bail!("import failed: {reason}")
        }
        Err(backup::ImportOutcome::Unsupported { version }) => anyhow::bail!(
            "import failed: this file was written by a newer Prism (format {version})"
        ),
        Err(backup::ImportOutcome::Imported { count, .. }) => {
            anyhow::bail!("import failed after importing {count} chat(s)")
        }
    }
}

/// `prism chats` — list the stored chats.
pub fn chats_cli(_args: &[String]) -> anyhow::Result<()> {
    let conversations = load_all();
    if conversations.is_empty() {
        println!("No chats.");
        return Ok(());
    }
    for conv in &conversations {
        let flags = [
            conv.archived.then_some("archived").unwrap_or_default(),
            (!conv.read).then_some("unread").unwrap_or_default(),
        ]
        .iter()
        .filter(|f| !f.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
        let tags = conv.tags.join(", ");
        println!(
            "{}  {}  {} msgs{}",
            &conv.id[..conv.id.len().min(8)],
            conv.title,
            conv.messages.len(),
            if flags.is_empty() {
                String::new()
            } else {
                format!("  [{flags}]")
            }
        );
        if !tags.is_empty() {
            println!("         tags: {tags}");
        }
    }
    Ok(())
}
