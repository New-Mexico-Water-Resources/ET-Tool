import { Button, Typography } from "@mui/material";
import { Component, type CSSProperties, type ErrorInfo, type ReactNode, useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import useStore from "../utils/store";
import "../scss/CurrentJobChip.scss";

type FullPageErrorProps = {
  onRetry?: () => void;
  detail?: string;
};

const pageButtonStyle: CSSProperties = {
  background: "#2563EB",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  font: "inherit",
  cursor: "pointer",
};

const pageSecondaryButtonStyle: CSSProperties = {
  ...pageButtonStyle,
  background: "#334155",
};

function errorDetail(error: unknown): string | undefined {
  if (!import.meta.env.DEV) {
    return undefined;
  }

  if (isRouteErrorResponse(error)) {
    const data = typeof error.data === "string" ? error.data : "";
    return [`${error.status} ${error.statusText}`, data].filter(Boolean).join("\n");
  }

  if (error instanceof Error) {
    return error.stack || error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function FullPageError({ onRetry, detail }: FullPageErrorProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1b1d1e",
        color: "#ebecec",
        fontFamily: "Inter, sans-serif",
        padding: 24,
        boxSizing: "border-box",
        overflow: "auto",
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          background: "#1f2223",
          borderRadius: 16,
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 24, lineHeight: 1.3, margin: "0 0 8px" }}>Something went wrong</h1>
        <p style={{ color: "#bcbcbc", margin: "0 0 16px" }}>
          This page hit an error and stopped rendering. Reload to continue.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {onRetry && (
            <button type="button" style={pageButtonStyle} onClick={onRetry}>
              Try again
            </button>
          )}
          <button type="button" style={onRetry ? pageSecondaryButtonStyle : pageButtonStyle} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
        {detail && (
          <details style={{ marginTop: 16, textAlign: "left" }}>
            <summary style={{ cursor: "pointer", color: "#bcbcbc" }}>Error details</summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflow: "auto",
                maxHeight: 240,
                color: "#bec0c2",
                fontSize: 12,
              }}
            >
              {detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();

  useEffect(() => {
    console.error("Application render error", error);
  }, [error]);

  return <FullPageError detail={errorDetail(error)} />;
}

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  error: Error | null;
};

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <FullPageError
        onRetry={() => this.setState({ error: null })}
        detail={errorDetail(this.state.error)}
      />
    );
  }
}

type PanelFallbackProps = {
  error: Error;
  reset: () => void;
};

type PanelErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string | number | null;
  fallback: (props: PanelFallbackProps) => ReactNode;
};

type PanelErrorBoundaryState = {
  error: Error | null;
  resetKey?: string | number | null;
};

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<PanelErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: PanelErrorBoundaryProps,
    state: PanelErrorBoundaryState
  ): Partial<PanelErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Job summary render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return this.props.fallback({
      error: this.state.error,
      reset: () => this.setState({ error: null }),
    });
  }
}

export function JobSummaryError({ onRetry }: { onRetry: () => void }) {
  const activeJobGroup = useStore((state) => state.activeJobGroup);
  const setActiveJob = useStore((state) => state.setActiveJob);
  const clearJobGroup = useStore((state) => state.clearJobGroup);
  const closeNewJob = useStore((state) => state.closeNewJob);

  return (
    <div className="current-job" style={{ maxWidth: 280 }}>
      <Typography variant="body2" sx={{ color: "var(--st-gray-20)", fontWeight: 700 }}>
        Job summary unavailable
      </Typography>
      <Typography variant="caption" sx={{ color: "var(--st-gray-40)", display: "block", marginTop: "4px" }}>
        The map is still available.
      </Typography>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button size="small" variant="contained" onClick={onRetry}>
          Try again
        </Button>
        <Button
          size="small"
          variant="contained"
          color="secondary"
          onClick={() => {
            if (activeJobGroup) {
              clearJobGroup();
            } else {
              setActiveJob(null);
            }
            closeNewJob();
          }}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
