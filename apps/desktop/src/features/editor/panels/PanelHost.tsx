import { useMemo, useState, type ComponentType } from 'react';
import type { Engine, FrameSnapshot } from '../../../hooks/useEngine';
import type { FillPreview } from '../../../render/drawModel';
import { panelsFor, type CommandContext, type PanelLocation } from '../../../registries';
import { useI18n } from '../../../app/i18n/resources';
import { EmptyState } from '../../../ui/primitives/controls';
import { LayersPanel } from './LayersPanel';
import { InspectorPanel } from './InspectorPanel';
import { DockTabs, INTERACTION_TAB_ID, resolveDockTab, type DockTab } from './DockTabs';

interface PanelBodyProps {
  frame: FrameSnapshot | null;
  onSelect: (ids: string[], additive: boolean) => void;
  engine: Engine;
  sendBatch: (ops: unknown[]) => Promise<string>;
  commandContext: CommandContext;
  projectId: string;
  /** Uncommitted fill preview shared with the canvas loop (writer-owned). */
  fillPreviewRef: { current: FillPreview | null };
}

/**
 * Single mapping from panel id to body. Adding a panel means adding its
 * descriptor to the panel registry and one entry here; dock layout,
 * ordering, and toggles stay generic.
 */
const PANEL_BODIES: Record<string, ComponentType<PanelBodyProps>> = {
  layers: LayersPanel,
  inspector: InspectorPanel,
};

interface PanelHostProps extends PanelBodyProps {
  location: PanelLocation;
  /** Adds the future interaction surface as a tab (Design Infinite only). */
  showInteractionTab?: boolean;
}

/** Renders one dock: a shared tab header plus the active panel body. */
export function PanelHost({
  location,
  frame,
  onSelect,
  engine,
  sendBatch,
  commandContext,
  projectId,
  fillPreviewRef,
  showInteractionTab = false,
}: PanelHostProps) {
  const { t } = useI18n();
  const tabs = useMemo<DockTab[]>(() => {
    const base: DockTab[] = panelsFor(location).map((panel) => ({
      id: panel.id,
      label: t(panel.labelKey),
      ...(panel.id === 'layers' ? { bare: true as const } : {}),
    }));
    if (location === 'right' && showInteractionTab) {
      base.push({ id: INTERACTION_TAB_ID, label: t('editor.panels.interaction') });
    }
    return base;
  }, [location, showInteractionTab, t]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const resolved = resolveDockTab(tabs, activeTab);

  return (
    <>
      <DockTabs tabs={tabs} activeId={resolved} onChange={setActiveTab} ariaLabel={tabs[0]?.label ?? ''} />
      {resolved === INTERACTION_TAB_ID ? (
        <section className="editor-panel" aria-label={t('editor.panels.interaction')}>
          <div className="editor-panel__body">
            <EmptyState title={t('editor.panels.interaction')} description={t('editor.panels.comingSoon')} />
          </div>
        </section>
      ) : (
        panelsFor(location).map((panel) => {
          if (panel.id !== resolved) return null;
          const Body = PANEL_BODIES[panel.id];
          if (!Body) {
            if (import.meta.env.DEV) {
              console.warn(`[panels] no body registered for panel "${panel.id}"`);
            }
            return null;
          }
          return (
            <section key={panel.id} className="editor-panel" aria-label={t(panel.labelKey)}>
              <div className="editor-panel__body">
                <Body
                  frame={frame}
                  onSelect={onSelect}
                  engine={engine}
                  sendBatch={sendBatch}
                  commandContext={commandContext}
                  projectId={projectId}
                  fillPreviewRef={fillPreviewRef}
                />
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
