"""Unit tests for the in-process asynchronous event bus."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest

import ai_img2sketch.infrastructure.events.async_event_bus as bus_module
from ai_img2sketch.application.ports.event_publisher import (
    DomainEvent,
    EventPublisher,
    EventStream,
)
from ai_img2sketch.infrastructure.events.async_event_bus import AsyncEventBus


async def _drain(stream: AsyncGenerator[DomainEvent, None], count: int) -> list[DomainEvent]:
    """Fetch ``count`` events, then unsubscribe cleanly."""
    collected: list[DomainEvent] = []
    for _ in range(count):
        collected.append(await stream.__anext__())
    await stream.aclose()
    return collected


def test_pub_sub_delivers_events_in_order() -> None:
    async def scenario() -> list[DomainEvent]:
        bus = AsyncEventBus()
        stream = bus.subscribe()  # attached eagerly, before any publish
        await bus.publish("sketch.started", {"image": "a.png"})
        await bus.publish("batch.started", {})
        return await _drain(stream, 2)

    events = asyncio.run(scenario())

    assert [event.event for event in events] == ["sketch.started", "batch.started"]
    assert events[0].data == {"image": "a.png"}


def test_keepalive_keeps_idle_streams_alive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bus_module, "_KEEPALIVE_AFTER_SECONDS", 0.02)

    async def scenario() -> list[DomainEvent]:
        bus = AsyncEventBus()
        stream = bus.subscribe()
        await bus.publish("sketch.completed", {})
        return await _drain(stream, 2)  # first the event, then the idle keep-alive

    events = asyncio.run(scenario())

    assert [event.event for event in events] == ["sketch.completed", "keepalive"]


def test_close_is_delivered_to_subscribers() -> None:
    async def scenario() -> list[DomainEvent]:
        bus = AsyncEventBus()
        stream = bus.subscribe()
        await bus.publish("sketch.started", {})
        await bus.close()
        return await _drain(stream, 2)

    events = asyncio.run(scenario())

    assert [event.event for event in events] == ["sketch.started", "close"]


def test_subscribe_registers_synchronously() -> None:
    async def scenario() -> list[DomainEvent]:
        bus = AsyncEventBus()
        stream = bus.subscribe()  # no pull yet — subscriber must already count
        await bus.publish("sketch.started", {})  # cannot be missed
        return await _drain(stream, 1)

    events = asyncio.run(scenario())

    assert [event.event for event in events] == ["sketch.started"]


def test_publish_with_no_subscribers_is_not_an_error() -> None:
    async def scenario() -> None:
        bus = AsyncEventBus()
        await bus.publish("sketch.started", {"image": "a.png"})

    asyncio.run(scenario())


def test_publish_snapshots_the_payload() -> None:
    """Callers may reuse/mutate their dict after publishing (sketch.* handlers do)."""

    async def scenario() -> DomainEvent:
        bus = AsyncEventBus()
        stream = bus.subscribe()
        payload: dict[str, object] = {"image": "a.png"}
        await bus.publish("sketch.started", payload)
        payload["error"] = "late mutation"  # must not leak into the queued event
        event = await stream.__anext__()
        await stream.aclose()
        return event

    event = asyncio.run(scenario())

    assert event.data == {"image": "a.png"}


def test_bus_satisfies_the_application_ports() -> None:
    bus = AsyncEventBus()

    publisher: EventPublisher = bus
    stream: EventStream = bus

    assert publisher is not None
    assert stream is not None


def test_keepalive_constant_is_positive() -> None:
    assert bus_module._KEEPALIVE_AFTER_SECONDS > 0
