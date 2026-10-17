import { useEffect, useState } from "react";

/**
 * Seconds elapsed while `active` is true, reset on every transition to true.
 *
 * Generation is a single long request, so the elapsed counter is what tells the
 * user the app has not frozen; it is local state, not server state, and needs no
 * store.
 *
 * @example
 * const elapsed = useElapsed(isPending);
 * // -> "Working… 12s"
 */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }

    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [active]);

  return elapsed;
}
