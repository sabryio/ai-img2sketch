import type { EventData } from "../rpc/contract";

/**
 * Reading progress out of the event stream.
 *
 * The stream is app-wide and carries every run, so a view needs two things: the
 * newest frame, and a decision about whether that frame belongs to the run the
 * view is watching. This module is the pure half of that decision; the hook that
 * captures it over time is `useRunProgress`.
 */

/** How far the run has got, in the shape a progress bar needs. */
export interface RunProgress {
  /** Completion of the run, 0-100. */
  percent: number;
  /** What is being drawn right now (a drawing group, or the final image). */
  label?: string;
  /** Frames written for the current image, and how many it will write. */
  frame?: number;
  totalFrames?: number;
  /**
   * A still of the frame just drawn, as a backend path
   * (`GET /api/v1/artifacts/download?path=…&disposition=inline`). It exists only
   * while the run does: the backend drops its previews when the render ends.
   */
  previewPath?: string;
  /** Position in a batch, 1-based, plus how many images it holds. */
  itemIndex?: number;
  itemTotal?: number;
  itemName?: string;
}

/** Which view is asking: a single render or a batch run. */
export type RunKind = "single" | "batch";

/** Compact label for the position in a batch, e.g. `image 2 of 5 · b.png`. */
export function itemDetail(
  progress: RunProgress | null | undefined,
): string | undefined {
  if (progress?.itemIndex === undefined || progress.itemTotal === undefined) {
    return undefined;
  }

  const position = `image ${progress.itemIndex} of ${progress.itemTotal}`;
  return progress.itemName ? `${position} · ${progress.itemName}` : position;
}

/** Compact label for the frame counter, e.g. `frame 120 / 300`. */
export function frameDetail(
  progress: RunProgress | null | undefined,
): string | undefined {
  if (progress?.frame === undefined || !progress.totalFrames) {
    return undefined;
  }
  return `frame ${progress.frame} / ${progress.totalFrames}`;
}

/**
 * Progress carried by one event, or `null` when it is not progress for `kind`.
 *
 * A lifecycle event counts as progress too: `started` is 0% and `completed` is
 * 100%, so a bar exists from the first frame and reaches the end even if the
 * engine had nothing to report in between. Any other event — a batch frame while
 * the single view is open, for instance — yields `null` and is ignored.
 */
export function runProgressFrom(
  event: EventData | undefined,
  kind: RunKind,
): RunProgress | null {
  if (!event) {
    return null;
  }

  if (kind === "single") {
    switch (event.event) {
      case "sketch.started":
        return { percent: 0 };
      case "sketch.progress":
        return {
          percent: event.percent,
          label: event.label,
          frame: event.frame,
          totalFrames: event.total_frames,
          previewPath: event.preview_path,
        };
      case "sketch.completed":
        return { percent: 100 };
      default:
        return null;
    }
  }

  switch (event.event) {
    case "batch.started":
      return { percent: 0 };
    case "batch.progress":
      return {
        percent: event.percent,
        label: event.label,
        frame: event.frame,
        totalFrames: event.total_frames,
        previewPath: event.preview_path,
        itemIndex: event.item_index,
        itemTotal: event.item_total,
        itemName: event.item_name,
      };
    case "batch.completed":
      return { percent: 100 };
    default:
      return null;
  }
}
