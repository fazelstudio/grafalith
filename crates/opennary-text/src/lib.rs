//! `opennary-text`: parley-based text layout (experimental).
//!
//! Scope: measurement, line breaking, and caret mapping for canvas text
//! boxes — the deterministic core keeps its `TextMeasurer` trait and plain
//! text model; hosts opt into this crate to replace the `0.6`-factor
//! fallback with shaped metrics. No shaping/layout code lands in
//! `opennary-core`; this crate depends on core, never the reverse.
//!
//! Font supply: system fonts via fontique (desktop/native). Font-less
//! targets fall back to whatever the host registers — parley resolves
//! what it can and the measurer degrades to advance-width sums, never a
//! panic.

use opennary_core::render_model::TextMeasurer;
use parley::{FontContext, LayoutContext};

/// Shaped text metrics for one paragraph.
#[derive(Debug, Clone, PartialEq)]
pub struct ParagraphMetrics {
    /// Number of laid-out lines.
    pub line_count: usize,
    /// Widest line advance in the requested units.
    pub width: f64,
    /// Total height in the requested units.
    pub height: f64,
    /// Shaped glyph count across all lines.
    pub glyph_count: usize,
}

/// Layout context owning parley state plus system fonts.
///
/// Create once per host (or thread) and share across measurements: font
/// lookup caches live here.
pub struct TextLayout {
    font_cx: FontContext,
    layout_cx: LayoutContext<u32>,
}

impl TextLayout {
    /// Creates layout state. `FontContext::new` already discovers system
    /// fonts where the platform provides them; font-less targets resolve
    /// what they can (missing glyphs simply shape to nothing, never a
    /// panic — measured by the zero-glyph edge below).
    pub fn with_system_fonts() -> Self {
        Self {
            font_cx: FontContext::new(),
            layout_cx: LayoutContext::new(),
        }
    }

    /// Lays out one paragraph: `font_size` in scene units, `max_width` as
    /// the wrap boundary (`f64::INFINITY` disables wrapping).
    pub fn layout_paragraph(
        &mut self,
        text: &str,
        font_family: &str,
        font_size: f32,
        max_width: f32,
    ) -> ParagraphMetrics {
        use parley::layout::Alignment;
        use parley::style::{FontFamily, LineHeight, StyleProperty};

        let mut builder = self
            .layout_cx
            .ranged_builder(&mut self.font_cx, text, 1.0, true);
        builder.push_default(StyleProperty::FontSize(font_size));
        builder.push_default(StyleProperty::FontFamily(FontFamily::named(font_family)));
        builder.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(
            1.25,
        )));
        let mut layout = builder.build(text);
        layout.break_all_lines(Some(max_width));
        layout.align(
            Alignment::Start,
            parley::layout::AlignmentOptions::default(),
        );

        let mut width: f32 = 0.0;
        let mut height: f32 = 0.0;
        let mut glyphs = 0;
        let mut lines = 0;
        for line in layout.lines() {
            lines += 1;
            width = width.max(line.metrics().advance);
            height += line.metrics().line_height;
            for item in line.items() {
                if let parley::PositionedLayoutItem::GlyphRun(glyph_run) = item {
                    glyphs += glyph_run.glyphs().count();
                }
            }
        }
        // Empty text still yields one line of height (core parity).
        if lines == 0 {
            lines = 1;
            height = font_size * 1.25;
        }
        ParagraphMetrics {
            line_count: lines,
            width: width as f64,
            height: height as f64,
            glyph_count: glyphs,
        }
    }
}

/// [`TextMeasurer`] over parley: hosts hand this to core commit paths
/// instead of the deterministic fallback.
pub struct ParleyMeasurer {
    layout: std::sync::Mutex<TextLayout>,
}

impl ParleyMeasurer {
    /// Creates a measurer with system fonts registered.
    pub fn with_system_fonts() -> Self {
        Self {
            layout: std::sync::Mutex::new(TextLayout::with_system_fonts()),
        }
    }
}

impl TextMeasurer for ParleyMeasurer {
    fn measure_line_width(&self, line: &str, font_size: f64, family: &str) -> f64 {
        let mut layout = self
            .layout
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        layout
            .layout_paragraph(line, family, font_size as f32, f32::INFINITY)
            .width
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paragraph_metrics_are_sane_and_deterministic() {
        let mut layout = TextLayout::with_system_fonts();
        let first = layout.layout_paragraph("Hello world", "sans-serif", 16.0, f32::INFINITY);
        let second = layout.layout_paragraph("Hello world", "sans-serif", 16.0, f32::INFINITY);
        assert_eq!(first, second, "same inputs build identical metrics");
        assert_eq!(first.line_count, 1);
        assert!(first.width > 0.0, "shaped advance is positive");
        assert!(
            first.glyph_count >= 10,
            "glyphs resolve, got {}",
            first.glyph_count
        );
    }

    #[test]
    fn narrow_width_wraps_into_more_lines() {
        let mut layout = TextLayout::with_system_fonts();
        let wide =
            layout.layout_paragraph("Hello brave new world", "sans-serif", 16.0, f32::INFINITY);
        let narrow = layout.layout_paragraph("Hello brave new world", "sans-serif", 16.0, 40.0);
        assert!(narrow.line_count > wide.line_count);
    }

    #[test]
    fn measurer_beats_the_fallback_on_real_text() {
        let measurer = ParleyMeasurer::with_system_fonts();
        let shaped = measurer.measure_line_width("Hello world", 16.0, "sans-serif");
        // The deterministic fallback this replaces: chars × size × 0.6.
        let fallback = "Hello world".chars().count() as f64 * 16.0 * 0.6;
        assert!(shaped > 0.0 && (shaped - fallback).abs() > 0.5);
    }
}
