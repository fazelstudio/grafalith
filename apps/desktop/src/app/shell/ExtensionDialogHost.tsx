import { useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../app/i18n/resources';
import { SearchInput, TextInput, Button } from '../../ui/primitives/controls';
import { Dialog } from '../../ui/primitives/overlays';
import { extensionDialogQueue } from '../../platform/extensions/extensionDialogs';

/**
 * Host renderer for extension modal requests (quick pick, input, confirm).
 * One request is visible at a time; resolving closes it. Mounted once in
 * the application shell so every extension shares one modal surface.
 */
export function ExtensionDialogHost() {
  const request = useSyncExternalStore(
    (notify) => extensionDialogQueue.subscribe(notify),
    () => extensionDialogQueue.peek(),
  );
  const [query, setQuery] = useState('');
  const [value, setValue] = useState('');
  const { t } = useI18n();

  if (!request) return null;
  const close = () => extensionDialogQueue.cancel();

  if (request.kind === 'quickPick') {
    const needle = query.trim().toLowerCase();
    const items = request.items.filter(
      (item) =>
        needle === '' ||
        item.label.toLowerCase().includes(needle) ||
        item.description?.toLowerCase().includes(needle),
    );
    return (
      <Dialog title={request.placeholder ?? t('editor.palette.title')} onClose={close}>
        <SearchInput label={request.placeholder ?? ''} placeholder={request.placeholder} value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="palette__list" role="listbox">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={false}
              className="palette__item"
              onClick={() => extensionDialogQueue.answer(item)}
            >
              <span className="palette__label">{item.label}</span>
              {item.description ? <span className="ui-shortcut">{item.description}</span> : null}
            </button>
          ))}
        </div>
      </Dialog>
    );
  }

  if (request.kind === 'input') {
    return (
      <Dialog title={request.prompt} onClose={close}>
        <TextInput
          aria-label={request.prompt}
          defaultValue={value === '' ? request.initialValue : value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="ui-dialog__actions">
          <Button variant="ghost" size="sm" onClick={close}>
            {t('common.actions.cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => extensionDialogQueue.answer(value === '' ? (request.initialValue ?? '') : value)}>
            {t('common.actions.confirm')}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={request.title} description={request.body} onClose={close}>
      <div className="ui-dialog__actions">
        <Button variant="ghost" size="sm" onClick={close}>
          {t('common.actions.cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => extensionDialogQueue.answer({ confirmed: true })}>
          {t('common.actions.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
