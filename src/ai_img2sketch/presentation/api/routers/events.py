"""Server-Sent Events router.

Thin adapter: subscribes to the application event bus and feeds each domain
event through :class:`~ai_img2sketch.infrastructure.sse.ORPCSseStream` so the
wire format is always oRPC-compatible (``asyncIteratorObject`` on the client).

The domain event name is injected as the ``"event"`` discriminant key inside
the JSON payload, matching the Zod ``discriminatedUnion("event", [...])``
schema on the frontend contract.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

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


async def _bus_to_generator(
    event_stream: EventStream,
) -> AsyncGenerator[SseItem, None]:
    """Translate bus events into plain dicts for :class:`ORPCSseStream`.

    - ``KEEPALIVE_EVENT`` → skipped (``ORPCSseStream`` handles keep-alives via
      its own comment frames; the bus ping is not forwarded to clients).
    - ``CLOSE_EVENT``     → yields ``ORPCSseStream.done()`` to emit the
      terminal ``event: close`` frame and stop the stream.
    - Everything else    → yields ``_payload(event)`` so the frontend
      ``discriminatedUnion`` can dispatch on ``EVENT_KEY``.
    """
    async for event in event_stream.subscribe():
        if event.event == KEEPALIVE_EVENT:
            continue
        if event.event == CLOSE_EVENT:
            yield ORPCSseStream.done()
            return
        yield _payload(event)


def create_events_router(event_stream: EventStream) -> APIRouter:
    """Build the events router against an ``EventStream`` implementation."""
    router = APIRouter(tags=["events"])

    @router.get(
        path="/events",
        summary="Server-Sent-Events stream of sketch/batch lifecycle events",
    )
    async def stream_events() -> StreamingResponse:
        """Keep a connection open and push every bus event to the client."""
        return ORPCSseStream(_bus_to_generator(event_stream)).to_response()

    return router
