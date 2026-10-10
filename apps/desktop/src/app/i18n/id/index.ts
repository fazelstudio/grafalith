import type { EnDict } from '../en';
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

/** Indonesian resources; the annotation keeps the shape tied to English. */
const id: EnDict = {
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
};

export default id;
