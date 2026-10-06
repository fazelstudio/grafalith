//! Clipboard payload codec: versioned JSON plus host publish/subscribe.
//!
//! TS source: `packages/core/src/interaction/clipboard.ts` —
//! `navigator.clipboard.writeText(JSON.stringify(elements))` writes a bare
//! element array best-effort, and no TS path ever reads it back (paste
//! consumes the internal buffer only).
//!
//! Interchange rule (explicit and versioned): Rust **writes** a versioned
//! envelope (`{"schemaVersion": 1, "elements": […]}`) so future schemas can
//! route on the version, and **reads** both the versioned envelope and a
//! bare element array (the exact bytes TS writes), so payloads copied from a
//! TS host still paste.
//!
//! The TS-never-reads asymmetry is intentional and documented: no TS
//! behavior changes, and no Rust reader rejects TS-authored bytes. The OS
//! clipboard itself crosses the
//! [`ClipboardAdapter`](nary_core::clipboard::ClipboardAdapter)
//! string boundary — [`publish_clipboard`] / [`subscribe_clipboard`] are the
//! only helpers that touch it, and core still never does.

use nary_core::clipboard::ClipboardAdapter;
use nary_core::document::SCHEMA_VERSION;
use nary_core::element::Element;
use nary_core::{EngineError, EngineResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::{element_from_value, element_to_value};

/// Versioned clipboard envelope (what Rust publishes).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardEnvelope {
    /// Payload schema version.
    schema_version: u32,
    /// Buffered elements.
    elements: Vec<Value>,
}

/// Decoded clipboard payload: admitted elements plus the skip count
/// (surfaced instead of silently dropping data, like import counts).
#[derive(Debug, Clone, PartialEq)]
pub struct ClipboardDecode {
    /// Admitted elements (validated, in buffer order).
    pub elements: Vec<Element>,
    /// Entries skipped as unknown or mistyped.
    pub skipped: usize,
}

/// Encodes buffered elements to the versioned payload string.
pub fn encode_clipboard(elements: &[Element]) -> EngineResult<String> {
    let mut values = Vec::with_capacity(elements.len());
    for element in elements {
        values.push(element_to_value(element).map_err(|err| {
            EngineError::InvalidInput(format!(
                "element '{}' is not JSON-serializable: {err}",
                element.id().as_str()
            ))
        })?);
    }
    let envelope = ClipboardEnvelope {
        schema_version: SCHEMA_VERSION,
        elements: values,
    };
    serde_json::to_string(&envelope)
        .map_err(|err| EngineError::InvalidInput(format!("clipboard encode failed: {err}")))
}

/// Decodes a clipboard payload string: the versioned envelope, or — for
/// TS-authored bytes — a bare element array.
///
/// Unknown or mistyped entries are skipped and counted; an unsupported
/// envelope version or a non-array/non-object payload is a typed error.
/// A versioned envelope whose array converts to zero elements (from a
/// non-empty array) is rejected, matching import strictness.
pub fn decode_clipboard(payload: &str) -> EngineResult<ClipboardDecode> {
    let value: Value = serde_json::from_str(payload)
        .map_err(|_| EngineError::InvalidInput("invalid JSON: could not parse".to_string()))?;
    let (version, items) = match &value {
        Value::Array(items) => (1, items.clone()),
        Value::Object(_) => {
            let envelope: ClipboardEnvelope = serde_json::from_value(value).map_err(|_| {
                EngineError::InvalidInput(
                    "invalid clipboard format: expected schemaVersion and elements".to_string(),
                )
            })?;
            if envelope.schema_version != SCHEMA_VERSION {
                return Err(EngineError::InvalidInput(format!(
                    "unsupported clipboard version: {}",
                    envelope.schema_version
                )));
            }
            (envelope.schema_version, envelope.elements)
        }
        _ => {
            return Err(EngineError::InvalidInput(
                "invalid clipboard format: expected an element array or envelope".to_string(),
            ));
        }
    };
    let _ = version;
    let mut elements = Vec::new();
    let mut skipped = 0;
    for item in &items {
        match element_from_value(item) {
            Some(element) => {
                if element.validate().is_ok() {
                    elements.push(element);
                } else {
                    skipped += 1;
                }
            }
            None => skipped += 1,
        }
    }
    if elements.is_empty() && !items.is_empty() {
        return Err(EngineError::InvalidInput(
            "no valid elements found in clipboard data".to_string(),
        ));
    }
    Ok(ClipboardDecode { elements, skipped })
}

/// Publishes buffered elements to the host system clipboard
/// (best-effort from core's perspective: adapter failures are the host's
/// to report — this helper only encodes and hands over the string).
pub fn publish_clipboard(
    adapter: &mut dyn ClipboardAdapter,
    elements: &[Element],
) -> EngineResult<()> {
    let payload = encode_clipboard(elements)?;
    adapter.write_text(payload);
    Ok(())
}

/// Reads a clipboard payload from the host system clipboard.
///
/// Returns `None` when the host has no text; otherwise decodes (versioned
/// or TS bare-array) or returns the typed decode error.
pub fn subscribe_clipboard(
    adapter: &dyn ClipboardAdapter,
) -> EngineResult<Option<ClipboardDecode>> {
    match adapter.read_text() {
        None => Ok(None),
        Some(payload) => decode_clipboard(&payload).map(Some),
    }
}
