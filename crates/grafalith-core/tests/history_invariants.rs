//! History invariants under random operation sequences (deterministic LCG):
//! undoing everything restores the initial snapshot exactly, and redoing
//! everything restores the post-ops snapshot exactly (exact-snapshot
//! inversion, never re-execution).

use grafalith_core::editor::Editor;
use grafalith_core::element::{create_rectangle, CounterIdGenerator, Element, ElementId};

/// Deterministic LCG returning values below `bound`.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, bound: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 33) % (bound as u64)) as usize
    }
}

type Snapshot = (Vec<Element>, Vec<ElementId>);

fn snapshot(editor: &Editor) -> Snapshot {
    (
        editor
            .document()
            .get_all_including_deleted()
            .into_iter()
            .cloned()
            .collect(),
        editor.document().order(),
    )
}

fn apply_random_ops(editor: &mut Editor, rng: &mut Lcg, created: &mut usize, steps: usize) {
    let mut gen = CounterIdGenerator::new();
    for _ in 0..steps {
        let live: Vec<ElementId> = editor
            .document()
            .get_all()
            .iter()
            .map(|element| element.id().clone())
            .collect();
        match rng.next(3) {
            // Create with a globally fresh id (never collides by construction).
            0 => {
                let id = format!("h{created}");
                *created += 1;
                let mut el = create_rectangle(&mut gen);
                el.base.id = ElementId::of(id);
                el.base.x = rng.next(500) as f64;
                el.base.y = rng.next(500) as f64;
                editor.create(Element::Rectangle(el)).unwrap();
            }
            // Move one random live element (no-op when empty).
            _ if live.is_empty() => {}
            1 => {
                let target = live[rng.next(live.len())].clone();
                editor
                    .move_elements(vec![target], rng.next(50) as f64, rng.next(50) as f64)
                    .unwrap();
            }
            // Delete one random live element.
            _ => {
                let target = live[rng.next(live.len())].clone();
                editor.delete(vec![target]).unwrap();
            }
        }
    }
}

#[test]
fn undo_all_restores_initial_snapshot_exactly() {
    let mut editor = Editor::new();
    let initial = snapshot(&editor);
    let mut rng = Lcg(0x51ab_3c7d_9e0f_1234);
    let mut created = 0usize;
    apply_random_ops(&mut editor, &mut rng, &mut created, 90);
    assert!(editor.history().can_undo());

    while editor.history().can_undo() {
        assert!(editor.undo().unwrap());
    }
    assert_eq!(snapshot(&editor), initial);
    assert!(!editor.history().can_undo());
}

#[test]
fn redo_all_restores_post_ops_snapshot_exactly() {
    let mut editor = Editor::new();
    let mut rng = Lcg(0x77aa_bb11_cc22_dd33);
    let mut created = 0usize;
    apply_random_ops(&mut editor, &mut rng, &mut created, 90);
    let post_ops = snapshot(&editor);

    while editor.history().can_undo() {
        editor.undo().unwrap();
    }
    while editor.history().can_redo() {
        assert!(editor.redo().unwrap());
    }
    assert_eq!(snapshot(&editor), post_ops);
}
