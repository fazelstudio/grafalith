//! SVG import tests (`svg` feature): shapes resolve to paths, text
//! chunks to text, groups to `groupIds`, unsupported content counts as
//! skips — never silent drops, never panics.

#![cfg(feature = "svg")]

use grafalith_core::document::Document;
use grafalith_core::element::{Element, FillStyle, GradientType};
use grafalith_core::history::HistoryManager;
use grafalith_io::{import_svg_str, import_svg_str_tracked};

const FIXTURE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000000"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <g id="layer1">
    <rect x="10" y="10" width="80" height="50" fill="#ff0000" stroke="#000000" stroke-width="2"/>
    <circle cx="150" cy="40" r="20" fill="url(#g1)"/>
    <text x="10" y="120" font-size="16" font-family="monospace">Hi</text>
    <text x="10" y="140">   </text>
    <text>unpositioned</text>
  </g>
  <path d="M 0 0 Q 50 100 100 0" fill="none" stroke="#00ff00"/>
</svg>"##;

fn just_imported() -> Document {
    let mut doc = Document::new();
    let summary = import_svg_str(&mut doc, FIXTURE).expect("fixture imports");
    // rect + circle + text + curve convert; the unpositioned text chunk
    // counts as a skip (whitespace-only text never leaves usvg at all).
    assert_eq!(summary.imported, 4);
    assert_eq!(summary.skipped, 1);
    doc
}

#[test]
fn shapes_text_and_groups_convert_with_counts() {
    let doc = just_imported();
    let live = doc.get_all();
    assert_eq!(live.len(), 4);
    // Document order follows the SVG tree order.
    let kinds: Vec<&str> = live
        .iter()
        .map(|element| element.element_type_name())
        .collect();
    assert_eq!(kinds, vec!["path", "path", "text", "path"]);

    // Solid fill + stroke land on the rectangle path.
    assert!(matches!(
        &live[0].base().background_color,
        FillStyle::Solid { color } if color == "#ff0000"
    ));
    assert_eq!(live[0].base().stroke_width, 2.0);

    // Gradient fill resolves by direction and stops.
    match &live[1].base().background_color {
        FillStyle::Gradient {
            gradient_type,
            stops,
            ..
        } => {
            assert_eq!(*gradient_type, GradientType::Linear);
            assert_eq!(stops.len(), 2);
        }
        FillStyle::Solid { .. } => panic!("circle keeps its gradient fill"),
    }

    // Text chunk keeps its string, size, and family.
    match live[2] {
        Element::Text(ref text) => {
            assert_eq!(text.text, "Hi");
            assert_eq!(text.font_size, 16.0);
            assert_eq!(text.font_family, "monospace");
        }
        _ => panic!("third element is text"),
    }

    // Grouped elements share one innermost-first group id.
    let grouped: Vec<&Element> = live[..3].to_vec();
    assert!(!grouped[0].base().group_ids.is_empty());
    assert_eq!(grouped[0].base().group_ids, grouped[1].base().group_ids);
    assert_eq!(grouped[1].base().group_ids, grouped[2].base().group_ids);
    // The ungrouped curve carries no groups.
    assert!(live[3].base().group_ids.is_empty());
}

#[test]
fn malformed_svg_fails_without_touching_the_document() {
    let mut doc = Document::new();
    let nonce_before = doc.scene_nonce();
    let result = import_svg_str(&mut doc, "this is not xml <oops");
    assert!(result.is_err());
    assert_eq!(doc.element_count(), 0);
    assert_eq!(doc.scene_nonce(), nonce_before);
}

#[test]
fn tracked_svg_import_is_one_undoable_entry() {
    let mut doc = Document::new();
    let mut history = HistoryManager::new();
    let summary = import_svg_str_tracked(&mut doc, &mut history, FIXTURE).expect("imports");
    assert_eq!(summary.imported, 4);
    assert_eq!(doc.element_count(), 4);
    assert!(history.undo(&mut doc).expect("undo works"));
    assert_eq!(doc.element_count(), 0);
    assert!(history.redo(&mut doc).expect("redo works"));
    assert_eq!(doc.element_count(), 4);
}
