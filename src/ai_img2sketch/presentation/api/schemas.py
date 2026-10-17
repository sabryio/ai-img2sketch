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
    """Optional generation settings; mirrors the CLI flags, nothing more."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    frame_rate: int | None = Field(default=None, ge=1, le=120)
    split_len: int | None = Field(default=None, ge=1, le=100)
    object_skip_rate: int | None = Field(default=None, ge=1, le=100)
    draw_duration_sec: float | None = Field(default=None, ge=0.1, le=600.0)
    end_duration_sec: int | None = Field(default=None, ge=0, le=10)


class SketchRequest(BaseModel):
    """Payload of ``POST /api/v1/sketches``."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    image_path: str = Field(min_length=1, description="Path to the source image")
    output_dir: str | None = Field(default=None, min_length=1)
    config: SketchOptions = Field(default_factory=SketchOptions)
    object_mask_path: str | None = Field(default=None, min_length=1)


class BatchSketchRequest(BaseModel):
    """Payload of ``POST /api/v1/sketches/batch``."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    input_dir: str = Field(min_length=1, description="Folder of images to process")
    output_dir: str | None = Field(default=None, min_length=1)
    config: SketchOptions = Field(default_factory=SketchOptions)
    object_mask_path: str | None = Field(default=None, min_length=1)


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
