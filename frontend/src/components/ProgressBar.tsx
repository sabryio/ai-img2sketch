import React from "react";

interface ProgressBarProps {
  /** 0-100 as last reported, or `null` before the first report arrives. */
  percent: number | null;
  /** What is happening now, e.g. a drawing group label. */
  label?: string;
  /** Secondary line, e.g. `frame 120 / 300`. */
  detail?: string;
  /** Third line, e.g. `image 2 of 5 · b.png`. */
  itemDetail?: string;
  /** Test id for the wrapper; the percent is exposed as `<testId>-percent`. */
  testId?: string;
}

/**
 * A determinate progress bar that stays honest before the first report.
 *
 * `percent` is `null` until the backend says something, which is a real state
 * (a run that has started but not yet drawn a frame) and renders as an
 * indeterminate, pulsing track rather than a fake `0%`.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  percent,
  label,
  detail,
  itemDetail,
  testId,
}) => {
  const known = percent !== null;

  return (
    <div data-testid={testId} className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-indigo-300 font-medium truncate">
          {label ?? "Working…"}
        </span>
        <span
          data-testid={testId ? `${testId}-percent` : undefined}
          className="font-mono text-zinc-300 shrink-0"
        >
          {known ? `${percent}%` : "—"}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={label ?? "Progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? percent : undefined}
        className="h-1.5 rounded-full bg-zinc-800 overflow-hidden"
      >
        <div
          className={`h-full rounded-full bg-indigo-500 transition-[width] duration-300 ease-out ${
            known ? "" : "w-full animate-pulse"
          }`}
          style={known ? { width: `${percent}%` } : undefined}
        />
      </div>

      {(itemDetail || detail) && (
        <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-zinc-500">
          <span className="truncate">{itemDetail ?? ""}</span>
          <span className="shrink-0">{detail ?? ""}</span>
        </div>
      )}
    </div>
  );
};
