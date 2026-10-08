import { EditorShell, type KindEditorProps } from '../shell/EditorShell';

/**
 * Design editor: the full canvas workspace. Extending this family means
 * changing its slots here; the six-region layout stays in `EditorShell`.
 */
export function DesignEditor(props: KindEditorProps) {
  return <EditorShell editorKind="design" {...props} />;
}
