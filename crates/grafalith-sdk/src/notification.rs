//! Notification routing DTOs (Rust → TypeScript toast provider).
//!
//! The engine never renders UI; when native code needs to surface a message
//! it builds a [`Notification`] here and the host forwards the JSON to the
//! shell toast region (level, actions, lifetime, source included).
//! Serialization is hand-rolled over `std` only so the SDK stays
//! dependency-free by contract (see the `workspace_wiring` test).

/// Notification severity (toast styling + screen-reader role).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Severity of a host notification.
pub enum NotificationLevel {
    /// Informational message.
    Info,
    /// Successful completion.
    Success,
    /// Non-blocking problem.
    Warning,
    /// Blocking failure.
    Error,
}

impl NotificationLevel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Success => "success",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

/// One notification action running a command when picked.
#[derive(Debug, Clone)]
/// Action button on a host notification.
pub struct NotificationAction {
    /// Button label.
    pub label: String,
    /// Command id run when picked.
    pub command_id: String,
}

/// Host notification routed to the shell toast region.
#[derive(Debug, Clone)]
/// Notification routed from Rust to the TypeScript toast provider.
pub struct Notification {
    /// Body text.
    pub message: String,
    /// Severity.
    pub level: NotificationLevel,
    /// Action buttons (the host renders the first as primary).
    pub actions: Vec<NotificationAction>,
    /// Lifetime in ms (`None` means the host default; `Some(0)` persists).
    pub duration: Option<u64>,
    /// Extension attribution (`publisher.id`) or core surface name.
    pub source: Option<String>,
}

impl Notification {
    /// Build an informational notification.
    #[must_use]
    pub fn info(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            level: NotificationLevel::Info,
            actions: Vec::new(),
            duration: None,
            source: None,
        }
    }

    /// Serialize for the Tauri → renderer crossing (JSON text).
    #[must_use]
    pub fn to_json(&self) -> String {
        let mut out = String::from("{\"message\":\"");
        out.push_str(&escape(&self.message));
        out.push_str("\",\"level\":\"");
        out.push_str(self.level.as_str());
        out.push_str("\",\"actions\":[");
        for (index, action) in self.actions.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str("{\"label\":\"");
            out.push_str(&escape(&action.label));
            out.push_str("\",\"commandId\":\"");
            out.push_str(&escape(&action.command_id));
            out.push_str("\"}");
        }
        out.push_str("],\"duration\":");
        match self.duration {
            Some(millis) => out.push_str(&millis.to_string()),
            None => out.push_str("null"),
        }
        out.push_str(",\"source\":");
        match &self.source {
            Some(source) => {
                out.push('"');
                out.push_str(&escape(source));
                out.push('"');
            }
            None => out.push_str("null"),
        }
        out.push('}');
        out
    }
}

fn escape(raw: &str) -> String {
    let mut escaped = String::with_capacity(raw.len());
    for c in raw.chars() {
        match c {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            c if (c as u32) < 0x20 => escaped.push_str(&format!("\\u{:04x}", c as u32)),
            c => escaped.push(c),
        }
    }
    escaped
}
