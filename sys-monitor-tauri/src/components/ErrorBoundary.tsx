import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  /** Wall-clock ms of the last caught render error (0 = none yet). */
  lastErrorAt: number;
}

/**
 * Minimum gap between auto-retry attempts after an error. Children change on
 * every metrics tick (~250ms), so without this guard a persistently-failing
 * card would enter a tight throw→reset→throw loop; with it, the boundary
 * retries at most once per second and shows the fallback in between.
 */
const RETRY_COOLDOWN_MS = 1000;

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, lastErrorAt: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, lastErrorAt: Date.now() };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  /**
   * Auto-recovery: when the boundary receives new children (e.g. a fresh
   * metrics snapshot), clear hasError so the card can render again — a
   * transient bad data point must not permanently disable the card. Gated by
   * RETRY_COOLDOWN_MS so a persistent error can't hammer the render loop.
   */
  componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError) return;
    if (prevProps.children === this.props.children) return;
    if (Date.now() - this.state.lastErrorAt < RETRY_COOLDOWN_MS) return;
    this.setState({ hasError: false, error: undefined, lastErrorAt: 0 });
  }

  /** Manual recovery affordance — retries rendering the card immediately. */
  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined, lastErrorAt: 0 });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: '12px 16px',
          background: '#1e1e1e',
          border: '1px solid #444',
          borderRadius: 6,
          color: '#888',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          <span>Chart error — bad data point</span>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid #444',
              background: 'transparent',
              color: '#4699e8',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
