"""In-process asynchronous event bus.

The bus satisfies two application ports at once: :class:`EventPublisher` (write
side, used by API request handlers) and :class:`EventStream` (read side, used by
the SSE transport). Broadcasting is per-process: run the server with a single
worker (the default) so a request handler and every subscribed SSE client live
in the same event loop.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, Mapping
from contextlib import suppress

from ...application.ports.event_publisher import CLOSE_EVENT, KEEPALIVE_EVENT, DomainEvent

logger = logging.getLogger(__name__)

#: Seconds of silence after which the reserved :data:`KEEPALIVE_EVENT` is
#: emitted so proxies and idle Tauri webviews keep the connection open.
_KEEPALIVE_AFTER_SECONDS = 15.0


class AsyncEventBus:
    """Fan events out to every active subscriber in this process."""

    def __init__(self) -> None:
        self._subscriptions: list[asyncio.Queue[DomainEvent]] = []

    async def publish(self, event: str, data: Mapping[str, object]) -> None:
        """Publish ``event`` to every current subscriber.

        Must be awaited on the event loop (generation itself runs off-loop in a
        thread, so handlers publish on completion). Events published before any
        subscriber attached (the bus starts empty) are not replayed later.
        """
        payload = DomainEvent(event=event, data=dict(data))  # snapshot: callers may reuse theirs
        for queue in list(self._subscriptions):
            queue.put_nowait(payload)

    async def close(self) -> None:
        """Deliver the terminal ``close`` event to every subscriber.

        Called on shutdown (lifespan) so clients receive an explicit end of
        stream instead of a dropped connection.
        """
        terminal = DomainEvent(event=CLOSE_EVENT, data={})
        for queue in list(self._subscriptions):
            queue.put_nowait(terminal)

    def subscribe(self) -> AsyncGenerator[DomainEvent, None]:
        """Register a subscriber now and return its live event stream.

        Registration happens synchronously at call time (not at the first
        pull), so events published right after ``subscribe()`` can never be
        missed. Iterate the returned generator with ``async for``.
        """
        queue: asyncio.Queue[DomainEvent] = asyncio.Queue()
        self._subscriptions.append(queue)
        return self._stream(queue)

    async def _stream(self, queue: asyncio.Queue[DomainEvent]) -> AsyncGenerator[DomainEvent, None]:
        """Yield queued events (plus keep-alives) until disconnect or close."""
        try:
            while True:
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=_KEEPALIVE_AFTER_SECONDS)
                except asyncio.TimeoutError:
                    yield DomainEvent(event=KEEPALIVE_EVENT, data={})
        finally:
            with suppress(ValueError):
                self._subscriptions.remove(queue)
            logger.debug("Subscriber disconnected (%d active)", len(self._subscriptions))
