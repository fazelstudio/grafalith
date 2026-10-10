// Fatal boot dialog: Phase 1 core service failure surface.
import { createRoot } from 'react-dom/client';
import type { CoreServiceCheck } from '../../platform/boot/coreBootstrap';
import { formatExtensionMessage } from '../../platform/extensions/extensionMessages';

/**
 * Render the fatal-error screen over an empty body and stop.
 * Logs every failure to the console first. Strings resolve through the
 * locale dictionaries directly (no provider exists yet on this path).
 */
export function renderFatalBoot(failures: readonly CoreServiceCheck[]): void {
  for (const failure of failures) {
    console.error(`[core-bootstrap] ${failure.name} failed to initialize: ${failure.error ?? 'unknown error'}`);
  }
  const root = document.getElementById('root');
  if (!root) return;
  createRoot(root).render(<FatalBootDialog failures={failures} />);
}

function FatalBootDialog({ failures }: { failures: readonly CoreServiceCheck[] }): React.JSX.Element {
  const retry = (): void => window.location.reload();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fatal-boot-title"
      aria-describedby="fatal-boot-description"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff',
        color: '#1c1c1a',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <h1 id="fatal-boot-title" style={{ fontSize: 22, margin: '0 0 8px' }}>
          {formatExtensionMessage('errors.boot.title')}
        </h1>
        <p id="fatal-boot-description" style={{ margin: '0 0 16px', opacity: 0.8 }}>
          {formatExtensionMessage('errors.boot.description')}
        </p>
        <ul style={{ margin: '0 0 16px', paddingLeft: 20 }}>
          {failures.map((failure) => (
            <li key={failure.name}>
              <strong>{failure.name}</strong>
              {failure.error ? `: ${failure.error}` : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={retry}
          style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
        >
          {formatExtensionMessage('errors.boot.retry')}
        </button>
      </div>
    </div>
  );
}
