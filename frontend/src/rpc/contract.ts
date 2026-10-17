import { asyncIteratorObject, oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

/**
 * The single source of truth for every payload crossing the HTTP boundary.
 *
 * Schemas are exported (not just inferred types) so components and forms can
 * re-use them, and so the compile-time types below can never drift from what
 * the server actually accepts or returns.
 */

// ===== Shared schemas =====

export const SketchOptionsSchema = z.object({
  frame_rate: z.number().int().min(1).max(120).optional(),
  split_len: z.number().int().min(1).max(100).optional(),
  object_skip_rate: z.number().int().min(1).max(100).optional(),
  draw_duration_sec: z.number().min(0.1).max(600).optional(),
  end_duration_sec: z.number().int().min(0).max(10).optional(),
  black_pixel_threshold: z.number().int().min(0).max(255).optional(),
});

export const SketchRequestSchema = z.object({
  image_path: z.string().min(1),
  output_dir: z.string().min(1).optional(),
  config: SketchOptionsSchema.optional(),
  object_mask_path: z.string().min(1).optional(),
  hand_image_path: z.string().min(1).optional(),
  hand_mask_path: z.string().min(1).optional(),
});

export const BatchSketchRequestSchema = z.object({
  input_dir: z.string().min(1),
  output_dir: z.string().min(1).optional(),
  config: SketchOptionsSchema.optional(),
  object_mask_path: z.string().min(1).optional(),
  hand_image_path: z.string().min(1).optional(),
  hand_mask_path: z.string().min(1).optional(),
});

export const SketchResultSchema = z.object({
  output_path: z.string(),
});

export const BatchItemSchema = z.object({
  image: z.string(),
  output_path: z.string().nullable(),
  error: z.string().nullable(),
});

export const BatchSketchResultSchema = z.object({
  input_dir: z.string(),
  items: z.array(BatchItemSchema),
});

export const HealthSchema = z.object({
  status: z.literal("ok"),
});

/**
 * One event from `GET /api/v1/events`, as a discriminated union on the
 * `"event"` field the server injects into every payload.
 *
 * The wire format (`docs/orpc-sse-wire-format.md`) carries the discriminant
 * *inside* the JSON: application frames have no SSE `event:` name, so this key
 * is what a consumer switches on. Field names match the REST responses and the
 * event catalogue in `docs/api.md`.
 */
export const EventDataSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("sketch.started"),
    image: z.string(),
    output_path: z.string(),
  }),
  z.object({
    event: z.literal("sketch.completed"),
    image: z.string(),
    output_path: z.string(),
  }),
  z.object({
    event: z.literal("sketch.failed"),
    image: z.string(),
    output_path: z.string(),
    error: z.string(),
  }),
  z.object({
    event: z.literal("batch.started"),
    input_dir: z.string(),
  }),
  z.object({
    event: z.literal("batch.completed"),
    input_dir: z.string(),
    succeeded: z.number().int(),
    failed: z.number().int(),
  }),
  z.object({
    event: z.literal("batch.failed"),
    input_dir: z.string(),
    error: z.string(),
  }),
]);

// ===== Contract =====

export const contract = oc.meta(openapi({ prefix: "/api/v1" })).router({
  // GET /api/v1/health
  health: oc
    .meta(openapi({ method: "GET", path: "/health" }))
    .output(HealthSchema),

  // POST /api/v1/sketches
  generateSketch: oc
    .meta(openapi({ method: "POST", path: "/sketches" }))
    .errors({
      NOT_FOUND: {},
      UNPROCESSABLE_CONTENT: {},
      INTERNAL_SERVER_ERROR: {},
    })
    .input(SketchRequestSchema)
    .output(SketchResultSchema),

  // POST /api/v1/sketches/batch
  generateBatch: oc
    .meta(openapi({ method: "POST", path: "/sketches/batch" }))
    .errors({
      NOT_FOUND: {},
      UNPROCESSABLE_CONTENT: {},
      INTERNAL_SERVER_ERROR: {},
    })
    .input(BatchSketchRequestSchema)
    .output(BatchSketchResultSchema),

  // GET /api/v1/events — Server-Sent Events decoded as an async iterator.
  // `asyncIteratorObject` is what makes the client return a typed stream
  // instead of a single JSON body.
  streamEvents: oc
    .meta(openapi({ method: "GET", path: "/events" }))
    .input(z.void())
    .output(asyncIteratorObject(EventDataSchema)),
});

// ===== Type exports =====

export type Health = z.infer<typeof HealthSchema>;
export type SketchOptions = z.infer<typeof SketchOptionsSchema>;
export type SketchRequest = z.infer<typeof SketchRequestSchema>;
export type BatchSketchRequest = z.infer<typeof BatchSketchRequestSchema>;
export type SketchResult = z.infer<typeof SketchResultSchema>;
export type BatchItem = z.infer<typeof BatchItemSchema>;
export type BatchSketchResult = z.infer<typeof BatchSketchResultSchema>;
export type EventData = z.infer<typeof EventDataSchema>;
export type EventName = EventData["event"];
