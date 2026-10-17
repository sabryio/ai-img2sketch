"""Unit tests for the SSE frame protocol (initial, message, close)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from ai_img2sketch.application.ports.event_publisher import DomainEvent
from ai_img2sketch.infrastructure.events.async_event_bus import AsyncEventBus
from ai_img2sketch.presentation.api.routers.events import (
    _sse_frames,
    close_frame,
    initial_frames,
    message_frame,
)


def test_initial_frame_carries_reconnect_hint_and_ack() -> None:
    frames = initial_frames()

    assert frames == "retry: 5000\n\n: connected\n\n"


def test_message_frame_has_name_id_and_json_data() -> None:
    frame = message_frame(DomainEvent(event="sketch.started", data={"image": "a.png"}), sequence=3)

    assert frame == 'event: sketch.started\nid: 3\ndata: {"image": "a.png"}\n\n'


def test_close_frame_is_a_named_end_of_stream() -> None:
    assert close_frame() == "event: close\ndata: \n\n"


def test_stream_starts_with_initial_and_fires_close_last() -> None:
    async def scenario() -> tuple[list[str], bool]:
        bus = AsyncEventBus()
        frames: AsyncIterator[str] = _sse_frames(bus)
        initial = await frames.__anext__()
        await bus.publish("sketch.completed", {"output": "a.mp4"})
        event_frame = await frames.__anext__()
        await bus.publish("close", {})
        final = await frames.__anext__()
        ended = False
        try:
            await frames.__anext__()
        except StopAsyncIteration:
            ended = True
        return [initial, event_frame, final], ended

    frames, ended = asyncio.run(scenario())

    assert "retry: 5000" in frames[0] and ": connected" in frames[0]
    assert frames[1].startswith("event: sketch.completed\nid: 0\n")
    assert frames[2] == "event: close\ndata: \n\n"
    assert ended is True


def test_ping_events_become_keepalive_comments() -> None:
    async def scenario() -> str:
        bus = AsyncEventBus()
        frames: AsyncIterator[str] = _sse_frames(bus)
        await frames.__anext__()  # initial frames
        await bus.publish("ping", {})
        return await frames.__anext__()

    frame = asyncio.run(scenario())

    assert frame == ": keep-alive\n\n"
