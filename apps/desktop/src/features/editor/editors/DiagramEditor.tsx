import { EditorShell, type KindEditorProps } from '../shell/EditorShell';

/**
 * Diagram editor: same six-region shell as design, basic behavior only.
 * Future diagram needs (connectors, shape libraries) slot in here without
 * touching the shared layout.
 */
export function DiagramEditor(props: KindEditorProps) {
  return <EditorShell editorKind="diagram" {...props} />;
}
