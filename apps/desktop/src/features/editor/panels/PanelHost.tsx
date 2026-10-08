import type { ComponentType } from 'react';
import type { Engine, FrameSnapshot } from '../../../hooks/useEngine';
import { panelsFor, type CommandContext, type PanelLocation } from '../../../registries';
import { useI18n } from '../../../app/i18n/resources';
import { LayersPanel } from './LayersPanel';
import { InspectorPanel } from './InspectorPanel';
import { EditorIcon } from '../../../ui/icons';

interface PanelBodyProps {
  frame: FrameSnapshot | null;
  onSelect: (ids: string[], additive: boolean) => void;
  engine: Engine;
  sendBatch: (ops: unknown[]) => Promise<string>;
  commandContext: CommandContext;
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
}

/** Renders every registered panel for one dock in registry order. */
export function PanelHost({ location, frame, onSelect, engine, sendBatch, commandContext }: PanelHostProps) {
  const { t } = useI18n();
  return (
    <>
      {panelsFor(location).map((panel) => {
        const Body = PANEL_BODIES[panel.id];
        if (!Body) {
          if (import.meta.env.DEV) {
            console.warn(`[panels] no body registered for panel "${panel.id}"`);
          }
          return null;
        }
        return (
          <section key={panel.id} className="editor-panel" aria-label={t(panel.labelKey)}>
            <h2 className="editor-panel__title">
              {panel.id === 'layers' ? <EditorIcon size={14} /> : null}
              <span>{t(panel.labelKey)}</span>
            </h2>
            <div className="editor-panel__body">
              <Body
                frame={frame}
                onSelect={onSelect}
                engine={engine}
                sendBatch={sendBatch}
                commandContext={commandContext}
              />
            </div>
          </section>
        );
      })}
    </>
  );
}
