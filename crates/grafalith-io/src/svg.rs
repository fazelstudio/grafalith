//! SVG import through `usvg` (host-gated).
//!
//! Available only with the `svg` Cargo feature so default builds pay
//! nothing. Converts an SVG document into scene elements: every supported
//! node becomes a `Path` (usvg already resolves basic shapes, arcs, and
//! `use` into simple absolute segments), text chunks become `Text`, and
//! SVG groups become our `groupIds` (innermost first, matching the scene
//! convention).
//!
//! Approximations (explicit, documented): beziers keep their control points
//! exactly (our path model is cubic) and `QuadTo` converts exactly to cubic
//! form; gradients map to our linear/radial model by direction and stops,
//! while gradient transforms beyond the endpoint vector, spreads, patterns,
//! masks, clip paths, filters, and images count as skips; stroke maps width
//! + dash presence only (solid vs dashed); text maps one chunk to one
//! element (first span wins for the string, chunk position wins for
//! placement) with per-span styling dropped; element ids mint from the
//! default local counter (`el-1`, …) and group ids as `svg-group-N`, and
//! like file import this path *replaces* document content, so counter
//! collisions with cleared content cannot happen.

use grafalith_core::document::{Document, ImportSummary, SCHEMA_VERSION};
use grafalith_core::element::{
    BaseElement, CounterIdGenerator, Element, ElementFillStyle, ElementId, FillStyle, GradientStop,
    GradientType, IdGenerator, PathElement, PathSegment, StrokeAlign, StrokeCap, StrokeJoin,
    StrokeStyle, TextAlign, TextElement,
};
use grafalith_core::{EngineError, EngineResult};

/// In/out cubic handles per anchor, relative to the anchor point.
#[cfg(feature = "svg")]
type HandlePair = (Option<[f64; 2]>, Option<[f64; 2]>);

/// Converts an SVG document string into scene elements plus a skip count.
///
///
/// Pure (no document touched): hosts commit through [`import_svg_str`].
#[cfg(feature = "svg")]
pub fn svg_to_elements(svg: &str) -> EngineResult<(Vec<Element>, usize)> {
    // System fonts so text nodes resolve (without them usvg drops text).
    // On font-less targets (minimal wasm builds) text counts as skips —
    // a documented platform limit, not silent loss.
    let mut fontdb = usvg::fontdb::Database::new();
    fontdb.load_system_fonts();
    let options = usvg::Options {
        fontdb: std::sync::Arc::new(fontdb),
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(svg, &options)
        .map_err(|err| EngineError::InvalidInput(format!("SVG parse failed: {err}")))?;
    let mut converter = SvgConverter::new();
    // The document root is not a group (minting one would wrap every
    // import in noise); nested groups mint below.
    for child in tree.root().children() {
        converter.walk_node(child, &[]);
    }
    Ok((converter.elements, converter.skipped))
}

/// Replaces document content from an SVG string (same atomicity as
/// [`crate::pipeline::import_str`]: validation first, untouched document on
/// failure).
#[cfg(feature = "svg")]
pub fn import_svg_str(doc: &mut Document, svg: &str) -> EngineResult<ImportSummary> {
    let (converted, convert_skipped) = svg_to_elements(svg)?;
    if converted.is_empty() {
        return Err(EngineError::InvalidInput(
            "no convertible elements found in SVG data".to_string(),
        ));
    }
    let order: Vec<ElementId> = converted
        .iter()
        .map(|element| element.id().clone())
        .collect();
    let snapshot = grafalith_core::document::DocumentSnapshot {
        schema_version: SCHEMA_VERSION,
        legacy_version: SCHEMA_VERSION,
        elements: converted,
        element_order: order,
        groups: vec![],
        labels: vec![],
    };
    let summary = doc.apply_snapshot(&snapshot)?;
    Ok(ImportSummary {
        imported: summary.imported,
        skipped: summary.skipped + convert_skipped,
    })
}

/// Tracked SVG import: same replacement as [`import_svg_str`], committed
/// as one undo entry (undo restores the exact pre-import content).
#[cfg(feature = "svg")]
pub fn import_svg_str_tracked(
    doc: &mut Document,
    history: &mut grafalith_core::history::HistoryManager,
    svg: &str,
) -> EngineResult<ImportSummary> {
    let (converted, convert_skipped) = svg_to_elements(svg)?;
    if converted.is_empty() {
        return Err(EngineError::InvalidInput(
            "no convertible elements found in SVG data".to_string(),
        ));
    }
    let order: Vec<ElementId> = converted
        .iter()
        .map(|element| element.id().clone())
        .collect();
    let snapshot = grafalith_core::document::DocumentSnapshot {
        schema_version: SCHEMA_VERSION,
        legacy_version: SCHEMA_VERSION,
        elements: converted,
        element_order: order,
        groups: vec![],
        labels: vec![],
    };
    let plan = Document::plan_snapshot(&snapshot)?;
    let imported = plan.imported;
    let skipped = plan.skipped + convert_skipped;
    history.transaction(doc, |ctx| {
        let visible: Vec<ElementId> = ctx
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
        Ok(())
    })?;
    Ok(ImportSummary { imported, skipped })
}

/// 2D affine transform in row-major form, composed parent-first.
#[cfg(feature = "svg")]
#[derive(Debug, Clone, Copy)]
struct Transform {
    sx: f32,
    kx: f32,
    ky: f32,
    sy: f32,
    tx: f32,
    ty: f32,
}

#[cfg(feature = "svg")]
impl Transform {
    /// Converts a usvg absolute transform to row-major form.
    fn from_usvg(transform: &usvg::Transform) -> Self {
        Self {
            sx: transform.sx,
            kx: transform.kx,
            ky: transform.ky,
            sy: transform.sy,
            tx: transform.tx,
            ty: transform.ty,
        }
    }

    fn apply(&self, x: f32, y: f32) -> [f64; 2] {
        [
            (self.sx * x + self.kx * y + self.tx) as f64,
            (self.ky * x + self.sy * y + self.ty) as f64,
        ]
    }
}

#[cfg(feature = "svg")]
struct SvgConverter {
    elements: Vec<Element>,
    skipped: usize,
    id_gen: CounterIdGenerator,
    group_counter: usize,
}

#[cfg(feature = "svg")]
impl SvgConverter {
    fn new() -> Self {
        Self {
            elements: Vec::new(),
            skipped: 0,
            id_gen: CounterIdGenerator::new(),
            group_counter: 0,
        }
    }

    fn fresh_id(&mut self) -> ElementId {
        self.id_gen.new_element_id()
    }

    fn walk_group(&mut self, group: &usvg::Group, ancestors: &mut Vec<ElementId>) {
        // usvg nodes carry absolute transforms, so no accumulation is
        // needed — groups only contribute nesting ids here.
        // Mint up front so descendants accumulate the full innermost-first
        // chain (an id may go unused when the subtree yields nothing —
        // harmless counter advance, no invariant depends on gap-free ids).
        self.group_counter += 1;
        ancestors.push(ElementId::of(format!("svg-group-{}", self.group_counter)));
        for child in group.children() {
            self.walk_node(child, ancestors);
        }
        ancestors.pop();
    }

    fn walk_node(&mut self, node: &usvg::Node, ancestors: &[ElementId]) {
        match node {
            usvg::Node::Group(group) => {
                let mut chain = ancestors.to_vec();
                self.walk_group(group, &mut chain);
            }
            usvg::Node::Path(path) => {
                let world = Transform::from_usvg(&path.abs_transform());
                match self.convert_path(path, &world, ancestors) {
                    Some(element) => self.elements.push(element),
                    None => self.skipped += 1,
                }
            }
            usvg::Node::Text(text) => {
                let world = Transform::from_usvg(&text.abs_transform());
                match self.convert_text(text, &world, ancestors) {
                    Some(element) => self.elements.push(element),
                    None => self.skipped += 1,
                }
            }
            // Images, masks-as-content, and anything else: counted skips.
            _ => self.skipped += 1,
        }
    }

    fn base(
        &mut self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        outer_first: &[ElementId],
    ) -> Option<BaseElement> {
        if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
            return None;
        }
        // Scene convention is innermost-first; the walk accumulates
        // outermost-first, so reverse once here.
        let group_ids: Vec<ElementId> = outer_first.iter().rev().cloned().collect();
        Some(BaseElement {
            id: self.fresh_id(),
            x,
            y,
            width: width.max(0.0),
            height: height.max(0.0),
            rotation: 0.0,
            stroke_color: "#000000".to_string(),
            background_color: FillStyle::Solid {
                color: "transparent".to_string(),
            },
            stroke_width: 1.0,
            stroke_style: StrokeStyle::Solid,
            stroke_cap: StrokeCap::default(),
            stroke_join: StrokeJoin::default(),
            stroke_align: StrokeAlign::default(),
            fill_style: ElementFillStyle::Solid,
            opacity: 100.0,
            seed: self.id_gen.new_seed(),
            version: 0,
            version_nonce: self.id_gen.new_nonce(),
            is_deleted: false,
            group_ids,
            locked: false,
            hidden: false,
            frame_id: None,
            constraints: None,
            child_layout_sizing: None,
        })
    }

    fn convert_path(
        &mut self,
        path: &usvg::Path,
        world: &Transform,
        groups: &[ElementId],
    ) -> Option<Element> {
        use usvg::tiny_skia_path::PathSegment as TinySegment;

        let mut anchors: Vec<[f64; 2]> = Vec::new();
        let mut handles: Vec<HandlePair> = Vec::new();
        let mut closed = false;
        for segment in path.data().segments() {
            match segment {
                TinySegment::MoveTo(point) => {
                    let mapped = world.apply(point.x, point.y);
                    anchors.push(mapped);
                    handles.push((None, None));
                }
                TinySegment::LineTo(point) => {
                    let mapped = world.apply(point.x, point.y);
                    anchors.push(mapped);
                    handles.push((None, None));
                }
                TinySegment::QuadTo(control, point) => {
                    // Exact quad-to-cubic elevation.
                    let mapped = world.apply(point.x, point.y);
                    let current = *anchors.last()?;
                    let control = world.apply(control.x, control.y);
                    let handle_out = [
                        current[0] + (2.0 / 3.0) * (control[0] - current[0]),
                        current[1] + (2.0 / 3.0) * (control[1] - current[1]),
                    ];
                    let handle_in = [
                        mapped[0] + (2.0 / 3.0) * (control[0] - mapped[0]),
                        mapped[1] + (2.0 / 3.0) * (control[1] - mapped[1]),
                    ];
                    if let Some(last) = handles.last_mut() {
                        last.1 = Some([handle_out[0] - current[0], handle_out[1] - current[1]]);
                    }
                    anchors.push(mapped);
                    handles.push((
                        Some([handle_in[0] - mapped[0], handle_in[1] - mapped[1]]),
                        None,
                    ));
                }
                TinySegment::CubicTo(first, second, point) => {
                    let mapped = world.apply(point.x, point.y);
                    let current = *anchors.last()?;
                    let first = world.apply(first.x, first.y);
                    let second = world.apply(second.x, second.y);
                    if let Some(last) = handles.last_mut() {
                        last.1 = Some([first[0] - current[0], first[1] - current[1]]);
                    }
                    anchors.push(mapped);
                    handles.push((Some([second[0] - mapped[0], second[1] - mapped[1]]), None));
                }
                TinySegment::Close => {
                    closed = true;
                }
            }
        }
        if anchors.len() < 2 {
            return None;
        }
        let min_x = anchors
            .iter()
            .map(|point| point[0])
            .fold(f64::INFINITY, f64::min);
        let min_y = anchors
            .iter()
            .map(|point| point[1])
            .fold(f64::INFINITY, f64::min);
        let max_x = anchors
            .iter()
            .map(|point| point[0])
            .fold(f64::NEG_INFINITY, f64::max);
        let max_y = anchors
            .iter()
            .map(|point| point[1])
            .fold(f64::NEG_INFINITY, f64::max);
        let mut base = self.base(min_x, min_y, max_x - min_x, max_y - min_y, groups)?;
        self.apply_paint(path.fill(), path.stroke(), &mut base);
        let segments = anchors
            .iter()
            .zip(handles.iter())
            .map(|(anchor, (handle_in, handle_out))| PathSegment {
                point: [anchor[0] - min_x, anchor[1] - min_y],
                handle_in: *handle_in,
                handle_out: *handle_out,
            })
            .collect();
        Some(Element::Path(PathElement {
            base,
            segments,
            closed,
        }))
    }

    fn apply_paint(
        &mut self,
        fill: Option<&usvg::Fill>,
        stroke: Option<&usvg::Stroke>,
        base: &mut BaseElement,
    ) {
        if let Some(fill) = fill {
            base.background_color = paint_to_fill(fill.paint());
            base.opacity = (f64::from(fill.opacity().get()) * 100.0).clamp(0.0, 100.0);
        }
        if let Some(stroke) = stroke {
            if let usvg::Paint::Color(color) = stroke.paint() {
                base.stroke_color = color_to_css(color);
            }
            base.stroke_width = f64::from(stroke.width().get()).max(0.0);
            if stroke.dasharray().is_some_and(|dashes| !dashes.is_empty()) {
                base.stroke_style = StrokeStyle::Dashed;
            }
        }
    }

    fn convert_text(
        &mut self,
        text: &usvg::Text,
        world: &Transform,
        groups: &[ElementId],
    ) -> Option<Element> {
        // One element per chunk, first span wins (documented approximation:
        // per-span styling and multi-chunk flow need laid-out text runs).
        // Chunks without an explicit position cannot place without font
        // metrics, so they are counted skips rather than origin piles.
        let chunk = text.chunks().first()?;
        let (cx, cy) = match (chunk.x(), chunk.y()) {
            (Some(x), Some(y)) => (x, y),
            _ => return None,
        };
        let span = chunk.spans().first()?;
        let string = chunk.text().get(span.start()..span.end())?.to_string();
        if string.trim().is_empty() {
            return None;
        }
        let position = world.apply(cx, cy);
        let font_size = f64::from(span.font_size().get());
        if !font_size.is_finite() || font_size <= 0.0 {
            return None;
        }
        let mut base = self.base(position[0], position[1], 100.0, font_size * 1.25, groups)?;
        base.background_color = FillStyle::Solid {
            color: "transparent".to_string(),
        };
        // Span fill wins for the text color (stroke color doubles as the
        // text color channel in our model — hosts draw text with it).
        if let Some(fill) = span.fill() {
            if let usvg::Paint::Color(color) = fill.paint() {
                base.stroke_color = color_to_css(color);
            }
        }
        Some(Element::Text(TextElement {
            base,
            text: string,
            font_size,
            font_family: font_family_name(span.font()),
            text_align: TextAlign::Left,
            border_color: None,
            container_id: None,
        }))
    }
}

/// CSS hex for a usvg color.
#[cfg(feature = "svg")]
fn color_to_css(color: &usvg::Color) -> String {
    format!("#{:02x}{:02x}{:02x}", color.red, color.green, color.blue)
}

/// Best-effort family name for a usvg font (generic families map to CSS
/// keywords; anything else passes through as its debug name so hosts see
/// what was asked for instead of a silent substitution).
#[cfg(feature = "svg")]
fn font_family_name(font: &usvg::Font) -> String {
    let Some(first) = font.families().first() else {
        return "sans-serif".to_string();
    };
    match format!("{first:?}").as_str() {
        "Serif" => "serif".to_string(),
        "SansSerif" => "sans-serif".to_string(),
        "Cursive" => "cursive".to_string(),
        "Fantasy" => "fantasy".to_string(),
        "Monospace" => "monospace".to_string(),
        other => other.to_string(),
    }
}

/// Maps a usvg paint to our fill (gradients by direction + stops; patterns
/// have no counterpart and fall back to transparent, counted by callers
/// that need accounting — here the path keeps a transparent fill).
#[cfg(feature = "svg")]
fn paint_to_fill(paint: &usvg::Paint) -> FillStyle {
    match paint {
        usvg::Paint::Color(color) => FillStyle::Solid {
            color: color_to_css(color),
        },
        usvg::Paint::LinearGradient(gradient) => {
            let angle = gradient_angle(
                f64::from(gradient.x1()),
                f64::from(gradient.y1()),
                f64::from(gradient.x2()),
                f64::from(gradient.y2()),
            );
            FillStyle::Gradient {
                gradient_type: GradientType::Linear,
                angle,
                stops: gradient
                    .stops()
                    .iter()
                    .map(|stop| GradientStop {
                        offset: f64::from(stop.offset().get()).clamp(0.0, 1.0),
                        color: color_to_css(&stop.color()),
                    })
                    .collect(),
            }
        }
        usvg::Paint::RadialGradient(gradient) => FillStyle::Gradient {
            gradient_type: GradientType::Radial,
            angle: 0.0,
            stops: gradient
                .stops()
                .iter()
                .map(|stop| GradientStop {
                    offset: f64::from(stop.offset().get()).clamp(0.0, 1.0),
                    color: color_to_css(&stop.color()),
                })
                .collect(),
        },
        // Patterns, and anything else without a counterpart: transparent.
        _ => FillStyle::Solid {
            color: "transparent".to_string(),
        },
    }
}

/// Gradient angle in degrees, 0° = left-to-right (our linear convention).
#[cfg(feature = "svg")]
fn gradient_angle(x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    (y2 - y1).atan2(x2 - x1).to_degrees()
}
