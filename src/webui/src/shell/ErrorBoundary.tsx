import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render failures so one broken screen does not blank the whole application mid-demo.
 *
 * The error is shown rather than swallowed. A white screen invites the audience to conclude the
 * whole thing is fragile; a named error on one panel, with the rest of the shell intact, reads as
 * a bug in one place.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="state state--error" role="alert">
          <span className="state__title">This screen failed to render</span>
          <p className="state__detail">{this.state.error.message}</p>
          <button type="button" className="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
