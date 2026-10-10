import common from './common';
import navigation from './navigation';
import home from './home';
import projects from './projects';
import editor from './editor';
import settings from './settings';
import dialogs from './dialogs';
import notifications from './notifications';
import errors from './errors';
import extensions from './extensions';

/** Canonical English resources composed from per-category files. */
const en = {
  common,
  navigation,
  home,
  projects,
  editor,
  settings,
  dialogs,
  notifications,
  errors,
  extensions,
} as const;

export default en;
export type EnDict = typeof en;
