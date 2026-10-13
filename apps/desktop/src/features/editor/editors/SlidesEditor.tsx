import { EditorShell, type KindEditorProps } from '../shell/EditorShell';

/**
 * Slides editor: the full canvas workspace on a fixed 16:9 page.
 * Multi-page decks and present mode slot in here without touching the
 * shared layout.
 */
export function SlidesEditor(props: KindEditorProps) {
  return <EditorShell editorKind="slides" {...props} />;
}
