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
      <div role="alert" className="ui-error-state">
        <div className="ui-error-state__title">{this.props.title}</div>
        <div className="ui-error-state__description">
          {this.props.description}
        </div>
        <div className="ui-error-state__actions">
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
