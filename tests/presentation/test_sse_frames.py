"""Unit tests for ORPCSseStream — oRPC AsyncIteratorObject wire format."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from typing import Any

from ai_img2sketch.infrastructure.sse import ORPCSseStream, SseItem


# ---------------------------------------------------------------------------
# Frame builder tests  (static helpers — pure string construction)
# ---------------------------------------------------------------------------


def test_comment_frame() -> None:
    assert ORPCSseStream.build_comment() == ": \n\n"
    assert ORPCSseStream.build_comment("ping") == ": ping\n\n"


def test_message_frame_without_seq() -> None:
    frame = ORPCSseStream.build_message({"event": "sketch.started", "image": "a.png"})
    assert frame == 'data: {"event": "sketch.started", "image": "a.png"}\n\n'


def test_message_frame_with_seq() -> None:
    frame = ORPCSseStream.build_message({"x": 1}, seq=3)
    assert frame == 'id: 3\ndata: {"x": 1}\n\n'


def test_close_frame_empty() -> None:
    assert ORPCSseStream.build_close() == "event: close\ndata: \n\n"


def test_close_frame_with_data() -> None:
    frame = ORPCSseStream.build_close({"ok": True})
    assert frame == 'event: close\ndata: {"ok": true}\n\n'


def test_error_frame() -> None:
    frame = ORPCSseStream.build_error({"message": "boom"})
    assert frame == 'event: error\ndata: {"message": "boom"}\n\n'


# ---------------------------------------------------------------------------
# Streaming integration tests
# ---------------------------------------------------------------------------


async def _collect(source: AsyncGenerator[SseItem, None]) -> list[str]:
    """Drive ORPCSseStream.frames() to completion and return all chunks."""
    return [chunk async for chunk in ORPCSseStream(source).frames()]


def test_initial_comment_is_first_frame() -> None:
    async def source() -> AsyncGenerator[dict[str, Any], None]:
        yield {"event": "sketch.started"}

    chunks = asyncio.run(_collect(source()))

    assert chunks[0] == ": \n\n"


def test_message_frames_carry_discriminant() -> None:
    async def source() -> AsyncGenerator[dict[str, Any], None]:
        yield {"event": "sketch.started", "image": "a.png", "output_path": "a.mp4"}
        yield {"event": "sketch.completed", "image": "a.png", "output_path": "a.mp4"}

    chunks = asyncio.run(_collect(source()))

    # chunks: [initial, msg1, msg2, close]
    assert '"event": "sketch.started"' in chunks[1]
    assert '"event": "sketch.completed"' in chunks[2]


def test_generator_return_emits_close_frame() -> None:
    async def source() -> AsyncGenerator[dict[str, Any], None]:
        yield {"event": "batch.started", "input_dir": "/photos"}

    chunks = asyncio.run(_collect(source()))

    assert chunks[-1] == "event: close\ndata: \n\n"


def test_done_sentinel_emits_close_frame_and_stops() -> None:
    async def source() -> AsyncGenerator[SseItem, None]:
        yield {"event": "sketch.started", "image": "a.png", "output_path": "a.mp4"}
        yield ORPCSseStream.done()
        yield {
            "event": "sketch.completed",
            "image": "a.png",
            "output_path": "a.mp4",
        }  # never reached

    chunks = asyncio.run(_collect(source()))

    # initial + message + close — the post-done yield is never reached
    assert len(chunks) == 3
    assert chunks[-1] == "event: close\ndata: \n\n"


def test_error_exception_emits_error_frame_and_stops() -> None:
    async def source() -> AsyncGenerator[dict[str, Any], None]:
        yield {"event": "sketch.started", "image": "a.png", "output_path": "a.mp4"}
        raise ORPCSseStream.Error({"message": "render failed"})

    chunks = asyncio.run(_collect(source()))

    assert chunks[-1] == 'event: error\ndata: {"message": "render failed"}\n\n'
    # no close frame after error
    assert "event: close" not in chunks[-1]


def test_seq_increments_across_messages() -> None:
    async def source() -> AsyncGenerator[dict[str, Any], None]:
        for i in range(3):
            yield {"event": "tick", "i": i}

    chunks = asyncio.run(_collect(source()))
    messages = chunks[1:-1]  # strip initial and close

    for idx, chunk in enumerate(messages):
        assert chunk.startswith(f"id: {idx}\n")


def test_custom_initial_comment() -> None:
    async def source() -> AsyncGenerator[dict[str, Any], None]:
        return
        yield  # make it a generator

    async def run() -> list[str]:
        return [c async for c in ORPCSseStream(source(), initial_comment="connected").frames()]

    chunks = asyncio.run(run())
    assert chunks[0] == ": connected\n\n"
