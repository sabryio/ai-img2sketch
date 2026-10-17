"""Router-level tests for the SSE translation (bus events → oRPC frames).

Covers the guarantees of `docs/orpc-sse-wire-format.md` that live in the
presentation adapter: the discriminant key, keep-alive comments and the
terminal close frame. The encoder itself is tested in ``test_sse_frames.py``.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator

from ai_img2sketch.application.ports.event_publisher import (
    CLOSE_EVENT,
    EVENT_KEY,
    KEEPALIVE_EVENT,
    DomainEvent,
)
from ai_img2sketch.infrastructure.sse import ORPCSseStream
from ai_img2sketch.presentation.api.routers.events import _bus_events, _payload


class FakeStream:
    """Minimal structural ``EventStream`` stub (no timers, no infrastructure)."""

    def __init__(self, events: list[DomainEvent]) -> None:
        self._events = events

    def subscribe(self) -> AsyncIterator[DomainEvent]:
        async def generate() -> AsyncGenerator[DomainEvent, None]:
            for event in self._events:
                yield event

        return generate()


def _frames(events: list[DomainEvent]) -> list[str]:
    """Drive the router translation through the real encoder."""

    async def collect() -> list[str]:
        stream = ORPCSseStream(_bus_events(FakeStream(events).subscribe()))
        return [chunk async for chunk in stream.frames()]

    return asyncio.run(collect())


def test_keepalive_renders_as_anonymous_comment() -> None:
    """Spec: keep-alives are empty comments and never consume an event id."""
    frames = _frames(
        [
            DomainEvent(event=KEEPALIVE_EVENT),
            DomainEvent(event="sketch.started", data={"image": "a.png"}),
            DomainEvent(event=CLOSE_EVENT),
        ]
    )

    assert frames == [
        ": \n\n",  # initial flush
        ": \n\n",  # keep-alive for the idle bus
        'id: 0\ndata: {"event": "sketch.started", "image": "a.png"}\n\n',
        "event: close\ndata: \n\n",
    ]


def test_discriminant_survives_a_colliding_payload_field() -> None:
    frame = _frames(
        [
            DomainEvent(event="sketch.started", data={EVENT_KEY: "spoofed"}),
            DomainEvent(event=CLOSE_EVENT),
        ]
    )[1]

    assert '"event": "sketch.started"' in frame
    assert "spoofed" not in frame


def test_message_frames_have_no_named_event_field() -> None:
    """Spec: the SSE ``event:`` field is reserved for close/error only."""
    frame = _frames(
        [
            DomainEvent(event="batch.completed", data={"succeeded": 1, "failed": 0}),
            DomainEvent(event=CLOSE_EVENT),
        ]
    )[1]

    assert frame.startswith("id: 0\ndata: ")
    assert not frame.startswith("event:")


def test_close_event_ends_the_stream() -> None:
    """No frames may follow the terminal close frame."""
    frames = _frames(
        [
            DomainEvent(event="sketch.completed", data={"image": "a.png"}),
            DomainEvent(event=CLOSE_EVENT),
            DomainEvent(event="sketch.started", data={"image": "never.png"}),
        ]
    )

    assert frames[-1] == "event: close\ndata: \n\n"
    assert all("never.png" not in frame for frame in frames)


def test_payload_keeps_the_event_name_first() -> None:
    payload = _payload(DomainEvent(event="batch.started", data={"input_dir": "/photos"}))

    assert list(payload) == [EVENT_KEY, "input_dir"]
