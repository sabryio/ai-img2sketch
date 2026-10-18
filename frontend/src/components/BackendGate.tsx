import React, { useState } from "react";
import {
  AlertCircle,
  Box,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Server,
  Square,
  Terminal,
} from "lucide-react";
import { useHealth } from "../hooks";
import { toAppError } from "../lib/errors";
import { useBackendStore } from "../stores/backend";

export const BackendGate: React.FC = () => {
  const {
    apiOrigin,
    dockerRunning,
    dockerProbeDetails,
    isCheckingDocker,
    isStartingBackend,
    backendActionLog,
    mode,
    setMode,
    probeDocker,
    startDocker,
    stopDocker,
    startSidecar,
  } = useBackendStore();

  // Same query `App` polls: the gate and the header can never disagree.
  const health = useHealth();
  const lastHealthError = health.error
    ? toAppError(health.error, mode).message
    : null;

  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const checking = health.isPending || isStartingBackend;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <section className="region">
        <div className="p-5">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-room-text">
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 text-room-muted ${
                checking ? "animate-spin" : ""
              }`}
            />
            Connecting to Backend
          </h2>
          <p className="mt-1.5 text-micro text-room-muted">
            Targeting{" "}
            <span className="mono text-room-text">{apiOrigin}</span>
          </p>
        </div>

        <div className="hairline flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <span className="flex items-center gap-2 text-micro text-room-muted">
            <span
              aria-hidden="true"
              className="block h-1.5 w-1.5 rounded-full bg-held-soft"
            />
            Checking{" "}
            <span className="mono text-room-text">/api/v1/health</span>
          </span>
          <span className="mono text-micro text-room-faint">
            Attempt #{health.errorUpdateCount + 1}
          </span>
        </div>

        <div className="hairline p-5">
          <h3 className="flex items-center gap-2 text-value font-semibold text-room-text">
            <AlertCircle
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-alert-soft"
            />
            Backend isn't reachable
          </h3>
          <p className="mt-1.5 text-micro leading-relaxed text-room-muted">
            Start Docker Desktop, or run without Docker using the local native
            sidecar (
            <span className="mono text-room-text">img2sketch-api</span>).
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-room-line bg-room-sunken px-3 py-2 text-micro">
            <span className="flex items-center gap-1.5 text-room-muted">
              <Box aria-hidden="true" className="h-3.5 w-3.5 text-room-text" />
              Docker System Status:
            </span>
            <span className="flex items-center gap-2.5">
              <span
                className={`font-semibold ${
                  dockerRunning ? "text-committed-soft" : "text-room-muted"
                }`}
              >
                {isCheckingDocker
                  ? "Checking..."
                  : dockerRunning
                    ? "Daemon Ready"
                    : "Not Detected"}
              </span>
              <button
                type="button"
                onClick={() => probeDocker()}
                className="btn btn-quiet px-2 py-0.5 text-[11.5px]"
              >
                Re-probe
              </button>
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setMode("docker");
                startDocker();
              }}
              disabled={isStartingBackend}
              className="btn btn-primary"
            >
              <Box aria-hidden="true" className="h-3.5 w-3.5" />
              {isStartingBackend && mode === "docker"
                ? "Starting Docker..."
                : "Start Docker backend"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("sidecar");
                startSidecar();
              }}
              disabled={isStartingBackend}
              className="btn"
            >
              <Server aria-hidden="true" className="h-3.5 w-3.5" />
              {isStartingBackend && mode === "sidecar"
                ? "Spawning..."
                : "Run sidecar"}
            </button>
          </div>

          {dockerRunning && (
            <button
              type="button"
              onClick={() => stopDocker()}
              disabled={isStartingBackend}
              className="btn mt-2.5 w-full"
            >
              <Square aria-hidden="true" className="h-3 w-3" />
              Stop Docker backend
            </button>
          )}

          <div className="hairline mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 text-micro">
            <button
              type="button"
              onClick={() => health.refetch()}
              disabled={isStartingBackend}
              className="btn btn-quiet px-2 py-1"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Retry now
            </button>
            <span className="mono text-[11px] text-room-faint">
              polling every 2s while down
            </span>
          </div>
        </div>

        {backendActionLog && (
          <div className="hairline p-4">
            <div className="max-h-32 overflow-y-auto rounded-control border border-room-line bg-room-sunken p-3 font-mono text-[11px] text-room-muted">
              <span className="mb-1 block font-semibold text-room-faint">
                $ Lifecycle output:
              </span>
              {backendActionLog}
            </div>
          </div>
        )}

        <div className="hairline">
          <button
            type="button"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            aria-expanded={showDiagnostics}
            className="flex w-full items-center justify-between px-5 py-3.5 text-micro text-room-muted transition-colors hover:text-room-text"
          >
            <span className="flex items-center gap-1.5">
              <Terminal aria-hidden="true" className="h-3.5 w-3.5" />
              Troubleshooting & Diagnostics
            </span>
            {showDiagnostics ? (
              <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>

          {showDiagnostics && (
            <div className="space-y-3 px-5 pb-5 text-micro">
              {lastHealthError && (
                <div className="rounded-control border border-room-line bg-room-sunken p-3 font-mono text-[11px] text-alert-soft">
                  <strong className="mb-1 block">Last Error:</strong>
                  {lastHealthError}
                </div>
              )}

              {dockerProbeDetails && (
                <div className="rounded-control border border-room-line bg-room-sunken p-3 font-mono text-[11px] text-room-muted">
                  <strong className="mb-1 block text-room-text">
                    Docker Probe Details:
                  </strong>
                  {dockerProbeDetails}
                </div>
              )}

              <div className="space-y-1 text-[11px] text-room-muted">
                <p>To start manually from terminal:</p>
                <div className="select-all rounded-control border border-room-line bg-room-sunken p-2 font-mono text-room-text">
                  docker compose up -d
                </div>
                <p className="pt-1">Or verify endpoint with curl:</p>
                <div className="select-all rounded-control border border-room-line bg-room-sunken p-2 font-mono text-room-text">
                  curl {apiOrigin}/api/v1/health
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
