import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileQuestion,
  Hand,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { SketchOptions } from "../rpc/contract";
import { useStoreMedia } from "../hooks";
import { toAppError } from "../lib/errors";
import { stageFiles } from "../lib/media";
import { planInputPath } from "../lib/paths";
import { pickImageFile, readHostImageFile } from "../lib/tauri";
import { useBackendStore } from "../stores/backend";
import { useNotificationsStore } from "../stores/notifications";

interface AdvancedConfigFormProps {
  config: SketchOptions;
  onChangeConfig: (newConfig: SketchOptions) => void;
  objectMaskPath?: string;
  onChangeObjectMaskPath?: (path: string) => void;
  handImagePath?: string;
  onChangeHandImagePath?: (path: string) => void;
  handMaskPath?: string;
  onChangeHandMaskPath?: (path: string) => void;
  /** Called with each path the form uploaded, so the view can delete it later. */
  onUploaded?: (backendPath: string) => void;
  isBatchMode?: boolean;
}

export const AdvancedConfigForm: React.FC<AdvancedConfigFormProps> = ({
  config,
  onChangeConfig,
  objectMaskPath = "",
  onChangeObjectMaskPath,
  handImagePath = "",
  onChangeHandImagePath,
  handMaskPath = "",
  onChangeHandMaskPath,
  onUploaded,
  isBatchMode = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showRarelyTouched, setShowRarelyTouched] = useState(false);
  const addToast = useNotificationsStore((state) => state.addToast);
  const mode = useBackendStore((state) => state.mode);
  const storeMedia = useStoreMedia();

  const updateField = <K extends keyof SketchOptions>(
    key: K,
    value: SketchOptions[K],
  ) => {
    onChangeConfig({
      ...config,
      [key]: value,
    });
  };

  /**
   * Pick one optional asset image and make sure the backend can read it.
   *
   * A browser only has bytes, and a container never sees the host — so in either
   * case the file is uploaded here and the field keeps the path the API answered
   * with. Only a native backend is handed the host path itself.
   */
  const stagePickedImage = async (
    title: string,
    apply: ((path: string) => void) | undefined,
  ) => {
    if (!apply) {
      return;
    }

    const picked = await pickImageFile({ title });
    if (!picked) {
      return;
    }

    const needsUpload = picked.file
      ? true
      : Boolean(picked.path && planInputPath(picked.path, mode).needsUpload);

    if (!needsUpload && picked.path) {
      apply(picked.path);
      return;
    }

    const file =
      picked.file ??
      (picked.path ? await readHostImageFile(picked.path) : null);
    if (!file) {
      addToast({
        type: "error",
        title: "Could not read the image",
        message: `Failed to read ${picked.path ?? "the picked file"}. Pick it again so the app can upload it.`,
      });
      return;
    }

    try {
      const [storedPath] = await stageFiles([file], (input) =>
        storeMedia.mutateAsync(input),
      );
      apply(storedPath);
      onUploaded?.(storedPath);
    } catch (error) {
      const appError = toAppError(error);
      addToast({
        type: "error",
        title: "Could not upload the image",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    }
  };

  const handlePickObjectMask = async () => {
    await stagePickedImage("Select Object Mask Image", onChangeObjectMaskPath);
  };

  const handlePickHandImage = async () => {
    await stagePickedImage("Select Drawing Hand Image", onChangeHandImagePath);
  };

  const handlePickHandMask = async () => {
    await stagePickedImage("Select Hand Mask Image", onChangeHandMaskPath);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="row group w-full cursor-pointer items-center text-left"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal
            aria-hidden="true"
            className="h-3.5 w-3.5 text-onion"
          />
          <span className="label transition-colors group-hover:text-room-text">
            Advanced Options &amp; Parameters
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="mono tnum text-micro text-room-muted">
            {config.frame_rate || 25} fps &bull; split {config.split_len || 10}
          </span>
          {isOpen ? (
            <ChevronUp
              aria-hidden="true"
              className="h-3.5 w-3.5 text-room-faint"
            />
          ) : (
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 text-room-faint"
            />
          )}
        </span>
      </button>

      {isOpen && (
        <div className="pb-1">
          <div className="row flex-col items-stretch">
            <div className="flex items-baseline justify-between gap-4">
              <label className="label">Frame Rate (FPS)</label>
              <span className="mono tnum text-value text-room-text">
                {config.frame_rate ?? 25} fps
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={120}
              value={config.frame_rate ?? 25}
              onChange={(e) =>
                updateField("frame_rate", Number(e.target.value))
              }
              className="mt-2 w-full accent-pencil"
            />
            <div className="mono mt-1 flex justify-between text-micro text-room-faint">
              <span>1 fps</span>
              <span>Default: 25</span>
              <span>120 fps</span>
            </div>
          </div>

          <div className="row flex-col items-stretch">
            <div className="flex items-baseline justify-between gap-4">
              <label className="label">Stroke Split Length</label>
              <span className="mono tnum text-value text-room-text">
                {config.split_len ?? 10}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={config.split_len ?? 10}
              onChange={(e) =>
                updateField("split_len", Number(e.target.value))
              }
              className="mt-2 w-full accent-pencil"
            />
            <div className="mono mt-1 flex justify-between text-micro text-room-faint">
              <span>1</span>
              <span>Default: 10</span>
              <span>100</span>
            </div>
          </div>

          <div className="row flex-col items-stretch">
            <div className="flex items-baseline justify-between gap-4">
              <label className="label">Object Skip Rate</label>
              <span className="mono tnum text-value text-room-text">
                {config.object_skip_rate ?? 8}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={config.object_skip_rate ?? 8}
              onChange={(e) =>
                updateField("object_skip_rate", Number(e.target.value))
              }
              className="mt-2 w-full accent-pencil"
            />
            <div className="mono mt-1 flex justify-between text-micro text-room-faint">
              <span>1</span>
              <span>Default: 8</span>
              <span>100</span>
            </div>
          </div>

          <div className="row flex-col items-stretch">
            <div className="flex items-baseline justify-between gap-4">
              <label className="label">Draw Duration (sec)</label>
              <span className="text-micro text-room-faint">Optional</span>
            </div>
            <input
              type="number"
              min={0.1}
              max={600}
              step={0.1}
              value={config.draw_duration_sec ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                updateField(
                  "draw_duration_sec",
                  raw === "" ? undefined : parseFloat(raw),
                );
              }}
              placeholder="Auto (based on strokes)"
              className="field mono mt-2"
            />
            <div className="mono mt-1 text-micro text-room-faint">
              Range: 0.1 - 600 seconds
            </div>
          </div>

          <div className="row flex-col items-stretch">
            <div className="flex items-baseline justify-between gap-4">
              <label className="label">End Freeze (sec)</label>
              <span className="mono tnum text-value text-room-text">
                {config.end_duration_sec ?? 2} s
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={config.end_duration_sec ?? 2}
              onChange={(e) =>
                updateField("end_duration_sec", Number(e.target.value))
              }
              className="mt-2 w-full accent-pencil"
            />
            <div className="mono mt-1 flex justify-between text-micro text-room-faint">
              <span>0 s</span>
              <span>Default: 2 s</span>
              <span>10 s</span>
            </div>
          </div>

          {!isBatchMode && onChangeObjectMaskPath && (
            <div className="pt-5">
              <h4 className="label flex items-center gap-1.5">
                <Hand aria-hidden="true" className="h-3.5 w-3.5 text-onion" />
                Optional Masks &amp; Drawing Hand Customization
              </h4>

              <div className="row flex-col items-stretch">
                <label className="label">Object Mask Path</label>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={objectMaskPath}
                    placeholder="None"
                    className="field mono min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    onClick={handlePickObjectMask}
                    className="btn shrink-0"
                    title="Choose mask"
                  >
                    Pick
                  </button>
                  {objectMaskPath && (
                    <button
                      type="button"
                      onClick={() => onChangeObjectMaskPath("")}
                      className="btn btn-quiet shrink-0 px-2"
                      aria-label="Clear object mask"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {onChangeHandImagePath && (
                <div className="row flex-col items-stretch">
                  <label className="label">Hand Image Path</label>
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={handImagePath}
                      placeholder="Default hand"
                      className="field mono min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={handlePickHandImage}
                      className="btn shrink-0"
                      title="Choose hand image"
                    >
                      Pick
                    </button>
                    {handImagePath && (
                      <button
                        type="button"
                        onClick={() => onChangeHandImagePath("")}
                        className="btn btn-quiet shrink-0 px-2"
                        aria-label="Clear hand image"
                      >
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {onChangeHandMaskPath && (
                <div className="row flex-col items-stretch">
                  <label className="label">Hand Mask Path</label>
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={handMaskPath}
                      placeholder="Default mask"
                      className="field mono min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={handlePickHandMask}
                      className="btn shrink-0"
                      title="Choose hand mask"
                    >
                      Pick
                    </button>
                    {handMaskPath && (
                      <button
                        type="button"
                        onClick={() => onChangeHandMaskPath("")}
                        className="btn btn-quiet shrink-0 px-2"
                        aria-label="Clear hand mask"
                      >
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-3">
            <button
              type="button"
              onClick={() => setShowRarelyTouched(!showRarelyTouched)}
              aria-expanded={showRarelyTouched}
              className="row group w-full cursor-pointer items-center text-left"
            >
              <span className="flex items-center gap-1.5 text-micro text-room-muted transition-colors group-hover:text-room-text">
                <FileQuestion aria-hidden="true" className="h-3.5 w-3.5" />
                Rarely Touched Parameters
              </span>
              {showRarelyTouched ? (
                <ChevronUp
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-room-faint"
                />
              ) : (
                <ChevronDown
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-room-faint"
                />
              )}
            </button>

            {showRarelyTouched && (
              <div className="row flex-col items-stretch">
                <div className="flex items-baseline justify-between gap-4">
                  <label className="label">Black Pixel Threshold</label>
                  <span className="mono tnum text-value text-room-text">
                    {config.black_pixel_threshold ?? 10}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={config.black_pixel_threshold ?? 10}
                  onChange={(e) =>
                    updateField(
                      "black_pixel_threshold",
                      Number(e.target.value),
                    )
                  }
                  className="mt-2 w-full accent-pencil"
                />
                <div className="mono mt-1 flex justify-between text-micro text-room-faint">
                  <span>0</span>
                  <span>Default: 10</span>
                  <span>255</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
