import { EditorShell, type KindEditorProps } from '../shell/EditorShell';

/**
 * Whiteboard editor: same six-region shell as design, basic behavior only.
 * Future whiteboard needs (infinite-canvas defaults, pens) slot in here
 * without touching the shared layout.
 */
export function WhiteboardEditor(props: KindEditorProps) {
  return <EditorShell editorKind="whiteboard" {...props} />;
}
