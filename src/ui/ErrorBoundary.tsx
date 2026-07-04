import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      const { error, errorInfo } = this.state;
      const stackInfo = errorInfo ? errorInfo.componentStack : '';
      const fullError = `${error.message}\n${stackInfo}`;

      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: 'var(--canvas)',
          color: 'var(--text-primary)',
          padding: '24px'
        }}>
          <div style={{
            background: 'var(--surface)',
            padding: '24px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            maxWidth: '600px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Something broke — your design is safe.</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              PatchLab autosaves continuously; reloading will restore your last state.
            </p>
            <div style={{
              background: 'var(--canvas)',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              color: 'var(--text-disabled)',
              fontFamily: 'var(--font-data)',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              overflowY: 'auto',
              maxHeight: '200px'
            }}>
              {fullError}
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button 
                className="pl-btn"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <button 
                className="pl-btn"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => navigator.clipboard.writeText(fullError).catch(() => {})}
              >
                Copy error
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
