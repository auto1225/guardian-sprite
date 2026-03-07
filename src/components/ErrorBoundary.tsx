import React from "react";
import i18n from "@/i18n";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary] Caught:", error.message);
    // "Should have a queue" 에러 시 자동 새로고침
    if (error.message?.includes("Should have a queue")) {
      console.warn("[ErrorBoundary] Queue error detected, reloading...");
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background text-foreground p-6">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-bold">{i18n.t("errorBoundary.title")}</h2>
            <p className="text-muted-foreground text-sm">{i18n.t("errorBoundary.description")}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
            >
              {i18n.t("errorBoundary.reload")}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;