"""Server-Sent Events router.

Thin adapter: subscribes to the application event bus and feeds each domain
event through :class:`~ai_img2sketch.infrastructure.sse.ORPCSseStream` so the
wire format is always oRPC-compatible (``asyncIteratorObject`` on the client).

The domain event name is injected as the ``"event"`` discriminant key inside
the JSON payload, matching the Zod ``discriminatedUnion("event", [...])``
schema on the frontend contract. The bus ``ping`` is rendered as an anonymous
keep-alive comment (see ``docs/orpc-sse-wire-format.md``).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ....application.ports.event_publisher import (
    CLOSE_EVENT,
    EVENT_KEY,
    KEEPALIVE_EVENT,
    DomainEvent,
    EventStream,
)
from ....infrastructure.sse import ORPCSseStream
from ....infrastructure.sse.stream import SseItem


def _payload(event: DomainEvent) -> dict[str, object]:
    """Event name first (documented wire shape), and authoritative.

    A payload field that happens to be named ``"event"`` is dropped rather than
    allowed to clobber the discriminant — clients dispatch on it.
    """
    extras = {key: value for key, value in event.data.items() if key != EVENT_KEY}
    return {EVENT_KEY: event.event, **extras}


def _bus_events(events: AsyncIterator[DomainEvent]) -> AsyncGenerator[SseItem, None]:
    """Translate subscribed bus events into items for :class:`ORPCSseStream`.

    - ``KEEPALIVE_EVENT`` → an anonymous comment frame: idle connections stay
      open without reaching application code (``docs/orpc-sse-wire-format.md``).
    - ``CLOSE_EVENT``     → ``ORPCSseStream.done()``: the terminal
      ``event: close`` frame, then the stream stops.
    - Everything else    → ``_payload(event)`` so the frontend
      ``discriminatedUnion`` can dispatch on the discriminant key.
    """

    async def generate() -> AsyncGenerator[SseItem, None]:
        async for event in events:
            if event.event == KEEPALIVE_EVENT:
                yield ORPCSseStream.comment()
                continue
            if event.event == CLOSE_EVENT:
                yield ORPCSseStream.done()
                return
            yield _payload(event)

    return generate()


def create_events_router(event_stream: EventStream) -> APIRouter:
    """Build the events router against an ``EventStream`` implementation."""
    router = APIRouter(tags=["events"])

    @router.get(
        path="/events",
        summary="Server-Sent-Events stream of sketch/batch lifecycle events",
    )
    async def stream_events() -> StreamingResponse:
        """Keep a connection open and push every bus event to the client."""
        # Attach before the first frame goes out, so events published between
        # the connection and the initial flush can never be missed.
        events = event_stream.subscribe()
        return ORPCSseStream(_bus_events(events)).to_response()

    return router
