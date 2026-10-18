import React from "react";
import { Folder, X } from "lucide-react";
import type { OutputPlan } from "../lib/paths";

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
}

/** Sentence explaining where the videos will actually land. */
function describePlan(plan: OutputPlan, value: string): React.ReactNode {
  const typed = value.trim();

  if (!typed) {
    return (
      <>
        Empty: every video is written next to its image (inside{" "}
        <code className="font-mono text-zinc-400">./media</code> when the backend
        runs in a container).
      </>
    );
  }

  if (plan.note === "exported") {
    return (
      <span className="text-amber-400/90">
        The container cannot write to {typed}: it renders next to the image, and
        the desktop app copies each video there when it finishes.
      </span>
    );
  }

  if (plan.note === "download") {
    return (
      <span className="text-amber-400/90">
        The container cannot write to {typed}. Videos are rendered next to the
        image — use Download to save them there.
      </span>
    );
  }

  const mapped = plan.backendOutputDir ?? "";
  return (
    <>
      Backend writes to{" "}
      <code className="font-mono text-indigo-300">{mapped}</code>
      {mapped !== typed && (
        <>
          {" "}
          (mapped from <code className="font-mono text-zinc-400">{typed}</code>)
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
}) => (
  <div className="space-y-1.5">
    <label
      htmlFor={id}
      className="flex items-center gap-2 text-sm font-semibold text-zinc-200"
    >
      <Folder className="w-4 h-4 text-indigo-400" />
      Output Folder
      <span className="text-[11px] font-normal text-zinc-500">optional</span>
    </label>

    <div className="flex flex-col sm:flex-row gap-2.5">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Leave empty to save next to the selected image"
        className="flex-1 px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs flex items-center justify-center gap-1.5 transition-colors border border-zinc-700 shrink-0"
          title="Clear: write beside the image again"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>

    <p className="text-[11px] text-zinc-500" data-testid="output-plan">
      {describePlan(plan, value)}
    </p>
  </div>
);
