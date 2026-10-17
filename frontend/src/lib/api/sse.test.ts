import { beforeEach, describe, expect, it, vi } from "vitest";
import { SSEClient } from "./sse";
import {
  SketchCompletedEvent,
  SketchFailedEvent,
  BatchCompletedEvent,
} from "./types";

// Mock implementation of EventSource
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  public readyState: number = MockEventSource.CONNECTING;
  public onopen: ((e: Event) => void) | null = null;
  public onerror: ((e: Event) => void) | null = null;
  private listeners: Map<string, Array<(e: Event) => void>> = new Map();

  constructor(public url: string) {
    // Simulate connection open asynchronously
    setTimeout(() => {
      this.readyState = MockEventSource.OPEN;
      if (this.onopen) this.onopen(new Event("open"));
    }, 10);
  }

  public addEventListener(event: string, handler: (e: Event) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  public removeEventListener(event: string, handler: (e: Event) => void) {
    const list = this.listeners.get(event);
    if (list) {
      this.listeners.set(
        event,
        list.filter((h) => h !== handler),
      );
    }
  }

  public close() {
    this.readyState = MockEventSource.CLOSED;
  }

  // Helper method to emit events for tests
  public emitNamedEvent(eventName: string, dataObj: unknown) {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      const event = new MessageEvent(eventName, {
        data: JSON.stringify(dataObj),
      });
      handlers.forEach((h) => h(event));
    }
  }

  public emitError(connectingState = true) {
    this.readyState = connectingState
      ? MockEventSource.CONNECTING
      : MockEventSource.CLOSED;
    if (this.onerror) this.onerror(new Event("error"));
  }
}

describe("SSEClient Unit Tests", () => {
  let client: SSEClient;
  let mockSource: MockEventSource;

  beforeEach(() => {
    client = new SSEClient();
  });

  it("transitions state to connecting then online", async () => {
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    // Connect with mock class
    client.connect(
      "http://localhost:8000",
      MockEventSource as unknown as { new (url: string): EventSource },
    );

    expect(client.getState()).toBe("connecting");

    // Wait for mock onopen
    await new Promise((r) => setTimeout(r, 20));
    expect(client.getState()).toBe("online");
  });

  it("receives sketch.completed named event and parses payload", async () => {
    let receivedPayload: SketchCompletedEvent | null = null;

    client.on("sketch.completed", (payload) => {
      receivedPayload = payload;
    });

    let createdSource: MockEventSource | null = null;
    const MockSourceFactory = class extends MockEventSource {
      constructor(url: string) {
        super(url);
        createdSource = this;
      }
    };

    client.connect(
      "http://localhost:8000",
      MockSourceFactory as unknown as { new (url: string): EventSource },
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(createdSource).not.toBeNull();

    const fixturePayload: SketchCompletedEvent = {
      image_path: "/app/media/cat.png",
      output_path: "/app/output/cat_sketch.mp4",
      duration_sec: 5.2,
      id: "req-123",
    };

    createdSource!.emitNamedEvent("sketch.completed", fixturePayload);

    expect(receivedPayload).toEqual(fixturePayload);
  });

  it("receives batch.completed event with correct counters", async () => {
    let batchResult: BatchCompletedEvent | null = null;

    client.on("batch.completed", (payload) => {
      batchResult = payload;
    });

    let createdSource: MockEventSource | null = null;
    const MockSourceFactory = class extends MockEventSource {
      constructor(url: string) {
        super(url);
        createdSource = this;
      }
    };

    client.connect(
      "http://localhost:8000",
      MockSourceFactory as unknown as { new (url: string): EventSource },
    );

    await new Promise((r) => setTimeout(r, 20));

    const fixtureBatch: BatchCompletedEvent = {
      input_dir: "/app/media/batch1",
      succeeded: 4,
      failed: 1,
      total: 5,
    };

    createdSource!.emitNamedEvent("batch.completed", fixtureBatch);

    expect(batchResult).toEqual(fixtureBatch);
  });

  it("transitions to reconnecting on error when readyState is CONNECTING", async () => {
    let createdSource: MockEventSource | null = null;
    const MockSourceFactory = class extends MockEventSource {
      constructor(url: string) {
        super(url);
        createdSource = this;
      }
    };

    client.connect(
      "http://localhost:8000",
      MockSourceFactory as unknown as { new (url: string): EventSource },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(client.getState()).toBe("online");

    createdSource!.emitError(true);
    expect(client.getState()).toBe("reconnecting");
  });

  it("closes cleanly on close()", () => {
    client.connect(
      "http://localhost:8000",
      MockEventSource as unknown as { new (url: string): EventSource },
    );
    client.close();
    expect(client.getState()).toBe("closed");
  });
});
