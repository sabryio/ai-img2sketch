"""Ports for publishing events and streaming them to subscribers.

Events flow anually outward: the application publishes domain events through
the ``EventPublisher`` port, and transports (e.g. the Server-Sent-Events
endpoint) read them through the ``EventStream`` port. Both are structurally
implemented by the in-process :class:`~ai_img2sketch.infrastructure.events.async_event_bus.AsyncEventBus`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class DomainEvent:
    """A single transport-agnostic event."""

    event: str
    data: Mapping[str, Any] = field(default_factory=dict)


class EventPublisher(Protocol):
    """Publishes events to whatever transport is plugged in at the edge."""

    async def publish(self, event: str, data: Mapping[str, Any]) -> None:
        """Fan ``event`` out to current subscribers."""
        ...


class EventStream(Protocol):
    """Read side used by transports that push events to clients (e.g. SSE).

    Declared with ``def`` (not ``async def``): the returned object is iterated
    with ``async for``, which is exactly what async generators produce.
    """

    def subscribe(self) -> AsyncIterator[DomainEvent]:
        """Yield events until the subscriber disconnects."""
        ...
