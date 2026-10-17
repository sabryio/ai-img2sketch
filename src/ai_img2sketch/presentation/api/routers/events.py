"""Server-Sent Events router.

The stream follows the classic lifecycle the client can rely on:

1. **Initial frames** — a `retry:` reconnect hint followed by an (unnamed)
   comment ack, sent the moment the connection opens.
2. **Message events** — every bus event as ``event: <name>`` + ``id: <n>``
   + ``data: <json>``; ``ping`` events become anonymous keep-alive comments
   during silence.
3. **Close event** — a terminal ``event: close`` frame when the bus shuts
   down, then the stream ends.

Event names and payloads mirror the JSON errors of the request/response
endpoints (see :mod:`.sketches`).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ....application.ports.event_publisher import DomainEvent, EventStream

#: Reconnect hint sent to the client (``retry:`` line) at stream start.
_RECONNECT_SECONDS = 5

#: hop-by-hop headers must stay out; these two stop buffering everywhere.
_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def initial_frames() -> str:
    """Warming frames sent before any application event."""
    return f"retry: {_RECONNECT_SECONDS * 1000}\n\n: connected\n\n"


def message_frame(event: DomainEvent, sequence: int) -> str:
    """Format one application event as an ``event``/``id``/``data`` frame."""
    payload = json.dumps(event.data, ensure_ascii=False)
    return f"event: {event.event}\nid: {sequence}\ndata: {payload}\n\n"


def close_frame() -> str:
    """Terminal frame marking the end of the stream."""
    return "event: close\ndata: \n\n"


def _sse_frames(event_stream: EventStream) -> AsyncIterator[str]:
    """Stream bus events as SSE frames until a ``close`` event arrives."""

    async def generator() -> AsyncIterator[str]:
        # Attach to the bus BEFORE the first frame goes out so events published
        # between connection and subscription can never be missed.
        events = event_stream.subscribe()
        yield initial_frames()
        sequence = 0
        async for event in events:
            if event.event == "close":
                yield close_frame()
                return
            if event.event == "ping":
                yield ": keep-alive\n\n"
                continue
            yield message_frame(event, sequence)
            sequence += 1

    return generator()


def create_events_router(event_stream: EventStream) -> APIRouter:
    """Build the events router against an ``EventStream`` implementation."""
    router = APIRouter(tags=["events"])

    @router.get(
        path="/events",
        summary="Server-Sent-Events stream of sketch/batch lifecycle events",
    )
    async def stream_events() -> StreamingResponse:
        """Keep a connection open and push every bus event to the client."""
        return StreamingResponse(
            _sse_frames(event_stream),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )

    return router
