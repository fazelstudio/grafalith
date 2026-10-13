// Home-screen contributions: widgets, templates, interceptors.
import { afterEach, describe, expect, test } from 'bun:test';
import {
  homeWidgets,
  interceptProjectCreate,
  projectTemplates,
  registerHomeWidgets,
  registerProjectCreateInterceptor,
  registerProjectTemplates,
  removeHomeContributions,
  resetHomeContributions,
} from './homeContributions';

afterEach(() => {
  resetHomeContributions();
});

describe('home contributions', () => {
  test('widgets and templates register per extension', () => {
    registerHomeWidgets([{ id: 'acme.recent', title: 'Recent', extensionId: 'acme.pack' }]);
    registerProjectTemplates([{ id: 'acme.poster', title: 'Poster', kind: 'design', extensionId: 'acme.pack' }]);
    expect(homeWidgets().map((widget) => widget.id)).toEqual(['acme.recent']);
    expect(projectTemplates('design').map((template) => template.id)).toEqual(['acme.poster']);
    expect(projectTemplates('whiteboard')).toEqual([]);
    expect(() => registerHomeWidgets([{ id: 'acme.recent', title: 'Dup', extensionId: 'acme.pack' }])).toThrow(
      /duplicate home widget/,
    );
  });

  test('interceptors redirect creation and unload clears state', () => {
    registerProjectCreateInterceptor((kind) => (kind === 'whiteboard' ? 'acme.board-template' : undefined));
    expect(interceptProjectCreate('whiteboard')).toBe('acme.board-template');
    expect(interceptProjectCreate('design')).toBeUndefined();
    registerHomeWidgets([{ id: 'acme.recent', title: 'Recent', extensionId: 'acme.pack' }]);
    removeHomeContributions('acme.pack');
    expect(homeWidgets()).toEqual([]);
  });
});
