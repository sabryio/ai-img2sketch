"""Request/response DTOs for the web API.

These are boundary objects: interface adapters translate them into domain value
objects and use-case results, keeping HTTP out of the application layer. The
shapes mirror what the SSE events carry so both channels read the same.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Liveness payload of ``GET /api/v1/health``."""

    model_config = ConfigDict(frozen=True)

    status: str = "ok"


class SketchOptions(BaseModel):
    """Optional generation settings; every domain knob is settable here."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    frame_rate: int | None = Field(default=None, ge=1, le=120)
    split_len: int | None = Field(default=None, ge=1, le=100)
    object_skip_rate: int | None = Field(default=None, ge=1, le=100)
    draw_duration_sec: float | None = Field(default=None, ge=0.1, le=600.0)
    end_duration_sec: int | None = Field(default=None, ge=0, le=10)
    black_pixel_threshold: int | None = Field(default=None, ge=0, le=255)


class SketchRequest(BaseModel):
    """Payload of ``POST /api/v1/sketches``.

    ``hand_image_path`` / ``hand_mask_path`` optionally point at custom
    drawing-hand assets; when omitted the bundled assets are used.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    image_path: str = Field(min_length=1, description="Path to the source image")
    output_dir: str | None = Field(default=None, min_length=1)
    config: SketchOptions = Field(default_factory=SketchOptions)
    object_mask_path: str | None = Field(default=None, min_length=1)
    hand_image_path: str | None = Field(default=None, min_length=1)
    hand_mask_path: str | None = Field(default=None, min_length=1)


class BatchSketchRequest(BaseModel):
    """Payload of ``POST /api/v1/sketches/batch`` (same options, per directory)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    input_dir: str = Field(min_length=1, description="Folder of images to process")
    output_dir: str | None = Field(default=None, min_length=1)
    config: SketchOptions = Field(default_factory=SketchOptions)
    object_mask_path: str | None = Field(default=None, min_length=1)
    hand_image_path: str | None = Field(default=None, min_length=1)
    hand_mask_path: str | None = Field(default=None, min_length=1)


class SketchResult(BaseModel):
    """Outcome of a single generation."""

    model_config = ConfigDict(frozen=True)

    output_path: str


class BatchSketchItem(BaseModel):
    """Per-image outcome of a batch run."""

    model_config = ConfigDict(frozen=True)

    image: str
    output_path: str | None = None
    error: str | None = None


class BatchSketchResult(BaseModel):
    """Outcome of a batch run (same items the ``batch.completed`` event carries)."""

    model_config = ConfigDict(frozen=True)

    input_dir: str
    items: list[BatchSketchItem]


class StoreMediaRequest(BaseModel):
    """Payload of ``POST /api/v1/media``.

    Base64 inside JSON rather than multipart: the client speaks one JSON
    transport (oRPC) for every call, and a browser-selected photo is small
    enough that the encoding overhead does not matter.

    ``directory`` lets several uploads share one folder, which is what a batch
    run needs; it is a client-chosen bucket name, so it is strictly validated.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1)
    directory: str | None = Field(
        default=None,
        max_length=32,
        pattern=r"^[a-z0-9][a-z0-9-]*$",
        description="Bucket so several uploads can land in one folder",
    )


class StoredMedia(BaseModel):
    """Result of ``POST /api/v1/media``: a path the backend can read right away."""

    model_config = ConfigDict(frozen=True)

    path: str
