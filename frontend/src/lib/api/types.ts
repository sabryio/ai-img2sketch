/**
 * DTOs mirroring docs/api.md and FastAPI models for AI-Img2Sketch
 */

export interface SketchConfig {
  /** Frame rate of the output sketch video (1-120, default 25) */
  frame_rate?: number;
  /** Length of segment split for stroke processing (1-100, default 10) */
  split_len?: number;
  /** Object skip rate for edge detection complexity (1-100, default 8) */
  object_skip_rate?: number;
  /** Target drawing duration in seconds (0.1-600, optional) */
  draw_duration_sec?: number | null;
  /** End freeze frame duration in seconds (0-10, default 2) */
  end_duration_sec?: number;
  /** Threshold for detecting black pixels (0-255, default 10, rarely touched) */
  black_pixel_threshold?: number;
}

export interface SketchRequest {
  image_path: string;
  object_mask_path?: string | null;
  hand_image_path?: string | null;
  hand_mask_path?: string | null;
  output_dir?: string | null;
  config?: SketchConfig;
}

export interface SketchResponse {
  output_path: string;
  duration_sec?: number;
  frame_count?: number;
  image_path?: string;
  status?: string;
}

export interface BatchSketchRequest {
  input_dir: string;
  output_dir?: string | null;
  object_mask_path?: string | null;
  hand_image_path?: string | null;
  hand_mask_path?: string | null;
  config?: SketchConfig;
}

export interface BatchItemResult {
  image: string;
  output_path?: string | null;
  error?: string | null;
}

export interface BatchSketchResponse {
  items: BatchItemResult[];
  total?: number;
  succeeded?: number;
  failed?: number;
  input_dir?: string;
}

export interface HealthResponse {
  status: string;
  version?: string;
  uptime_sec?: number;
}

export interface FastAPIValidationErrorDetail {
  loc?: (string | number)[];
  msg: string;
  type?: string;
}

export interface FastAPIErrorPayload {
  detail?: string | FastAPIValidationErrorDetail[];
  message?: string;
  error?: string;
}

export interface AppError {
  status?: number;
  message: string;
  verbatim?: string;
  mode?: "docker" | "sidecar";
  isPathVisibilityError?: boolean;
}

// SSE Event types
export interface SketchStartedEvent {
  image_path: string;
  id?: string;
  timestamp?: string | number;
}

export interface SketchCompletedEvent {
  image_path: string;
  output_path: string;
  duration_sec?: number;
  id?: string;
}

export interface SketchFailedEvent {
  image_path: string;
  error: string;
  id?: string;
}

export interface BatchStartedEvent {
  input_dir: string;
  total_files?: number;
}

export interface BatchCompletedEvent {
  input_dir: string;
  succeeded: number;
  failed: number;
  total: number;
}

export interface BatchFailedEvent {
  input_dir: string;
  error: string;
}

export type SSEEventMap = {
  "sketch.started": SketchStartedEvent;
  "sketch.completed": SketchCompletedEvent;
  "sketch.failed": SketchFailedEvent;
  "batch.started": BatchStartedEvent;
  "batch.completed": BatchCompletedEvent;
  "batch.failed": BatchFailedEvent;
};

export type SSEEventName = keyof SSEEventMap;
