# oRPC SSE / AsyncIteratorObject Wire Format

> Reference for implementing a backend in **any language** that is compatible
> with `asyncIteratorObject` on the oRPC frontend client.

---

## Sources

| Source                                                | URL                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@standard-server/core` README (event-stream section) | https://github.com/middleapi/standard-server                                                         |
| `OpenAPILinkCodec` source                             | https://github.com/unnoq/orpc/blob/main/packages/openapi/src/adapters/standard/openapi-link-codec.ts |
| `OpenAPILink` (fetch adapter)                         | https://github.com/unnoq/orpc/blob/main/packages/openapi/src/adapters/fetch/openapi-link.ts          |
| `toEventStream` / `toAsyncIteratorObject` (compiled)  | `node_modules/@standard-server/fetch/dist/index.mjs`                                                 |
| `encodeEventStreamMessage` (compiled)                 | `node_modules/@standard-server/core/dist/index.mjs`                                                  |
| oRPC AsyncIteratorObject docs                         | https://orpc.dev/docs/async-iterator-object                                                          |
| oRPC OpenAPI Handler docs (eventStream options)       | https://orpc.dev/docs/openapi/openapi-handler                                                        |

---

## How the client detects an event-stream response

`OpenAPILinkCodec.decodeResponse` calls `response.resolveBody(meta?.responseBodyHint)`.

The body hint is resolved from the response `Content-Type` header via
`resolveStandardBodyHint()` ([source][standard-server]):

```
Content-Type: text/event-stream  →  hint = "event-stream"
```

When the hint is `"event-stream"`, `toAsyncIteratorObject(response.body)` is called,
which pipes the raw stream through `EventStreamDecoderStream` and converts it into an
`AsyncIteratorObject` that the frontend iterates with `for await`.

---

## Required response headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
```

`Transfer-Encoding: chunked` is implied for HTTP/1.1. For HTTP/2 framing is
handled by the transport. No `Content-Length` header — the body is unbounded.

---

## Frame sequence

```
: <any comment>                ← 1. Initial flush frame (optional but recommended)
                                  Sent immediately so headers reach the client before
                                  the first real event. An empty comment (": \n\n")
                                  is the oRPC default.

data: <json>\n\n               ← 2..N  Message frames  (one per yielded value)
                                  OR with optional metadata:
event: message\n               ←   (may be omitted — "message" is the SSE default)
id: <string>\n
retry: <ms integer>\n
data: <json>\n\n

: <any comment>                ← Keep-alive frames, sent periodically during silence
                                  (oRPC default: every 15 000 ms, empty comment)

event: error\n                 ← Error frame  (stream threw an ErrorEvent)
data: <json>\n\n

event: close\n                 ← Terminal frame  (stream returned / generator done)
data: <json or empty>\n\n      ←   oRPC client treats this as { done: true }
```

---

## Frame-by-frame rules (from `encodeEventStreamMessage`)

```
[: <comment>\n]...             optional; one line per comment string

[event: <name>\n]              omitted when name == "message" AND data is present
                               (SSE spec default; reduces byte count for the common case)

[retry: <integer>\n]           opt-in; non-negative integer milliseconds

[id: <string>\n]               opt-in; must not contain \r \n or NULL

data: <value>\n                required; multi-line values are split:
                               each embedded newline becomes \ndata:

\n                             blank line = end of frame
```

---

## Data encoding rules

Every `data:` value **must be valid JSON**, produced by the language-native
equivalent of `JSON.stringify`. Objects, arrays, strings, numbers, booleans,
and `null` are all valid.

```
# scalar
data: 42

# object (most common)
data: {"event":"started","image":"/app/photo.jpg","output_path":"/app/out.mp4"}

# empty close
data:
```

There is **no oRPC envelope** — the value is the raw payload the server yields.

---

## Event name semantics (client decode table)

| SSE `event:` field   | oRPC client behaviour                                                 |
| -------------------- | --------------------------------------------------------------------- |
| `message` or omitted | `JSON.parse(data)` → yielded to `for await` loop                      |
| `error`              | `JSON.parse(data)` → thrown as `ErrorEvent`                           |
| `close`              | `JSON.parse(data)` → iterator returns `{ done: true, value: <data> }` |
| any comment (`:`)    | silently ignored; never reaches application code                      |

**Any other event name is silently skipped.** Domain-event type information
must therefore live **inside the `data` JSON**, not in the SSE `event:` field.

---

## Discriminating event types in the payload

Because all application events arrive as `event: message`, a discriminant
field inside the JSON is the only way to tell them apart on the client.

### Recommended: add an `"event"` key to every payload

```jsonc
// started
{ "event": "started", "image": "/a.jpg", "output_path": "/a.mp4" }

// batch.completed
{ "event": "batch.completed", "input_dir": "/photos", "succeeded": 3, "failed": 1 }
```

This pairs naturally with a Zod `discriminatedUnion("event", [...])` schema in the
oRPC contract.

---

## Complete SSE session example

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

: \n\n                                              ← initial flush (empty comment)

data: {"event":"started","image":"/a.jpg","output_path":"/a.mp4"}\n\n

: \n\n                                              ← keep-alive after 15 s silence

data: {"event":"completed","image":"/a.jpg","output_path":"/a.mp4"}\n\n

event: close\n
data: \n\n                                          ← terminal frame
```

---

## What the client does NOT support

- Named `event:` values other than `message`, `error`, `close` — all others
  are dropped in the `switch` inside `toAsyncIteratorObject`.
- Automatic reconnection (`EventSource`-style `retry:` + `Last-Event-ID`
  reconnect) is **not** automatic. The oRPC client passes `lastEventId` in the
  request header if provided, but reconnection must be triggered manually.
- The `standard-server` hint header is set automatically by the TypeScript
  server; a foreign backend using raw `text/event-stream` content type does
  not need it — `resolveStandardBodyHint` falls through to content-type
  inference and picks `"event-stream"` correctly.

---

## Minimal Python implementation sketch

```python
import json
from collections.abc import AsyncIterator
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

def _frame(data: dict) -> str:
    """One oRPC-compatible SSE message frame."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

def _close_frame() -> str:
    return "event: close\ndata: \n\n"

def _comment(text: str = "") -> str:
    return f": {text}\n\n"

async def _stream(bus) -> AsyncIterator[str]:
    events = bus.subscribe()              # attach before the first frame
    yield _comment()                      # initial flush
    async for event in events:
        if event.event == "close":
            yield _close_frame()
            return
        if event.event == "ping":
            yield _comment()              # keep-alive
            continue
        # inject the discriminant AND keep it authoritative: a payload field
        # named "event" must never clobber the real event name.
        extras = {k: v for k, v in event.data.items() if k != "event"}
        yield _frame({"event": event.event, **extras})

router = APIRouter()

@router.get("/events")
async def stream_events():
    return StreamingResponse(
        _stream(bus),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

---

## Minimal TypeScript / Node.js implementation sketch

The native approach using `@orpc/server` and `@orpc/openapi` — this is the
reference implementation the wire format was derived from.

```typescript
import { os } from "@orpc/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { asyncIteratorObject } from "@orpc/contract";
import { withEventMeta } from "@orpc/server";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

// ----- Contract -----

const EventDataSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("started"),
    image: z.string(),
    output_path: z.string(),
  }),
  z.object({
    event: z.literal("completed"),
    image: z.string(),
    output_path: z.string(),
  }),
  z.object({
    event: z.literal("failed"),
    image: z.string(),
    error: z.string(),
  }),
]);

const contract = oc.router({
  streamEvents: oc
    .meta(openapi({ method: "GET", path: "/events" }))
    .input(z.void())
    .output(asyncIteratorObject(EventDataSchema)),
});

// ----- Implementation -----
// os.contract(contract.streamEvents) wires the contract to the handler.
// The generator yields plain objects; oRPC serialises them as:
//   data: <json>\n\n          (event: message, omitted)
// and on return:
//   event: close\ndata: \n\n

const router = {
  streamEvents: os.contract(contract.streamEvents).handler(async function* ({
    signal,
  }) {
    // withEventMeta attaches id/retry metadata without changing the
    // visible shape of the yielded value.
    let seq = 0;

    try {
      while (true) {
        signal?.throwIfAborted();

        yield withEventMeta(
          {
            event: "started" as const,
            image: "/a.jpg",
            output_path: "/a.mp4",
          },
          { id: String(seq++), retry: 5000 },
        );

        // simulate async work
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      // cleanup on disconnect or abort
    }
  }),
};

// ----- Server -----

const handler = new OpenAPIHandler(router, {
  toFetchResponse: {
    eventStream: {
      initialComment: { enabled: true, comment: "" }, // ": \n\n" flush frame
      keepAlive: { enabled: true, interval: 15000, comment: "" },
    },
  },
});

// Attach to any Fetch-compatible runtime (Bun, Deno, Cloudflare Workers, etc.)
export default {
  fetch: (req: Request) => handler.handle(req),
};
```

### Without oRPC server — raw Fetch API (portable, no dependencies)

When you only have a Fetch-based runtime and want zero framework overhead,
build the stream by hand while staying wire-compatible:

```typescript
export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  // Helper builders — mirror encodeEventStreamMessage exactly
  const comment = (text = "") => encoder.encode(`: ${text}\n\n`);
  const message = (data: object, id?: string) => {
    let frame = "";
    if (id !== undefined) frame += `id: ${id}\n`;
    frame += `data: ${JSON.stringify(data)}\n\n`;
    return encoder.encode(frame);
  };
  const close = () => encoder.encode("event: close\ndata: \n\n");

  let seq = 0;
  let keepAliveTimer: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(comment()); // initial flush

      keepAliveTimer = setInterval(
        () => controller.enqueue(comment()), // keep-alive every 15 s
        15_000,
      );

      // yield application events — event name lives inside the JSON
      controller.enqueue(
        message(
          { event: "started", image: "/a.jpg", output_path: "/a.mp4" },
          String(seq++),
        ),
      );

      await new Promise((r) => setTimeout(r, 1000));

      controller.enqueue(
        message(
          { event: "completed", image: "/a.jpg", output_path: "/a.mp4" },
          String(seq++),
        ),
      );

      clearInterval(keepAliveTimer);
      controller.enqueue(close()); // terminal frame
      controller.close();
    },
    cancel() {
      clearInterval(keepAliveTimer); // client disconnected
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
```

---

## Minimal Rust / Axum implementation sketch

```rust
// Each application event → event: message (omitted) + data: JSON
// Keep-alive            → : \n\n  comment
// Terminal              → event: close\ndata: \n\n

async fn stream_events() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let initial = tokio_stream::iter([Ok(Event::default().comment(""))]);  // flush

    let events = /* your bus stream */
        .map(|evt| {
            let json = serde_json::to_string(&json!({
                "event": evt.name,
                // ...rest of payload
            })).unwrap();
            Ok(Event::default().data(json))   // no .event() → defaults to "message"
        })
        .chain(tokio_stream::iter([
            Ok(Event::default().event("close").data(""))
        ]));

    Sse::new(initial.chain(events))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text(""))
}
```
