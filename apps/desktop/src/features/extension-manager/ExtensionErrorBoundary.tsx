// Error boundary isolating extension-contributed UI from core surfaces.
import React from 'react';
import { useI18n } from '../../app/i18n/resources';

interface ExtensionErrorBoundaryProps {
  readonly title: string;
  readonly retryLabel: string;
  readonly children: React.ReactNode;
}

interface ExtensionErrorBoundaryState {
  error: Error | null;
}

/** Class boundary (React requires a class for error catching). */
class InnerExtensionErrorBoundary extends React.Component<
  ExtensionErrorBoundaryProps,
  ExtensionErrorBoundaryState
> {
  state: ExtensionErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ExtensionErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[extension-ui] contributed surface crashed', error);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, border: '1px solid var(--border, #e2e2e2)', borderRadius: 8 }}>
          <div style={{ fontWeight: 600 }}>{this.props.title}</div>
          <div style={{ opacity: 0.75, margin: '4px 0 8px' }}>{this.state.error.message}</div>
          <button type="button" onClick={this.retry}>
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Localized wrapper: resolves UI strings through the provider, then
 * delegates to the class boundary. A crashing widget unmounts to this
 * fallback instead of taking down Home or the editor.
 */
export function ExtensionErrorBoundary({
  surface,
  children,
}: {
  readonly surface: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <InnerExtensionErrorBoundary
      title={t('extensions.error.title', { surface })}
      retryLabel={t('extensions.error.retry')}
    >
      {children}
    </InnerExtensionErrorBoundary>
  );
}
