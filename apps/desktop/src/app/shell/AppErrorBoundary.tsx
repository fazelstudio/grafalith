import { Component } from 'react';
import { Button } from '../../ui/primitives/controls';

interface Props {
  title: string;
  description: string;
  retryLabel: string;
  homeLabel: string;
  onHome: () => void;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

/** Recoverable failure boundary around each routed screen. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.children !== this.props.children && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-sm)',
          padding: 'var(--space-xxl)',
          textAlign: 'center',
        }}
      >
        <div style={{ font: 'var(--font-section)' }}>{this.props.title}</div>
        <div style={{ font: 'var(--font-body-small)', color: 'var(--fg-secondary)', maxWidth: 360 }}>
          {this.props.description}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <Button variant="secondary" onClick={() => this.setState({ failed: false })}>
            {this.props.retryLabel}
          </Button>
          <Button variant="primary" onClick={this.props.onHome}>
            {this.props.homeLabel}
          </Button>
        </div>
      </div>
    );
  }
}
