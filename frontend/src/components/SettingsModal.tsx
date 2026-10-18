import React, { useState } from "react";
import { Box, Check, Radio, Server, Trash2, X } from "lucide-react";
import type { SseState } from "../hooks";
import type { EventData } from "../rpc/contract";
import { DEFAULT_API_ORIGIN } from "../lib/apiOrigin";
import { queryClient } from "../lib/queryClient";
import { useBackendStore } from "../stores/backend";
import { useNotificationsStore } from "../stores/notifications";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sseState: SseState;
  /** Newest event on the live stream, for the diagnostics line. */
  latestEvent?: EventData;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  sseState,
  latestEvent,
}) => {
  const { apiOrigin, setApiOrigin, mode, setMode } = useBackendStore();

  const events = useNotificationsStore((state) => state.events);
  const clearEvents = useNotificationsStore((state) => state.clearEvents);

  const [localApiOrigin, setLocalApiOrigin] = useState(apiOrigin);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const originChanged = localApiOrigin.trim() !== apiOrigin;
    setApiOrigin(localApiOrigin);

    if (originChanged) {
      // Every cached result belongs to the old origin: drop them and let the
      // active queries (health, the event stream) re-run against the new one.
      queryClient.clear();
    }

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="max-w-xl w-full bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <h3 id="settings-title" className="text-base font-bold text-white">
              Application & Engine Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-6 overflow-y-auto">
          {/* Engine Endpoint */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-300">
              API Base URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={localApiOrigin}
                onChange={(e) => setLocalApiOrigin(e.target.value)}
                placeholder={DEFAULT_API_ORIGIN}
                className="flex-1 px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                required
              />
              <button
                type="button"
                onClick={() => setLocalApiOrigin(DEFAULT_API_ORIGIN)}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
                title="Reset to default"
              >
                Reset
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Target address of the FastAPI + SSE backend (Dockerized container
              or sidecar). Applied immediately on save.
            </p>
          </div>

          {/* Execution Mode */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-300">
              Backend Execution Mode
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  mode === "docker"
                    ? "bg-indigo-600/10 border-indigo-500 text-white"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <input
                  type="radio"
                  name="executionMode"
                  value="docker"
                  checked={mode === "docker"}
                  onChange={() => setMode("docker")}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                    <Box className="w-3.5 h-3.5 text-indigo-400" />
                    Docker Container
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    No host mounts: files are{" "}
                    <span className="text-zinc-400">uploaded in</span> and{" "}
                    <span className="text-zinc-400">downloaded out</span>.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  mode === "sidecar"
                    ? "bg-indigo-600/10 border-indigo-500 text-white"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <input
                  type="radio"
                  name="executionMode"
                  value="sidecar"
                  checked={mode === "sidecar"}
                  onChange={() => setMode("sidecar")}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                    <Server className="w-3.5 h-3.5 text-emerald-400" />
                    Host Sidecar
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Direct local binary (
                    <code className="font-mono text-zinc-400">
                      img2sketch-api
                    </code>
                    ).
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* SSE Stream Diagnostics & Recent Events */}
          <div className="space-y-2 pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-indigo-400" />
                Live SSE Stream Log
              </span>
              <div className="flex items-center gap-2">
                <span
                  data-testid="sse-state"
                  className="text-[11px] font-mono text-zinc-500"
                >
                  State: {sseState} &bull; {events.length} events &bull; last:{" "}
                  {latestEvent?.event ?? "—"}
                </span>
                {events.length > 0 && (
                  <button
                    type="button"
                    onClick={clearEvents}
                    className="text-zinc-500 hover:text-zinc-300"
                    aria-label="Clear event log"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div
              data-testid="event-log"
              className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 max-h-36 overflow-y-auto font-mono text-[11px] space-y-1"
            >
              {events.length === 0 ? (
                <div className="text-zinc-600 text-center py-2">
                  No events received yet (stream listening)
                </div>
              ) : (
                events.map((ev) => (
                  <div
                    key={ev.id}
                    className="text-zinc-400 flex items-start gap-2"
                  >
                    <span className="text-zinc-600">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-indigo-400 font-semibold">
                      {ev.name}:
                    </span>
                    <span className="truncate text-zinc-300">
                      {JSON.stringify(ev.data)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-md shadow-indigo-600/20"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Saved!
                </>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
