//! The feature handlers behind the new Slint controls: search, message
//! actions (fork / edit / read / tag), session actions (read / archive
//! / tag), the context panel and import / export.
//!
//! Everything here operates on the same `State` the rest of the app
//! uses and persists through `host::save_conversation`, so a change
//! made in the UI survives a restart like any other conversation edit.

use crate::shared::{
    conversations, host, persist_current, push_system, refresh_chats, refresh_transcript, AppWindow,
    ChatLine, Line, State,
};
use prism_core::backup::{self, ImportMode};
use prism_core::context::{self, ContextItem};
use prism_core::search::{self, SearchQuery, SearchSort};
use prism_core::session_ops;
use slint::{ModelRc, SharedString, VecModel};
use std::cell::RefCell;
use std::rc::Rc;

/// The role filter labels offered by the search panel.
pub const SEARCH_ROLE_LABELS: &[&str] = &["Any role", "User", "Assistant", "System"];

/// The sort labels offered by the search panel.
pub const SEARCH_SORT_LABELS: &[&str] = &["Newest", "Oldest", "Title"];

/// The role a search filter index selects.
fn role_for_index(index: i32) -> Option<String> {
    match index {
        1 => Some("user".into()),
        2 => Some("assistant".into()),
        3 => Some("system".into()),
        _ => None,
    }
}

/// The sort a search filter index selects.
fn sort_for_index(index: i32) -> SearchSort {
    match index {
        1 => SearchSort::Oldest,
        2 => SearchSort::Title,
        _ => SearchSort::Newest,
    }
}

/// Every conversation on disk, loaded for searching.
fn load_all_conversations() -> Vec<prism_core::conversations::Conversation> {
    let mut out = Vec::new();
    for meta in host::list_conversations() {
        if let Some(conv) = host::load_conversation(&meta.id) {
            out.push(conv);
        }
    }
    out
}

/// Run the search panel's current query and fill the result list.
pub fn run_search(ui: &AppWindow) {
    let query = SearchQuery {
        text: ui.get_search_query().to_string(),
        regex: ui.get_search_regex(),
        case_sensitive: ui.get_search_case_sensitive(),
        role: role_for_index(ui.get_search_role_idx()),
        tag: Some(ui.get_search_tag().to_string())
            .filter(|t| !t.trim().is_empty()),
        unread_only: ui.get_search_unread_only(),
        include_archived: ui.get_search_include_archived(),
        file_filter: Some(ui.get_search_file().to_string())
            .filter(|f| !f.trim().is_empty()),
        limit: 500,
        sort: sort_for_index(ui.get_search_sort_idx()),
    };

    let conversations = load_all_conversations();
    let hits = search::search(&conversations, &query);

    let rows: Vec<crate::shared::SearchRow> = hits
        .iter()
        .map(|hit| crate::shared::SearchRow {
            conversation_id: hit.conversation_id.clone().into(),
            conversation_title: hit.conversation_title.clone().into(),
            message_index: hit.message_index as i32,
            role: hit.role.clone().into(),
            preview: hit.preview.clone().into(),
        })
        .collect();
    ui.set_search_results(ModelRc::from(Rc::new(VecModel::from(rows))));

    let status = if hits.len() == 1 {
        "1 match".to_string()
    } else {
        format!("{} matches", hits.len())
    };
    ui.set_search_status(status.into());
}

/// Open a conversation and scroll to one of its messages.
pub fn jump_to_message(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    conversation_id: &str,
    message_index: i32,
) {
    let Some(conv) = host::load_conversation(conversation_id) else {
        push_system(ui, state, lines_model, "conversation not found".into());
        return;
    };

    {
        let mut st = state.borrow_mut();
        st.lines = conv
            .messages
            .iter()
            .map(|m| Line {
                role: m.role.clone(),
                content: m.content.clone(),
                thinking: m.thinking.clone(),
                tags: m.tags.clone(),
                read: m.read,
                edited: m.edited_at.is_some(),
            })
            .collect();
        st.current_id = Some(conv.id.clone());
        st.current_created = conv.created_at;
        st.session_tags = conv.tags.clone();
        st.session_archived = conv.archived;
        st.session_read = conv.read;
        st.forked_from = conv.forked_from.clone();
        st.forked_at_message = conv.forked_at_message;
        st.confirm_delete = None;
    }

    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
    ui.invoke_scroll_to_end();
    refresh_chats(ui, state);

    ui.set_search_open(false);

    let index = message_index.max(0) as usize;
    if index < lines.len() {
        let line = &lines[index];
        push_system(
            ui,
            state,
            lines_model,
            format!("Jumped to message {} ({}).", index + 1, line.role),
        );
    }
}

/// Branch the current conversation at a message into a new one.
pub fn fork_at(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    index: i32,
) {
    if index < 0 {
        return;
    }
    let index = index as usize;

    // Build the conversation from the in-memory lines so the fork
    // includes unsaved edits.
    let now = conversations::now_ms();
    let (source, current_id, current_created) = {
        let st = state.borrow();
        let messages: Vec<prism_core::conversations::StoredMessage> = st
            .lines
            .iter()
            .map(|l| prism_core::conversations::StoredMessage {
                role: l.role.clone(),
                content: l.content.clone(),
                thinking: l.thinking.clone(),
                id: None,
                tags: l.tags.clone(),
                read: l.read,
                edited_at: if l.edited { Some(now) } else { None },
            })
            .collect();
        let id = st
            .current_id
            .clone()
            .unwrap_or_else(|| conversations::new_id());
        (
            prism_core::conversations::Conversation {
                id: id.clone(),
                title: conversations::derive_title(&messages),
                created_at: if st.current_created == 0 {
                    now
                } else {
                    st.current_created
                },
                updated_at: now,
                messages,
                tags: st.session_tags.clone(),
                archived: st.session_archived,
                read: st.session_read,
                forked_from: st.forked_from.clone(),
                forked_at_message: st.forked_at_message,
            },
            id,
            if st.current_created == 0 {
                now
            } else {
                st.current_created
            },
        )
    };

    let fork = session_ops::fork_branch(&source, index, conversations::new_id(), now);
    if let Err(e) = host::save_conversation(&fork) {
        push_system(
            ui,
            state,
            lines_model,
            format!("Fork failed: {e}"),
        );
        return;
    }

    // Switch to the fork.
    {
        let mut st = state.borrow_mut();
        st.lines = fork
            .messages
            .iter()
            .map(|m| Line {
                role: m.role.clone(),
                content: m.content.clone(),
                thinking: m.thinking.clone(),
                tags: m.tags.clone(),
                read: m.read,
                edited: m.edited_at.is_some(),
            })
            .collect();
        st.current_id = Some(fork.id.clone());
        st.current_created = fork.created_at;
        st.session_tags = fork.tags.clone();
        st.session_archived = false;
        st.session_read = false;
        st.forked_from = fork.forked_from.clone();
        st.forked_at_message = fork.forked_at_message;
    }

    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
    refresh_chats(ui, state);

    let _ = (current_id, current_created);
    push_system(
        ui,
        state,
        lines_model,
        format!("Forked at message {} into a new chat.", index + 1),
    );
}

/// Start editing a message.
pub fn edit_start(ui: &AppWindow, state: &Rc<RefCell<State>>, index: i32) {
    if index < 0 {
        return;
    }
    let index = index as usize;
    let text = state.borrow().lines.get(index).map(|l| l.content.clone());
    let Some(text) = text else {
        return;
    };
    ui.set_editing_message_index(index as i32);
    ui.set_editing_message_text(text.into());
}

/// Cancel editing.
pub fn edit_cancel(ui: &AppWindow) {
    ui.set_editing_message_index(-1);
    ui.set_editing_message_text(SharedString::new());
}

/// Commit an edit: the message text changes and the stale tail after it
/// is dropped, because it answered the old text.
pub fn edit_commit(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    index: i32,
    text: &str,
) {
    if index < 0 {
        return;
    }
    let index = index as usize;
    {
        let mut st = state.borrow_mut();
        if index >= st.lines.len() {
            return;
        }
        st.lines[index].content = text.to_string();
        st.lines[index].edited = true;
        // The tail answered the old text; drop it.
        st.lines.truncate(index + 1);
    }
    ui.set_editing_message_index(-1);
    ui.set_editing_message_text(SharedString::new());

    persist_current(ui, state, lines_model);
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
    push_system(
        ui,
        state,
        lines_model,
        format!("Edited message {}.", index + 1),
    );
}

/// Toggle a message's read flag.
pub fn toggle_message_read(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    index: i32,
) {
    if index < 0 {
        return;
    }
    let index = index as usize;
    {
        let mut st = state.borrow_mut();
        let Some(line) = st.lines.get_mut(index) else {
            return;
        };
        line.read = !line.read;
    }
    persist_current(ui, state, lines_model);
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
}

/// Add a tag to a message.
pub fn tag_message(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    index: i32,
    tag: &str,
) {
    let tag = tag.trim();
    if tag.is_empty() || index < 0 {
        return;
    }
    let index = index as usize;
    {
        let mut st = state.borrow_mut();
        let Some(line) = st.lines.get_mut(index) else {
            return;
        };
        if line.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            return;
        }
        line.tags.push(tag.to_string());
    }
    persist_current(ui, state, lines_model);
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
}

/// Remove a tag from a message.
pub fn untag_message(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    index: i32,
    tag: &str,
) {
    if index < 0 {
        return;
    }
    let index = index as usize;
    {
        let mut st = state.borrow_mut();
        let Some(line) = st.lines.get_mut(index) else {
            return;
        };
        line.tags.retain(|t| !t.eq_ignore_ascii_case(tag));
    }
    persist_current(ui, state, lines_model);
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
}

/// Toggle a session's read flag.
pub fn toggle_session_read(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) {
    {
        let mut st = state.borrow_mut();
        st.session_read = !st.session_read;
    }
    persist_current(ui, state, lines_model);
    refresh_chats(ui, state);
}

/// Toggle a session's archive flag.
pub fn toggle_session_archive(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) {
    {
        let mut st = state.borrow_mut();
        st.session_archived = !st.session_archived;
    }
    persist_current(ui, state, lines_model);
    refresh_chats(ui, state);
    let archived = state.borrow().session_archived;
    push_system(
        ui,
        state,
        lines_model,
        if archived {
            "Chat archived.".into()
        } else {
            "Chat unarchived.".into()
        },
    );
}

/// Add a tag to the current session.
pub fn tag_session(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    tag: &str,
) {
    let tag = tag.trim();
    if tag.is_empty() {
        return;
    }
    {
        let mut st = state.borrow_mut();
        if st.session_tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            return;
        }
        st.session_tags.push(tag.to_string());
    }
    persist_current(ui, state, lines_model);
    refresh_chats(ui, state);
}

/// Remove a tag from the current session.
pub fn untag_session(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    tag: &str,
) {
    {
        let mut st = state.borrow_mut();
        st.session_tags.retain(|t| !t.eq_ignore_ascii_case(tag));
    }
    persist_current(ui, state, lines_model);
    refresh_chats(ui, state);
}

/// The context panel's rows.
fn context_rows(items: &[ContextItem]) -> Vec<crate::shared::ContextRow> {
    items
        .iter()
        .map(|item| crate::shared::ContextRow {
            id: item.id.clone().into(),
            kind: item.kind.clone().into(),
            title: item.title.clone().into(),
            tokens: item.tokens as i32,
            enabled: item.enabled,
            source: item.source.clone().into(),
        })
        .collect()
}

/// Redraw the context panel.
pub fn refresh_context(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let items = state.borrow().context_items.clone();
    let rows = context_rows(&items);
    ui.set_context_items(ModelRc::from(Rc::new(VecModel::from(rows))));

    let enabled: usize = items.iter().filter(|i| i.enabled).map(|i| i.tokens).sum();
    let total = items.len();
    ui.set_context_status(
        format!("{enabled} tokens enabled · {total} items").into(),
    );
}

/// Apply the token budget to the attached context.
pub fn apply_context_budget(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let budget = state.borrow().context_budget;
    let items = state.borrow().context_items.clone();
    let trimmed = context::context_budget(&items, budget);
    state.borrow_mut().context_items = trimmed;
    refresh_context(ui, state);
}

/// Change the context token budget.
///
/// The field is free text, so an unparseable value keeps the previous
/// budget rather than silently dropping the context to zero.
pub fn set_context_budget(ui: &AppWindow, state: &Rc<RefCell<State>>, budget: &str) {
    let Ok(parsed) = budget.trim().parse::<usize>() else {
        return;
    };
    state.borrow_mut().context_budget = parsed;
    apply_context_budget(ui, state);
}

/// Enable or disable one context item.
pub fn toggle_context_item(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    id: &str,
    enabled: bool,
) {
    {
        let mut st = state.borrow_mut();
        if let Some(item) = st.context_items.iter_mut().find(|i| i.id == id) {
            item.enabled = enabled;
        }
    }
    apply_context_budget(ui, state);
}

/// Remove one context item.
pub fn remove_context_item(ui: &AppWindow, state: &Rc<RefCell<State>>, id: &str) {
    {
        let mut st = state.borrow_mut();
        st.context_items.retain(|i| i.id != id);
    }
    refresh_context(ui, state);
}

/// Write every conversation to a backup file.
pub fn export_backup(ui: &AppWindow, path: &str) {
    if path.trim().is_empty() {
        ui.set_backup_status("No path given.".into());
        return;
    }
    let conversations = load_all_conversations();
    match backup::export_json(&conversations, conversations::now_ms()) {
        Ok(json) => match std::fs::write(path, json) {
            Ok(()) => {
                let status = format!("Exported {} chats to {path}.", conversations.len());
                ui.set_backup_status(status.into());
            }
            Err(e) => {
                let status = format!("Export failed: {e}");
                ui.set_backup_status(status.into());
            }
        },
        Err(e) => {
            let status = format!("Export failed: {e}");
            ui.set_backup_status(status.into());
        }
    }
}

/// Read a backup file back into the conversation store.
pub fn import_backup(ui: &AppWindow, path: &str) {
    if path.trim().is_empty() {
        ui.set_backup_status("No path given.".into());
        return;
    }
    let raw = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) => {
            let status = format!("Import failed: {e}");
            ui.set_backup_status(status.into());
            return;
        }
    };

    let mut existing = load_all_conversations();
    match backup::import_backup(&raw, &mut existing, ImportMode::Merge) {
        Ok(backup::ImportOutcome::Imported { count, .. }) => {
            for conv in &existing {
                if let Err(e) = host::save_conversation(conv) {
                    eprintln!("prism-slint: saving imported chat failed: {e}");
                }
            }
            let status = format!("Imported {count} chats.");
            ui.set_backup_status(status.into());
        }
        Ok(backup::ImportOutcome::Corrupt { reason }) => {
            let status = format!("Import failed: {reason}");
            ui.set_backup_status(status.into());
        }
        Ok(backup::ImportOutcome::Unsupported { version }) => {
            let status = format!(
                "Import failed: this file was written by a newer Prism (format {version})."
            );
            ui.set_backup_status(status.into());
        }
        Err(backup::ImportOutcome::Corrupt { reason }) => {
            let status = format!("Import failed: {reason}");
            ui.set_backup_status(status.into());
        }
        Err(backup::ImportOutcome::Unsupported { version }) => {
            let status = format!(
                "Import failed: this file was written by a newer Prism (format {version})."
            );
            ui.set_backup_status(status.into());
        }
        Err(backup::ImportOutcome::Imported { count, .. }) => {
            let status = format!("Import failed after importing {count} chats.");
            ui.set_backup_status(status.into());
        }
    }
}
