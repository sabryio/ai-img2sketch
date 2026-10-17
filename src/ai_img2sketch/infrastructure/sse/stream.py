"""oRPC-compatible Server-Sent Events stream.

``ORPCSseStream`` is a self-contained, framework-agnostic helper for building
SSE responses that are wire-compatible with the oRPC ``asyncIteratorObject``
frontend client.

Wire format (derived from ``@standard-server/fetch`` source):

- The SSE ``event:`` field is **omitted** for application events so browsers
  treat each frame as the default ``"message"`` type — the only value the oRPC
  client decodes as a yielded iterator item.
- The ``event:`` field is only used for the reserved ``"close"`` terminal frame
  and the optional ``"error"`` frame.
- Keep-alives and the initial flush are anonymous comments (``:``) so they are
  silently ignored by the browser and never reach application code. The source
  decides *when* to keep alive (yield ``ORPCSseStream.comment()``); this class
  only renders it — e.g. the bus turns its idle ``ping`` into a comment.

Typical usage inside a FastAPI route::

    from fastapi.responses import StreamingResponse
    from ai_img2sketch.infrastructure.sse import ORPCSseStream

    @router.get("/events")
    async def stream():
        sse = ORPCSseStream(my_async_generator())
        return StreamingResponse(
            sse.frames(),
            media_type="text/event-stream",
            headers=ORPCSseStream.HEADERS,
        )

Or with the built-in ``to_response()`` shortcut::

    @router.get("/events")
    async def stream():
        return ORPCSseStream(my_async_generator()).to_response()

The async generator passed to the constructor must yield ``SseItem`` values —
a plain ``dict`` (a message frame), an ``ORPCSseStream.comment(...)`` sentinel
(an anonymous comment, used for keep-alives), or ``ORPCSseStream.done()``
(terminal ``event: close``).  Any ``"event"`` key already present in a dict is
preserved; for dicts without one the caller is responsible for injecting the
discriminant before yielding.

Termination is signalled by yielding ``ORPCSseStream.done()``, or by the
generator simply raising ``StopAsyncIteration`` (i.e. returning normally).

Error frames are emitted by raising ``ORPCSseStream.Error(data)`` inside the
generator, where *data* is any JSON-serialisable value.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from fastapi.responses import StreamingResponse

# ---------------------------------------------------------------------------
# Sentinel / error types
# ---------------------------------------------------------------------------


@dataclass
class CloseSentinel:
    """Yielded by the source generator to signal a clean end-of-stream.

    Obtain via ``ORPCSseStream.done()`` rather than constructing directly.
    """

    data: Mapping[str, Any] = field(default_factory=dict)


@dataclass
class CommentSentinel:
    """Yielded by the source generator to emit an anonymous ``:`` comment line.

    Comments are ignored by the oRPC client by design; use them for keep-alives
    during silence (obtain via ``ORPCSseStream.comment()``).
    """

    text: str = ""


#: Union of all valid yield types for an ``ORPCSseStream`` source generator.
SseItem = dict[str, Any] | CloseSentinel | CommentSentinel


class ORPCSseError(Exception):
    """Raise inside the source generator to emit an ``event: error`` frame.

    Example::

        async def my_gen():
            try:
                yield {"event": "started"}
            except SomeFailure as exc:
                raise ORPCSseStream.Error({"message": str(exc)}) from exc
    """

    def __init__(self, data: Any = None) -> None:
        super().__init__(str(data))
        self.data = data


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------


class ORPCSseStream:
    """Build an oRPC-compatible SSE stream from any async generator of dicts.

    Parameters
    ----------
    source:
        Async generator that yields :data:`SseItem` values: plain ``dict``
        message frames, ``ORPCSseStream.comment(...)`` comments and
        ``ORPCSseStream.done()``.  Raise :class:`ORPCSseStream.Error` to emit
        an error frame.
    initial_comment:
        Text of the initial flush comment.  Defaults to an empty string
        (the oRPC default: ``": \\n\\n"``).
    """

    # Expose nested types so callers import one name.
    Error = ORPCSseError

    #: Response headers required by every SSE endpoint.
    HEADERS: dict[str, str] = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    }

    def __init__(
        self,
        source: AsyncGenerator[SseItem, None],
        *,
        initial_comment: str = "",
    ) -> None:
        self._source = source
        self._initial_comment = initial_comment

    # ------------------------------------------------------------------
    # Factory helpers
    # ------------------------------------------------------------------

    @staticmethod
    def done(data: Mapping[str, Any] | None = None) -> CloseSentinel:
        """Yield this from the source generator to emit the close frame.

        The optional *data* dict is serialised into the ``event: close`` frame.
        Most callers pass nothing — oRPC ignores the close payload.
        """
        return CloseSentinel(data or {})

    @staticmethod
    def comment(text: str = "") -> CommentSentinel:
        """Yield this from the source generator to emit an anonymous comment.

        The oRPC client ignores comments entirely; they keep idle connections
        alive (the reference server sends one every 15 s of silence).
        """
        return CommentSentinel(text)

    # ------------------------------------------------------------------
    # Frame builders  (static — useful for unit tests)
    # ------------------------------------------------------------------

    @staticmethod
    def build_comment(text: str = "") -> str:
        """``:<text>\\n\\n`` — silently ignored by the oRPC client."""
        return f": {text}\n\n"

    @staticmethod
    def build_message(data: dict[str, Any], *, seq: int | None = None) -> str:
        """``[id: <seq>\\n]data: <json>\\n\\n`` — yielded as an iterator value."""
        prefix = f"id: {seq}\n" if seq is not None else ""
        return f"{prefix}data: {json.dumps(data, ensure_ascii=False)}\n\n"

    @staticmethod
    def build_close(data: Mapping[str, Any] | None = None) -> str:
        """``event: close\\ndata: <json>\\n\\n`` — terminates the iterator."""
        payload = json.dumps(dict(data), ensure_ascii=False) if data else ""
        return f"event: close\ndata: {payload}\n\n"

    @staticmethod
    def build_error(data: Any) -> str:
        """``event: error\\ndata: <json>\\n\\n`` — throws on the client side."""
        return f"event: error\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    # ------------------------------------------------------------------
    # Core streaming logic
    # ------------------------------------------------------------------

    def frames(self) -> AsyncIterator[str]:
        """Return an async iterator of raw SSE text chunks.

        Pass this directly to ``StreamingResponse``::

            StreamingResponse(sse.frames(), media_type="text/event-stream", ...)
        """
        source = self._source
        initial = self.build_comment(self._initial_comment)

        async def _generate() -> AsyncIterator[str]:
            yield initial  # flush headers immediately
            seq = 0
            try:
                async for item in source:
                    if isinstance(item, CloseSentinel):
                        yield self.build_close(item.data)
                        return
                    if isinstance(item, CommentSentinel):
                        yield self.build_comment(item.text)
                        continue
                    yield self.build_message(item, seq=seq)
                    seq += 1
            except ORPCSseError as exc:
                yield self.build_error(exc.data)
                return
            # Generator returned normally → emit close
            yield self.build_close()

        return _generate()

    def to_response(self) -> StreamingResponse:
        """Shortcut: wrap ``frames()`` in a ``StreamingResponse`` ready to return."""
        return StreamingResponse(
            self.frames(),
            media_type="text/event-stream",
            headers=self.HEADERS,
        )
