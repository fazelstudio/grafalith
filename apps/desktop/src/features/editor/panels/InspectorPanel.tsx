import { useState } from 'react';
import type { DrawEntryDto, Engine, FrameSnapshot, RenderModelDto } from '../../../hooks/useEngine';
import { useI18n } from '../../../app/i18n/resources';
import { LoadingState } from '../../../ui/primitives/controls';
import { useToast } from '../../../app/shell/ToastProvider';
import { executeCommand, canExecuteCommand, type CommandContext } from '../../../registries';
import { normalizeSelection } from '../selection';
import { inspectorSectionsFor } from '../inspector/descriptors';
import { InspectorField } from '../inspector/fields';
import { kindLabel } from './LayersPanel';

interface InspectorPanelProps {
  frame: FrameSnapshot | null;
  engine: Engine;
  sendBatch: (ops: unknown[]) => Promise<string>;
  commandContext: CommandContext;
}

function findEntries(model: RenderModelDto, ids: readonly string[]): DrawEntryDto[] {
  const wanted = new Set(ids);
  const found: DrawEntryDto[] = [];
  for (const entry of model.base) {
    if (wanted.has(entry.id)) found.push(entry);
  }
  for (const pass of model.frames) {
    if (wanted.has(pass.frame.id)) found.push(pass.frame);
    for (const child of pass.children) {
      if (wanted.has(child.id)) found.push(child);
    }
  }
  // Preserve selection order so multi-selection reads stay predictable.
  found.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return found;
}

function allLiveIds(model: RenderModelDto): Set<string> {
  const ids = new Set<string>();
  for (const entry of model.base) ids.add(entry.id);
  for (const pass of model.frames) {
    ids.add(pass.frame.id);
    for (const child of pass.children) ids.add(child.id);
  }
  return ids;
}

function totalEntries(model: RenderModelDto): number {
  let count = model.base.length;
  for (const pass of model.frames) {
    count += 1 + pass.children.length;
  }
  return count;
}

/**
 * Descriptor-driven inspector: sections and fields come from
 * `inspector/descriptors.ts` and render through shared templates in
 * `inspector/fields.tsx`. Only engine-readable/writable properties are
 * editable; everything else is read-only or omitted (see engineGaps.ts).
 */
export function InspectorPanel({ frame, engine, sendBatch, commandContext }: InspectorPanelProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [fieldError, setFieldError] = useState<string | null>(null);

  if (!frame) {
    return <LoadingState label={t('editor.inspector.loading')} />;
  }

  const liveIds = allLiveIds(frame.model);
  // Central normalization: stale ids vanish here, not per panel.
  const selection = normalizeSelection(frame.session.selection, liveIds);
  const entries = findEntries(frame.model, selection);
  const kinds = new Set(entries.map((entry) => entry.kind));

  function handleFieldResult(_fieldId: string, ok: boolean, message: string | null) {
    if (!ok && message) {
      setFieldError(message);
      notify(message);
    } else {
      setFieldError(null);
    }
  }

  async function runAlign(mode: string) {
    const result = await executeCommand(modeToAlignId(mode), commandContext);
    if (result.status !== 'ok') {
      const message = t('editor.errors.commandFailed', { message: mode });
      setFieldError(message);
      notify(message);
    }
  }

  async function runDistribute(axis: string) {
    const id = axis === 'horizontal' ? 'distributeHorizontal' : 'distributeVertical';
    const result = await executeCommand(id, commandContext);
    if (result.status !== 'ok') {
      const message = t('editor.errors.commandFailed', { message: axis });
      setFieldError(message);
      notify(message);
    }
  }

  if (selection.length === 0) {
    const toolKey = `editor.tools.${frame.session.tool}`;
    const toolName = t(toolKey) === toolKey ? frame.session.tool : t(toolKey);
    return (
      <div className="editor-inspector">
        <div className="editor-inspector__empty-title">{t('editor.inspector.emptyTitle')}</div>
        <div className="editor-inspector__empty-hint">{t('editor.inspector.emptyHint')}</div>
        <h3 className="editor-inspector__section">{t('editor.inspector.documentTitle')}</h3>
        <div className="editor-inspector__facts">
          <div>{t('editor.status.elements', { count: totalEntries(frame.model) })}</div>
          <div>{t('editor.status.tool', { tool: toolName })}</div>
          <div>{t('editor.status.zoom', { zoom: frame.session.viewport.zoom.toFixed(2) })}</div>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="editor-inspector">
        <div className="editor-inspector__empty-title">{t('editor.inspector.stale')}</div>
        <div className="editor-inspector__empty-hint">{t('editor.inspector.staleHint')}</div>
      </div>
    );
  }

  const sections = inspectorSectionsFor(selection.length, kinds);
  const fieldCtx = { entries, selection, sendBatch, engine };
  const alignVerdict = canExecuteCommand('alignLeft', commandContext);
  const distributeVerdict = canExecuteCommand('distributeHorizontal', commandContext);

  return (
    <div className="editor-inspector">
      <h3 className="editor-inspector__section">
        {selection.length > 1
          ? t('editor.inspector.selectedCount', { count: selection.length })
          : kindLabel(entries[0].kind, t)}
      </h3>
      {fieldError ? (
        <div className="editor-inspector__error" role="alert">
          {fieldError}
        </div>
      ) : null}
      {sections.map((section) => (
        <section key={section.id} aria-label={t(section.titleKey)}>
          <h4 className="editor-inspector__section">{t(section.titleKey)}</h4>
          <div className="editor-inspector__fields">
            {section.fields
              .filter((field) => field.visible?.(fieldCtx) ?? true)
              .map((field) =>
                field.control === 'alignment' ? (
                  <InspectorField
                    key={field.id}
                    field={field}
                    ctx={fieldCtx}
                    onResult={handleFieldResult}
                    alignment={{
                      onAlign: (mode) => void runAlign(mode),
                      canAlign: alignVerdict.executable,
                      onDistribute: (axis) => void runDistribute(axis),
                      canDistribute: distributeVerdict.executable,
                    }}
                  />
                ) : (
                  <InspectorField key={field.id} field={field} ctx={fieldCtx} onResult={handleFieldResult} />
                ),
              )}
          </div>
        </section>
      ))}
      {selection.length > 1 ? (
        <div className="editor-inspector__empty-hint">{t('editor.inspector.multiNote')}</div>
      ) : null}
    </div>
  );
}

function modeToAlignId(mode: string): string {
  switch (mode) {
    case 'left':
      return 'alignLeft';
    case 'centerH':
      return 'alignCenterH';
    case 'right':
      return 'alignRight';
    case 'top':
      return 'alignTop';
    case 'centerV':
      return 'alignCenterV';
    case 'bottom':
      return 'alignBottom';
    default:
      return 'alignLeft';
  }
}
