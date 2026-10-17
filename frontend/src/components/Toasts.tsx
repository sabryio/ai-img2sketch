import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  X,
} from "lucide-react";
import { ToastItem, useGenerationStore } from "../stores/generation";

export const Toasts: React.FC = () => {
  const { toasts, dismissToast } = useGenerationStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (toasts.length === 0) return null;

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <aside
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((toast) => {
        const isError = toast.type === "error";
        const isSuccess = toast.type === "success";
        const isWarning = toast.type === "warning";

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto p-4 rounded-xl border shadow-2xl backdrop-blur-md transition-all animate-slide-up ${
              isError
                ? "bg-zinc-950/95 border-rose-500/40 text-rose-200"
                : isSuccess
                  ? "bg-zinc-950/95 border-emerald-500/30 text-emerald-200"
                  : isWarning
                    ? "bg-zinc-950/95 border-amber-500/30 text-amber-200"
                    : "bg-zinc-950/95 border-zinc-800 text-zinc-200"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {isError && (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                {isSuccess && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                )}
                {isWarning && (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                {!isError && !isSuccess && !isWarning && (
                  <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                )}

                <div className="space-y-0.5">
                  <h4 className="text-xs font-bold text-white tracking-tight">
                    {toast.title}
                  </h4>
                  <p className="text-xs leading-relaxed opacity-90 break-words">
                    {toast.message}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="text-zinc-400 hover:text-white p-1 rounded transition-colors"
                aria-label="Close notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Verbatim 500 error display with copy button */}
            {toast.verbatim && (
              <div className="mt-3 pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-zinc-400 truncate">
                  Local debugging payload
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(toast.id, toast.verbatim!)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition-colors border border-zinc-700"
                >
                  <Copy className="w-3 h-3" />
                  {copiedId === toast.id
                    ? "Copied verbatim"
                    : "Copy verbatim error"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
};
