"""Ports for publishing events and streaming them to subscribers.

Events flow outward: the application publishes domain events through the
``EventPublisher`` port, and transports (e.g. the Server-Sent-Events endpoint)
read them through the ``EventStream`` port. Both are structurally implemented
by the in-process :class:`~ai_img2sketch.infrastructure.events.async_event_bus.AsyncEventBus`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

#: Reserved event name: synthetic keep-alive yielded by ``EventStream`` while
#: the subscriber is idle. Transports may render it however their protocol
#: dictates (SSE turns it into an anonymous comment).
KEEPALIVE_EVENT = "ping"

#: Reserved event name: terminal event yielded after the stream shuts down.
#: Transports must stop iterating once it arrives.
CLOSE_EVENT = "close"


@dataclass(frozen=True)
class DomainEvent:
    """A single transport-agnostic domain event."""

    event: str
    data: Mapping[str, object] = field(default_factory=dict)


@runtime_checkable
class EventPublisher(Protocol):
    """Publishes events to whatever transport is plugged in at the edge."""

    async def publish(self, event: str, data: Mapping[str, object]) -> None:
        """Fan ``event`` out to current subscribers."""
        ...


@runtime_checkable
class EventStream(Protocol):
    """Read side used by transports that push events to clients (e.g. SSE).

    Declared with ``def`` (not ``async def``): the returned object is iterated
    with ``async for``, which is exactly what async generators produce. The
    stream is terminated by the reserved :data:`CLOSE_EVENT` event and may
    yield :data:`KEEPALIVE_EVENT` during silence.
    """

    def subscribe(self) -> AsyncIterator[DomainEvent]:
        """Yield events until the subscriber disconnects or the stream ends."""
        ...
