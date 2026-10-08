//! Phase-10 performance benchmarks: measures representative workloads
//! for the Rust engine. Records execution time for key operations.

use std::time::Instant;

use opennary_core::document::Document;
use opennary_core::editor::Editor;
use opennary_core::element::{create_rectangle, CounterIdGenerator, Element, ElementId};
use opennary_core::geometry::viewport::Viewport;
use opennary_core::hit_test::{hit_test_top, hit_test_top_indexed, HitTestFilter};
use opennary_core::interaction::{Modifiers, PointerButton};
use opennary_core::render_model::{RenderConfig, RenderModel};

fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
    let mut gen = CounterIdGenerator::new();
    let mut el = create_rectangle(&mut gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.width = w;
    el.base.height = h;
    Element::Rectangle(el)
}

fn click(editor: &mut Editor, x: f64, y: f64) {
    editor
        .pointer_down(x, y, PointerButton::Left, Modifiers::none(), 1)
        .unwrap();
    editor
        .pointer_up(x, y, PointerButton::Left, Modifiers::none())
        .unwrap();
}

fn drag(editor: &mut Editor, from: (f64, f64), to: (f64, f64)) {
    editor
        .pointer_down(from.0, from.1, PointerButton::Left, Modifiers::none(), 1)
        .unwrap();
    editor.pointer_move(to.0, to.1, Modifiers::none()).unwrap();
    editor
        .pointer_up(to.0, to.1, PointerButton::Left, Modifiers::none())
        .unwrap();
}

fn measure<F: FnOnce() -> T, T>(name: &str, f: F) -> T {
    let start = Instant::now();
    let result = f();
    let elapsed = start.elapsed();
    println!("  {:40} {:>10.3?}", name, elapsed);
    result
}

#[test]
fn benchmark_document_creation() {
    println!("\n=== Document Creation ===");
    let count = 5000;
    let mut editor = Editor::new();
    measure(&format!("Create {} elements", count), || {
        for i in 0..count {
            editor
                .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
                .unwrap();
        }
    });
    assert_eq!(editor.document().get_all().len(), count);
}

#[test]
fn benchmark_insertion_removal() {
    println!("\n=== Insertion/Removal ===");
    let count = 1000;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    measure("Delete 1000 elements", || {
        for i in 0..count {
            editor
                .delete(vec![ElementId::of(format!("r{}", i))])
                .unwrap();
        }
    });
    assert_eq!(editor.document().get_all().len(), 0);
}

#[test]
fn benchmark_selection() {
    println!("\n=== Selection ===");
    let count = 5000;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    measure("Click select (5000 elements)", || {
        click(&mut editor, 25.0, 25.0);
    });
    assert_eq!(editor.state().selection.ids().len(), 1);
}

#[test]
fn benchmark_hit_testing() {
    println!("\n=== Hit Testing ===");
    let count = 5000;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    let doc = editor.document();
    measure("Hit test top (5000 elements)", || {
        hit_test_top(doc, 25.0, 25.0, HitTestFilter::selection());
    });
}

#[test]
fn benchmark_hit_testing_indexed() {
    println!("\n=== Hit Testing (indexed) ===");
    let count = 5000;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    let doc = editor.document();
    let expected = hit_test_top(doc, 25.0, 25.0, HitTestFilter::selection());
    measure("Hit test top indexed (5000 elements)", || {
        hit_test_top_indexed(doc, 25.0, 25.0, HitTestFilter::selection());
    });
    assert_eq!(
        hit_test_top_indexed(doc, 25.0, 25.0, HitTestFilter::selection()),
        expected
    );
}

#[test]
fn benchmark_drag() {
    println!("\n=== Drag ===");
    let count = 100;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    click(&mut editor, 25.0, 25.0);
    measure("Drag move (100 elements)", || {
        drag(&mut editor, (25.0, 25.0), (125.0, 125.0));
    });
}

#[test]
fn benchmark_undo_redo() {
    println!("\n=== Undo/Redo ===");
    let count = 100;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    measure("Undo 100 times", || {
        for _ in 0..count {
            editor.undo().unwrap();
        }
    });
    measure("Redo 100 times", || {
        for _ in 0..count {
            editor.redo().unwrap();
        }
    });
}

#[test]
fn benchmark_serialize_deserialize() {
    println!("\n=== Serialize/Deserialize ===");
    let count = 1000;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    let doc = editor.document();
    let snapshot = measure("Serialize 1000 elements", || doc.to_snapshot());
    measure("Deserialize 1000 elements", || {
        let mut doc2 = Document::new();
        Document::apply_snapshot(&mut doc2, &snapshot).unwrap();
    });
}

#[test]
fn benchmark_render_preparation() {
    println!("\n=== Render Preparation ===");
    let count = 5000;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    let doc = editor.document();
    let viewport = Viewport {
        scroll_x: 0.0,
        scroll_y: 0.0,
        zoom: 1.0,
    };
    let config = RenderConfig::new(1920.0, 1080.0);
    measure("Render model (5000 elements)", || {
        RenderModel::build(doc, &viewport, &config, &|_| true);
    });
}

#[test]
fn benchmark_large_document_operations() {
    println!("\n=== Large Document Operations ===");
    let count = 5000;
    let mut editor = Editor::new();
    measure("Create 5000 elements", || {
        for i in 0..count {
            editor
                .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
                .unwrap();
        }
    });
    assert_eq!(editor.document().get_all().len(), count);
    measure("Export 5000 elements", || {
        let doc = editor.document();
        doc.to_snapshot();
    });
    measure("Import 5000 elements", || {
        let doc = editor.document();
        let snapshot = doc.to_snapshot();
        let mut doc2 = Document::new();
        Document::apply_snapshot(&mut doc2, &snapshot).unwrap();
    });
}

#[test]
fn benchmark_spatial_queries() {
    println!("\n=== Spatial Queries ===");
    let count = 5000;
    let mut editor = Editor::new();
    for i in 0..count {
        editor
            .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
            .unwrap();
    }
    let doc = editor.document();
    use opennary_core::geometry::rect::Bounds;
    let bounds = Bounds::new(0.0, 0.0, 1000.0, 1000.0);
    measure("Query in bounds (5000 elements)", || {
        opennary_core::hit_test::query_in_bounds(doc, &bounds);
    });
}

#[test]
fn benchmark_combined_workload() {
    println!("\n=== Combined Workload ===");
    let count = 1000;
    let mut editor = Editor::new();
    measure("Create 1000 elements", || {
        for i in 0..count {
            editor
                .create(rect(&format!("r{}", i), i as f64 * 10.0, 0.0, 50.0, 50.0))
                .unwrap();
        }
    });
    measure("Select 100 elements", || {
        for i in 0..100 {
            click(&mut editor, i as f64 * 10.0 + 25.0, 25.0);
        }
    });
    measure("Drag 100 elements", || {
        for i in 0..100 {
            drag(
                &mut editor,
                (i as f64 * 10.0 + 25.0, 25.0),
                (i as f64 * 10.0 + 125.0, 125.0),
            );
        }
    });
    measure("Undo 100 drags", || {
        for _ in 0..100 {
            editor.undo().unwrap();
        }
    });
    measure("Redo 100 drags", || {
        for _ in 0..100 {
            editor.redo().unwrap();
        }
    });
    measure("Export 1000 elements", || {
        let doc = editor.document();
        doc.to_snapshot();
    });
}
