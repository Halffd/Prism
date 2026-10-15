//! egui application: chat window with streaming responses and a
//! settings side panel.

use crate::client::{self, ChatMessage, StreamEvent};
use crate::providers::{self, PROVIDERS};
use crate::settings::{self, Connection, Settings};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

/// One line in the chat transcript.
struct TranscriptLine {
    role: String, // "user" | "assistant" | "system"
    content: String,
}

pub struct PrismApp {
    settings: Settings,
    transcript: Vec<TranscriptLine>,
    input: String,
    streaming: bool,
    rx: Option<Receiver<StreamEvent>>,
    show_settings: bool,
    settings_status: String,
}

impl PrismApp {
    pub fn new() -> Self {
        PrismApp {
            settings: settings::load(),
            transcript: Vec::new(),
            input: String::new(),
            streaming: false,
            rx: None,
            show_settings: true,
            settings_status: String::new(),
        }
    }

    /// Resolve the effective model id (settings override or provider default).
    fn effective_model(&self) -> String {
        if !self.settings.model.trim().is_empty() {
            self.settings.model.trim().to_string()
        } else {
            providers::find(&self.settings.provider)
                .map(|p| p.default_model.to_string())
                .unwrap_or_default()
        }
    }

    fn push_system(&mut self, text: String) {
        self.transcript.push(TranscriptLine {
            role: "system".into(),
            content: text,
        });
    }

    /// Conversation history for the model, excluding system lines.
    fn history(&self) -> Vec<ChatMessage> {
        self.transcript
            .iter()
            .filter(|l| l.role != "system")
            .map(|l| ChatMessage {
                role: l.role.clone(),
                content: l.content.clone(),
            })
            .collect()
    }

    fn send(&mut self) {
        let content = self.input.trim().to_string();
        if content.is_empty() || self.streaming {
            return;
        }
        self.input.clear();

        // Build the request from history BEFORE appending the new
        // user message and the assistant placeholder to the transcript.
        let mut history = self.history();
        history.push(ChatMessage {
            role: "user".into(),
            content: content.clone(),
        });

        self.transcript.push(TranscriptLine {
            role: "user".into(),
            content,
        });
        self.transcript.push(TranscriptLine {
            role: "assistant".into(),
            content: String::new(),
        });

        let (tx, rx) = mpsc::channel::<StreamEvent>();

        match self.settings.connection {
            Connection::Direct => {
                let def = providers::find(&self.settings.provider);
                let needs_key = def.map(|d| d.needs_key).unwrap_or(false);
                if needs_key && self.settings.api_key.trim().is_empty() {
                    let label = def.map(|d| d.label).unwrap_or("provider");
                    self.push_system(format!("API key required for {label}. Open settings."));
                    return;
                }
                let base_url = def.map(|d| d.base_url.to_string()).unwrap_or_default();
                let req = client::StreamRequest {
                    base_url,
                    api_key: self.settings.api_key.trim().to_string(),
                    model: self.effective_model(),
                    temperature: self.settings.temperature,
                    messages: history,
                };
                self.streaming = true;
                self.rx = Some(rx);
                client::spawn_stream(req, tx);
            }
            Connection::PrismApi => {
                if self.settings.prism_api_token.trim().is_empty() {
                    self.push_system("Prism API token required. Open settings.".into());
                    return;
                }
                let req = client::ApiChatRequest {
                    server_url: self.settings.prism_api_url.trim().to_string(),
                    token: self.settings.prism_api_token.trim().to_string(),
                    content: history
                        .last()
                        .map(|m| m.content.clone())
                        .unwrap_or_default(),
                };
                self.streaming = true;
                self.rx = Some(rx);
                client::spawn_api_chat(req, tx);
            }
        }
    }

    /// Drain stream events from the background task.
    fn drain_events(&mut self, ctx: &egui::Context) {
        let mut still_open = false;
        if let Some(rx) = &self.rx {
            loop {
                match rx.try_recv() {
                    Ok(StreamEvent::Chunk(text)) => {
                        if let Some(last) = self.transcript.last_mut() {
                            last.content.push_str(&text);
                        }
                    }
                    Ok(StreamEvent::Done) => {
                        self.streaming = false;
                        self.rx = None;
                        break;
                    }
                    Ok(StreamEvent::Error(e)) => {
                        self.streaming = false;
                        self.rx = None;
                        self.push_system(format!("Error: {e}"));
                        break;
                    }
                    Err(mpsc::TryRecvError::Empty) => {
                        still_open = true;
                        break;
                    }
                    Err(mpsc::TryRecvError::Disconnected) => {
                        self.streaming = false;
                        self.rx = None;
                        break;
                    }
                }
            }
        }
        if still_open {
            ctx.request_repaint_after(Duration::from_millis(50));
        }
    }
}

impl Default for PrismApp {
    fn default() -> Self {
        Self::new()
    }
}

impl eframe::App for PrismApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.drain_events(&ctx);

        // Top bar: connection mode, provider, model, settings toggle.
        egui::Panel::top("top_bar").show(ui, |ui| {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                let connection_label = match self.settings.connection {
                    Connection::Direct => "Direct",
                    Connection::PrismApi => "Prism API",
                };
                egui::ComboBox::from_id_salt("connection")
                    .selected_text(connection_label)
                    .width(100.0)
                    .show_ui(ui, |ui| {
                        ui.selectable_value(
                            &mut self.settings.connection,
                            Connection::Direct,
                            "Direct",
                        );
                        ui.selectable_value(
                            &mut self.settings.connection,
                            Connection::PrismApi,
                            "Prism API",
                        );
                    });

                if self.settings.connection == Connection::Direct {
                    let current = providers::find(&self.settings.provider)
                        .map(|p| p.label)
                        .unwrap_or("?");
                    egui::ComboBox::from_id_salt("provider")
                        .selected_text(current)
                        .width(170.0)
                        .show_ui(ui, |ui| {
                            for p in PROVIDERS {
                                ui.selectable_value(
                                    &mut self.settings.provider,
                                    p.id.to_string(),
                                    p.label,
                                );
                            }
                        });
                }

                let hint = if self.settings.model.trim().is_empty() {
                    format!("default: {}", self.effective_model())
                } else {
                    String::new()
                };
                ui.add(
                    egui::TextEdit::singleline(&mut self.settings.model)
                        .hint_text(hint)
                        .desired_width(180.0),
                );

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.toggle_value(&mut self.show_settings, "Settings");
                    if self.streaming {
                        ui.colored_label(egui::Color32::YELLOW, "…responding");
                    }
                });
            });
            ui.add_space(4.0);
        });

        // Side panel with credentials and endpoints.
        if self.show_settings {
            egui::Panel::right("settings_panel")
                .resizable(true)
                .default_size(300.0)
                .show(ui, |ui| {
                    ui.heading("Settings");
                    ui.separator();
                    egui::Grid::new("settings_grid")
                        .num_columns(2)
                        .spacing([8.0, 8.0])
                        .show(ui, |ui| {
                            match self.settings.connection {
                                Connection::Direct => {
                                    ui.label("API key");
                                    ui.add(
                                        egui::TextEdit::singleline(&mut self.settings.api_key)
                                            .password(true),
                                    );
                                    ui.end_row();
                                }
                                Connection::PrismApi => {
                                    ui.label("Server URL");
                                    ui.add(egui::TextEdit::singleline(
                                        &mut self.settings.prism_api_url,
                                    ));
                                    ui.end_row();
                                    ui.label("JWT token");
                                    ui.add(
                                        egui::TextEdit::singleline(
                                            &mut self.settings.prism_api_token,
                                        )
                                        .password(true),
                                    );
                                    ui.end_row();
                                }
                            }
                            if self.settings.connection == Connection::Direct
                                && self.settings.provider == "ollama"
                            {
                                ui.label("Ollama URL");
                                ui.add(egui::TextEdit::singleline(
                                    &mut self.settings.local_base_url,
                                ));
                                ui.end_row();
                            }
                            ui.label("Temperature");
                            ui.add(
                                egui::Slider::new(&mut self.settings.temperature, 0.0..=2.0)
                                    .step_by(0.05),
                            );
                            ui.end_row();
                        });
                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        if ui.button("Save").clicked() {
                            self.settings_status = match settings::config_path() {
                                Some(path) => match self.settings.save_to(&path) {
                                    Ok(()) => format!("saved to {}", path.display()),
                                    Err(e) => format!("save failed: {e}"),
                                },
                                None => "no config dir on this platform".into(),
                            };
                        }
                        ui.colored_label(egui::Color32::GRAY, self.settings_status.clone());
                    });
                    ui.separator();
                    ui.label(
                        egui::RichText::new(
                            "Keys are stored in plaintext, like the Prism extension.",
                        )
                        .small(),
                    );
                });
        }

        // Input area (declared before the central panel so the
        // central transcript takes the remaining space above it).
        egui::Panel::bottom("input_bar").show(ui, |ui| {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                let send_clicked = ui
                    .add_enabled(!self.streaming, egui::Button::new("Send"))
                    .clicked();
                let response = ui.add(
                    egui::TextEdit::multiline(&mut self.input)
                        .hint_text("Type a message… (Enter to send, Shift+Enter for newline)")
                        .desired_rows(2),
                );
                let enter_sends = response.lost_focus()
                    && ui.input(|i| i.key_pressed(egui::Key::Enter))
                    && !ui.input(|i| i.modifiers.shift);
                if (send_clicked || enter_sends) && !self.input.trim().is_empty() {
                    self.send();
                }
            });
            ui.add_space(2.0);
        });

        // Transcript.
        egui::CentralPanel::default().show(ui, |ui| {
            egui::ScrollArea::vertical()
                .stick_to_bottom(true)
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    if self.transcript.is_empty() {
                        ui.vertical_centered(|ui| {
                            ui.add_space(40.0);
                            ui.label("Prism — pick a provider in Settings, then say hello.");
                        });
                    }
                    for line in &self.transcript {
                        match line.role.as_str() {
                            "user" => {
                                ui.add_space(4.0);
                                ui.label(
                                    egui::RichText::new("You")
                                        .strong()
                                        .color(egui::Color32::LIGHT_BLUE),
                                );
                                ui.label(&line.content);
                            }
                            "assistant" => {
                                ui.add_space(4.0);
                                ui.label(
                                    egui::RichText::new("Prism")
                                        .strong()
                                        .color(egui::Color32::LIGHT_GREEN),
                                );
                                if line.content.is_empty() && self.streaming {
                                    ui.label(egui::RichText::new("…").weak());
                                } else {
                                    ui.label(&line.content);
                                }
                            }
                            _ => {
                                ui.add_space(2.0);
                                ui.label(
                                    egui::RichText::new(&line.content)
                                        .small()
                                        .color(egui::Color32::ORANGE),
                                );
                            }
                        }
                        ui.separator();
                    }
                });
        });
    }
}
