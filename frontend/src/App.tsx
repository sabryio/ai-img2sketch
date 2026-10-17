import React, { useEffect, useState } from "react";
import { BackendGate } from "./components/BackendGate";
import { BatchSketchView } from "./components/BatchSketchView";
import { Header } from "./components/Header";
import { SettingsModal } from "./components/SettingsModal";
import { SingleSketchView } from "./components/SingleSketchView";
import { Toasts } from "./components/Toasts";
import { useBackendStore } from "./stores/backend";

export default function App() {
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { ready, startPollingHealth, stopPollingHealth } = useBackendStore();

  useEffect(() => {
    // Start health check polling on mount
    startPollingHealth();

    return () => {
      stopPollingHealth();
    };
  }, [startPollingHealth, stopPollingHealth]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* App Header */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
              <SingleSketchView />
            ) : (
              <BatchSketchView />
            )}
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Floating Notification Toasts */}
      <Toasts />
    </div>
  );
}
