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

/** How many frames the strip resolves a run into before it is exact again. */
const TICKS = 28;

/**
 * Progress drawn as frames on the sheet: a strip of frame ticks beside the
 * drawing, filling in graphite behind the pencil that is drawing now.
 *
 * `percent` is `null` until the backend says something, which is a real state
 * (a run that has started but has not drawn a frame yet) and renders as a strip
 * holding its breath rather than a fake `0%`.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  percent,
  label,
  detail,
  itemDetail,
  testId,
}) => {
  const known = percent !== null;
  const drawn = known
    ? Math.round((Math.min(100, Math.max(0, percent)) / 100) * TICKS)
    : 0;

  const tickColor = (index: number) => {
    if (!known) return "var(--color-sheet-line)";
    if (index < drawn) return "var(--color-graphite)";
    if (index === drawn) return "var(--color-pencil)";
    return "var(--color-sheet-line)";
  };

  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="annot truncate">{label ?? "Working…"}</span>
        <span
          data-testid={testId ? `${testId}-percent` : undefined}
          className="mono tnum shrink-0 text-value font-semibold text-graphite-2"
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
        className={`mt-3 flex items-end gap-0.5 ${known ? "" : "ticks"}`}
      >
        {Array.from({ length: TICKS }, (_, index) => (
          <i
            key={index}
            aria-hidden="true"
            className="block flex-1 rounded-xs transition-[background-color,height] duration-300 ease-step"
            style={{
              backgroundColor: tickColor(index),
              height: known && index === drawn ? 3 : 2,
            }}
          />
        ))}
      </div>

      {(itemDetail || detail) && (
        <div className="mono mt-2.5 flex items-center justify-between gap-4 text-micro text-graphite-3">
          <span className="truncate">{itemDetail ?? ""}</span>
          <span className="shrink-0">{detail ?? ""}</span>
        </div>
      )}
    </div>
  );
};
