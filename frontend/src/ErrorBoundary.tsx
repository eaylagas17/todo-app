import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

// Error boundaries must be class components: React has no hook for catching render errors.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <h1>Something went wrong</h1>
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
