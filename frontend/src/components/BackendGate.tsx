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

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-xl w-full bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8">
        {/* Animated Icon & Status Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex p-3 rounded-2xl bg-zinc-800/80 border border-zinc-700/60 shadow-inner">
            <RefreshCw
              className={`w-8 h-8 text-indigo-400 ${
                health.isPending || isStartingBackend ? "animate-spin" : ""
              }`}
            />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Connecting to Backend
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              Targeting{" "}
              <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                {apiOrigin}
              </code>
            </p>
          </div>
        </div>

        {/* Retry State Status Badge */}
        <div className="mt-6 flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
            <span>
              Checking{" "}
              <code className="font-mono text-zinc-400">/api/v1/health</code>...
            </span>
          </div>
          <span className="text-zinc-500 font-mono">
            Attempt #{health.errorUpdateCount + 1}
          </span>
        </div>

        {/* Backend-not-running UX: clear, non-blocking panel */}
        <div className="mt-6 p-4 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Backend isn't reachable
              </h3>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Start Docker Desktop, or run without Docker using the local
                native sidecar (
                <code className="font-mono text-zinc-300">img2sketch-api</code>
                ).
              </p>
            </div>
          </div>

          {/* Docker Status Probe indicator */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-zinc-300" />
              Docker System Status:
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`font-semibold ${
                  dockerRunning ? "text-emerald-400" : "text-zinc-400"
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
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
              >
                Re-probe
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setMode("docker");
                startDocker();
              }}
              disabled={isStartingBackend}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 disabled:opacity-50 transition-colors"
            >
              <Box className="w-3.5 h-3.5" />
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
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs border border-zinc-700/80 disabled:opacity-50 transition-colors"
            >
              <Server className="w-3.5 h-3.5" />
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 font-medium text-xs border border-zinc-800 disabled:opacity-50 transition-colors"
            >
              <Square className="w-3 h-3" />
              Stop Docker backend
            </button>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 text-xs">
            <button
              type="button"
              onClick={() => health.refetch()}
              disabled={isStartingBackend}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry now
            </button>
            <span className="text-[11px] text-zinc-600 font-mono">
              polling every 2s while down
            </span>
          </div>
        </div>

        {/* Command Log output if an action was run */}
        {backendActionLog && (
          <div className="mt-4 p-3 rounded-lg bg-zinc-950 font-mono text-[11px] text-zinc-300 border border-zinc-800 max-h-32 overflow-y-auto">
            <span className="text-zinc-500 font-bold block mb-1">
              $ Lifecycle output:
            </span>
            {backendActionLog}
          </div>
        )}

        {/* Collapsible Diagnostics Accordion */}
        <div className="mt-6 border-t border-zinc-800/80 pt-4">
          <button
            type="button"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="w-full flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-300"
          >
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              Troubleshooting & Diagnostics
            </span>
            {showDiagnostics ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {showDiagnostics && (
            <div className="mt-3 space-y-3 text-xs">
              {lastHealthError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono text-[11px]">
                  <strong className="block text-rose-400">Last Error:</strong>
                  {lastHealthError}
                </div>
              )}

              {dockerProbeDetails && (
                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 font-mono text-[11px]">
                  <strong className="block text-zinc-300 mb-1">
                    Docker Probe Details:
                  </strong>
                  {dockerProbeDetails}
                </div>
              )}

              <div className="text-zinc-400 space-y-1 text-[11px]">
                <p>To start manually from terminal:</p>
                <div className="p-2 rounded bg-zinc-950 font-mono text-zinc-300 border border-zinc-800 select-all">
                  docker compose up -d
                </div>
                <p className="pt-1">Or verify endpoint with curl:</p>
                <div className="p-2 rounded bg-zinc-950 font-mono text-zinc-300 border border-zinc-800 select-all">
                  curl {apiOrigin}/api/v1/health
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
