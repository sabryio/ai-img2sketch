import React, { useState } from "react";
import { Copy, X } from "lucide-react";
import { useNotificationsStore } from "../stores/notifications";

export const Toasts: React.FC = () => {
  const toasts = useNotificationsStore((state) => state.toasts);
  const dismissToast = useNotificationsStore((state) => state.dismissToast);
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
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col gap-2.5 overflow-y-auto px-4 sm:px-0"
    >
      {toasts.map((toast) => {
        const isError = toast.type === "error";
        const isSuccess = toast.type === "success";
        const isWarning = toast.type === "warning";

        const stateTag = isError
          ? "tag-alert"
          : isSuccess
            ? "tag-committed"
            : isWarning
              ? "tag-held"
              : "tag-pencil";
        const stateDot = isError
          ? "bg-alert-soft"
          : isSuccess
            ? "bg-committed-soft"
            : isWarning
              ? "bg-held-soft"
              : "bg-onion";
        const stateLabel = isError
          ? "Error"
          : isSuccess
            ? "Done"
            : isWarning
              ? "Warning"
              : "Info";

        return (
          <div
            key={toast.id}
            role="status"
            className="region slip-in pointer-events-auto p-3.5"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-1.75 h-1.5 w-1.5 shrink-0 rounded-full ${stateDot}`}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-value font-semibold tracking-[-0.01em] text-room-text">
                    {toast.title}
                  </h4>
                  <span className={`tag shrink-0 ${stateTag}`}>
                    {stateLabel}
                  </span>
                </div>
                <p className="mt-1 text-micro leading-relaxed wrap-break-word text-room-muted">
                  {toast.message}
                </p>
              </div>

              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="btn btn-quiet shrink-0 px-1.5 py-1"
                aria-label="Close notification"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Verbatim 500 error display with copy button */}
            {toast.verbatim && (
              <div className="hairline mt-3 flex items-center justify-between gap-2 pt-2.5">
                <span className="mono truncate text-[11px] text-room-faint">
                  Local debugging payload
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(toast.id, toast.verbatim!)}
                  className="btn shrink-0 px-2 py-1 text-[11px]"
                >
                  <Copy aria-hidden="true" className="h-3 w-3" />
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
