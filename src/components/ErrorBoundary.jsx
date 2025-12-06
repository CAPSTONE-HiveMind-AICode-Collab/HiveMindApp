"use client";

import { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo,
    });

    // Future: Send error to monitoring service (e.g., Sentry)
    // logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full border-2 border-red-200">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  🐝 Oops! Something went wrong
                </h1>
                <p className="text-gray-600 mt-1">
                  The hive encountered an unexpected error
                </p>
              </div>
            </div>

            {process.env.NODE_ENV === "development" && this.state.error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded">
                <p className="font-mono text-sm text-red-900 mb-2">
                  <strong>Error:</strong> {this.state.error.toString()}
                </p>
                {this.state.errorInfo && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-red-700 font-semibold text-sm">
                      Stack Trace (Developer Mode)
                    </summary>
                    <pre className="mt-2 text-xs text-red-800 overflow-x-auto bg-red-100 p-2 rounded">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="space-y-3">
              <p className="text-gray-700">
                Don't worry! Here's what you can do:
              </p>
              <ul className="list-disc list-inside space-y-2 text-gray-600 ml-4">
                <li>Try refreshing the page</li>
                <li>Go back to the dashboard and try again</li>
                <li>Check your internet connection</li>
                <li>Clear your browser cache</li>
              </ul>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={this.handleReset}
                className="flex-1 bg-gradient-to-r from-yellow-400 to-yellow-500 text-gray-900 px-6 py-3 rounded-lg font-semibold hover:from-yellow-500 hover:to-yellow-600 transition-all duration-200 shadow-md"
              >
                Try Again
              </button>
              <button
                onClick={() => (window.location.href = "/dashboard")}
                className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-all duration-200"
              >
                Back to Dashboard
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-6 text-center">
              If this problem persists, please contact support with the error details above.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
