import { useEffect, useRef, useState } from "react";
import type { EventData } from "../rpc/contract";
import { runProgressFrom, type RunKind, type RunProgress } from "../lib/progress";

/**
 * Live progress of the run this view started.
 *
 * The stream is app-wide, so "the newest event" may belong to a *different* run
 * than the one on screen. This hook therefore only listens while `isRunning`,
 * and it resets when a run starts, so a fresh bar can never flash the previous
 * run's 100%.
 *
 * Reported values are kept monotonic: the backend only reports forward, but the
 * live query can coalesce frames, so guarding here keeps the bar from stepping
 * backwards if two runs overlap.
 *
 * @param event - newest event on the stream (`useLatestEvent`).
 * @param isRunning - true from the moment the mutation starts until it settles.
 * @param kind - which family of events to read ("single" or "batch").
 */
export function useRunProgress(
  event: EventData | undefined,
  isRunning: boolean,
  kind: RunKind,
): RunProgress | null {
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const wasRunning = useRef(false);

  useEffect(() => {
    if (!isRunning) {
      wasRunning.current = false;
      setProgress(null);
      return;
    }

    if (!wasRunning.current) {
      // A run just started: whatever arrived before it says nothing about it.
      wasRunning.current = true;
      setProgress(null);
    }

    const seen = runProgressFrom(event, kind);
    if (!seen) {
      return;
    }

    setProgress((current) =>
      current && seen.percent < current.percent ? current : seen,
    );
  }, [event, isRunning, kind]);

  return isRunning ? progress : null;
}
