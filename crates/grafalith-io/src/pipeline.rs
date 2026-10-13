//! Staged document pipeline: export, import, and PNG export planning.
//!
//! TS sources: `packages/core/src/io/export-json.ts` (envelope shape,
//! non-deleted elements, full order vector) and
//! `packages/core/src/io/import-json.ts` (`migrateScene`, per-element
//! validation with skip counts, referential repair, atomic clear-and-fill,
//! order restoration), plus `packages/core/src/io/export-png.ts` (visible
//! bounds, padding, scale, 4096 px pixel cap, hidden exclusion).
//!
//! Stage order — parse → version → validate → repair → candidate → commit
//! — with the document untouched until commit:
//!
//! ```text
//! &str
//!   ↓ parse (malformed JSON / non-object root rejected)
//! envelope { version, elements[], elementOrder[] }
//!   ↓ version (`schemaVersion ?? version ?? 1`; unsupported rejected)
//! per-element convert (unknown/mistyped → skipped + counted)
//!   ↓ repair + candidate ([`Document::plan_snapshot`]: dangling refs →
//!      None, order filtered, zero-valid rejected)
//! commit — direct ([`Document::apply_snapshot`]) or one undoable
//!   transaction ([`import_str_tracked`])
//! ```
//!
//! Export never includes transient editor state: selection, hover, tool,
//! hover, tool, drag, and caret live outside [`Document`](grafalith_core::document::Document)
//! by construction, so the snapshot cannot leak them. PNG planning is pure
//! math — canvas allocation and rasterization stay host-side.

use grafalith_core::document::{Document, GroupRecord, ImportSummary, SCHEMA_VERSION};
use grafalith_core::element::{Element, ElementId};
use grafalith_core::geometry::Bounds;
use grafalith_core::{EngineError, EngineResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::{element_from_value, element_to_value};

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/// Raw scene envelope: version fields are optional so legacy payloads
/// (missing version → v1, exactly like TS `migrateScene`) still load.
/// `elements` stays a [`Value`] so a non-array can be rejected with the
/// envelope's error rather than a serde type error.
#[derive(Debug, Deserialize)]
struct RawEnvelope {
    /// Preferred schema version (TS `schemaVersion`).
    #[serde(rename = "schemaVersion", default)]
    schema_version: Option<u32>,
    /// Legacy version alias (TS `version`, always 1).
    #[serde(default)]
    version: Option<u32>,
    /// Element array (must be present and an array).
    #[serde(default)]
    elements: Option<Value>,
    /// Z-order (optional; non-string entries are dropped, TS parity).
    #[serde(rename = "elementOrder", default)]
    element_order: Option<Value>,
    #[serde(default)]
    groups: Option<Value>,
    #[serde(default)]
    labels: Option<Value>,
}

/// Outgoing scene envelope, mirroring TS `SerializedScene` exactly:
/// `schemaVersion` + legacy `version` alias, z-ordered non-deleted
/// elements, and the full order vector.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SceneEnvelopeOut {
    /// Envelope schema version.
    schema_version: u32,
    /// Legacy alias, always 1.
    version: u32,
    /// Non-deleted elements in z-order.
    elements: Vec<Value>,
    /// Full z-order, including tombstone ids (TS export parity).
    element_order: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    groups: Vec<GroupRecordOut>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    labels: Vec<ElementLabelOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupRecordOut {
    id: String,
    name: String,
    parent_group_id: Option<String>,
    #[serde(skip_serializing_if = "is_false", default)]
    locked: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ElementLabelOut {
    id: String,
    name: String,
}

fn parse_groups(value: Option<Value>) -> Vec<GroupRecord> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let id = object.get("id")?.as_str()?;
            Some(GroupRecord {
                id: ElementId::of(id),
                name: object
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .to_string(),
                parent_id: object
                    .get("parentGroupId")
                    .and_then(Value::as_str)
                    .map(ElementId::of),
                locked: object
                    .get("locked")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect()
}

fn parse_labels(value: Option<Value>) -> Vec<grafalith_core::document::ElementLabel> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let id = object.get("id")?.as_str()?;
            let name = object.get("name")?.as_str()?;
            if name.trim().is_empty() {
                return None;
            }
            Some(grafalith_core::document::ElementLabel {
                id: ElementId::of(id),
                name: name.trim().to_string(),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Exports the document to a compact JSON string (TS `exportSceneToJSON`
/// parity: versioned envelope, non-deleted elements in z-order, full order
/// vector including tombstone ids).
///
/// Fails loudly instead of emitting corrupt JSON when in-memory state holds
/// non-finite floats (which JSON cannot represent).
pub fn export_str(doc: &Document) -> EngineResult<String> {
    let snapshot = doc.to_snapshot();
    let mut elements = Vec::with_capacity(snapshot.elements.len());
    for element in &snapshot.elements {
        elements.push(element_to_value(element).map_err(|err| {
            EngineError::InvalidInput(format!(
                "element '{}' is not JSON-serializable: {err}",
                element.id().as_str()
            ))
        })?);
    }
    let envelope = SceneEnvelopeOut {
        schema_version: SCHEMA_VERSION,
        version: SCHEMA_VERSION,
        elements,
        element_order: snapshot
            .element_order
            .iter()
            .map(|id| id.as_str().to_string())
            .collect(),
        groups: snapshot
            .groups
            .iter()
            .map(|group| GroupRecordOut {
                id: group.id.as_str().to_string(),
                name: group.name.clone(),
                parent_group_id: group.parent_id.as_ref().map(|id| id.as_str().to_string()),
                locked: group.locked,
            })
            .collect(),
        labels: snapshot
            .labels
            .iter()
            .map(|label| ElementLabelOut {
                id: label.id.as_str().to_string(),
                name: label.name.clone(),
            })
            .collect(),
    };
    serde_json::to_string(&envelope)
        .map_err(|err| EngineError::InvalidInput(format!("scene export failed: {err}")))
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/// Parsed envelope parts: element values, order strings, group records, and
/// explicit element labels.
type ParsedEnvelope = (
    Vec<Value>,
    Vec<String>,
    Vec<GroupRecord>,
    Vec<grafalith_core::document::ElementLabel>,
);

/// Parses the envelope version and raw element values without touching the
/// document (pipeline stages: parse → version).
fn parse_envelope(json: &str) -> EngineResult<ParsedEnvelope> {
    let raw: RawEnvelope = serde_json::from_str(json)
        .map_err(|_| EngineError::InvalidInput("invalid JSON: could not parse".to_string()))?;
    // `from_str` to a struct already rejects non-object roots (arrays,
    // strings, numbers fail struct deserialization) with the same error.
    let version = raw.schema_version.or(raw.version).unwrap_or(1);
    if version != SCHEMA_VERSION {
        return Err(EngineError::InvalidInput(format!(
            "unsupported scene version: {version}"
        )));
    }
    let elements = match raw.elements {
        Some(Value::Array(items)) => items,
        _ => {
            return Err(EngineError::InvalidInput(
                "invalid scene format: \"elements\" must be an array".to_string(),
            ));
        }
    };
    // TS parity: a non-array order is ignored (not an error); non-string
    // entries inside an array are dropped.
    let order = match raw.element_order {
        Some(Value::Array(items)) => items
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    };
    Ok((
        elements,
        order,
        parse_groups(raw.groups),
        parse_labels(raw.labels),
    ))
}

/// Converts raw element values to domain elements, skipping unknown or
/// mistyped entries (TS per-element leniency). Returns the converted
/// elements plus the skip count.
fn convert_elements(values: &[Value]) -> (Vec<Element>, usize) {
    let mut elements = Vec::new();
    let mut skipped = 0;
    for value in values {
        match element_from_value(value) {
            Some(element) => elements.push(element),
            None => skipped += 1,
        }
    }
    (elements, skipped)
}

/// Imports a scene from a JSON string, replacing document content
/// (TS `importSceneFromJSON` parity without the history integration).
///
/// Validation and repair complete before anything is stored: malformed
/// JSON, unsupported versions, and zero-valid payloads leave the document
/// (and its nonce) untouched. Returns admitted/skipped counts. For a
/// one-entry undoable import, use [`import_str_tracked`].
pub fn import_str(doc: &mut Document, json: &str) -> EngineResult<ImportSummary> {
    let (values, order, groups, labels) = parse_envelope(json)?;
    let (converted, convert_skipped) = convert_elements(&values);
    if converted.is_empty() && !values.is_empty() {
        return Err(EngineError::InvalidInput(
            "no valid elements found in scene data".to_string(),
        ));
    }
    let snapshot = grafalith_core::document::DocumentSnapshot {
        schema_version: SCHEMA_VERSION,
        legacy_version: SCHEMA_VERSION,
        elements: converted,
        element_order: order
            .into_iter()
            .map(grafalith_core::element::ElementId::of)
            .collect(),
        groups,
        labels,
    };
    let summary = doc.apply_snapshot(&snapshot)?;
    Ok(ImportSummary {
        imported: summary.imported,
        skipped: summary.skipped + convert_skipped,
    })
}

/// Imports a scene from a JSON string as one undoable history entry.
///
/// Parsing, conversion, and planning are identical to [`import_str`]; the
/// commit runs inside a [`HistoryManager`](grafalith_core::history::HistoryManager)
/// transaction over the shared [`Document::plan_snapshot`](grafalith_core::document::Document::plan_snapshot)
/// plan, so undo restores the exact pre-import content and a failed commit
/// rolls back instead of leaving partial state.
pub fn import_str_tracked(
    doc: &mut Document,
    history: &mut grafalith_core::history::HistoryManager,
    json: &str,
) -> EngineResult<ImportSummary> {
    let (values, order, groups, labels) = parse_envelope(json)?;
    let (converted, convert_skipped) = convert_elements(&values);
    if converted.is_empty() && !values.is_empty() {
        return Err(EngineError::InvalidInput(
            "no valid elements found in scene data".to_string(),
        ));
    }
    let snapshot = grafalith_core::document::DocumentSnapshot {
        schema_version: SCHEMA_VERSION,
        legacy_version: SCHEMA_VERSION,
        elements: converted,
        element_order: order
            .into_iter()
            .map(grafalith_core::element::ElementId::of)
            .collect(),
        groups,
        labels,
    };
    let plan = Document::plan_snapshot(&snapshot)?;
    let imported = plan.imported;
    let skipped = plan.skipped + convert_skipped;
    history.transaction(doc, |ctx| {
        let visible: Vec<grafalith_core::element::ElementId> = ctx
            .doc()
            .get_all()
            .iter()
            .map(|element| (*element).id().clone())
            .collect();
        for id in visible {
            ctx.soft_delete(id.as_str())?;
        }
        for element in &plan.elements {
            ctx.upsert(element.clone())?;
        }
        if let Some(order) = plan.order.clone() {
            ctx.set_order(order)?;
        }
        ctx.set_groups(plan.groups.clone())?;
        ctx.set_labels(plan.labels.clone())?;
        Ok(())
    })?;
    Ok(ImportSummary { imported, skipped })
}

/// Parses one fill value into the domain fill: a plain string sets a solid
/// fill, a fill object (`{"type":"solid"|"gradient", …}`) parses as the
/// versioned schema DTO. Returns `None` for mistyped payloads.
///
/// Shared by file import and `setStyle` so both paths validate identically
/// — one parser, no drift.
pub fn parse_fill_style(value: &Value) -> Option<grafalith_core::element::FillStyle> {
    crate::schema::fill_from_value(value)
}

// ---------------------------------------------------------------------------
// PNG export planning
// ---------------------------------------------------------------------------
/// Maximum canvas dimension in pixels (TS `MAX_DIMENSION = 4096` parity —
/// a 10k-world-unit scene at scale 2 would otherwise allocate ~1.6 GB).
pub const PNG_MAX_DIMENSION: u32 = 4096;

/// Options for PNG export planning (TS `PNGExportOptions` parity).
#[derive(Debug, Clone, PartialEq)]
pub struct PngExportOptions {
    /// Canvas background (`"transparent"` leaves alpha untouched).
    pub background: String,
    /// Padding around the content bounds in scene units.
    pub padding: f64,
    /// Resolution scale factor (2 = retina).
    pub scale: f64,
}

impl Default for PngExportOptions {
    /// TS defaults: transparent background, 20 units padding, scale 2.
    fn default() -> Self {
        Self {
            background: "transparent".to_string(),
            padding: 20.0,
            scale: 2.0,
        }
    }
}

/// Pure PNG export descriptor (TS `exportSceneToPNG` math without the
/// canvas).
///
/// The host allocates `canvas_width_px × canvas_height_px`, fills
/// `background` (unless transparent), translates by `(padding -
/// content_min)`, scales by `effective_scale`, and draws the visible
/// non-hidden elements in z-order. Canvas creation, rasterization, and
/// blob encoding stay host-side.
#[derive(Debug, Clone, PartialEq)]
pub struct PngExportPlan {
    /// Union of visible non-hidden element bounds in scene units.
    pub content_bounds: Bounds,
    /// Canvas width in pixels (at least 1).
    pub canvas_width_px: u32,
    /// Canvas height in pixels (at least 1).
    pub canvas_height_px: u32,
    /// Scale applied after the 4096 px clamp (`scale × downscale`).
    pub effective_scale: f64,
    /// Canvas background (`"transparent"` = no fill pass).
    pub background: String,
    /// Padding around the content in scene units.
    pub padding: f64,
}

/// Plans PNG export for the document's visible non-hidden elements.
///
/// Errors on empty scenes (`"No elements to export"`) and on non-finite
/// or non-positive content extents (`"Invalid scene bounds…"`) — both TS
/// error parity, both raised before any host allocation.
pub fn plan_png_export(doc: &Document, options: &PngExportOptions) -> EngineResult<PngExportPlan> {
    let visible: Vec<&Element> = doc
        .get_all()
        .into_iter()
        .filter(|element| !element.base().hidden)
        .collect();
    if visible.is_empty() {
        return Err(EngineError::InvalidInput(
            "No elements to export".to_string(),
        ));
    }
    let mut bounds = visible[0].bounds();
    for element in &visible[1..] {
        bounds = bounds.union(&element.bounds());
    }
    let width = (bounds.max_x - bounds.min_x) + options.padding * 2.0;
    let height = (bounds.max_y - bounds.min_y) + options.padding * 2.0;
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(EngineError::InvalidInput(
            "Invalid scene bounds for PNG export".to_string(),
        ));
    }
    let requested_w = (width * options.scale).round();
    let requested_h = (height * options.scale).round();
    let downscale = (f64::from(PNG_MAX_DIMENSION) / requested_w.max(requested_h)).min(1.0);
    let effective_scale = options.scale * downscale;
    Ok(PngExportPlan {
        content_bounds: bounds,
        canvas_width_px: (width * effective_scale).round().max(1.0) as u32,
        canvas_height_px: (height * effective_scale).round().max(1.0) as u32,
        effective_scale,
        background: options.background.clone(),
        padding: options.padding,
    })
}

// ---------------------------------------------------------------------------
// Shared raster framing (JPEG/WebP; PNG keeps its pinned TS-parity body)
// ---------------------------------------------------------------------------

/// Union of visible non-hidden element bounds plus pixel math shared by the
/// lossy export planners. `format` names the format in error text only.
fn plan_raster_frame(
    doc: &Document,
    padding: f64,
    scale: f64,
    max_dimension: u32,
    format: &str,
) -> EngineResult<(Bounds, u32, u32, f64)> {
    let visible: Vec<&Element> = doc
        .get_all()
        .into_iter()
        .filter(|element| !element.base().hidden)
        .collect();
    if visible.is_empty() {
        return Err(EngineError::InvalidInput(
            "No elements to export".to_string(),
        ));
    }
    let mut bounds = visible[0].bounds();
    for element in &visible[1..] {
        bounds = bounds.union(&element.bounds());
    }
    let width = (bounds.max_x - bounds.min_x) + padding * 2.0;
    let height = (bounds.max_y - bounds.min_y) + padding * 2.0;
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(EngineError::InvalidInput(format!(
            "Invalid scene bounds for {format} export"
        )));
    }
    let requested_w = (width * scale).round();
    let requested_h = (height * scale).round();
    let downscale = (f64::from(max_dimension) / requested_w.max(requested_h)).min(1.0);
    let effective_scale = scale * downscale;
    Ok((
        bounds,
        (width * effective_scale).round().max(1.0) as u32,
        (height * effective_scale).round().max(1.0) as u32,
        effective_scale,
    ))
}

/// Clamps an encoder quality hint into the valid 1–100 range (host hint,
/// not content: clamping never fails the plan).
fn clamp_quality(quality: u8) -> u8 {
    quality.clamp(1, 100)
}

// ---------------------------------------------------------------------------
// JPEG export planning (no alpha channel)
// ---------------------------------------------------------------------------

/// Options for JPEG export planning. JPEG cannot encode alpha, so a
/// `"transparent"` background resolves to white in the plan (explicit,
/// documented here — never silent).
#[derive(Debug, Clone, PartialEq)]
pub struct JpegExportOptions {
    /// Canvas background (`"transparent"` resolves to `"#ffffff"`).
    pub background: String,
    /// Padding around the content bounds in scene units.
    pub padding: f64,
    /// Resolution scale factor (2 = retina).
    pub scale: f64,
    /// Quality hint 1–100 for the host encoder (clamped, default 90).
    pub quality: u8,
}

impl Default for JpegExportOptions {
    /// White background (no alpha in JPEG), 20 units padding, scale 2,
    /// quality 90.
    fn default() -> Self {
        Self {
            background: "#ffffff".to_string(),
            padding: 20.0,
            scale: 2.0,
            quality: 90,
        }
    }
}

/// Pure JPEG export descriptor: same framing math as PNG, plus the resolved
/// background and quality hint. Encoding stays host-side.
#[derive(Debug, Clone, PartialEq)]
pub struct JpegExportPlan {
    /// Union of visible non-hidden element bounds in scene units.
    pub content_bounds: Bounds,
    /// Canvas width in pixels (at least 1).
    pub canvas_width_px: u32,
    /// Canvas height in pixels (at least 1).
    pub canvas_height_px: u32,
    /// Scale applied after the 4096 px clamp.
    pub effective_scale: f64,
    /// Resolved canvas background (never `"transparent"`).
    pub background: String,
    /// Padding around the content in scene units.
    pub padding: f64,
    /// Quality hint 1–100 for the host encoder.
    pub quality: u8,
}

/// Plans JPEG export for the document's visible non-hidden elements.
///
/// Errors on empty scenes and on non-finite or non-positive content
/// extents, before any host allocation.
pub fn plan_jpeg_export(
    doc: &Document,
    options: &JpegExportOptions,
) -> EngineResult<JpegExportPlan> {
    let background = if options.background == "transparent" {
        "#ffffff".to_string()
    } else {
        options.background.clone()
    };
    let (content_bounds, canvas_width_px, canvas_height_px, effective_scale) = plan_raster_frame(
        doc,
        options.padding,
        options.scale,
        PNG_MAX_DIMENSION,
        "JPEG",
    )?;
    Ok(JpegExportPlan {
        content_bounds,
        canvas_width_px,
        canvas_height_px,
        effective_scale,
        background,
        padding: options.padding,
        quality: clamp_quality(options.quality),
    })
}

// ---------------------------------------------------------------------------
// WebP export planning (alpha-capable, lossy or lossless)
// ---------------------------------------------------------------------------

/// Options for WebP export planning (alpha-capable like PNG).
#[derive(Debug, Clone, PartialEq)]
pub struct WebpExportOptions {
    /// Canvas background (`"transparent"` leaves alpha untouched).
    pub background: String,
    /// Padding around the content bounds in scene units.
    pub padding: f64,
    /// Resolution scale factor (2 = retina).
    pub scale: f64,
    /// Quality hint 1–100 for lossy encoding (clamped, default 90;
    /// ignored when `lossless` is set).
    pub quality: u8,
    /// Lossless encoding hint for the host encoder (default false).
    pub lossless: bool,
}

impl Default for WebpExportOptions {
    /// TS-style defaults: transparent background, 20 units padding, scale
    /// 2, quality 90, lossy.
    fn default() -> Self {
        Self {
            background: "transparent".to_string(),
            padding: 20.0,
            scale: 2.0,
            quality: 90,
            lossless: false,
        }
    }
}

/// Pure WebP export descriptor: PNG-style framing plus encoder hints.
/// Encoding stays host-side.
#[derive(Debug, Clone, PartialEq)]
pub struct WebpExportPlan {
    /// Union of visible non-hidden element bounds in scene units.
    pub content_bounds: Bounds,
    /// Canvas width in pixels (at least 1).
    pub canvas_width_px: u32,
    /// Canvas height in pixels (at least 1).
    pub canvas_height_px: u32,
    /// Scale applied after the 4096 px clamp.
    pub effective_scale: f64,
    /// Canvas background (`"transparent"` = no fill pass).
    pub background: String,
    /// Padding around the content in scene units.
    pub padding: f64,
    /// Quality hint 1–100 for lossy encoding.
    pub quality: u8,
    /// Lossless encoding hint.
    pub lossless: bool,
}

/// Plans WebP export for the document's visible non-hidden elements.
///
/// Errors on empty scenes and on non-finite or non-positive content
/// extents, before any host allocation.
pub fn plan_webp_export(
    doc: &Document,
    options: &WebpExportOptions,
) -> EngineResult<WebpExportPlan> {
    let (content_bounds, canvas_width_px, canvas_height_px, effective_scale) = plan_raster_frame(
        doc,
        options.padding,
        options.scale,
        PNG_MAX_DIMENSION,
        "WebP",
    )?;
    Ok(WebpExportPlan {
        content_bounds,
        canvas_width_px,
        canvas_height_px,
        effective_scale,
        background: options.background.clone(),
        padding: options.padding,
        quality: clamp_quality(options.quality),
        lossless: options.lossless,
    })
}
