import React, { useState } from "react";
import {
  Activity,
  Box,
  Check,
  FolderTree,
  Radio,
  RefreshCw,
  Server,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useBackendStore } from "../stores/backend";
import { useGenerationStore } from "../stores/generation";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    apiBase,
    setApiBaseUrl,
    mode,
    setMode,
    pathConfig,
    setPathConfig,
    simulatorActive,
    toggleSimulator,
    checkHealthOnce,
  } = useBackendStore();

  const { eventsHistory, sseState } = useGenerationStore();

  const [localApiBase, setLocalApiBase] = useState(apiBase);
  const [projectRoot, setProjectRoot] = useState(pathConfig.projectRoot);
  const [mediaSubdir, setMediaSubdir] = useState(pathConfig.mediaSubdir);
  const [outputSubdir, setOutputSubdir] = useState(pathConfig.outputSubdir);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setApiBaseUrl(localApiBase);
    setPathConfig({
      projectRoot,
      mediaSubdir,
      outputSubdir,
    });
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
                value={localApiBase}
                onChange={(e) => setLocalApiBase(e.target.value)}
                placeholder="http://localhost:8000"
                className="flex-1 px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                required
              />
              <button
                type="button"
                onClick={() => setLocalApiBase("http://localhost:8000")}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
                title="Reset to default"
              >
                Reset
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Target address of the FastAPI + SSE backend (Dockerized container
              or sidecar).
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
                    Mounted volumes (
                    <code className="font-mono text-zinc-400">/app/media</code>,{" "}
                    <code className="font-mono text-zinc-400">/app/output</code>
                    ).
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

          {/* Docker Paths & Volume Mapping */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <FolderTree className="w-4 h-4 text-indigo-400" />
              Volume Mapping Subdirectories (Docker Mode)
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400">
                  Project Root
                </label>
                <input
                  type="text"
                  value={projectRoot}
                  onChange={(e) => setProjectRoot(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded font-mono text-zinc-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400">
                  Media Subdir
                </label>
                <input
                  type="text"
                  value={mediaSubdir}
                  onChange={(e) => setMediaSubdir(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded font-mono text-zinc-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400">
                  Output Subdir
                </label>
                <input
                  type="text"
                  value={outputSubdir}
                  onChange={(e) => setOutputSubdir(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-zinc-950 border border-zinc-800 rounded font-mono text-zinc-200"
                />
              </div>
            </div>
          </div>

          {/* Web Preview Demo Simulator Toggle */}
          <div className="pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Web Demo Simulator
                </span>
                <p className="text-[11px] text-zinc-500">
                  Simulate healthy backend, mock video generation, and corrupt
                  batch handling inside browser preview.
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleSimulator()}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  simulatorActive
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {simulatorActive ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>

          {/* SSE Stream Diagnostics & Recent Events */}
          <div className="space-y-2 pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-indigo-400" />
                Live SSE Stream Log
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                State: {sseState} &bull; {eventsHistory.length} events
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 max-h-36 overflow-y-auto font-mono text-[11px] space-y-1">
              {eventsHistory.length === 0 ? (
                <div className="text-zinc-600 text-center py-2">
                  No events received yet (stream listening)
                </div>
              ) : (
                eventsHistory.map((ev) => (
                  <div
                    key={ev.id}
                    className="text-zinc-400 flex items-start gap-2"
                  >
                    <span className="text-zinc-600">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-indigo-400 font-semibold">
                      {ev.type}:
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
