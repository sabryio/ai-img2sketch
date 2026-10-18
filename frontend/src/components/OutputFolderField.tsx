import React from "react";
import { Folder, Info, X } from "lucide-react";
import type { BackendMode, InputPathPlan, OutputPlan } from "../lib/paths";

interface OutputFolderFieldProps {
  /** Unique per view (`single-output-dir`, `batch-output-dir`). */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Resolved from `value` by the view, so what this says and what the request
   * asks for can never disagree.
   */
  plan: OutputPlan;
  /**
   * The single file the run reads, as selected and as the backend will open it.
   * Views that have no single input of their own omit it.
   */
  input?: {
    /** Path as selected or typed by the user. */
    path: string;
    /** Path the backend will open, and whether bytes have to travel first. */
    plan: InputPathPlan;
    mode: BackendMode;
  };
}

/** Sentence explaining where the videos will actually land. */
function describePlan(plan: OutputPlan, value: string): React.ReactNode {
  const typed = value.trim();

  if (!typed) {
    return (
      <>
        Empty: every video is written next to its image, inside the backend's own
        directory.
      </>
    );
  }

  if (plan.note === "exported") {
    return (
      <span className="text-held-soft">
        The container cannot write to {typed}: it renders next to the image, and
        the desktop app copies each video there when it finishes.
      </span>
    );
  }

  if (plan.note === "download") {
    return (
      <span className="text-held-soft">
        The container cannot write to {typed}. Videos are rendered next to the
        image — use Download to save them there.
      </span>
    );
  }

  const mapped = plan.backendOutputDir ?? "";
  return (
    <>
      Backend writes to{" "}
      <code className="mono text-onion">{mapped}</code>
      {mapped !== typed && (
        <>
          {" "}
          (mapped from <code className="mono text-room-muted">{typed}</code>)
        </>
      )}
      .
    </>
  );
}

/**
 * Where the produced videos should go.
 *
 * Empty means "next to the selected image" — which is exactly what the backend
 * does when no `output_dir` is sent — so the field states that default instead
 * of leaving the user to guess.
 */
export const OutputFolderField: React.FC<OutputFolderFieldProps> = ({
  id,
  value,
  onChange,
  plan,
  input,
}) => (
  <>
    {input && input.path.trim() && (
      <div className="row flex-col items-stretch">
        <div className="flex items-center gap-2">
          <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-onion" />
          <span className="text-micro font-medium text-room-text">
            Backend Path ({input.mode}):
          </span>
        </div>

        <div className="mono mt-2 space-y-1 text-micro">
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 text-room-faint">Selected:</span>
            <span className="min-w-0 truncate text-room-text">
              {input.path}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 text-room-faint">Backend sees:</span>
            <span className="min-w-0 truncate font-semibold text-onion">
              {input.plan.path || "—"}
            </span>
          </div>
        </div>

        {input.plan.needsUpload && (
          <p className="mt-2 text-micro text-held-soft">
            &bull; The file is uploaded to the backend when the run starts: the
            container only reads files it was given.
          </p>
        )}
      </div>
    )}

    <div className="row flex-col items-stretch">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="label flex items-center gap-1.5"
        >
          <Folder aria-hidden="true" className="h-3.5 w-3.5 text-onion" />
          Output Folder
        </label>
        <span className="text-micro text-room-faint">optional</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Leave empty to save next to the selected image"
          className="field mono min-w-0 flex-1"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="btn btn-quiet shrink-0"
            title="Clear: write beside the image again"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      <p className="mt-2 text-micro text-room-muted" data-testid="output-plan">
        {describePlan(plan, value)}
      </p>
    </div>
  </>
);
