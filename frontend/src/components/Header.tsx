import React from "react";
import {
  Activity,
  Box,
  CheckCircle2,
  FolderSync,
  Layers,
  Radio,
  RefreshCw,
  Server,
  Settings,
  Sparkles,
  Zap,
} from "lucide-react";
import { useBackendStore } from "../stores/backend";
import { useGenerationStore } from "../stores/generation";

interface HeaderProps {
  activeTab: "single" | "batch";
  onTabChange: (tab: "single" | "batch") => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenSettings,
}) => {
  const {
    health,
    ready,
    mode,
    setMode,
    dockerRunning,
    simulatorActive,
    checkHealthOnce,
  } = useBackendStore();

  const { sseState } = useGenerationStore();

  const getSseBadge = () => {
    switch (sseState) {
      case "online":
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            title="SSE stream connected: listening for lifecycle events"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            SSE Live
          </span>
        );
      case "reconnecting":
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20"
            title="SSE stream reconnecting..."
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            Reconnecting
          </span>
        );
      case "connecting":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Radio className="w-3 h-3 animate-pulse" />
            Connecting
          </span>
        );
      case "closed":
      default:
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700"
            title="SSE stream idle or closed"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500"></span>
            SSE Idle
          </span>
        );
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-white tracking-tight">
                    AI-Img2Sketch
                  </h1>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60">
                    Tauri
                  </span>
                </div>
                <p className="text-xs text-zinc-400 hidden sm:block">
                  FastAPI Engine &bull; Video Sketch Synthesis
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="hidden md:flex items-center p-1 rounded-lg bg-zinc-900 border border-zinc-800/80 ml-4">
              <button
                type="button"
                onClick={() => onTabChange("single")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === "single"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                Single Image
              </button>
              <button
                type="button"
                onClick={() => onTabChange("batch")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === "batch"
                    ? "bg-indigo-600 text-white shadow"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Batch Processing
              </button>
            </div>
          </div>

          {/* Right Controls: Status Badges, Mode Toggle, Settings */}
          <div className="flex items-center gap-3">
            {/* Backend Health Badge */}
            <button
              type="button"
              onClick={() => checkHealthOnce()}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                ready
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                  : health === "starting"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : "bg-rose-500/10 text-rose-400 border-rose-500/20"
              }`}
              title="Click to re-check backend health"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  ready ? "bg-emerald-400" : "bg-rose-400"
                }`}
              />
              <span className="hidden sm:inline">Backend:</span>
              <span className="font-semibold capitalize">{health}</span>
            </button>

            {/* SSE Badge */}
            {getSseBadge()}

            {/* Mode Switcher */}
            <div className="hidden lg:flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode("docker")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                  mode === "docker"
                    ? "bg-zinc-800 text-indigo-400 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Docker container execution (port 8000 + mounted volumes)"
              >
                <Box className="w-3.5 h-3.5" />
                Docker
              </button>
              <button
                type="button"
                onClick={() => setMode("sidecar")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors ${
                  mode === "sidecar"
                    ? "bg-zinc-800 text-indigo-400 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Direct native host sidecar execution (img2sketch-api binary)"
              >
                <Server className="w-3.5 h-3.5" />
                Sidecar
              </button>
            </div>

            {/* Simulator Indicator if active */}
            {simulatorActive && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700">
                Demo Sim
              </span>
            )}

            {/* Settings Button */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-700"
              title="Configure API Base URL, Docker paths, and debug logs"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Navigation Tabs */}
        <div className="flex md:hidden items-center justify-around pb-3 pt-1 border-t border-zinc-800/60">
          <button
            type="button"
            onClick={() => onTabChange("single")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
              activeTab === "single"
                ? "bg-indigo-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Single
          </button>
          <button
            type="button"
            onClick={() => onTabChange("batch")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
              activeTab === "batch"
                ? "bg-indigo-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Batch
          </button>
        </div>
      </div>
    </header>
  );
};
