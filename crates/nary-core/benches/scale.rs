//! Scale benchmarks: 1k / 10k / 100k / 1M scenes (M5).
//!
//! Read-only benches share one `OnceLock` document per size (built once per
//! binary run); mutating benches rebuild per sample via `iter_batched`.
//! The 1M tier covers read paths only — a 1M mutating setup per sample
//! would measure allocation, not the operation.

//! Criterion's generated harness has no docs; the bench binary is not API.
#![allow(missing_docs)]

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use nary_core::document::Document;
use nary_core::editor::Editor;
use nary_core::element::{create_rectangle, CounterIdGenerator, Element, ElementId};
use nary_core::geometry::rect::Bounds;
use nary_core::geometry::viewport::Viewport;
use nary_core::hit_test::{hit_test_top_indexed, query_in_bounds_indexed, HitTestFilter};
use nary_core::render_model::{RenderConfig, RenderModel};
use std::hint::black_box;
use std::sync::OnceLock;
use std::time::Duration;

/// Grid layout resembling real scenes (60-unit pitch, 40-unit boxes).
fn build_doc(count: usize) -> Document {
    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    let cols = (count as f64).sqrt().ceil() as usize;
    for i in 0..count {
        let mut el = create_rectangle(&mut gen);
        el.base.id = ElementId::of(format!("n{i}"));
        el.base.x = ((i % cols) * 60) as f64;
        el.base.y = ((i / cols) * 60) as f64;
        el.base.width = 40.0;
        el.base.height = 40.0;
        doc.upsert(Element::Rectangle(el))
            .expect("valid bench element");
    }
    doc
}

/// Shared read-only document per tier (built once).
fn doc_for(count: usize) -> &'static Document {
    static DOC_10K: OnceLock<Document> = OnceLock::new();
    static DOC_100K: OnceLock<Document> = OnceLock::new();
    static DOC_1M: OnceLock<Document> = OnceLock::new();
    match count {
        10_000 => DOC_10K.get_or_init(|| build_doc(count)),
        100_000 => DOC_100K.get_or_init(|| build_doc(count)),
        1_000_000 => DOC_1M.get_or_init(|| build_doc(count)),
        _ => panic!("shared tier covers 10k/100k/1M only"),
    }
}

fn content_center(doc: &Document) -> [f64; 2] {
    let mut bounds: Option<Bounds> = None;
    for element in doc.get_all() {
        bounds = Some(match bounds {
            Some(current) => current.union(&element.bounds()),
            None => element.bounds(),
        });
    }
    let bounds = bounds.expect("bench docs are non-empty");
    [
        (bounds.min_x + bounds.max_x) / 2.0,
        (bounds.min_y + bounds.max_y) / 2.0,
    ]
}

fn bench_hit_test(c: &mut Criterion) {
    let mut group = c.benchmark_group("hit_test_top_indexed");
    group.measurement_time(Duration::from_secs(5));
    let doc_1k = build_doc(1_000);
    let center_1k = content_center(&doc_1k);
    group.bench_function("1000", |b| {
        b.iter(|| {
            hit_test_top_indexed(
                &doc_1k,
                black_box(center_1k[0]),
                black_box(center_1k[1]),
                HitTestFilter::selection(),
            )
        });
    });
    for count in [10_000usize, 100_000, 1_000_000] {
        // Shared static: built once per binary run, read by every sample.
        let doc: &'static Document = doc_for(count);
        let center = content_center(doc);
        group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, _| {
            b.iter(|| {
                hit_test_top_indexed(
                    doc,
                    black_box(center[0]),
                    black_box(center[1]),
                    HitTestFilter::selection(),
                )
            });
        });
    }
    group.finish();
}

fn bench_render(c: &mut Criterion) {
    let mut group = c.benchmark_group("render_model_full");
    // Full 100k builds take ~0.3 s each; ten timed samples resolve the
    // mean without a ten-minute group.
    group
        .sample_size(10)
        .measurement_time(Duration::from_secs(60));
    let doc_1k = build_doc(1_000);
    render_into_group(&mut group, 1_000, &doc_1k);
    for count in [10_000usize, 100_000] {
        // Shared static: built once per binary run, read by every sample.
        render_into_group(&mut group, count, doc_for(count));
    }
    group.finish();
}

/// Renders the whole content (canvas covers the world): measures the full
/// build, not the cull.
fn render_into_group(
    group: &mut criterion::BenchmarkGroup<'_, criterion::measurement::WallTime>,
    count: usize,
    doc: &Document,
) {
    let cols = ((doc.element_count().max(1)) as f64).sqrt().ceil();
    let world = cols * 60.0;
    let config = RenderConfig::new(world, world);
    let viewport = Viewport {
        scroll_x: 0.0,
        scroll_y: 0.0,
        zoom: 1.0,
    };
    group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, _| {
        b.iter(|| RenderModel::build(doc, &viewport, &config, &|_| true));
    });
}

fn bench_marquee(c: &mut Criterion) {
    let mut group = c.benchmark_group("marquee_query_indexed");
    group.measurement_time(Duration::from_secs(5));
    for count in [10_000usize, 100_000, 1_000_000] {
        // Shared static: built once per binary run, read by every sample.
        let doc: &'static Document = doc_for(count);
        let center = content_center(doc);
        let probe = Bounds::from_xywh(center[0] - 5_000.0, center[1] - 5_000.0, 10_000.0, 10_000.0);
        group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, _| {
            b.iter(|| query_in_bounds_indexed(doc, black_box(&probe)));
        });
    }
    group.finish();
}

fn build_editor(count: usize) -> Editor {
    let mut editor = Editor::new();
    let mut gen = CounterIdGenerator::new();
    let cols = (count as f64).sqrt().ceil() as usize;
    for i in 0..count {
        let mut el = create_rectangle(&mut gen);
        el.base.id = ElementId::of(format!("m{i}"));
        el.base.x = ((i % cols) * 60) as f64;
        el.base.y = ((i / cols) * 60) as f64;
        el.base.width = 40.0;
        el.base.height = 40.0;
        editor
            .create(Element::Rectangle(el))
            .expect("valid bench element");
    }
    editor
}

fn bench_mass_move(c: &mut Criterion) {
    let mut group = c.benchmark_group("mass_move_all");
    group.sample_size(10);
    for count in [1_000usize, 10_000] {
        group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, _| {
            b.iter_batched(
                || {
                    let editor = build_editor(count);
                    let ids: Vec<ElementId> = editor
                        .document()
                        .get_all()
                        .iter()
                        .map(|element| element.id().clone())
                        .collect();
                    (editor, ids)
                },
                |(mut editor, ids)| editor.move_elements(ids, black_box(5.0), black_box(5.0)),
                criterion::BatchSize::SmallInput,
            );
        });
    }
    group.finish();
}

fn bench_undo_redo(c: &mut Criterion) {
    let mut group = c.benchmark_group("undo_redo_1k");
    group.sample_size(30);
    group.bench_function("undo_after_mass_move", |b| {
        b.iter_batched(
            || {
                let mut editor = build_editor(1_000);
                let ids: Vec<ElementId> = editor
                    .document()
                    .get_all()
                    .iter()
                    .map(|element| element.id().clone())
                    .collect();
                editor.move_elements(ids, 5.0, 5.0).expect("bench move");
                editor
            },
            |mut editor| editor.undo(),
            criterion::BatchSize::SmallInput,
        );
    });
    group.finish();
}

fn bench_load(c: &mut Criterion) {
    let mut group = c.benchmark_group("document_build");
    group.sample_size(10);
    for count in [1_000usize, 10_000, 100_000] {
        group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, &count| {
            b.iter(|| build_doc(black_box(count)));
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_hit_test,
    bench_render,
    bench_marquee,
    bench_mass_move,
    bench_undo_redo,
    bench_load,
);
criterion_main!(benches);
