//! Interchange scale benchmarks: import/export at 1k / 10k / 100k.
//!
//! Scene payloads are built once per binary run through the real export
//! path, so import benches measure parsing of representative documents.

//! Criterion's generated harness has no docs; the bench binary is not API.
#![allow(missing_docs)]

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use opennary_core::document::Document;
use opennary_core::element::{create_rectangle, CounterIdGenerator, Element, ElementId};
use opennary_io::{export_str, import_str};
use std::hint::black_box;
use std::sync::OnceLock;
use std::time::Duration;

fn build_scene_json(count: usize) -> String {
    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    let cols = (count as f64).sqrt().ceil() as usize;
    for i in 0..count {
        let mut el = create_rectangle(&mut gen);
        el.base.id = ElementId::of(format!("s{i}"));
        el.base.x = ((i % cols) * 60) as f64;
        el.base.y = ((i / cols) * 60) as f64;
        el.base.width = 40.0;
        el.base.height = 40.0;
        doc.upsert(Element::Rectangle(el))
            .expect("valid bench element");
    }
    export_str(&doc).expect("bench scene exports")
}

fn scene_for(count: usize) -> &'static str {
    static SCENE_1K: OnceLock<String> = OnceLock::new();
    static SCENE_10K: OnceLock<String> = OnceLock::new();
    static SCENE_100K: OnceLock<String> = OnceLock::new();
    match count {
        1_000 => SCENE_1K.get_or_init(|| build_scene_json(count)),
        10_000 => SCENE_10K.get_or_init(|| build_scene_json(count)),
        100_000 => SCENE_100K.get_or_init(|| build_scene_json(count)),
        _ => panic!("scene tier covers 1k/10k/100k only"),
    }
}

fn bench_import(c: &mut Criterion) {
    let mut group = c.benchmark_group("import_scene");
    // Hundreds of samples of a 100k import would take hours; ten timed
    // samples plus warmup resolve the mean without an overnight run.
    group
        .sample_size(10)
        .measurement_time(Duration::from_secs(30));
    for count in [1_000usize, 10_000, 100_000] {
        // Shared payload: parsed fresh by every sample into a scratch doc.
        let payload: &'static str = scene_for(count);
        group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, _| {
            b.iter_batched(
                Document::new,
                |mut doc| import_str(&mut doc, black_box(payload)),
                criterion::BatchSize::SmallInput,
            );
        });
    }
    group.finish();
}

fn bench_export(c: &mut Criterion) {
    let mut group = c.benchmark_group("export_scene");
    group.measurement_time(Duration::from_secs(5));
    for count in [10_000usize, 100_000] {
        // Shared document: serialized fresh by every sample.
        let mut doc = Document::new();
        import_str(&mut doc, scene_for(count)).expect("bench scene imports");
        group.bench_with_input(BenchmarkId::from_parameter(count), &count, |b, _| {
            b.iter(|| export_str(black_box(&doc)));
        });
    }
    group.finish();
}

criterion_group!(benches, bench_import, bench_export);
criterion_main!(benches);
