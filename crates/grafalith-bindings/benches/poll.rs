//! Frame-poll benchmark: repeated identical `renderModel` crossings on a
//! 5k scene. The first poll rebuilds; the rest are cache
//! hits (clone + serialize, no rebuild).

//! Criterion's generated harness has no docs; the bench binary is not API.
#![allow(missing_docs)]

use criterion::{criterion_group, criterion_main, Criterion};
use grafalith_bindings::Engine;
use serde_json::json;
use std::hint::black_box;
use std::time::Duration;

fn engine_5k() -> Engine {
    let mut engine = Engine::new();
    for chunk in 0..10 {
        let creates: Vec<serde_json::Value> = (0..500)
            .map(|i| {
                let n = chunk * 500 + i;
                json!({"op": "create", "element": {
                    "id": format!("p{n}"), "type": "rectangle",
                    "x": (n % 100) * 60, "y": (n / 100) * 60,
                    "width": 40, "height": 40, "rotation": 0,
                    "strokeColor": "#333",
                    "backgroundColor": {"type": "solid", "color": "#e8f4fc"},
                    "strokeWidth": 2, "strokeStyle": "solid", "fillStyle": "solid",
                    "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
                    "isDeleted": false, "groupIds": [], "locked": false,
                    "hidden": false, "frameId": null, "roundness": null,
                }})
            })
            .collect();
        engine.apply_batch(&serde_json::to_string(&creates).expect("batch serializes"));
    }
    assert_eq!(engine.element_count(), 5_000);
    engine
}

fn bench_cached_poll(c: &mut Criterion) {
    let mut group = c.benchmark_group("render_poll_5k");
    group.measurement_time(Duration::from_secs(10));
    let mut engine = engine_5k();
    let query =
        json!([{"op": "renderModel", "canvasWidth": 1920, "canvasHeight": 1080}]).to_string();
    // Warm the cache outside the measured loop: the warmup is the single
    // miss, every sample below is a hit.
    engine.apply_batch(&query);
    assert_eq!(engine.render_cache_hits(), 0);
    assert_eq!(engine.render_cache_misses(), 1);
    group.bench_function("cached_hit", |b| {
        b.iter(|| engine.apply_batch(black_box(&query)));
    });
    // Every sample below misses by construction (a fresh canvas size per
    // poll changes the cull): full rebuild + map + serialize.
    let mut width = 1920u32;
    group.bench_function("uncached_miss", |b| {
        b.iter(|| {
            width += 1;
            let query = format!(
                "[{{\"op\": \"renderModel\", \"canvasWidth\": {width}, \"canvasHeight\": 1080}}]"
            );
            engine.apply_batch(black_box(&query))
        });
    });
    group.finish();
}

criterion_group!(benches, bench_cached_poll);
criterion_main!(benches);
