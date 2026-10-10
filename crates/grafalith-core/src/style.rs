//! Bulk style operations (persistent style data only).
//!
//! TS source: `packages/core/src/scene/style-actions.ts` (bulk setters +
//! mixed-state readers for UI).
//!
//! Persistent style (fill, stroke, opacity, line width) only. Transient
//! UI state (hovered, selected, editing, dragging) lives outside the
//! document (see [`crate::selection`]) and never serializes. The
//! mixed-state readers are UI helpers kept here as pure queries; the
//! adapter layer re-exports them for panels.

use crate::document::Document;
use crate::element::{ElementId, FillStyle, StrokeStyle};
use crate::EngineResult;

/// Sets the stroke color on every stored element in the list (TS parity:
/// deleted elements are included when explicitly addressed; unknown ids
/// are skipped).
pub fn set_stroke_color(
    doc: &mut Document,
    element_ids: &[ElementId],
    color: impl Into<String>,
) -> EngineResult<()> {
    let color = color.into();
    for id in element_ids {
        if let Some(element) = doc.get(id.as_str()) {
            let mut next = element.clone();
            next.base_mut().stroke_color = color.clone();
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Sets the background fill on every stored element in the list.
pub fn set_background_fill(
    doc: &mut Document,
    element_ids: &[ElementId],
    fill: FillStyle,
) -> EngineResult<()> {
    for id in element_ids {
        if let Some(element) = doc.get(id.as_str()) {
            let mut next = element.clone();
            next.base_mut().background_color = fill.clone();
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Sets the stroke width on every stored element in the list.
pub fn set_stroke_width(
    doc: &mut Document,
    element_ids: &[ElementId],
    width: f64,
) -> EngineResult<()> {
    for id in element_ids {
        if let Some(element) = doc.get(id.as_str()) {
            let mut next = element.clone();
            next.base_mut().stroke_width = width;
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Sets the stroke dash pattern on every stored element in the list.
pub fn set_stroke_style(
    doc: &mut Document,
    element_ids: &[ElementId],
    style: StrokeStyle,
) -> EngineResult<()> {
    for id in element_ids {
        if let Some(element) = doc.get(id.as_str()) {
            let mut next = element.clone();
            next.base_mut().stroke_style = style;
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Sets opacity on every stored element in the list, clamped to 0–100
/// (TS parity: the clamp lives in the operation, storage itself only
/// requires finiteness).
pub fn set_opacity(
    doc: &mut Document,
    element_ids: &[ElementId],
    opacity: f64,
) -> EngineResult<()> {
    let clamped = opacity.clamp(0.0, 100.0);
    for id in element_ids {
        if let Some(element) = doc.get(id.as_str()) {
            let mut next = element.clone();
            next.base_mut().opacity = clamped;
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Common stroke color across the list, or `None` when mixed, empty, or
/// fully unknown (TS `getMixedStrokeColor` parity: missing ids are
/// skipped).
pub fn mixed_stroke_color(doc: &Document, element_ids: &[ElementId]) -> Option<String> {
    let mut common: Option<&str> = None;
    for id in element_ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        match common {
            None => common = Some(element.base().stroke_color.as_str()),
            Some(current) if current == element.base().stroke_color => {}
            Some(_) => return None,
        }
    }
    common.map(str::to_string)
}

/// Common opacity across the list, or `None` when mixed/empty/unknown.
pub fn mixed_opacity(doc: &Document, element_ids: &[ElementId]) -> Option<f64> {
    shared_value(doc, element_ids, |element| element.base().opacity)
}

/// Common stroke width across the list, or `None` when mixed/empty/unknown.
pub fn mixed_stroke_width(doc: &Document, element_ids: &[ElementId]) -> Option<f64> {
    shared_value(doc, element_ids, |element| element.base().stroke_width)
}

/// Shared reader behind [`mixed_opacity`] and [`mixed_stroke_width`].
fn shared_value(
    doc: &Document,
    element_ids: &[ElementId],
    pick: impl Fn(&crate::element::Element) -> f64,
) -> Option<f64> {
    let mut common: Option<f64> = None;
    for id in element_ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        let value = pick(element);
        match common {
            None => common = Some(value),
            Some(current) if current == value => {}
            Some(_) => return None,
        }
    }
    common
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator, Element, ElementFillStyle};

    fn document_with(colors: &[&str]) -> (Document, Vec<ElementId>) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut ids = Vec::new();
        for (index, color) in colors.iter().enumerate() {
            let id = format!("el-{index}");
            let mut rect = create_rectangle(&mut gen);
            rect.base.id = ElementId::of(id.clone());
            rect.base.stroke_color = (*color).to_string();
            doc.upsert(Element::Rectangle(rect)).unwrap();
            ids.push(ElementId::of(id));
        }
        (doc, ids)
    }

    #[test]
    fn bulk_setters_apply_and_mixed_readers_agree() {
        let (mut doc, ids) = document_with(&["#111111", "#111111"]);
        assert_eq!(mixed_stroke_color(&doc, &ids), Some("#111111".to_string()));

        set_stroke_color(&mut doc, &ids, "#ff0000").unwrap();
        assert_eq!(mixed_stroke_color(&doc, &ids), Some("#ff0000".to_string()));

        set_stroke_width(&mut doc, &ids[..1], 4.0).unwrap();
        assert_eq!(mixed_stroke_width(&doc, &ids), None, "widths now differ");
        assert_eq!(mixed_stroke_width(&doc, &ids[..1]), Some(4.0));

        set_opacity(&mut doc, &ids, 150.0).unwrap();
        assert_eq!(mixed_opacity(&doc, &ids), Some(100.0), "clamped to 100");
        set_opacity(&mut doc, &ids[..1], -20.0).unwrap();
        assert_eq!(doc.get("el-0").unwrap().base().opacity, 0.0);

        set_stroke_style(&mut doc, &ids, StrokeStyle::Dashed).unwrap();
        assert_eq!(
            doc.get("el-0").unwrap().base().stroke_style,
            StrokeStyle::Dashed
        );
        set_background_fill(
            &mut doc,
            &ids,
            FillStyle::Solid {
                color: "#e8f4fc".to_string(),
            },
        )
        .unwrap();
        assert!(matches!(
            doc.get("el-0").unwrap().base().background_color,
            FillStyle::Solid { .. }
        ));
        assert_eq!(
            doc.get("el-0").unwrap().base().fill_style,
            ElementFillStyle::Solid
        );
    }

    #[test]
    fn mixed_readers_skip_nothing_and_handle_empty() {
        let (doc, _) = document_with(&[]);
        assert_eq!(mixed_stroke_color(&doc, &[]), None);
        assert_eq!(mixed_opacity(&doc, &[ElementId::of("ghost")]), None);
    }
}
