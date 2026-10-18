import React, { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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

  const radioRow = (selected: boolean) =>
    `flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
      selected
        ? "border-onion-dim bg-onion-dim/25"
        : "border-room-line bg-room-sunken hover:border-room-line-2"
    }`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-[70] flex justify-end"
    >
      <div aria-hidden="true" className="fade-in absolute inset-0 bg-room/80" />

      <div className="slip-in relative flex h-full w-full max-w-[440px] flex-col border-l border-room-line bg-room-raised">
        <div className="flex items-start justify-between gap-3 border-b border-room-line px-5 py-4">
          <div>
            <h3
              id="settings-title"
              className="text-[15px] font-semibold tracking-[-0.01em] text-room-text"
            >
              Application & Engine Settings
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-quiet shrink-0 px-2 py-1.5"
            aria-label="Close settings"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-5 py-5">
              <label htmlFor="settings-api-origin" className="label">
                API Base URL
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="settings-api-origin"
                  type="text"
                  value={localApiOrigin}
                  onChange={(e) => setLocalApiOrigin(e.target.value)}
                  placeholder={DEFAULT_API_ORIGIN}
                  className="field mono"
                  required
                />
                <button
                  type="button"
                  onClick={() => setLocalApiOrigin(DEFAULT_API_ORIGIN)}
                  className="btn shrink-0"
                  title="Reset to default"
                >
                  Reset
                </button>
              </div>
              <p className="mt-2 text-micro leading-relaxed text-room-muted">
                Target address of the FastAPI + SSE backend (Dockerized
                container or sidecar). Applied immediately on save.
              </p>
            </div>

            <div className="hairline px-5 py-5">
              <span className="label">Backend Execution Mode</span>
              <div className="mt-2.5 flex flex-col gap-2">
                <label className={radioRow(mode === "docker")}>
                  <input
                    type="radio"
                    name="executionMode"
                    value="docker"
                    checked={mode === "docker"}
                    onChange={() => setMode("docker")}
                    className="mt-0.5 accent-pencil"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-value font-semibold text-room-text">
                      <Box aria-hidden="true" className="h-3.5 w-3.5 text-onion" />
                      Docker Container
                    </span>
                    <span className="mt-0.5 block text-micro leading-relaxed text-room-muted">
                      No host mounts: files are{" "}
                      <span className="text-room-text">uploaded in</span> and{" "}
                      <span className="text-room-text">downloaded out</span>.
                    </span>
                  </span>
                </label>

                <label className={radioRow(mode === "sidecar")}>
                  <input
                    type="radio"
                    name="executionMode"
                    value="sidecar"
                    checked={mode === "sidecar"}
                    onChange={() => setMode("sidecar")}
                    className="mt-0.5 accent-pencil"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-value font-semibold text-room-text">
                      <Server
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-onion"
                      />
                      Host Sidecar
                    </span>
                    <span className="mt-0.5 block text-micro leading-relaxed text-room-muted">
                      Direct local binary (
                      <span className="mono text-room-text">img2sketch-api</span>
                      ).
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="hairline px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <span className="label flex items-center gap-1.5">
                  <Radio aria-hidden="true" className="h-3.5 w-3.5" />
                  Live SSE Stream Log
                </span>
                {events.length > 0 && (
                  <button
                    type="button"
                    onClick={clearEvents}
                    className="btn btn-quiet shrink-0 px-2 py-1"
                    aria-label="Clear event log"
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="mt-2.5">
                <span
                  data-testid="sse-state"
                  className="mono text-micro text-room-muted"
                >
                  State: {sseState} &bull; {events.length} events &bull; last:{" "}
                  {latestEvent?.event ?? "—"}
                </span>
              </div>

              <div
                data-testid="event-log"
                className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-control border border-room-line bg-room-sunken p-2.5 font-mono text-[11px]"
              >
                {events.length === 0 ? (
                  <div className="py-2 text-center text-room-faint">
                    No events received yet (stream listening)
                  </div>
                ) : (
                  events.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-start gap-2 text-room-muted"
                    >
                      <span className="mono shrink-0 text-room-faint">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="shrink-0 font-semibold text-onion">
                        {ev.name}:
                      </span>
                      <span className="truncate text-room-text">
                        {JSON.stringify(ev.data)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-room-line px-5 py-4">
            <button type="button" onClick={onClose} className="btn">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {savedSuccess ? (
                <>
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
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
