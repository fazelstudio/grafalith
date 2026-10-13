import type { CommandResult } from '../../registries';

/**
 * Engine gaps recorded instead of faked in React.
 *
 * A gap is a capability the desktop UI deliberately does NOT expose
 * because the engine protocol cannot read/write it safely yet. Each entry
 * names the missing op or field so the engine can close it without
 * changing desktop architecture.
 */
export interface EngineGap {
  /** Stable id for tests and palette search. */
  id: string;
  /** User-facing area (inspector, tools, style, …). */
  area: string;
  /** What the UI omits and why. */
  description: string;
  /** Engine work that would unblock it. */
  unblocks: string;
}

/** Capabilities omitted from the inspector, tools, and commands by design. */
export const ENGINE_GAPS: readonly EngineGap[] = [
  {
    id: 'font-editing',
    area: 'text',
    description: 'Font size/family/alignment have no direct write op; text edits go through the overlay session.',
    unblocks: 'setTextStyle op (fontSize, fontFamily, textAlign) as one history entry.',
  },
  {
    id: 'roundness-editing',
    area: 'style',
    description: 'Rectangle roundness is read-only in the inspector; no setRoundness op exists.',
    unblocks: 'setRoundness op or scalar style field.',
  },
  {
    id: 'image-tool',
    area: 'tools',
    description: 'No image creation tool: Draw(image) needs an asset-upload flow the desktop does not host yet.',
    unblocks: 'Asset upload + create-image op with assetId.',
  },
  {
    id: 'path-tool',
    area: 'tools',
    description: 'No pen/path creation tool: pen sessions need a multi-click host flow not yet built.',
    unblocks: 'Host pen-session UI driving penBegin/penClick/penCommit.',
  },
  {
    id: 'crop-flow',
    area: 'tools',
    description: 'No crop UI: crop sessions need handle-drag hosting.',
    unblocks: 'Host crop-session UI driving cropStart/cropDrag/cropCommit.',
  },
  {
    id: 'path-edit-flow',
    area: 'tools',
    description: 'No path-edit UI: pathEdit sessions need anchor/handle hosting.',
    unblocks: 'Host path-edit UI driving pathEditBegin/pathEditDrag/pathEditCommit.',
  },
  {
    id: 'space-pan',
    area: 'interaction',
    description: 'No space-held pan tool: middle-drag and wheel pan work, but no BatchOp exposes pan_by_screen for space-drag.',
    unblocks: 'Pan-viewport BatchOp or host setViewport-drag flow with pointer capture.',
  },
  {
    id: 'auto-layout-config',
    area: 'arrange',
    description: 'No auto-layout config editing: applyAutoLayout runs but has no config writers.',
    unblocks: 'Frame layout-config write ops.',
  },
];

/** Map a command result to a user-facing message (null = silent success/disabled). */
export function commandResultMessage(
  commandId: string,
  result: CommandResult,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  switch (result.status) {
    case 'ok':
      return null;
    case 'disabled':
      return null;
    case 'notApplicable':
      if (result.reason === 'empty-clipboard' && commandId === 'paste') {
        return t('editor.errors.emptyClipboard');
      }
      if (result.reason === 'not-grouped') {
        return t('editor.errors.notGrouped');
      }
      return null;
    case 'validationError':
      return result.message;
    case 'engineError':
      return t('editor.errors.commandFailed', { message: result.message });
  }
}
