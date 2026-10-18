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
   *   is what the badge reports and what the views read for live progress.
   * - `useEventStream` is the same stream accumulated, because the notification
   *   log needs every frame (a live query keeps only the newest value). It is
   *   mounted only once the backend answers, so a cold start does not spray
   *   reconnect attempts.
   *
   * Everything below receives what it needs as props, which keeps one source of
   * truth for each piece of server state: the views do not open a second stream.
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
    <div className="flex min-h-screen flex-col bg-room font-sans text-room-text lg:h-screen">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        sseState={sseState}
        onRestartStream={restartStream}
      />

      <main className="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 flex-col px-4 py-6 sm:px-6">
        {!ready ? (
          /* The room before the backend answers: nothing has been lit yet. */
          <BackendGate />
        ) : activeTab === "single" ? (
          <SingleSketchView ready={ready} latestEvent={latest} />
        ) : (
          <BatchSketchView ready={ready} latestEvent={latest} />
        )}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        sseState={sseState}
        latestEvent={latest}
      />

      <Toasts />
    </div>
  );
}
