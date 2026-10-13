import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as UIPointerEvent,
} from 'react';
import type { Engine, FrameSnapshot } from '../../../hooks/useEngine';
import { parseBatchResult } from '../../../hooks/useEngine';
import { useI18n } from '../../../app/i18n/resources';
import { useToast } from '../../../app/shell/ToastProvider';
import { executeCommand, type CommandContext } from '../../../registries';
import { executeExtensionCommand, hasExtensionCommand } from '../../../platform/extensions/extensionContributions';
import { commandResultMessage } from '../engineGaps';
import { Tooltip } from '../../../ui/primitives/tooltip';
import { buildNavigatorEntries, type NavigatorEntry } from '../navigator';
import { normalizeSelection } from '../selection';
import { CanvasContextMenu } from '../menus/menus';
import { CollapseAllIcon, ExpandAllIcon, LockIcon } from '../../../ui/icons';
import {
  coveredGroups,
  directChildrenOf,
  expandToElementIds,
  globalReorder,
  indexRows,
  intoInsertIndex,
  isInheritedOnly,
  layersMenuFor,
  lockCauseFor,
  pruneTreeSelection,
  rangeInRows,
  selectionRoots,
  siblingInsertIndex,
  treeGuideCells,
  unitOf,
  validateRenameInput,
  validateTreeDrop,
  visibleRows,
  type LayersDropTarget,
  type LayersGroupInfo,
  type LayersIntent,
} from '../layersTree';

interface LayersPanelProps {
  frame: FrameSnapshot | null;
  onSelect: (ids: string[], additive: boolean) => void;
  engine: Engine;
  sendBatch: (ops: unknown[]) => Promise<string>;
  commandContext: CommandContext;
}

/** Localized element-kind label with a raw-id fallback for custom kinds. */
export function kindLabel(kind: string, t: (key: string) => string): string {
  const key = `editor.kinds.${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}

interface MenuState {
  x: number;
  y: number;
  /** Right-clicked node id (element or group). Never a label or row index. */
  targetId: string;
  /** Pruned tree selection the menu was computed from. */
  selection: string[];
  intents: LayersIntent[];
}

interface DropIndicator {
  target: LayersDropTarget;
  valid: boolean;
}

/** Pointer travel before a press becomes a tree drag. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Layers tree: Figma-style hierarchy rows over the engine render model.
 *
 * The engine owns every permanent mutation (group, reparent, reorder,
 * rename, lock) through single atomic ops; this panel only holds transient
 * UI state (tree selection pin, collapse, rename draft, drag preview).
 * Highlighting follows stable node ids, and right-click never widens the
 * selection beyond its target.
 */
export function LayersPanel({ frame, onSelect, sendBatch, commandContext }: LayersPanelProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [dragRoots, setDragRoots] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<DropIndicator | null>(null);
  const dragRootsRef = useRef<string[] | null>(null);
  const renameCommittedRef = useRef(false);
  const pressRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<number | null>(null);

  // -- derived model -------------------------------------------------------

  const allRows = useMemo(() => {
    if (!frame) return [];
    return buildNavigatorEntries(frame.model, []);
  }, [frame]);

  const rowsById = useMemo(() => indexRows(allRows), [allRows]);

  const groupsById = useMemo(() => {
    const map = new Map<string, LayersGroupInfo>();
    for (const group of frame?.model.groups ?? []) {
      map.set(group.id, {
        id: group.id,
        name: group.name,
        parentGroupId: group.parentGroupId,
        locked: group.locked,
        effectiveLocked: group.effectiveLocked,
      });
    }
    return map;
  }, [frame]);

  const liveElements = useMemo(() => {
    const live = new Set<string>();
    if (!frame) return live;
    for (const entry of frame.model.base) live.add(entry.id);
    for (const pass of frame.model.frames) {
      live.add(pass.frame.id);
      for (const child of pass.children) live.add(child.id);
    }
    return live;
  }, [frame]);

  const liveNodes = useMemo(() => {
    const live = new Set<string>(liveElements);
    for (const id of groupsById.keys()) live.add(id);
    return live;
  }, [liveElements, groupsById]);

  const engineSel = useMemo(
    () => normalizeSelection(frame?.session.selection ?? [], liveElements),
    [frame, liveElements],
  );

  // Single source of truth is the engine selection. Group containers
  // highlight alongside their members whenever the whole unit is selected,
  // so the tree and the canvas always agree on what "the group" means.
  const highlight = useMemo(() => {
    const pruned = pruneTreeSelection(engineSel, liveNodes);
    const covered = coveredGroups(pruned, rowsById, groupsById);
    const seen = new Set(pruned);
    for (const id of covered) {
      if (!seen.has(id)) {
        seen.add(id);
        pruned.push(id);
      }
    }
    return pruned;
  }, [engineSel, liveNodes, rowsById, groupsById]);
  const highlightSet = useMemo(() => new Set(highlight), [highlight]);

  const visible = useMemo(() => visibleRows(allRows, collapsedGroups), [allRows, collapsedGroups]);
  const rootChildren = useMemo(() => directChildrenOf(allRows, null, groupsById), [allRows, groupsById]);

  /** Frame container per element, for tree guides of frame children. */
  const frameOf = useMemo(() => {
    const map = new Map<string, string>();
    if (!frame) return map;
    for (const pass of frame.model.frames) {
      for (const child of pass.children) map.set(child.id, pass.frame.id);
    }
    return map;
  }, [frame]);

  const guidesById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof treeGuideCells>>();
    for (const row of visible) map.set(row.id, treeGuideCells(row, visible, groupsById, frameOf));
    return map;
  }, [visible, groupsById, frameOf]);

  // Renaming a node that vanished (undo, delete) exits edit mode intact.
  useEffect(() => {
    if (renamingId !== null && !liveNodes.has(renamingId)) {
      setRenamingId(null);
      setRenameError(null);
    }
  }, [renamingId, liveNodes]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  // -- engine commit ---------------------------------------------------------

  // Stable mount-once focus for the rename input: an inline ref callback
  // would reattach (and reselect-all) on every keystroke, so each typed
  // character would replace the previous content instead of appending.
  const focusSelectRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.select();
    }
  }, []);

  /** Send one batch, toast typed failures, and report success. */
  const commitOps = useCallback(
    async (ops: unknown[], opts?: { refresh?: boolean }): Promise<{ ok: boolean; affected: string[] }> => {
      let raw: string;
      try {
        raw = await sendBatch(ops);
      } catch (error) {
        notify(t('editor.errors.commandFailed', { message: error instanceof Error ? error.message : String(error) }));
        return { ok: false, affected: [] };
      }
      let parsed: ReturnType<typeof parseBatchResult>;
      try {
        parsed = parseBatchResult(raw);
      } catch (error) {
        notify(t('editor.errors.commandFailed', { message: error instanceof Error ? error.message : String(error) }));
        return { ok: false, affected: [] };
      }
      const failed = parsed.results.find((entry) => !entry.ok);
      if (failed) {
        notify(t('editor.errors.commandFailed', { message: failed.message ?? failed.code ?? 'error' }));
        return { ok: false, affected: [] };
      }
      // Wake the canvas watcher: processing already finished in the
      // background above, and the UI only adopts the ready state — no
      // refresh chrome, no polling, exactly one fresh frame follows.
      // Read-only ops (copy) skip the wake so idle panels cost nothing.
      if (opts?.refresh ?? true) requestRefresh();
      const affected: string[] = [];
      for (const entry of parsed.results) {
        const data = entry.data as { affected?: unknown; groupId?: unknown } | undefined;
        if (Array.isArray(data?.affected)) {
          for (const id of data.affected) {
            if (typeof id === 'string') affected.push(id);
          }
        }
        if (typeof data?.groupId === 'string') affected.push(data.groupId);
      }
      return { ok: true, affected };
    },
    // commandContext rides along: without it the closure keeps the first
    // render's (possibly view-less) context and the watcher wake silently
    // never fires, leaving committed results invisible until incidental input.
    [sendBatch, notify, t, commandContext],
  );

  /** Mirror ids to the engine without the stale-frame filter (fresh ids
   * from duplication are not live in the current frame yet). */
  const engineSelectDirect = useCallback(
    (ids: string[]) => {
      void sendBatch([{ op: 'select', ids }])
        .then(() => commandContext.view?.refreshFrame?.())
        .catch(() => undefined);
    },
    [sendBatch, commandContext],
  );

  /** Ask the canvas watcher for one fresh frame after a local mutation. */
  function requestRefresh(): void {
    commandContext.view?.refreshFrame?.();
  }

  // -- selection ---------------------------------------------------------------
  //
  // Group members act as one unit with their outermost container: naming a
  // grouped node (element or group) selects the container plus every
  // member, on the canvas and in the tree alike. Unit expansion itself
  // lives in the central select path so every caller converges.

  function parentOf(id: string): string | null {
    const row = rowsById.get(id);
    if (row && !row.group) return row.groupIds[0] ?? null;
    return groupsById.get(id)?.parentGroupId ?? null;
  }

  function selectRow(id: string, additive: boolean, range: boolean): void {
    if (!rowsById.has(id) && !groupsById.has(id)) return;
    if (range) {
      const anchor = highlight[highlight.length - 1] ?? visible[0]?.id ?? id;
      onSelect(pruneTreeSelection(rangeInRows(visible, anchor, id), liveNodes), false);
      return;
    }
    onSelect([id], additive);
  }

  function clickRow(event: MouseEvent, row: NavigatorEntry): void {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (renamingId !== null) return;
    const toggle = (event.ctrlKey || event.metaKey) && !event.shiftKey;
    selectRow(row.id, toggle, event.shiftKey);
  }

  function toggleCollapse(id: string): void {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allGroupIds = useMemo(() => [...groupsById.keys()], [groupsById]);
  const anyExpanded = allGroupIds.some((id) => !collapsedGroups.has(id));

  /** Collapse every folder, or expand them all when none is expanded. */
  function toggleCollapseAll(): void {
    setCollapsedGroups(anyExpanded ? new Set(allGroupIds) : new Set());
  }

  // -- right-click ---------------------------------------------------------------

  function openMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!liveNodes.has(id)) return;
    // Keep an active selection whose unit already contains the target;
    // otherwise the target's whole unit becomes the menu selection.
    const unit = unitOf(id, rowsById, groupsById);
    const unitIds = [...(unit.group ? [unit.group] : []), ...unit.members];
    const next = unitIds.every((entry) => highlightSet.has(entry)) ? highlight : unitIds;
    if (next !== highlight) {
      onSelect([id], false);
    }
    setMenu({
      x: event.clientX,
      y: event.clientY,
      targetId: id,
      selection: next,
      intents: layersMenuFor({ rows: rowsById, groups: groupsById, selection: next, targetId: id }),
    });
  }

  // -- menu execution ---------------------------------------------------------------

  async function runMenuAction(intent: LayersIntent): Promise<void> {
    const snapshot = menu;
    setMenu(null);
    if (!snapshot) return;
    const { targetId, selection } = snapshot;
    const roots = selectionRoots(selection, rowsById, groupsById);
    const elementIds = expandToElementIds(selection, allRows, groupsById);

    if (intent.kind === 'rename') {
      beginRename(targetId);
      return;
    }
    if (intent.kind === 'unlockAncestor') {
      const { ok } = await commitOps([{ op: 'setGroupLocked', ids: [intent.ancestorId], locked: false }]);
      if (ok) notify(`${t('editor.commands.unlock')} · ${intent.ancestorName}`);
      return;
    }
    switch (intent.id) {
      case 'selectAll': {
        const result = await executeCommand('selectAll', commandContext);
        const message = commandResultMessage('selectAll', result, t);
        if (message) notify(message);
        return;
      }
      case 'delete': {
        const { ok } = await commitOps([{ op: 'delete', ids: elementIds }]);
        if (ok) onSelect([], false);
        return;
      }
      case 'copy': {
        await commitOps([{ op: 'copy', ids: elementIds }], { refresh: false });
        return;
      }
      case 'duplicate': {
        const hasGroup = roots.some((id) => groupsById.has(id));
        const { ok, affected } = await commitOps(
          hasGroup ? [{ op: 'duplicateNodes', ids: roots }] : [{ op: 'duplicate', ids: elementIds }],
        );
        // Fresh ids are not live in the current frame yet, so mirror them
        // through the raw op: the engine stores them verbatim and the next
        // watcher frame (already requested above) adopts them.
        if (ok && affected.length > 0) engineSelectDirect(affected);
        return;
      }
      case 'bringToFront':
      case 'sendToBack': {
        await commitOps([{ op: intent.id, ids: elementIds }]);
        return;
      }
      case 'lock': {
        const elementRoots = roots.filter((id) => !groupsById.has(id));
        const groupRoots = roots.filter((id) => groupsById.has(id));
        const ops: unknown[] = [];
        if (elementRoots.length > 0) ops.push({ op: 'setLocked', ids: elementRoots, locked: true });
        if (groupRoots.length > 0) ops.push({ op: 'setGroupLocked', ids: groupRoots, locked: true });
        await commitOps(ops);
        return;
      }
      case 'unlock': {
        const elementRoots = roots.filter((id) => !groupsById.has(id));
        const groupRoots = roots.filter((id) => groupsById.has(id));
        const ops: unknown[] = [];
        if (elementRoots.length > 0) ops.push({ op: 'setLocked', ids: elementRoots, locked: false });
        if (groupRoots.length > 0) ops.push({ op: 'setGroupLocked', ids: groupRoots, locked: false });
        await commitOps(ops);
        return;
      }
      case 'group': {
        // Members stay selected, so the fresh container highlights itself
        // through coverage on the next watcher frame — no pin needed.
        await commitOps([{ op: 'group', ids: elementIds }]);
        return;
      }
      case 'ungroup': {
        await commitOps([{ op: 'ungroup', groupId: targetId }]);
        return;
      }
      default: {
        if (hasExtensionCommand(intent.id)) {
          await executeExtensionCommand(intent.id);
          commandContext.view?.refreshFrame?.();
          return;
        }
        const result = await executeCommand(intent.id, commandContext);
        const message = commandResultMessage(intent.id, result, t);
        if (message) notify(message);
      }
    }
  }

  // -- inline rename ---------------------------------------------------------------

  function beginRename(id: string): void {
    const row = rowsById.get(id);
    if (!row) return;
    renameCommittedRef.current = false;
    // Prefill with the displayed title — stored name, or the tool-type
    // fallback (e.g. Rectangle) for unnamed objects — exactly like groups,
    // so edit mode never opens on something different from the row.
    // Commit stores the input verbatim; nothing is ever appended to it.
    setRenameDraft(row.name === '' ? kindLabel(row.kind, t) : row.name);
    setRenameError(null);
    setRenamingId(id);
  }

  function exitRename(): void {
    renameCommittedRef.current = true;
    setRenamingId(null);
    setRenameError(null);
  }

  /**
   * Finish an inline rename. Enter commits; Escape and blur commit too when
   * the input holds a valid name and revert otherwise — an empty name never
   * reaches the engine and never wipes the stored one.
   */
  async function finishRename(source: 'enter' | 'escape' | 'blur'): Promise<void> {
    if (renamingId === null || renameCommittedRef.current) return;
    const validation = validateRenameInput(renameDraft);
    if (!validation.ok) {
      if (source === 'enter') {
        setRenameError(t('editor.navigator.nameRequired'));
        return;
      }
      exitRename();
      return;
    }
    const id = renamingId;
    const current = rowsById.get(id)?.name ?? '';
    if (validation.name === current) {
      exitRename();
      return;
    }
    exitRename();
    // Engine validation is final; the tree re-renders from engine state.
    await commitOps([{ op: 'renameNode', id, name: validation.name }]);
  }

  // -- lock toggle ---------------------------------------------------------------

  async function toggleRowLock(row: NavigatorEntry): Promise<void> {
    const cause = lockCauseFor(row.id, rowsById, groupsById);
    if (cause?.kind === 'inherited') {
      const { ok } = await commitOps([{ op: 'setGroupLocked', ids: [cause.ancestorId], locked: false }]);
      if (ok) notify(`${t('editor.commands.unlock')} · ${cause.ancestorName}`);
      return;
    }
    if (row.group) {
      await commitOps([{ op: 'setGroupLocked', ids: [row.id], locked: !row.locked }]);
      return;
    }
    await commitOps([{ op: 'setLocked', ids: [row.id], locked: !row.locked }]);
  }

  function lockTooltip(row: NavigatorEntry): string {
    const cause = lockCauseFor(row.id, rowsById, groupsById);
    if (cause?.kind === 'local') return t('editor.navigator.locked');
    if (cause?.kind === 'inherited') return t('editor.navigator.lockedBy', { name: cause.ancestorName });
    return t('editor.commands.lock');
  }

  // -- drag-and-drop (pointer-based) -----------------------------------------
  //
  // Tree drags run on pointer events, like canvas drags do: a press arms a
  // candidate, crossing a small threshold starts the drag, and release
  // commits exactly one atomic engine command — or nothing when the release
  // point is invalid (including outside the panel). Validity is always
  // checked at release; the indicator only previews.

  function dragRootsFor(sourceId: string): string[] {
    const roots = selectionRoots(highlight.includes(sourceId) ? highlight : [sourceId], rowsById, groupsById);
    return roots.filter((id) => rowsById.has(id) || groupsById.has(id));
  }

  function canDragStart(id: string): boolean {
    const row = rowsById.get(id);
    if (!row) return false;
    // Files drag into folders; folders never drag into files, and
    // inherited-only locks cannot start a structural drag. Local locks
    // travel through hierarchy commands with their flags preserved.
    if (isInheritedOnly(id, rowsById, groupsById)) return false;
    if (row.group && groupsById.get(id)?.effectiveLocked === true) return false;
    return dragRootsFor(id).length > 0;
  }

  function cleanupPress(): void {
    pressRef.current = null;
    dragRootsRef.current = null;
    setDragRoots(null);
    setDrop(null);
    stopAutoScroll();
    window.removeEventListener('pointermove', pressPointerMove);
    window.removeEventListener('pointerup', pressPointerUp);
    window.removeEventListener('pointercancel', pressPointerCancel);
    window.removeEventListener('blur', pressPointerCancel);
    window.removeEventListener('keydown', pressKeyDown);
  }

  function rowPointerDown(event: UIPointerEvent<HTMLButtonElement>, id: string): void {
    if (event.button !== 0 || renamingId !== null) return;
    // Modified presses are selection gestures, never drags.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!canDragStart(id)) return;
    pressRef.current = { id, x: event.clientX, y: event.clientY };
    window.addEventListener('pointermove', pressPointerMove);
    window.addEventListener('pointerup', pressPointerUp);
    window.addEventListener('pointercancel', pressPointerCancel);
    window.addEventListener('blur', pressPointerCancel);
    window.addEventListener('keydown', pressKeyDown);
  }

  function pressPointerMove(event: globalThis.PointerEvent): void {
    const press = pressRef.current;
    if (!press) return;
    if (dragRootsRef.current === null) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD_PX) return;
      const roots = dragRootsFor(press.id);
      if (roots.length === 0) {
        cleanupPress();
        return;
      }
      // A drag from outside the selection first selects its source unit,
      // so the dragged set and the highlight always agree.
      if (!highlight.includes(press.id)) {
        onSelect([press.id], false);
      }
      dragRootsRef.current = roots;
      setDragRoots(roots);
    }
    updateHoverIndicator(event.clientX, event.clientY);
    autoScroll(event.clientY);
  }

  function pressPointerUp(event: globalThis.PointerEvent): void {
    const press = pressRef.current;
    const roots = dragRootsRef.current;
    cleanupPress();
    if (!press) return;
    if (!roots || roots.length === 0) return;
    // Swallow the click that follows a real drag so release never reselects.
    suppressClickRef.current = true;
    const target = hoverTargetAt(event.clientX, event.clientY);
    if (!target) return;
    if (target.zone === 'root') {
      void commitTreeDrop(roots, target);
      return;
    }
    const verdict = validateTreeDrop(roots, target, rowsById, groupsById);
    if (!verdict.ok) {
      notify(t('editor.navigator.dropInvalid'));
      return;
    }
    void commitTreeDrop(roots, target);
  }

  function pressPointerCancel(): void {
    const wasDragging = dragRootsRef.current !== null;
    cleanupPress();
    if (wasDragging) suppressClickRef.current = true;
  }

  function pressKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !pressRef.current) return;
    event.preventDefault();
    pressPointerCancel();
  }

  function updateHoverIndicator(clientX: number, clientY: number): void {
    const roots = dragRootsRef.current;
    if (!roots || roots.length === 0) return;
    const target = hoverTargetAt(clientX, clientY);
    if (!target) {
      setDrop(null);
      return;
    }
    const valid = target.zone === 'root' ? true : validateTreeDrop(roots, target, rowsById, groupsById).ok;
    const next: DropIndicator = { target, valid };
    setDrop((current) => (sameDrop(current, next) ? current : next));
  }

  function autoScroll(clientY: number): void {
    const container = scrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const edge = 28;
    const step = 9;
    let delta = 0;
    if (clientY - rect.top < edge) delta = -step;
    else if (rect.bottom - clientY < edge) delta = step;
    if (delta === 0) {
      stopAutoScroll();
      return;
    }
    if (autoScrollRef.current !== null) return;
    const tick = (): void => {
      const host = scrollRef.current;
      if (!host || dragRootsRef.current === null) {
        stopAutoScroll();
        return;
      }
      host.scrollTop += delta;
      autoScrollRef.current = requestAnimationFrame(tick);
    };
    autoScrollRef.current = requestAnimationFrame(tick);
  }

  function sameDrop(a: DropIndicator | null, b: DropIndicator): boolean {
    if (a === null) return false;
    if (a.valid !== b.valid || a.target.zone !== b.target.zone) return false;
    if (a.target.zone === 'root' && b.target.zone === 'root') return a.target.index === b.target.index;
    if (a.target.zone === 'row' && b.target.zone === 'row') {
      return a.target.position === b.target.position && a.target.id === b.target.id;
    }
    return false;
  }

  /**
   * Resolve the drop target from pointer coordinates, so indent guides,
   * gaps, and row padding are all droppable — there are no dead zones
   * between rows. Returns the hovered row plus its zone, the root append
   * slot over list background, or null outside the panel (release there
   * restores the previous state with no commit).
   */
  function hoverTargetAt(clientX: number, clientY: number): LayersDropTarget | null {
    const host = scrollRef.current;
    if (!host) return null;
    const element = document.elementFromPoint(clientX, clientY);
    const item = element instanceof HTMLElement ? element.closest('li[data-node-id]') : null;
    if (!(item instanceof HTMLElement)) {
      return element instanceof Node && host.contains(element)
        ? { zone: 'root', index: rootChildren.length }
        : null;
    }
    const id = item.dataset.nodeId;
    const row = id !== undefined ? rowsById.get(id) : undefined;
    if (!row) return null;
    const rect = item.getBoundingClientRect();
    if (rect.height <= 0) return { zone: 'row', position: 'after', id: row.id };
    const ratio = (clientY - rect.top) / rect.height;
    if (row.group) {
      if (ratio < 0.25) return { zone: 'row', position: 'before', id: row.id };
      if (ratio > 0.75) return { zone: 'row', position: 'after', id: row.id };
      return { zone: 'row', position: 'into', id: row.id };
    }
    return { zone: 'row', position: ratio < 0.5 ? 'before' : 'after', id: row.id };
  }

  /** Commit one drop as a single atomic engine command (one undo entry). */
  async function commitTreeDrop(roots: string[], target: LayersDropTarget): Promise<void> {
    const order = frame?.model.elementOrder ?? [];
    if (target.zone === 'root') {
      const children = directChildrenOf(allRows, null, groupsById);
      const clamped = Math.max(0, Math.min(target.index, children.length));
      const reparented = roots.some((id) => parentOf(id) !== null);
      if (!reparented) {
        // Already at the root: slide the block after the last root child.
        const last = children[children.length - 1];
        if (last === undefined) return;
        await commitOps([
          { op: 'reorder', order: globalReorder(order, allRows, groupsById, roots, last, 'after') },
        ]);
        return;
      }
      await commitOps([{ op: 'reparentNodes', ids: roots, parentGroupId: null, index: clamped }]);
      return;
    }
    if (target.position === 'into') {
      await commitOps([
        {
          op: 'reparentNodes',
          ids: roots,
          parentGroupId: target.id,
          index: intoInsertIndex(allRows, groupsById, target.id),
        },
      ]);
      return;
    }
    const { parent } = siblingInsertIndex(allRows, groupsById, target.id, target.position, roots);
    if (roots.every((id) => parentOf(id) === parent)) {
      await commitOps([
        { op: 'reorder', order: globalReorder(order, allRows, groupsById, roots, target.id, target.position) },
      ]);
      return;
    }
    const destination = siblingInsertIndex(allRows, groupsById, target.id, target.position, roots);
    await commitOps([{ op: 'reparentNodes', ids: roots, parentGroupId: destination.parent, index: destination.index }]);
  }

  // -- render ------------------------------------------------------------------

  if (!frame) return null;

  const menuLabelOverrides: Record<string, string> = { rename: t('editor.navigator.rename') };
  if (menu) {
    for (const intent of menu.intents) {
      if (intent.kind === 'unlockAncestor') {
        menuLabelOverrides['unlockAncestor'] = t('editor.navigator.unlockGroup', {
          name: intent.ancestorName,
        });
      }
    }
  }
  const menuIntentIds = menu
    ? menu.intents.map((intent) =>
        intent.kind === 'command' ? intent.id : intent.kind === 'rename' ? 'rename' : 'unlockAncestor',
      )
    : [];
  const menuContext: CommandContext = menu ? { ...commandContext, selection: menu.selection } : commandContext;

  return (
    <>
      <div className="editor-layers__head">
        <span className="editor-layers__title">{t('editor.panels.layers')}</span>
        <Tooltip
          content={anyExpanded ? t('editor.panels.collapseAll') : t('editor.panels.expandAll')}
          placement="left"
        >
          <button
            type="button"
            className="editor-layers__collapsebtn"
            aria-label={anyExpanded ? t('editor.panels.collapseAll') : t('editor.panels.expandAll')}
            aria-pressed={!anyExpanded}
            onClick={toggleCollapseAll}
          >
            {anyExpanded ? <CollapseAllIcon size={14} /> : <ExpandAllIcon size={14} />}
          </button>
        </Tooltip>
      </div>
      <div
        ref={scrollRef}
        className={`editor-layers__scroll${dragRoots !== null ? ' editor-layers__scroll--dragging' : ''}`}
      >
        {visible.length === 0 ? (
          <div className="editor-panel__empty">
            <div className="editor-panel__empty-title">{t('editor.navigator.empty')}</div>
            <div className="editor-panel__empty-hint">{t('editor.navigator.emptyHint')}</div>
          </div>
        ) : (
          <ul className="editor-layers" aria-label={t('editor.panels.layers')}>
            {visible.map((row) => {
              const title = row.name === '' ? kindLabel(row.kind, t) : row.name;
              const isRenaming = renamingId === row.id;
              const isDragging = dragRoots !== null && dragRoots.includes(row.id);
              const indicator =
                drop !== null && drop.target.zone === 'row' && drop.target.id === row.id ? drop : null;
              const position =
                indicator !== null && indicator.target.zone === 'row' ? indicator.target.position : null;
              const dropClass =
                indicator === null
                  ? ''
                  : !indicator.valid
                    ? ' editor-layers__row--drop-invalid'
                    : position === 'into'
                      ? ' editor-layers__row--drop-into'
                      : position === 'before'
                        ? ' editor-layers__row--drop-before'
                        : ' editor-layers__row--drop-after';
              const selected = highlightSet.has(row.id);
              const guides = guidesById.get(row.id) ?? [];
              const dragging = dragRoots !== null;
              // The twisty sits in the row's own elbow slot with the
              // connector drawn behind the arrow, so child guides start
              // exactly under their parent's arrow.
              const ancestorCells = row.group ? guides.slice(0, -1) : guides;
              const ownElbow = row.group
                ? guides.length > 0
                  ? guides[guides.length - 1]
                  : null
                : null;
              return (
                <li key={row.id} data-node-id={row.id} className="editor-layers__item">
                  {ancestorCells.length > 0 ? (
                    <span className="editor-layers__guides" aria-hidden="true">
                      {ancestorCells.map((cell, index) => (
                        <span key={index} className={`editor-layers__guide editor-layers__guide--${cell}`} />
                      ))}
                    </span>
                  ) : null}
                  {row.group ? (
                    <button
                      type="button"
                      className={
                        `editor-layers__twisty` +
                        (ownElbow === 'branch' || ownElbow === 'end' ? ` editor-layers__twisty--${ownElbow}` : '')
                      }
                      aria-expanded={!collapsedGroups.has(row.id)}
                      aria-label={row.name}
                      onClick={() => toggleCollapse(row.id)}
                      tabIndex={-1}
                    >
                      <span aria-hidden="true">{collapsedGroups.has(row.id) ? '▸' : '▾'}</span>
                    </button>
                  ) : null}
                  {isRenaming ? (
                    // The input stands alone where the name was — no kind
                    // label beside it, exactly like group rename mode.
                    <div className={`editor-layers__row${dropClass}`} aria-current={selected ? 'true' : undefined}>
                      <div className="editor-layers__renamewrap">
                        <input
                          ref={focusSelectRef}
                          className="editor-layers__rename"
                          aria-label={t('editor.navigator.rename')}
                          value={renameDraft}
                          onChange={(event) => {
                            setRenameDraft(event.target.value);
                            if (renameError !== null) setRenameError(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void finishRename('enter');
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              event.stopPropagation();
                              void finishRename('escape');
                            }
                          }}
                          onBlur={() => void finishRename('blur')}
                          onClick={(event) => event.stopPropagation()}
                          onContextMenu={(event) => event.stopPropagation()}
                        />
                        {renameError !== null ? (
                          <span className="editor-layers__rename-error" role="alert">
                            {renameError}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`editor-layers__row${dropClass}${isDragging ? ' editor-layers__row--dragging' : ''}`}
                      aria-current={selected ? 'true' : undefined}
                      onClick={(event) => clickRow(event, row)}
                      onDoubleClick={() => beginRename(row.id)}
                      onPointerDown={(event) => rowPointerDown(event, row.id)}
                      onContextMenu={(event) => openMenu(event, row.id)}
                    >
                      {/* One title span like group rows: the kind label never
                          sits beside the name, so a stored name never reads
                          as "default + input". */}
                      <Tooltip content={title} disabled={dragging}>
                        <span className="editor-layers__name">{title}</span>
                      </Tooltip>
                    </button>
                  )}
                  <Tooltip content={lockTooltip(row)} placement="left" disabled={dragging}>
                    <button
                      type="button"
                      className={
                        `editor-layers__lockbtn` +
                        (row.effectiveLocked ? ' editor-layers__lockbtn--on' : '') +
                        (row.effectiveLocked && !row.locked ? ' editor-layers__lockbtn--inherited' : '')
                      }
                      aria-label={row.effectiveLocked ? t('editor.commands.unlock') : t('editor.commands.lock')}
                      aria-pressed={row.effectiveLocked}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleRowLock(row);
                      }}
                      onContextMenu={(event) => openMenu(event, row.id)}
                      tabIndex={-1}
                    >
                      <LockIcon size={14} />
                    </button>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {menu ? (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          intents={menuIntentIds}
          context={menuContext}
          labelOverrides={menuLabelOverrides}
          onExecute={(intent) => {
            const resolved = menu.intents.find((entry) =>
              entry.kind === 'command' ? entry.id === intent : entry.kind === intent,
            );
            if (resolved) void runMenuAction(resolved);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}
