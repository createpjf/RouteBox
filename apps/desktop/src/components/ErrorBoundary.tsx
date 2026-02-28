import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-accent-red/10">
            <AlertTriangle size={20} strokeWidth={1.75} className="text-accent-red" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-text-primary">Something went wrong</p>
            <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed max-w-[240px]">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="btn-primary mt-1"
          >
            <RotateCcw size={14} strokeWidth={1.75} />
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
