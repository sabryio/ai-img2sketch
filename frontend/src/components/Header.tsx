import React from "react";
import { Box, Layers, PenLine, Radio, RefreshCw, Server, Settings } from "lucide-react";
import { useHealth } from "../hooks";
import type { SseState } from "../hooks";
import { useBackendStore } from "../stores/backend";

interface HeaderProps {
  activeTab: "single" | "batch";
  onTabChange: (tab: "single" | "batch") => void;
  onOpenSettings: () => void;
  /** Stream state owned by `App` (it holds the stream subscriptions). */
  sseState: SseState;
  /** Reconnect the live event stream (clicking the SSE badge). */
  onRestartStream: () => void;
}

/** The registration bar, reduced to a mark: a sheet with three pegs. */
const SheetMark: React.FC = () => (
  <span
    aria-hidden="true"
    className="flex h-5.5 w-5.5 items-center justify-center gap-0.5 rounded-sheet bg-sheet"
  >
    <i className="block h-1.75 w-0.75 rounded-xs bg-graphite" />
    <i className="block h-1.75 w-0.75 rounded-xs bg-graphite" />
    <i className="block h-1.75 w-0.75 rounded-xs bg-graphite" />
  </span>
);

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenSettings,
  sseState,
  onRestartStream,
}) => {
  const { mode, setMode } = useBackendStore();

  // Shares the query `App` already runs: same cache entry, same polling.
  const health = useHealth();
  const ready = health.data?.status === "ok";
  const healthLabel = ready
    ? "ok"
    : health.status === "pending"
      ? "starting"
      : "down";

  const healthTone = ready
    ? "var(--color-committed-soft)"
    : health.status === "pending"
      ? "var(--color-held-soft)"
      : "var(--color-alert-soft)";

  const sseTone =
    sseState === "online"
      ? "var(--color-committed-soft)"
      : sseState === "reconnecting"
        ? "var(--color-held-soft)"
        : sseState === "connecting"
          ? "var(--color-onion)"
          : "var(--color-room-faint)";

  const sseTitle =
    sseState === "online"
      ? "SSE stream connected: listening for lifecycle events"
      : sseState === "reconnecting"
        ? "SSE stream reconnecting..."
        : sseState === "connecting"
          ? "SSE stream connecting..."
          : "SSE stream idle or closed";

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-6 border-b border-room-line bg-room px-4 sm:px-6">
      <div className="flex items-center gap-2.5">
        <SheetMark />
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-room-text">
          AI-Img2Sketch
        </span>
      </div>

      {/* Navigation reads as navigation: one segmented control, the platform's control. */}
      <nav aria-label="Job" className="seg">
        <button
          type="button"
          onClick={() => onTabChange("single")}
          aria-current={activeTab === "single" ? "page" : undefined}
        >
          <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
          Single Image
        </button>
        <button
          type="button"
          onClick={() => onTabChange("batch")}
          aria-current={activeTab === "batch" ? "page" : undefined}
        >
          <Layers aria-hidden="true" className="h-3.5 w-3.5" />
          Batch Processing
        </button>
      </nav>

      <div className="ml-auto flex items-center gap-2.5">
        {/* Backend health: a status reading, not a decoration — click re-checks it. */}
        <button
          type="button"
          data-testid="health-badge"
          onClick={() => health.refetch()}
          title="Click to re-check backend health"
          className="inline-flex items-center gap-1.5 rounded-sheet px-2 py-1 text-micro text-room-muted transition-colors hover:bg-room-raised hover:text-room-text"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: healthTone }}
          />
          <span className="hidden sm:inline">Backend:</span>
          <span className="tnum">{healthLabel}</span>
        </button>

        {/* SSE: click to reconnect the live event stream. */}
        <button
          type="button"
          data-testid="sse-badge"
          onClick={onRestartStream}
          title={sseTitle}
          className="inline-flex items-center gap-1.5 rounded-sheet px-2 py-1 text-micro text-room-muted transition-colors hover:bg-room-raised hover:text-room-text"
        >
          {sseState === "reconnecting" ? (
            <RefreshCw aria-hidden="true" className="h-3 w-3 animate-spin" />
          ) : sseState === "connecting" ? (
            <Radio aria-hidden="true" className="h-3 w-3" />
          ) : (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: sseTone }}
            />
          )}
          {sseState === "online"
            ? "SSE Live"
            : sseState === "reconnecting"
              ? "Reconnecting"
              : sseState === "connecting"
                ? "Connecting"
                : "SSE Idle"}
        </button>

        <div className="seg" role="group" aria-label="Execution mode">
          <button
            type="button"
            aria-pressed={mode === "docker"}
            onClick={() => setMode("docker")}
            title="Docker container execution (port 8000)"
          >
            <Box aria-hidden="true" className="h-3.5 w-3.5" />
            Docker
          </button>
          <button
            type="button"
            aria-pressed={mode === "sidecar"}
            onClick={() => setMode("sidecar")}
            title="Direct native host sidecar execution (img2sketch-api binary)"
          >
            <Server aria-hidden="true" className="h-3.5 w-3.5" />
            Sidecar
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="btn btn-quiet px-2"
          title="Configure API base URL, execution mode, and the event log"
          aria-label="Settings"
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
