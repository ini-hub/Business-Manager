import React, { Component, ErrorInfo, ReactNode } from "react";
import ServerError from "./server-error";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isRecovering: boolean;
}

// A new deploy replaces /assets/*.js with fresh content hashes. A tab left
// open from before the deploy (or a lazy route the user hasn't visited yet)
// will try to fetch a chunk hash that no longer exists on the server. The
// fix isn't retrying the same import — it's fetching the new index.html.
const CHUNK_LOAD_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Loading chunk .* failed|ChunkLoadError|error loading dynamically imported module/i;

const RELOAD_FLAG_KEY = "bm-chunk-reload-attempted";

function isChunkLoadError(error: Error | null): boolean {
  return !!error && CHUNK_LOAD_ERROR_PATTERN.test(error.message);
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    isRecovering: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidMount() {
    // A clean mount (no error) means we're on a good build — clear the
    // guard so a future deploy can trigger another auto-reload.
    if (!this.state.hasError) {
      try {
        sessionStorage.removeItem(RELOAD_FLAG_KEY);
      } catch {
        // sessionStorage unavailable (e.g. private browsing) — ignore
      }
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);

    if (isChunkLoadError(error)) {
      let alreadyAttempted = false;
      try {
        alreadyAttempted = sessionStorage.getItem(RELOAD_FLAG_KEY) === "1";
        if (!alreadyAttempted) {
          sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
        }
      } catch {
        // sessionStorage unavailable — fall through and show the error UI
        // rather than risk an unguarded reload loop.
        alreadyAttempted = true;
      }

      if (!alreadyAttempted) {
        this.setState({ isRecovering: true });
        window.location.reload();
      }
    }
  }

  public render() {
    if (this.state.isRecovering) {
      return (
        <div className="flex min-h-[85vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          <p>Updating to the latest version…</p>
        </div>
      );
    }

    if (this.state.hasError) {
      return (
        <ServerError
          error={this.state.error || "An unexpected application error occurred."}
          reset={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}
