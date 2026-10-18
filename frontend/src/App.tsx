import React, { useState } from "react";
import { BackendGate } from "./components/BackendGate";
import { BatchSketchView } from "./components/BatchSketchView";
import { Header } from "./components/Header";
import { SettingsModal } from "./components/SettingsModal";
import { SingleSketchView } from "./components/SingleSketchView";
import { Toasts } from "./components/Toasts";
import {
  toSseState,
  useEventNotifications,
  useEventStream,
  useHealth,
  useLatestEvent,
} from "./hooks";

export default function App() {
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  /**
   * Every server-facing concern lives here, and only here:
   *
   * - `useHealth` decides whether the workspace is reachable at all.
   * - `useLatestEvent` is the stream as a live query — the newest event, which
   *   is what the badge and the diagnostics line report.
   * - `useEventStream` is the same stream accumulated, because the notification
   *   log needs every frame (a live query keeps only the newest value). It is
   *   mounted only once the backend answers, so a cold start does not spray
   *   reconnect attempts.
   *
   * Everything below receives what it needs as props, which keeps one source of
   * truth for each piece of server state.
   */
  const health = useHealth();
  const ready = health.data?.status === "ok";

  const {
    data: latest,
    isLoading: isStreamConnecting,
    error: streamError,
    refetch: restartStream,
  } = useLatestEvent({ enabled: ready });

  const stream = useEventStream({ enabled: ready });
  useEventNotifications(stream.data);

  const sseState = toSseState(
    { data: latest, isLoading: isStreamConnecting, error: streamError },
    ready,
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* App Header */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        sseState={sseState}
        onRestartStream={restartStream}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!ready ? (
          /* Startup Gate: Shown while backend is starting or unreachable */
          <BackendGate />
        ) : (
          /* Main Workspace: Active once GET /api/v1/health is OK */
          <div className="space-y-6">
            {activeTab === "single" ? (
              <SingleSketchView ready={ready} />
            ) : (
              <BatchSketchView ready={ready} />
            )}
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        sseState={sseState}
        latestEvent={latest}
      />

      {/* Floating Notification Toasts */}
      <Toasts />
    </div>
  );
}
