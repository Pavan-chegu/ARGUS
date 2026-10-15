import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React Error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100vh',
            width: '100vw',
            background: '#040711',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          }}
        >
          <div
            style={{
              maxWidth: 580,
              width: '100%',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 16,
              padding: 28,
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🛡️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px 0', color: '#f87171' }}>
              Interface Exception Caught
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Argus CloudMesh prevented an unhandled UI crash.
            </p>
            <pre
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                padding: 12,
                borderRadius: 8,
                fontSize: 11,
                fontFamily: 'monospace',
                color: '#fca5a5',
                overflowX: 'auto',
                textAlign: 'left',
                marginBottom: 20,
              }}
            >
              {this.state.error?.message || 'Unknown runtime error'}
            </pre>
            <button
              onClick={this.handleReset}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                background: '#38bdf8',
                color: '#040711',
                border: 'none',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Reload & Recover Session
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
