'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  pageName?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundaryWrapper extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
          <div className="max-w-lg w-full">
            <div className="bg-white border border-red-200 rounded-xl shadow-lg p-6">
              <div className="text-red-500 font-bold text-lg mb-2">
                Error{this.props.pageName ? ` loading ${this.props.pageName}` : ''}
              </div>
              <div className="text-sm text-red-600 font-mono mb-3">{this.state.error.message}</div>
              <pre className="text-xs text-red-400 bg-red-50 rounded p-3 max-h-[200px] overflow-auto whitespace-pre-wrap mb-4">
                {this.state.error.stack?.split('\n').slice(0, 8).join('\n')}
              </pre>
              <div className="flex gap-2">
                <button
                  onClick={() => this.setState({ error: null })}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Try Again
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
