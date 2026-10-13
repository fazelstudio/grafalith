//! Instance-scoped clipboard: copy / paste / duplicate / cut.
//!
//! An in-memory buffer plus best-effort system write, fresh ids,
//! group/binding/frame remap, cascade offset, single history batch, and
//! unlocked pastes with a fresh version stream, nonce, and seed.
//!
//! Instance scoping and history discipline: every editor owns one
//! [`Clipboard`] — tests are deterministic, and buffers never leak across
//! documents. Paste/cut commit through
//! [`HistoryManager::transaction`](crate::history::HistoryManager::transaction),
//! so each operation is one undo entry *and* atomic (a failing paste rolls
//! back instead of leaving half a buffer behind). The OS clipboard stays
//! host-side: core defines the [`ClipboardAdapter`] string boundary, and the
//! io layer owns the JSON codec (`encode`/`decode`) plus publish/subscribe
//! helpers. Core never touches `navigator`, the DOM, or Tauri.
//!
//! Paste contract: an empty buffer yields an empty result with no history
//! entry; every element gets a fresh id and every distinct group id gets one
//! fresh group id (pasted copies never merge into the source group); arrow
//! bindings remap when the target travels with the buffer, else are nulled,
//! with `frame_id` / text `container_id` remapped-or-detached the same way;
//! placement is the cascade offset (`PASTE_OFFSET × consecutive paste count`,
//! reset on every copy/cut) or bbox-relative for an explicit target point;
//! pasted elements restart their version stream (`version = 0` with a fresh
//! nonce and seed) and start unlocked, while `hidden` is preserved verbatim.

use std::collections::{HashMap, HashSet};

use crate::document::{Document, GroupRecord};
use crate::element::{Element, ElementId};
use crate::history::HistoryManager;
use crate::{EngineError, EngineResult};

/// Cascade step in scene units between consecutive pastes.
pub const PASTE_OFFSET: f64 = 10.0;

/// Host-side system-clipboard boundary: the OS clipboard is host owned.
///
/// Hosts implement this with `navigator.clipboard`, Tauri clipboard APIs,
/// or an in-memory fake in tests. Core only moves plain strings across the
/// boundary — never DOM or OS handles. The JSON codec plus
/// publish/subscribe helpers live in the io layer, which owns the payload
/// schema.
pub trait ClipboardAdapter {
    /// Best-effort write of a clipboard payload string.
    fn write_text(&mut self, text: String);
    /// Reads a clipboard payload string, or `None` when unavailable.
    fn read_text(&self) -> Option<String>;
}

/// Instance-scoped clipboard buffer.
///
/// Owns the copied elements plus the consecutive-paste counter that drives
/// the cascade offset. Copying replaces the buffer and resets the counter;
/// each paste bumps the counter so repeated pastes walk diagonally instead
/// of stacking exactly.
#[derive(Debug, Clone, Default)]
pub struct Clipboard {
    /// Deep clones of the copied elements (source identity preserved here;
    /// fresh identity is minted at paste time).
    elements: Vec<Element>,
    /// Consecutive paste count (reset on copy/cut, bumped on paste).
    paste_count: u32,
}

impl Clipboard {
    /// Creates an empty clipboard.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns `true` when the buffer holds nothing (paste would be a no-op).
    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }

    /// Number of buffered elements.
    pub fn len(&self) -> usize {
        self.elements.len()
    }

    /// Borrows the buffered elements (source snapshots for host publish via
    /// the io JSON codec).
    pub fn buffered(&self) -> &[Element] {
        &self.elements
    }

    /// Clears the buffer and resets the cascade counter.
    pub fn clear(&mut self) {
        self.elements.clear();
        self.paste_count = 0;
    }

    /// Copies live (non-deleted) elements into the buffer, resetting the
    /// cascade counter (TS `copyElements` parity — the system-clipboard
    /// write itself is host-side via [`ClipboardAdapter`]).
    ///
    /// Unknown and deleted ids are skipped. Returns deep clones of what was
    /// buffered.
    pub fn copy(&mut self, doc: &Document, ids: &[ElementId]) -> Vec<Element> {
        let mut buffered = Vec::new();
        for id in ids {
            if let Some(element) = doc.get(id.as_str()) {
                if !element.base().is_deleted {
                    buffered.push(element.clone());
                }
            }
        }
        self.elements = buffered.clone();
        self.paste_count = 0;
        buffered
    }

    /// Pastes the buffer as fresh elements with remapped references
    /// (TS `pasteElements` parity).
    ///
    /// `target` (`None` = cascade offset, `Some([x, y])` = bbox-relative
    /// placement preserving the copied layout) must be finite — a
    /// non-finite target is a typed error before anything is stored. The
    /// paste commits as one history entry via transaction (atomic: failure
    /// stores nothing and records nothing). An empty buffer yields an empty
    /// result with no history entry.
    ///
    /// Returns the committed elements (with their fresh ids).
    pub fn paste(
        &mut self,
        doc: &mut Document,
        history: &mut HistoryManager,
        target: Option<[f64; 2]>,
    ) -> EngineResult<Vec<Element>> {
        if self.elements.is_empty() {
            return Ok(Vec::new());
        }
        if let Some(point) = target {
            if !point[0].is_finite() || !point[1].is_finite() {
                return Err(EngineError::InvalidInput(format!(
                    "paste target must be finite, got ({}, {})",
                    point[0], point[1]
                )));
            }
        }
        self.paste_count = self.paste_count.saturating_add(1);
        let planned = plan_paste_elements(doc, &self.elements, self.paste_count, target)?;
        history.transaction(doc, |ctx| {
            let mut groups = ctx.doc().groups();
            for element in &planned {
                for group_id in &element.base().group_ids {
                    if !groups.iter().any(|group| group.id == *group_id) {
                        groups.push(GroupRecord {
                            id: group_id.clone(),
                            name: format!("Group-{}", groups.len() + 1),
                            parent_id: None,
                            locked: false,
                        });
                    }
                }
            }
            ctx.set_groups(groups)?;
            for element in &planned {
                ctx.upsert(element.clone())?;
            }
            Ok(planned.clone())
        })
    }

    /// Cuts live elements: copies them to the buffer, then soft-deletes the
    /// originals as one history entry (TS `cutElements` parity).
    ///
    /// Ghost and already-deleted ids change nothing and record nothing.
    /// Returns deep clones of what was buffered.
    pub fn cut(
        &mut self,
        doc: &mut Document,
        history: &mut HistoryManager,
        ids: &[ElementId],
    ) -> EngineResult<Vec<Element>> {
        let copied = self.copy(doc, ids);
        if copied.is_empty() {
            return Ok(Vec::new());
        }
        let targets: Vec<ElementId> = ids.to_vec();
        history.transaction(doc, |ctx| {
            for id in &targets {
                ctx.soft_delete(id.as_str())?;
            }
            Ok(())
        })?;
        Ok(copied)
    }
}

/// Duplicates live elements in place without touching any [`Clipboard`]
/// (TS `duplicateElements` parity: works when the system clipboard is
/// denied, always offsets by exactly one cascade step).
///
/// Commits as one history entry. Unknown and deleted ids are skipped;
/// empty input → empty result, no history entry.
pub fn duplicate_elements(
    doc: &mut Document,
    history: &mut HistoryManager,
    ids: &[ElementId],
) -> EngineResult<Vec<Element>> {
    let mut source = Vec::new();
    for id in ids {
        if let Some(element) = doc.get(id.as_str()) {
            if !element.base().is_deleted {
                source.push(element.clone());
            }
        }
    }
    if source.is_empty() {
        return Ok(Vec::new());
    }
    // TS forces the cascade counter 0 → 1 for duplicates: exactly one step.
    let planned = plan_paste_elements(doc, &source, 1, None)?;
    history.transaction(doc, |ctx| {
        let mut groups = ctx.doc().groups();
        for element in &planned {
            for group_id in &element.base().group_ids {
                if !groups.iter().any(|group| group.id == *group_id) {
                    groups.push(GroupRecord {
                        id: group_id.clone(),
                        name: format!("Group-{}", groups.len() + 1),
                        parent_id: None,
                        locked: false,
                    });
                }
            }
        }
        ctx.set_groups(groups)?;
        for element in &planned {
            ctx.upsert(element.clone())?;
        }
        Ok(planned.clone())
    })
}

/// Builds the pasted elements for one paste step: fresh ids, remapped
/// references, fresh version stream, and placement.
///
/// `paste_index` is 1-based (first paste after a copy uses 1): the cascade
/// offset is `PASTE_OFFSET × paste_index`. Ids mint from the document's id
/// source and loop until collision-free, so counter-based generators stay
/// correct even after imports introduced foreign ids (TS `randomUUID`
/// cannot collide — EXPECTED DIFFERENCE, same observable outcome).
fn plan_paste_elements(
    doc: &mut Document,
    source: &[Element],
    paste_index: u32,
    target: Option<[f64; 2]>,
) -> EngineResult<Vec<Element>> {
    // Fresh element ids (collision-free against the live document).
    let mut id_map: HashMap<ElementId, ElementId> = HashMap::new();
    for original in source {
        let mut fresh = doc.fresh_element_id();
        while doc.contains(fresh.as_str()) || id_map.values().any(|id| id == &fresh) {
            fresh = doc.fresh_element_id();
        }
        id_map.insert(original.id().clone(), fresh);
    }
    // One fresh group id per distinct group in the buffer (document-scoped
    // uniqueness: loop past ids already present in the document).
    let used_groups: HashSet<ElementId> = doc
        .get_all_including_deleted()
        .iter()
        .flat_map(|element| element.base().group_ids.iter().cloned())
        .collect();
    let mut group_map: HashMap<ElementId, ElementId> = HashMap::new();
    for original in source {
        for gid in &original.base().group_ids {
            if !group_map.contains_key(gid) {
                let mut fresh = doc.next_group_id();
                while used_groups.contains(&fresh) || group_map.values().any(|id| id == &fresh) {
                    fresh = doc.next_group_id();
                }
                group_map.insert(gid.clone(), fresh);
            }
        }
    }
    let copied_ids: HashSet<&ElementId> = source.iter().map(Element::id).collect();

    // Placement: cascade, or bbox-relative for an explicit target.
    let (delta_x, delta_y) = match target {
        Some([tx, ty]) => {
            let mut min_x = f64::INFINITY;
            let mut min_y = f64::INFINITY;
            for original in source {
                let base = original.base();
                if base.x < min_x {
                    min_x = base.x;
                }
                if base.y < min_y {
                    min_y = base.y;
                }
            }
            (tx + PASTE_OFFSET - min_x, ty + PASTE_OFFSET - min_y)
        }
        None => {
            let step = PASTE_OFFSET * f64::from(paste_index.max(1));
            (step, step)
        }
    };

    let mut pasted = Vec::with_capacity(source.len());
    for original in source {
        let mut next = original.clone();
        let base = next.base_mut();
        base.id = id_map
            .get(&base.id)
            .cloned()
            .expect("id map covers every source element");
        base.version = 0;
        base.version_nonce = doc.fresh_nonce();
        base.seed = doc.fresh_seed();
        // Pasted content starts unlocked (TS parity); `hidden` is preserved
        // verbatim — inheriting invisibility is the documented TS behavior.
        base.locked = false;
        base.x += delta_x;
        base.y += delta_y;
        base.group_ids = base
            .group_ids
            .iter()
            .map(|gid| group_map.get(gid).cloned().unwrap_or_else(|| gid.clone()))
            .collect();
        if let Some(frame_id) = base.frame_id.clone() {
            base.frame_id = id_map.get(&frame_id).cloned();
        }
        match &mut next {
            Element::Arrow(arrow) => {
                for slot in [&mut arrow.start_binding, &mut arrow.end_binding] {
                    if let Some(binding) = slot {
                        if copied_ids.contains(&binding.element_id) {
                            binding.element_id = id_map
                                .get(&binding.element_id)
                                .cloned()
                                .expect("copied target has a fresh id");
                        } else {
                            *slot = None;
                        }
                    }
                }
            }
            Element::Text(text) => {
                if let Some(container_id) = text.container_id.clone() {
                    text.container_id = id_map.get(&container_id).cloned();
                }
            }
            _ => {}
        }
        // Instance override patches clone verbatim (TS parity —
        // `clipboard.ts` remaps no override contents).
        next.validate()?;
        pasted.push(next);
    }
    Ok(pasted)
}
