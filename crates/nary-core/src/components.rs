//! Component masters, instances, overrides, resolve, and actions.
//!
//! TS sources: `packages/core/src/components/component-registry.ts`
//! (master registry), `instance-sync.ts` (resolve + version-keyed
//! `InstanceResolveCache`), `component-actions.ts` (create/override/reset/
//! detach/materialize), `assets/asset-store.ts` is the sibling
//! [`crate::assets`] module.
//!
//! Commit pattern (one consistent rule, not two competing ones): resolve is
//! pure (`&Document`) — [`resolve_instance`], [`resolve_instance_deep`],
//! [`resolve_all_instances`], and [`get_instance_elements`] only read, with
//! render/hit-test consuming their output directly and production loops
//! pairing them with [`InstanceResolveCache`]. Mutations are `plan_*`
//! functions returning pending elements ([`plan_create_instance`],
//! [`plan_set_override`], [`plan_reset_override`],
//! [`plan_detach_instance`]); plans that mint fresh identity take `&mut
//! Document` and commit through `history.transaction` + `ctx.upsert` /
//! `ctx.soft_delete` (the [`crate::clipboard`] precedent). A [`Command`]
//! cannot mint: the [`Document`] is the single version/nonce/identity owner
//! and [`crate::command::CommandContext`] exposes no fresh-id source.
//! [`SetOverride`] and [`ResetOverride`] rewrite one existing element, so
//! they are thin [`crate::command::Command`]s delegating to the plans (one
//! history entry via `history.execute`, [`crate::command::SetStyle`]
//! precedent); [`CreateInstance`] and [`DetachInstance`] are history
//! adapters over already-planned data ([`crate::command::CreateElements`]
//! precedent) for call sites that commit through `history.execute`.
//!
//! Override model: [`crate::element::InstanceElement::overrides`] maps an
//! index path (`"0"`, `"0/1"`) to a [`crate::element::PatchValue::Object`]
//! property bag. Only common scalar base fields are applied
//! (`x`/`y`/`width`/`height`/`rotation`, `stroke_color`, `stroke_width`,
//! `opacity`, accepting both `snake_case` and TS `camelCase` spellings);
//! identity keys (`id`, `type`) are never applied and instance-level
//! metadata (`group_ids`, `frame_id`, `locked`, `hidden`) always wins.
//! Structural payloads (points, text, bindings, fills, nested objects) are
//! out of scope and ignored — a documented boundary, so resolve output is
//! always valid without guessing.
//!
//! Deliberate difference from TS: override presence is a key-presence
//! check. TS used a falsy check (`if (!override?.x)`), which silently
//! dropped legitimate `0` overrides; here an explicitly set `0` wins over
//! the anchor offset.

use std::collections::HashMap;

use crate::command::{Command, CommandContext, CommandOutcome};
use crate::document::Document;
use crate::element::{
    BaseElement, Element, ElementFillStyle, ElementId, FillStyle, InstanceElement, PatchValue,
    StrokeAlign, StrokeCap, StrokeJoin, StrokeStyle,
};
use crate::frame::frame_children;
use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Master registry (unchanged public surface)
// ---------------------------------------------------------------------------

/// A component master: metadata pointing at the scene elements that form
/// the template (TS `ComponentDefinition`). Not a scene element itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentDefinition {
    /// Unique component id.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Scene ids of the master root elements.
    pub root_element_ids: Vec<ElementId>,
}

/// Instance-scoped registry of component masters with a reverse index
/// from master root element to component id.
#[derive(Debug, Clone, Default)]
pub struct ComponentRegistry {
    /// Definitions by component id.
    definitions: HashMap<String, ComponentDefinition>,
    /// Reverse index: master root element id → component id.
    root_to_component: HashMap<ElementId, String>,
}

impl ComponentRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a master. Duplicate ids and empty ids are rejected
    /// (TS throws on duplicates; Rust returns a typed error).
    pub fn register(&mut self, definition: ComponentDefinition) -> EngineResult<()> {
        if definition.id.is_empty() {
            return Err(EngineError::InvalidInput(
                "component id must not be empty".to_string(),
            ));
        }
        if self.definitions.contains_key(&definition.id) {
            return Err(EngineError::InvalidInput(format!(
                "component with id \"{}\" already exists",
                definition.id
            )));
        }
        for root_id in &definition.root_element_ids {
            self.root_to_component
                .insert(root_id.clone(), definition.id.clone());
        }
        self.definitions.insert(definition.id.clone(), definition);
        Ok(())
    }

    /// Borrows a definition by component id.
    pub fn get(&self, id: &str) -> Option<&ComponentDefinition> {
        self.definitions.get(id)
    }

    /// Returns `true` when the component id is registered.
    pub fn has(&self, id: &str) -> bool {
        self.definitions.contains_key(id)
    }

    /// Removes a definition and its reverse-index entries. Scene elements
    /// are untouched (TS parity). Returns `false` when unknown.
    pub fn remove(&mut self, id: &str) -> bool {
        let Some(definition) = self.definitions.remove(id) else {
            return false;
        };
        for root_id in &definition.root_element_ids {
            self.root_to_component.remove(root_id);
        }
        true
    }

    /// Borrows all definitions.
    pub fn all(&self) -> Vec<&ComponentDefinition> {
        self.definitions.values().collect()
    }

    /// Finds the component owning a master root element.
    pub fn get_by_root_element(&self, element_id: &ElementId) -> Option<&ComponentDefinition> {
        let component_id = self.root_to_component.get(element_id)?;
        self.definitions.get(component_id)
    }
}

/// Promotes existing document elements into a master component definition.
///
/// TS parity: `defineComponent` in
/// `packages/core/src/components/component-registry.ts`. The elements stay
/// in the document (they are the master visual); only registry metadata is
/// added.
///
/// Validation order (first failure wins): `name` must be non-empty after
/// trimming (`InvalidInput`); `root_ids` must be non-empty (`InvalidInput`);
/// every root must exist (`NotFound` for unknown ids), must not be
/// soft-deleted (`InvalidInput` for tombstones), must not be an instance
/// (`InvalidInput` — a master must never be an instance; the TS helper does
/// not check this explicitly, but accepting an instance root here would let a
/// master transitively resolve through another component, which the Rust
/// resolve path is not designed to expand, so it is rejected by contract),
/// and must not already be a master root of another component (`InvalidInput`
/// via [`ComponentRegistry::get_by_root_element`]).
///
/// Identity mints from [`Document::fresh_element_id`] (instance-scoped
/// deterministic counter, no new `uuid` dependency). Unlike TS
/// (`component-<timestamp>-<random>`), ids follow the document id source
/// (e.g. `el-N` under [`crate::element::CounterIdGenerator`]); a collision
/// loop skips ids already registered. Takes `&mut Document` because minting
/// mutates the id source — the single version/nonce/identity owner.
pub fn define_component(
    doc: &mut Document,
    registry: &mut ComponentRegistry,
    name: &str,
    root_ids: &[ElementId],
) -> EngineResult<ComponentDefinition> {
    if name.trim().is_empty() {
        return Err(EngineError::InvalidInput(
            "component name must not be empty".to_string(),
        ));
    }
    if root_ids.is_empty() {
        return Err(EngineError::InvalidInput(
            "component must have at least one root element".to_string(),
        ));
    }
    for root_id in root_ids {
        let Some(element) = doc.get(root_id.as_str()) else {
            return Err(EngineError::NotFound(format!(
                "element \"{}\" not found",
                root_id.as_str()
            )));
        };
        if element.base().is_deleted {
            return Err(EngineError::InvalidInput(format!(
                "element \"{}\" is deleted",
                root_id.as_str()
            )));
        }
        if element.element_type_name() == "instance" {
            return Err(EngineError::InvalidInput(format!(
                "element \"{}\" is an instance and cannot be a component master root",
                root_id.as_str()
            )));
        }
        if registry.get_by_root_element(root_id).is_some() {
            return Err(EngineError::InvalidInput(format!(
                "element \"{}\" is already a master root of another component",
                root_id.as_str()
            )));
        }
    }
    let mut component_id = doc.fresh_element_id().into_string();
    while registry.has(&component_id) {
        component_id = doc.fresh_element_id().into_string();
    }
    let definition = ComponentDefinition {
        id: component_id,
        name: name.to_string(),
        root_element_ids: root_ids.to_vec(),
    };
    registry.register(definition.clone())?;
    Ok(definition)
}

// ---------------------------------------------------------------------------
// Resolve (pure, &Document)
// ---------------------------------------------------------------------------

/// Resolves an instance into its visual elements (TS `resolveInstance`).
///
/// Each master root is cloned, its per-index override (`String(i)`) is
/// applied, the copy is repositioned so the instance origin anchors the
/// master's root-0 origin (unless `x`/`y` is explicitly overridden), and
/// instance metadata (`group_ids`, `frame_id`, `locked`, `hidden`, plus
/// `rotation` unless overridden) is preserved. Missing or deleted masters
/// are skipped. Copies are transient render data: they keep master ids and
/// must not be upserted as-is (see [`plan_detach_instance`]).
pub fn resolve_instance(
    doc: &Document,
    instance: &Element,
    component: &ComponentDefinition,
) -> EngineResult<Vec<Element>> {
    let Element::Instance(instance_el) = instance else {
        return Err(EngineError::InvalidInput(format!(
            "resolve_instance targets instance elements, '{}' is {}",
            instance.id().as_str(),
            instance.element_type_name()
        )));
    };
    let offset = anchor_offset(doc, instance_el, component);
    let mut resolved = Vec::with_capacity(component.root_element_ids.len());
    for (index, root_id) in component.root_element_ids.iter().enumerate() {
        let Some(master) = doc.get(root_id.as_str()) else {
            continue;
        };
        if master.base().is_deleted {
            continue;
        }
        let path = index.to_string();
        let patch = override_patch(&instance_el.overrides, &path);
        resolved.push(resolve_copy(instance_el, patch, master, offset));
    }
    Ok(resolved)
}

/// Resolves an instance including nested frame children (TS
/// `resolveInstanceDeep`).
///
/// Same as [`resolve_instance`], but masters that are frames additionally
/// expand their live children recursively under `"{root}/{child}"` paths
/// (via [`frame_children`], in z-order). Non-frame masters resolve flat.
pub fn resolve_instance_deep(
    doc: &Document,
    instance: &Element,
    component: &ComponentDefinition,
) -> EngineResult<Vec<Element>> {
    let Element::Instance(instance_el) = instance else {
        return Err(EngineError::InvalidInput(format!(
            "resolve_instance_deep targets instance elements, '{}' is {}",
            instance.id().as_str(),
            instance.element_type_name()
        )));
    };
    let offset = anchor_offset(doc, instance_el, component);
    let mut resolved = Vec::new();
    for (index, root_id) in component.root_element_ids.iter().enumerate() {
        let Some(master) = doc.get(root_id.as_str()) else {
            continue;
        };
        if master.base().is_deleted {
            continue;
        }
        resolve_tree(
            doc,
            instance_el,
            &index.to_string(),
            master,
            offset,
            &mut resolved,
        );
    }
    Ok(resolved)
}

/// Resolves every live instance in document order (TS `resolveAllInstances`).
///
/// Returns the per-instance resolutions plus the ids of instances whose
/// component is unknown (or failed to resolve). Infallible by construction:
/// resolution of a known instance cannot fail, so failures degrade to
/// `unresolved` instead of aborting the whole pass.
pub fn resolve_all_instances(
    doc: &Document,
    registry: &ComponentRegistry,
) -> (HashMap<ElementId, Vec<Element>>, Vec<ElementId>) {
    let mut resolved = HashMap::new();
    let mut unresolved = Vec::new();
    for element in doc.get_all() {
        if let Element::Instance(instance) = element {
            match registry.get(instance.component_id.as_str()) {
                None => unresolved.push(element.id().clone()),
                Some(component) => match resolve_instance(doc, element, component) {
                    Ok(elements) => {
                        resolved.insert(element.id().clone(), elements);
                    }
                    Err(_) => unresolved.push(element.id().clone()),
                },
            }
        }
    }
    (resolved, unresolved)
}

/// Returns the resolved elements for one instance (TS `getInstanceElements`).
///
/// Does NOT cache — pair [`resolve_instance`] with [`InstanceResolveCache`]
/// in production loops. Returns an empty vec when the instance or its
/// component is missing (TS parity).
pub fn get_instance_elements(
    doc: &Document,
    instance_id: &str,
    registry: &ComponentRegistry,
) -> Vec<Element> {
    let Some(element) = doc.get(instance_id) else {
        return Vec::new();
    };
    if element.base().is_deleted {
        return Vec::new();
    }
    let Element::Instance(instance) = element else {
        return Vec::new();
    };
    let Some(component) = registry.get(instance.component_id.as_str()) else {
        return Vec::new();
    };
    resolve_instance(doc, element, component).unwrap_or_default()
}

/// Scene-space anchor delta: instance origin minus master root-0 origin.
/// A missing root-0 degrades to a zero offset (no reposition, TS parity).
fn anchor_offset(
    doc: &Document,
    instance: &InstanceElement,
    component: &ComponentDefinition,
) -> (f64, f64) {
    let (anchor_x, anchor_y) = component
        .root_element_ids
        .first()
        .and_then(|id| doc.get(id.as_str()))
        .map(|root| (root.base().x, root.base().y))
        .unwrap_or((instance.base.x, instance.base.y));
    (instance.base.x - anchor_x, instance.base.y - anchor_y)
}

/// Borrows the property bag for one index path. Non-object patches are
/// treated as absent (a scalar at a path position is meaningless).
fn override_patch<'a>(
    overrides: &'a HashMap<String, PatchValue>,
    path: &str,
) -> Option<&'a HashMap<String, PatchValue>> {
    match overrides.get(path) {
        Some(PatchValue::Object(patch)) => Some(patch),
        _ => None,
    }
}

/// Copies one master, applies its override bag, repositions from the anchor
/// (unless `x`/`y` is explicitly overridden), and preserves instance-level
/// metadata (TS parity: `groupIds`, `frameId`, `locked`, `hidden`
/// unconditionally; `rotation` unless overridden).
fn resolve_copy(
    instance: &InstanceElement,
    patch: Option<&HashMap<String, PatchValue>>,
    master: &Element,
    offset: (f64, f64),
) -> Element {
    let mut copy = master.clone();
    if let Some(bag) = patch {
        apply_override_patch(copy.base_mut(), bag);
    }
    let has = |key: &str| patch.is_some_and(|bag| bag.contains_key(key));
    let base = copy.base_mut();
    if !has("x") {
        base.x += offset.0;
    }
    if !has("y") {
        base.y += offset.1;
    }
    base.group_ids.clone_from(&instance.base.group_ids);
    base.frame_id.clone_from(&instance.base.frame_id);
    base.locked = instance.base.locked;
    base.hidden = instance.base.hidden;
    if !has("rotation") {
        base.rotation = instance.base.rotation;
    }
    copy
}

/// Recursively resolves one master subtree for [`resolve_instance_deep`].
fn resolve_tree(
    doc: &Document,
    instance: &InstanceElement,
    path: &str,
    master: &Element,
    offset: (f64, f64),
    out: &mut Vec<Element>,
) {
    let patch = override_patch(&instance.overrides, path);
    out.push(resolve_copy(instance, patch, master, offset));
    if matches!(master, Element::Frame(_)) {
        for (child_index, child_id) in frame_children(doc, master.id().as_str()).iter().enumerate()
        {
            if let Some(child) = doc.get(child_id.as_str()) {
                if child.base().is_deleted {
                    continue;
                }
                resolve_tree(
                    doc,
                    instance,
                    &format!("{path}/{child_index}"),
                    child,
                    offset,
                    out,
                );
            }
        }
    }
}

/// Applies one override bag to shared base fields. Identity keys (`id`,
/// `type`) and instance-owned metadata are never applied; anything outside
/// the supported scalar set is ignored (documented boundary, see the
/// module docs).
fn apply_override_patch(base: &mut BaseElement, patch: &HashMap<String, PatchValue>) {
    for (key, value) in patch {
        match key.as_str() {
            "x" => {
                if let Some(number) = as_finite_number(value) {
                    base.x = number;
                }
            }
            "y" => {
                if let Some(number) = as_finite_number(value) {
                    base.y = number;
                }
            }
            "width" => {
                if let Some(number) = as_finite_number(value) {
                    base.width = number;
                }
            }
            "height" => {
                if let Some(number) = as_finite_number(value) {
                    base.height = number;
                }
            }
            "rotation" => {
                if let Some(number) = as_finite_number(value) {
                    base.rotation = number;
                }
            }
            "stroke_color" | "strokeColor" => {
                if let Some(text) = as_text(value) {
                    base.stroke_color = text.to_string();
                }
            }
            "stroke_width" | "strokeWidth" => {
                if let Some(number) = as_finite_number(value) {
                    base.stroke_width = number;
                }
            }
            "opacity" => {
                if let Some(number) = as_finite_number(value) {
                    base.opacity = number;
                }
            }
            _ => {}
        }
    }
}

/// Extracts a finite number from a patch value.
fn as_finite_number(value: &PatchValue) -> Option<f64> {
    match value {
        PatchValue::Number(number) if number.is_finite() => Some(*number),
        _ => None,
    }
}

/// Extracts a string from a patch value.
fn as_text(value: &PatchValue) -> Option<&str> {
    match value {
        PatchValue::Text(text) => Some(text),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Version-keyed resolve cache
// ---------------------------------------------------------------------------

/// One cached resolution: versions that produced it plus the output.
#[derive(Debug, Clone, PartialEq)]
struct ResolveCacheEntry {
    /// Instance `version` at resolve time.
    instance_version: u32,
    /// Master root `version`s at resolve time, in root order.
    master_versions: Vec<u32>,
    /// Resolved copies (transient, as returned by the resolve functions).
    resolved: Vec<Element>,
}

/// Caches resolved instance output, keyed by versions (TS
/// `InstanceResolveCache`).
///
/// A hit requires the same instance `version` and the same per-master
/// `version` vector (same length, same values in root order); anything else
/// is a miss. Callers read versions from the document before querying.
#[derive(Debug, Clone, Default)]
pub struct InstanceResolveCache {
    /// Cached resolutions by instance id.
    entries: HashMap<ElementId, ResolveCacheEntry>,
}

impl InstanceResolveCache {
    /// Creates an empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the cached resolution, or `None` on any version mismatch.
    pub fn get(
        &self,
        instance_id: &str,
        instance_version: u32,
        master_versions: &[u32],
    ) -> Option<&Vec<Element>> {
        let entry = self.entries.get(instance_id)?;
        if entry.instance_version != instance_version {
            return None;
        }
        if entry.master_versions != master_versions {
            return None;
        }
        Some(&entry.resolved)
    }

    /// Stores a resolution with the versions that produced it.
    pub fn set(
        &mut self,
        instance_id: ElementId,
        instance_version: u32,
        master_versions: &[u32],
        resolved: Vec<Element>,
    ) {
        self.entries.insert(
            instance_id,
            ResolveCacheEntry {
                instance_version,
                master_versions: master_versions.to_vec(),
                resolved,
            },
        );
    }

    /// Drops the entry for one instance.
    pub fn invalidate(&mut self, instance_id: &str) {
        self.entries.remove(instance_id);
    }

    /// Drops all entries (e.g. after a master edit of unknown scope).
    pub fn invalidate_all(&mut self) {
        self.entries.clear();
    }

    /// Number of cached entries (debugging/profiling).
    pub fn size(&self) -> usize {
        self.entries.len()
    }

    /// Returns `true` when no entries are cached.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Actions: plans (mint identity) + commands (rewrite in place)
// ---------------------------------------------------------------------------

/// Loads a live instance element or reports why it cannot be edited.
/// Unknown and soft-deleted ids are both `NotFound` (ghost parity with
/// [`Document::soft_delete`]); wrong-type elements are `InvalidInput`.
fn lookup_live_instance(doc: &Document, instance_id: &str) -> EngineResult<InstanceElement> {
    let Some(element) = doc.get(instance_id) else {
        return Err(EngineError::NotFound(format!(
            "instance \"{instance_id}\" not found"
        )));
    };
    if element.base().is_deleted {
        return Err(EngineError::NotFound(format!(
            "instance \"{instance_id}\" not found"
        )));
    }
    let Element::Instance(instance) = element else {
        return Err(EngineError::InvalidInput(format!(
            "element \"{}\" is {} not an instance",
            instance_id,
            element.element_type_name()
        )));
    };
    Ok(instance.clone())
}

/// Union bounds of the live master roots, or `None` when no root is
/// resolvable (missing or deleted).
fn master_union_bounds(
    doc: &Document,
    component: &ComponentDefinition,
) -> Option<(f64, f64, f64, f64)> {
    let mut acc: Option<(f64, f64, f64, f64)> = None;
    for root_id in &component.root_element_ids {
        let master = doc.get(root_id.as_str())?;
        if master.base().is_deleted {
            continue;
        }
        let bounds = master.bounds();
        acc = Some(match acc {
            None => (bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y),
            Some((min_x, min_y, max_x, max_y)) => (
                min_x.min(bounds.min_x),
                min_y.min(bounds.min_y),
                max_x.max(bounds.max_x),
                max_y.max(bounds.max_y),
            ),
        });
    }
    acc
}

/// Plans a new instance element (TS `createInstance`).
///
/// The instance is anchored at (`x`, `y`) with the union size of the live
/// master roots and no overrides. Identity (id, seed, nonce) mints from the
/// document, collision-free. Commit with `ctx.upsert` (or a one-element
/// [`CreateInstance`] command). Errors on non-finite positions and when no
/// master root is live (TS would store infinite dimensions instead).
pub fn plan_create_instance(
    doc: &mut Document,
    component: &ComponentDefinition,
    x: f64,
    y: f64,
) -> EngineResult<Element> {
    if !x.is_finite() || !y.is_finite() {
        return Err(EngineError::InvalidInput(format!(
            "instance position must be finite, got ({x}, {y})"
        )));
    }
    let Some((min_x, min_y, max_x, max_y)) = master_union_bounds(doc, component) else {
        return Err(EngineError::NotFound(format!(
            "component \"{}\" has no live master elements",
            component.id
        )));
    };
    let mut instance_id = doc.fresh_element_id();
    while doc.contains(instance_id.as_str()) {
        instance_id = doc.fresh_element_id();
    }
    let element = Element::Instance(InstanceElement {
        base: BaseElement {
            id: instance_id,
            x,
            y,
            width: max_x - min_x,
            height: max_y - min_y,
            rotation: 0.0,
            stroke_color: "#000000".to_string(),
            background_color: FillStyle::default_transparent(),
            stroke_width: 1.0,
            stroke_style: StrokeStyle::Solid,
            stroke_cap: StrokeCap::default(),
            stroke_join: StrokeJoin::default(),
            stroke_align: StrokeAlign::default(),
            fill_style: ElementFillStyle::Solid,
            opacity: 100.0,
            seed: doc.fresh_seed(),
            version: 0,
            version_nonce: doc.fresh_nonce(),
            is_deleted: false,
            group_ids: Vec::new(),
            locked: false,
            hidden: false,
            frame_id: None,
            constraints: None,
            child_layout_sizing: None,
        },
        component_id: component.id.clone(),
        overrides: HashMap::new(),
    });
    element.validate()?;
    Ok(element)
}

/// Plans an override update on one index path (TS `setInstanceOverride`).
///
/// The patch must be an [`PatchValue::Object`] property bag; it shallow-
/// merges over the existing bag at `path` (TS `{...current, ...patch}`
/// parity). Returns the next element; commit with `ctx.upsert` (or
/// [`SetOverride`]). Rejects non-finite patch numbers.
pub fn plan_set_override(
    doc: &Document,
    instance_id: &str,
    path: &str,
    patch: PatchValue,
) -> EngineResult<Element> {
    if path.is_empty() {
        return Err(EngineError::InvalidInput(
            "override path must not be empty".to_string(),
        ));
    }
    let PatchValue::Object(patch_map) = &patch else {
        return Err(EngineError::InvalidInput(
            "override patch must be an object of property patches".to_string(),
        ));
    };
    patch.validate()?;
    let mut next = lookup_live_instance(doc, instance_id)?;
    let mut merged: HashMap<String, PatchValue> = match next.overrides.get(path) {
        Some(PatchValue::Object(current)) => current.clone(),
        _ => HashMap::new(),
    };
    for (key, value) in patch_map {
        merged.insert(key.clone(), value.clone());
    }
    next.overrides
        .insert(path.to_string(), PatchValue::Object(merged));
    let element = Element::Instance(next);
    element.validate()?;
    Ok(element)
}

/// Plans the removal of one override path (TS `resetInstanceOverride`).
///
/// Unknown paths are a no-op plan: the returned element equals the stored
/// one, so callers (and [`ResetOverride`]) skip the upsert and record
/// nothing. Returns the next element; commit with `ctx.upsert`.
pub fn plan_reset_override(doc: &Document, instance_id: &str, path: &str) -> EngineResult<Element> {
    if path.is_empty() {
        return Err(EngineError::InvalidInput(
            "override path must not be empty".to_string(),
        ));
    }
    let mut next = lookup_live_instance(doc, instance_id)?;
    next.overrides.remove(path);
    Ok(Element::Instance(next))
}

/// Pending detach: materialized copies plus the instance to soft-delete.
/// Commit with [`DetachPlan::commit`] (or a [`DetachInstance`] command).
#[derive(Debug, Clone, PartialEq)]
pub struct DetachPlan {
    /// Independent copies with fresh ids, version 0, and fresh nonces.
    pub materialized: Vec<Element>,
    /// Instance to soft-delete on commit.
    pub instance_id: ElementId,
}

impl DetachPlan {
    /// Commits the plan: upserts every copy, then soft-deletes the
    /// instance (TS `detachInstance` order parity). Returns the committed
    /// ids, materialized first with the instance id last.
    pub fn commit(self, ctx: &mut CommandContext) -> EngineResult<Vec<ElementId>> {
        let mut ids = Vec::with_capacity(self.materialized.len() + 1);
        for element in self.materialized {
            ids.push(element.id().clone());
            ctx.upsert(element)?;
        }
        ctx.soft_delete(self.instance_id.as_str())?;
        ids.push(self.instance_id);
        Ok(ids)
    }
}

/// Plans detaching an instance (TS `detachInstance`).
///
/// Resolves the instance shallowly (TS parity — frame children stay
/// addressed through their own `frame_id`, they are not expanded), then
/// materializes each copy with a fresh collision-free id, `version` 0, and
/// a fresh nonce. The seed and resolved geometry/metadata carry over from
/// the master. The instance itself is NOT deleted by the plan; the commit
/// step does that (see [`DetachPlan::commit`]).
pub fn plan_detach_instance(
    doc: &mut Document,
    instance_id: &str,
    registry: &ComponentRegistry,
) -> EngineResult<DetachPlan> {
    let instance = lookup_live_instance(doc, instance_id)?;
    let Some(component) = registry.get(instance.component_id.as_str()) else {
        return Err(EngineError::NotFound(format!(
            "component \"{}\" not found",
            instance.component_id
        )));
    };
    let resolved = resolve_instance(doc, &Element::Instance(instance.clone()), component)?;
    let mut materialized = Vec::with_capacity(resolved.len());
    for mut element in resolved {
        let mut fresh = doc.fresh_element_id();
        while doc.contains(fresh.as_str())
            || materialized
                .iter()
                .any(|copy: &Element| copy.id() == &fresh)
        {
            fresh = doc.fresh_element_id();
        }
        let nonce = doc.fresh_nonce();
        let base = element.base_mut();
        base.id = fresh;
        base.version = 0;
        base.version_nonce = nonce;
        element.validate()?;
        materialized.push(element);
    }
    Ok(DetachPlan {
        materialized,
        instance_id: instance.base.id.clone(),
    })
}

/// Creates a pre-planned instance element as one undoable step.
///
/// Data-carrier over [`plan_create_instance`] output
/// ([`crate::command::CreateElements`] precedent): the plan already minted
/// identity from `&mut Document`, so the command only validates and stores.
#[derive(Debug, Clone, PartialEq)]
pub struct CreateInstance {
    /// Planned instance element to store.
    pub element: Element,
}

impl CreateInstance {
    /// Wraps a planned instance element (see [`plan_create_instance`]).
    pub fn new(element: Element) -> Self {
        Self { element }
    }
}

impl Command for CreateInstance {
    fn label(&self) -> &str {
        "create-instance"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        self.element.validate()?;
        if !matches!(self.element, Element::Instance(_)) {
            return Err(EngineError::InvalidInput(
                "CreateInstance carries an instance element".to_string(),
            ));
        }
        if ctx.doc().contains(self.element.id().as_str()) {
            return Err(EngineError::InvariantViolation(format!(
                "create collides with existing element '{}'",
                self.element.id().as_str()
            )));
        }
        let id = self.element.id().clone();
        ctx.upsert(self.element.clone())?;
        Ok(CommandOutcome {
            affected: vec![id],
            changed: true,
        })
    }
}

/// Sets an override bag on one index path as one undoable step.
///
/// Delegates to [`plan_set_override`]; an empty net change records nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct SetOverride {
    /// Instance to edit.
    pub instance_id: ElementId,
    /// Override key (e.g. `"0"` for the first root element).
    pub path: String,
    /// Property bag to shallow-merge over the path.
    pub patch: PatchValue,
}

impl SetOverride {
    /// Builds an override-set command.
    pub fn new(instance_id: ElementId, path: String, patch: PatchValue) -> Self {
        Self {
            instance_id,
            path,
            patch,
        }
    }
}

impl Command for SetOverride {
    fn label(&self) -> &str {
        "set-instance-override"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let next = plan_set_override(
            ctx.doc(),
            self.instance_id.as_str(),
            &self.path,
            self.patch.clone(),
        )?;
        if ctx
            .doc()
            .get(self.instance_id.as_str())
            .is_some_and(|current| *current == next)
        {
            return Ok(CommandOutcome::default());
        }
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.instance_id.clone()],
            changed: true,
        })
    }
}

/// Removes one override path as one undoable step.
///
/// Delegates to [`plan_reset_override`]; an absent path records nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct ResetOverride {
    /// Instance to edit.
    pub instance_id: ElementId,
    /// Override key to remove (e.g. `"0"`).
    pub path: String,
}

impl ResetOverride {
    /// Builds an override-reset command.
    pub fn new(instance_id: ElementId, path: String) -> Self {
        Self { instance_id, path }
    }
}

impl Command for ResetOverride {
    fn label(&self) -> &str {
        "reset-instance-override"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let next = plan_reset_override(ctx.doc(), self.instance_id.as_str(), &self.path)?;
        if ctx
            .doc()
            .get(self.instance_id.as_str())
            .is_some_and(|current| *current == next)
        {
            return Ok(CommandOutcome::default());
        }
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.instance_id.clone()],
            changed: true,
        })
    }
}

/// Detaches a pre-planned instance as one undoable step.
///
/// Data-carrier over [`plan_detach_instance`] output: upserts the
/// materialized copies, then soft-deletes the instance.
#[derive(Debug, Clone, PartialEq)]
pub struct DetachInstance {
    /// Planned detach to commit.
    pub plan: DetachPlan,
}

impl DetachInstance {
    /// Wraps a planned detach (see [`plan_detach_instance`]).
    pub fn new(plan: DetachPlan) -> Self {
        Self { plan }
    }
}

impl Command for DetachInstance {
    fn label(&self) -> &str {
        "detach-instance"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let affected = self.plan.clone().commit(ctx)?;
        Ok(CommandOutcome {
            affected,
            changed: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{
        create_ellipse, create_frame, create_instance, create_rectangle, CounterIdGenerator,
    };
    use crate::history::HistoryManager;

    fn rectangle(
        gen: &mut CounterIdGenerator,
        id: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        rect.base.x = x;
        rect.base.y = y;
        rect.base.width = w;
        rect.base.height = h;
        Element::Rectangle(rect)
    }

    fn ellipse(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
        let mut ellipse = create_ellipse(gen);
        ellipse.base.id = ElementId::of(id);
        ellipse.base.x = x;
        ellipse.base.y = y;
        ellipse.base.width = w;
        ellipse.base.height = h;
        Element::Ellipse(ellipse)
    }

    fn frame(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
        let mut frame = create_frame(gen);
        frame.base.id = ElementId::of(id);
        frame.base.x = x;
        frame.base.y = y;
        frame.base.width = w;
        frame.base.height = h;
        Element::Frame(frame)
    }

    fn instance(
        gen: &mut CounterIdGenerator,
        id: &str,
        component_id: &str,
        x: f64,
        y: f64,
    ) -> Element {
        let mut inst = create_instance(gen, component_id, x, y);
        inst.base.id = ElementId::of(id);
        Element::Instance(inst)
    }

    fn bag(pairs: &[(&str, PatchValue)]) -> PatchValue {
        PatchValue::Object(
            pairs
                .iter()
                .map(|(key, value)| ((*key).to_string(), value.clone()))
                .collect(),
        )
    }

    fn number(value: f64) -> PatchValue {
        PatchValue::Number(value)
    }

    fn text(value: &str) -> PatchValue {
        PatchValue::Text(value.to_string())
    }

    /// Document with two masters + a registered component over them.
    fn doc_with_component() -> (Document, CounterIdGenerator, ComponentRegistry) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle(&mut gen, "m1", 10.0, 20.0, 100.0, 80.0))
            .unwrap();
        doc.upsert(ellipse(&mut gen, "m2", 200.0, 0.0, 50.0, 50.0))
            .unwrap();
        let mut registry = ComponentRegistry::new();
        registry
            .register(ComponentDefinition {
                id: "comp-1".to_string(),
                name: "Pair".to_string(),
                root_element_ids: vec![ElementId::of("m1"), ElementId::of("m2")],
            })
            .unwrap();
        (doc, gen, registry)
    }

    #[test]
    fn register_lookup_and_reverse_index() {
        let mut registry = ComponentRegistry::new();
        registry
            .register(ComponentDefinition {
                id: "comp-1".to_string(),
                name: "Button".to_string(),
                root_element_ids: vec![ElementId::of("root-1")],
            })
            .unwrap();
        assert!(registry.has("comp-1"));
        assert_eq!(registry.get("comp-1").unwrap().name, "Button");
        assert_eq!(
            registry
                .get_by_root_element(&ElementId::of("root-1"))
                .unwrap()
                .id,
            "comp-1"
        );
        assert!(registry
            .get_by_root_element(&ElementId::of("other"))
            .is_none());
    }

    #[test]
    fn duplicate_and_empty_ids_are_rejected() {
        let mut registry = ComponentRegistry::new();
        registry
            .register(ComponentDefinition {
                id: "comp-1".to_string(),
                name: "Button".to_string(),
                root_element_ids: vec![ElementId::of("root-1")],
            })
            .unwrap();
        assert!(registry
            .register(ComponentDefinition {
                id: "comp-1".to_string(),
                name: "Button".to_string(),
                root_element_ids: vec![ElementId::of("root-1")],
            })
            .is_err());
        assert!(registry
            .register(ComponentDefinition {
                id: String::new(),
                name: "Bad".to_string(),
                root_element_ids: vec![],
            })
            .is_err());
    }

    #[test]
    fn remove_clears_definition_and_reverse_index() {
        let mut registry = ComponentRegistry::new();
        registry
            .register(ComponentDefinition {
                id: "comp-1".to_string(),
                name: "Button".to_string(),
                root_element_ids: vec![ElementId::of("root-1")],
            })
            .unwrap();
        assert!(registry.remove("comp-1"));
        assert!(!registry.has("comp-1"));
        assert!(registry
            .get_by_root_element(&ElementId::of("root-1"))
            .is_none());
        assert!(!registry.remove("comp-1"), "second remove reports absence");
    }

    #[test]
    fn resolve_repositions_from_anchor_and_preserves_metadata() {
        let (mut doc, mut gen, registry) = doc_with_component();
        let mut inst = instance(&mut gen, "i1", "comp-1", 110.0, 120.0);
        if let Element::Instance(inner) = &mut inst {
            inner.base.rotation = 0.5;
            inner.base.locked = true;
            inner.base.group_ids = vec![ElementId::of("g1")];
        }
        doc.upsert(inst.clone()).unwrap();
        let component = registry.get("comp-1").unwrap();

        let resolved = resolve_instance(&doc, &inst, component).unwrap();
        assert_eq!(resolved.len(), 2);
        // Anchor is root-0 (10, 20): offset (100, 100).
        assert_eq!(resolved[0].base().x, 110.0);
        assert_eq!(resolved[0].base().y, 120.0);
        assert_eq!(resolved[1].base().x, 300.0);
        assert_eq!(resolved[1].base().y, 100.0);
        // Metadata comes from the instance, rotation follows it.
        for copy in &resolved {
            assert_eq!(copy.base().group_ids, vec![ElementId::of("g1")]);
            assert!(copy.base().locked);
            assert_eq!(copy.base().rotation, 0.5);
        }
        // Copies keep master ids: they are transient, not new elements.
        assert_eq!(resolved[0].id(), &ElementId::of("m1"));
    }

    #[test]
    fn resolve_applies_overrides_and_never_identity() {
        let (mut doc, mut gen, registry) = doc_with_component();
        let mut inst = instance(&mut gen, "i1", "comp-1", 110.0, 120.0);
        if let Element::Instance(inner) = &mut inst {
            inner.overrides.insert(
                "0".to_string(),
                bag(&[
                    ("id", text("hacked")),
                    ("type", text("ellipse")),
                    ("x", number(5.0)),
                    ("stroke_color", text("#ff0000")),
                    ("opacity", number(42.0)),
                ]),
            );
            // camelCase spelling is accepted too.
            inner.overrides.insert(
                "1".to_string(),
                bag(&[("strokeWidth", number(3.0)), ("rotation", number(1.0))]),
            );
        }
        doc.upsert(inst.clone()).unwrap();
        let component = registry.get("comp-1").unwrap();

        let resolved = resolve_instance(&doc, &inst, component).unwrap();
        assert_eq!(resolved[0].id().as_str(), "m1", "id override is ignored");
        assert_eq!(
            resolved[0].element_type_name(),
            "rectangle",
            "type override is ignored"
        );
        // Explicit x wins over the anchor offset; y still repositions.
        assert_eq!(resolved[0].base().x, 5.0);
        assert_eq!(resolved[0].base().y, 120.0);
        assert_eq!(resolved[0].base().stroke_color, "#ff0000");
        assert_eq!(resolved[0].base().opacity, 42.0);
        // Second root: rotation override sticks, positions still reposition.
        assert_eq!(resolved[1].base().rotation, 1.0);
        assert_eq!(resolved[1].base().stroke_width, 3.0);
        assert_eq!(resolved[1].base().x, 300.0);
    }

    #[test]
    fn resolve_skips_missing_and_deleted_masters() {
        let (mut doc, mut gen, mut registry) = doc_with_component();
        doc.soft_delete("m2").unwrap();
        registry
            .register(ComponentDefinition {
                id: "comp-ghost".to_string(),
                name: "Ghost".to_string(),
                root_element_ids: vec![ElementId::of("nope")],
            })
            .unwrap();
        let inst = instance(&mut gen, "i1", "comp-1", 0.0, 0.0);

        let component = registry.get("comp-1").unwrap();
        let resolved = resolve_instance(&doc, &inst, component).unwrap();
        assert_eq!(resolved.len(), 1, "deleted m2 is skipped");
        assert_eq!(resolved[0].id().as_str(), "m1");

        let ghost = registry.get("comp-ghost").unwrap();
        let empty = resolve_instance(&doc, &inst, ghost).unwrap();
        assert!(empty.is_empty(), "missing masters resolve to nothing");
    }

    #[test]
    fn resolve_rejects_non_instances() {
        let (doc, _, registry) = doc_with_component();
        let component = registry.get("comp-1").unwrap();
        let master = doc.get("m1").unwrap();
        assert!(resolve_instance(&doc, master, component).is_err());
        assert!(resolve_instance_deep(&doc, master, component).is_err());
    }

    #[test]
    fn resolve_deep_expands_frame_children_with_indexed_paths() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(frame(&mut gen, "f1", 0.0, 0.0, 400.0, 300.0))
            .unwrap();
        let mut child = rectangle(&mut gen, "c1", 20.0, 30.0, 50.0, 40.0);
        child.base_mut().frame_id = Some(ElementId::of("f1"));
        doc.upsert(child).unwrap();
        let mut registry = ComponentRegistry::new();
        registry
            .register(ComponentDefinition {
                id: "comp-frame".to_string(),
                name: "Framed".to_string(),
                root_element_ids: vec![ElementId::of("f1")],
            })
            .unwrap();
        let component = registry.get("comp-frame").unwrap();
        let mut inst = instance(&mut gen, "i1", "comp-frame", 100.0, 50.0);
        if let Element::Instance(inner) = &mut inst {
            inner
                .overrides
                .insert("0/0".to_string(), bag(&[("x", number(7.0))]));
        }
        doc.upsert(inst.clone()).unwrap();

        let shallow = resolve_instance(&doc, &inst, component).unwrap();
        assert_eq!(shallow.len(), 1, "shallow resolve skips frame children");

        let deep = resolve_instance_deep(&doc, &inst, component).unwrap();
        assert_eq!(deep.len(), 2);
        // Anchor is f1 at (0, 0): offset (100, 50). The child override pins x.
        assert_eq!(deep[1].id().as_str(), "c1");
        assert_eq!(deep[1].base().x, 7.0);
        assert_eq!(deep[1].base().y, 80.0);
    }

    #[test]
    fn resolve_all_splits_resolved_and_unresolved() {
        let (mut doc, mut gen, registry) = doc_with_component();
        doc.upsert(instance(&mut gen, "good", "comp-1", 0.0, 0.0))
            .unwrap();
        doc.upsert(instance(&mut gen, "bad", "missing-comp", 0.0, 0.0))
            .unwrap();
        let (resolved, unresolved) = resolve_all_instances(&doc, &registry);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[&ElementId::of("good")].len(), 2);
        assert_eq!(unresolved, vec![ElementId::of("bad")]);
        assert!(get_instance_elements(&doc, "good", &registry).len() == 2);
        assert!(get_instance_elements(&doc, "bad", &registry).is_empty());
        assert!(get_instance_elements(&doc, "ghost", &registry).is_empty());
    }

    #[test]
    fn cache_hits_only_on_matching_versions() {
        let (mut doc, mut gen, registry) = doc_with_component();
        let inst = instance(&mut gen, "i1", "comp-1", 10.0, 20.0);
        doc.upsert(inst.clone()).unwrap();
        let component = registry.get("comp-1").unwrap();
        let resolved = resolve_instance(&doc, &inst, component).unwrap();
        let master_versions = vec![
            doc.get("m1").unwrap().base().version,
            doc.get("m2").unwrap().base().version,
        ];

        let mut cache = InstanceResolveCache::new();
        assert!(cache.is_empty());
        cache.set(
            ElementId::of("i1"),
            inst.base().version,
            &master_versions,
            resolved,
        );
        assert_eq!(cache.size(), 1);
        assert!(cache
            .get("i1", inst.base().version, &master_versions)
            .is_some());
        assert!(
            cache
                .get("i1", inst.base().version + 1, &master_versions)
                .is_none(),
            "instance version bump misses"
        );
        assert!(
            cache.get("i1", inst.base().version, &[99, 99]).is_none(),
            "master version drift misses"
        );
        assert!(
            cache
                .get("i1", inst.base().version, &master_versions[..1])
                .is_none(),
            "master count change misses"
        );
        cache.invalidate("i1");
        assert!(cache.is_empty());
        cache.set(
            ElementId::of("i1"),
            inst.base().version,
            &master_versions,
            Vec::new(),
        );
        cache.invalidate_all();
        assert!(cache.is_empty());
        assert_eq!(cache.size(), 0);
    }

    #[test]
    fn plan_create_computes_union_size_and_commits() {
        let (mut doc, _, registry) = doc_with_component();
        let component = registry.get("comp-1").unwrap().clone();
        // Masters span x 10..250, y 0..100.
        let planned = plan_create_instance(&mut doc, &component, 5.0, 6.0).unwrap();
        assert_eq!(planned.base().x, 5.0);
        assert_eq!(planned.base().y, 6.0);
        assert_eq!(planned.base().width, 240.0);
        assert_eq!(planned.base().height, 100.0);
        let Element::Instance(inner) = &planned else {
            panic!("plan must produce an instance");
        };
        assert_eq!(inner.component_id, "comp-1");
        assert!(inner.overrides.is_empty());

        let id = planned.id().clone();
        let mut history = HistoryManager::new();
        history
            .execute(&mut doc, CreateInstance::new(planned))
            .unwrap();
        assert!(doc.get(id.as_str()).is_some());
        assert!(history.can_undo());

        assert!(plan_create_instance(&mut doc, &component, f64::NAN, 0.0).is_err());
        let ghost = ComponentDefinition {
            id: "ghost".to_string(),
            name: "Ghost".to_string(),
            root_element_ids: vec![ElementId::of("nope")],
        };
        assert!(plan_create_instance(&mut doc, &ghost, 0.0, 0.0).is_err());
    }

    #[test]
    fn plan_set_and_reset_override_merge_and_clear() {
        let (mut doc, mut gen, _) = doc_with_component();
        doc.upsert(instance(&mut gen, "i1", "comp-1", 0.0, 0.0))
            .unwrap();

        let mut history = HistoryManager::new();
        history
            .execute(
                &mut doc,
                SetOverride::new(
                    ElementId::of("i1"),
                    "0".to_string(),
                    bag(&[("x", number(9.0))]),
                ),
            )
            .unwrap();
        history
            .execute(
                &mut doc,
                SetOverride::new(
                    ElementId::of("i1"),
                    "0".to_string(),
                    bag(&[("y", number(8.0))]),
                ),
            )
            .unwrap();
        let stored = doc.get("i1").unwrap().clone();
        let Element::Instance(inner) = &stored else {
            panic!("must stay an instance");
        };
        // Second set shallow-merges over the first at the same path.
        let PatchValue::Object(first) = &inner.overrides["0"] else {
            panic!("override bag must be an object");
        };
        assert_eq!(first.len(), 2);

        // Resetting an unknown path is a no-op that records nothing.
        let undos = history.undo_len();
        history
            .execute(
                &mut doc,
                ResetOverride::new(ElementId::of("i1"), "absent".to_string()),
            )
            .unwrap();
        assert_eq!(history.undo_len(), undos);

        history
            .execute(
                &mut doc,
                ResetOverride::new(ElementId::of("i1"), "0".to_string()),
            )
            .unwrap();
        let Element::Instance(cleared) = doc.get("i1").unwrap() else {
            panic!("must stay an instance");
        };
        assert!(!cleared.overrides.contains_key("0"));

        // Unknown instances and scalar patches are typed errors.
        assert!(plan_set_override(&doc, "ghost", "0", bag(&[])).is_err());
        assert!(plan_set_override(&doc, "i1", "0", number(1.0)).is_err());
        assert!(plan_set_override(&doc, "m1", "0", bag(&[])).is_err());
        assert!(plan_reset_override(&doc, "ghost", "0").is_err());
    }

    #[test]
    fn plan_detach_materializes_copies_and_clears_the_instance() {
        let (mut doc, mut gen, registry) = doc_with_component();
        doc.upsert(instance(&mut gen, "i1", "comp-1", 50.0, 60.0))
            .unwrap();

        let plan = plan_detach_instance(&mut doc, "i1", &registry).unwrap();
        assert_eq!(plan.materialized.len(), 2);
        assert_eq!(plan.instance_id, ElementId::of("i1"));
        for copy in &plan.materialized {
            assert_ne!(copy.id().as_str(), "m1");
            assert_ne!(copy.id().as_str(), "m2");
            assert_eq!(copy.base().version, 0);
        }
        // Anchor is m1 at (10, 20): offset (40, 40).
        assert_eq!(plan.materialized[0].base().x, 50.0);
        assert_eq!(plan.materialized[1].base().x, 240.0);

        let mut history = HistoryManager::new();
        history
            .execute(&mut doc, DetachInstance::new(plan))
            .unwrap();
        assert!(doc.get("i1").unwrap().base().is_deleted);
        assert_eq!(doc.element_count(), 4, "masters plus two copies");
        assert!(history.can_undo());

        assert!(plan_detach_instance(&mut doc, "ghost", &registry).is_err());
    }

    #[test]
    fn define_component_promotes_roots_and_indexes_reverse_lookup() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle(&mut gen, "m1", 0.0, 0.0, 10.0, 10.0))
            .unwrap();
        doc.upsert(ellipse(&mut gen, "m2", 20.0, 20.0, 10.0, 10.0))
            .unwrap();
        let mut registry = ComponentRegistry::new();

        let def = define_component(
            &mut doc,
            &mut registry,
            "Button",
            &[ElementId::of("m1"), ElementId::of("m2")],
        )
        .unwrap();
        assert!(!def.id.is_empty(), "minted id must not be empty");
        assert_eq!(def.name, "Button");
        assert_eq!(
            def.root_element_ids,
            vec![ElementId::of("m1"), ElementId::of("m2")]
        );
        assert!(registry.has(&def.id));
        assert_eq!(
            registry
                .get_by_root_element(&ElementId::of("m1"))
                .unwrap()
                .id,
            def.id
        );
        assert_eq!(
            registry
                .get_by_root_element(&ElementId::of("m2"))
                .unwrap()
                .id,
            def.id
        );
    }

    #[test]
    fn define_component_rejects_empty_name() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle(&mut gen, "m1", 0.0, 0.0, 10.0, 10.0))
            .unwrap();
        let mut registry = ComponentRegistry::new();

        for bad in ["", "   ", "\t\n "] {
            let err =
                define_component(&mut doc, &mut registry, bad, &[ElementId::of("m1")]).unwrap_err();
            assert!(
                matches!(err, crate::EngineError::InvalidInput(_)),
                "empty name {bad:?} must be InvalidInput, got {err:?}"
            );
        }
        assert!(registry.all().is_empty(), "rejection registers nothing");
    }

    #[test]
    fn define_component_rejects_empty_roots() {
        let mut doc = Document::new();
        let mut registry = ComponentRegistry::new();
        let err = define_component(&mut doc, &mut registry, "Empty", &[]).unwrap_err();
        assert!(matches!(err, crate::EngineError::InvalidInput(_)));
        assert!(registry.all().is_empty());
    }

    #[test]
    fn define_component_rejects_unknown_root() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle(&mut gen, "m1", 0.0, 0.0, 10.0, 10.0))
            .unwrap();
        let mut registry = ComponentRegistry::new();

        let err = define_component(&mut doc, &mut registry, "Ghost", &[ElementId::of("nope")])
            .unwrap_err();
        assert!(
            matches!(err, crate::EngineError::NotFound(_)),
            "unknown id must be NotFound, got {err:?}"
        );
        assert!(registry.all().is_empty());
    }

    #[test]
    fn define_component_rejects_deleted_root() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle(&mut gen, "m1", 0.0, 0.0, 10.0, 10.0))
            .unwrap();
        doc.soft_delete("m1").unwrap();
        let mut registry = ComponentRegistry::new();

        let err = define_component(&mut doc, &mut registry, "Tombstone", &[ElementId::of("m1")])
            .unwrap_err();
        assert!(
            matches!(err, crate::EngineError::InvalidInput(_)),
            "deleted root must be InvalidInput, got {err:?}"
        );
        assert!(registry.all().is_empty());
    }

    #[test]
    fn define_component_rejects_duplicate_master_root() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle(&mut gen, "m1", 0.0, 0.0, 10.0, 10.0))
            .unwrap();
        doc.upsert(ellipse(&mut gen, "m2", 20.0, 20.0, 10.0, 10.0))
            .unwrap();
        let mut registry = ComponentRegistry::new();
        define_component(&mut doc, &mut registry, "First", &[ElementId::of("m1")]).unwrap();

        let err = define_component(
            &mut doc,
            &mut registry,
            "Second",
            &[ElementId::of("m1"), ElementId::of("m2")],
        )
        .unwrap_err();
        assert!(
            matches!(err, crate::EngineError::InvalidInput(_)),
            "already-master root must be InvalidInput, got {err:?}"
        );
        assert_eq!(registry.all().len(), 1, "rejection adds nothing");
        assert!(
            registry.get_by_root_element(&ElementId::of("m2")).is_none(),
            "failed promotion must not partially index the fresh root"
        );
    }

    #[test]
    fn define_component_rejects_instance_as_root() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle(&mut gen, "m1", 0.0, 0.0, 10.0, 10.0))
            .unwrap();
        doc.upsert(instance(&mut gen, "i1", "comp-1", 0.0, 0.0))
            .unwrap();
        let mut registry = ComponentRegistry::new();

        let err = define_component(&mut doc, &mut registry, "Nested", &[ElementId::of("i1")])
            .unwrap_err();
        assert!(
            matches!(err, crate::EngineError::InvalidInput(_)),
            "instance root must be InvalidInput, got {err:?}"
        );
        assert!(registry.all().is_empty());
    }
}
