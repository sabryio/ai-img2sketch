import { useEffect } from "react";
import type { EventData } from "../rpc/contract";
import { useNotificationsStore } from "../stores/notifications";

/**
 * Side effects for every event on the stream: append to the history log and
 * raise a toast for failures.
 *
 * Pass the array from `useEventStream()` (the accumulator) rather than the
 * newest event: this hook walks the whole array on each render, and the store
 * dedupes by payload identity, so an event is handled exactly once even if
 * several arrive in one React batch, or the component remounts and receives
 * the already-cached array again.
 */
export function useEventNotifications(events: readonly EventData[] | undefined) {
  const ingest = useNotificationsStore((state) => state.ingest);

  useEffect(() => {
    if (!events) {
      return;
    }
    for (const event of events) {
      ingest(event);
    }
  }, [events, ingest]);
}
