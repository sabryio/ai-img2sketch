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

#: Reserved event names with which ``EventStream`` marks *stream lifecycle*
#: rather than a domain occurrence. Their values are in-process sentinels only —
#: each transport renders its own wire form, so neither value is ever sent to a
#: client (SSE renders :data:`KEEPALIVE_EVENT` as an anonymous, empty comment
#: and :data:`CLOSE_EVENT` as an ``event: close`` frame).
#:
#: :data:`KEEPALIVE_EVENT` — synthetic keep-alive yielded while the subscriber is
#: idle, so proxies and webviews do not time the connection out.
KEEPALIVE_EVENT = "keepalive"

#: :data:`CLOSE_EVENT` — terminal event yielded after the stream shuts down.
#: Transports must stop iterating once it arrives.
CLOSE_EVENT = "close"

#: JSON key under which the event name is carried in serialised payloads.
#: Transports that cannot use a per-type channel (e.g. the oRPC-compatible SSE
#: stream, where every application event arrives as the default ``message``
#: type) put :attr:`DomainEvent.event` here so clients can dispatch with a
#: discriminated union — mirroring the frontend's ``discriminatedUnion("event",
#: [...])`` schema. The domain event name is authoritative: a payload field of
#: the same name never wins.
EVENT_KEY = "event"


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
