import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileQuestion,
  Hand,
  Sliders,
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
    <div className="border border-zinc-800 rounded-xl bg-zinc-950/60 overflow-hidden transition-all">
      {/* Header Accordion Toggle */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-300 hover:text-white bg-zinc-900/50 hover:bg-zinc-900 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          <span className="font-medium">Advanced Options & Parameters</span>
          <span className="text-xs text-zinc-500 font-mono">
            {config.frame_rate || 25} fps &bull; split {config.split_len || 10}
          </span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-zinc-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        )}
      </button>

      {isOpen && (
        <div className="p-4 sm:p-5 space-y-5 border-t border-zinc-800/80">
          {/* Primary Numeric Parameters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* frame_rate: 1-120 (default 25) */}
            <div className="space-y-1 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-zinc-300">
                  Frame Rate (FPS)
                </label>
                <span className="font-mono text-indigo-400 font-bold">
                  {config.frame_rate ?? 25}
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
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>1 fps</span>
                <span>Default: 25</span>
                <span>120 fps</span>
              </div>
            </div>

            {/* split_len: 1-100 (default 10) */}
            <div className="space-y-1 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-zinc-300">
                  Stroke Split Length
                </label>
                <span className="font-mono text-indigo-400 font-bold">
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
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>1</span>
                <span>Default: 10</span>
                <span>100</span>
              </div>
            </div>

            {/* object_skip_rate: 1-100 (default 8) */}
            <div className="space-y-1 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-zinc-300">
                  Object Skip Rate
                </label>
                <span className="font-mono text-indigo-400 font-bold">
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
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>1</span>
                <span>Default: 8</span>
                <span>100</span>
              </div>
            </div>

            {/* draw_duration_sec: 0.1-600 (optional number input) */}
            <div className="space-y-1 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-zinc-300">
                  Draw Duration (sec)
                </label>
                <span className="text-[11px] text-zinc-500">Optional</span>
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
                className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700/80 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
              />
              <div className="text-[10px] text-zinc-500">
                Range: 0.1 - 600 seconds
              </div>
            </div>

            {/* end_duration_sec: 0-10 (default 2) */}
            <div className="space-y-1 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-zinc-300">
                  End Freeze (sec)
                </label>
                <span className="font-mono text-indigo-400 font-bold">
                  {config.end_duration_sec ?? 2}s
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
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>0s</span>
                <span>Default: 2s</span>
                <span>10s</span>
              </div>
            </div>
          </div>

          {/* Optional Masks & Hand Assets */}
          {!isBatchMode && onChangeObjectMaskPath && (
            <div className="pt-2 border-t border-zinc-800/80 space-y-3">
              <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                <Hand className="w-3.5 h-3.5 text-indigo-400" />
                Optional Masks & Drawing Hand Customization
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Object Mask */}
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400 block truncate">
                    Object Mask Path
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={objectMaskPath}
                      placeholder="None"
                      className="w-full px-2 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono truncate"
                    />
                    <button
                      type="button"
                      onClick={handlePickObjectMask}
                      className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs"
                      title="Choose mask"
                    >
                      Pick
                    </button>
                    {objectMaskPath && (
                      <button
                        type="button"
                        onClick={() => onChangeObjectMaskPath("")}
                        className="px-1.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Hand Image */}
                {onChangeHandImagePath && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400 block truncate">
                      Hand Image Path
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={handImagePath}
                        placeholder="Default hand"
                        className="w-full px-2 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono truncate"
                      />
                      <button
                        type="button"
                        onClick={handlePickHandImage}
                        className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs"
                        title="Choose hand image"
                      >
                        Pick
                      </button>
                      {handImagePath && (
                        <button
                          type="button"
                          onClick={() => onChangeHandImagePath("")}
                          className="px-1.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Hand Mask */}
                {onChangeHandMaskPath && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400 block truncate">
                      Hand Mask Path
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={handMaskPath}
                        placeholder="Default mask"
                        className="w-full px-2 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono truncate"
                      />
                      <button
                        type="button"
                        onClick={handlePickHandMask}
                        className="px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs"
                        title="Choose hand mask"
                      >
                        Pick
                      </button>
                      {handMaskPath && (
                        <button
                          type="button"
                          onClick={() => onChangeHandMaskPath("")}
                          className="px-1.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Rarely Touched Group */}
          <div className="pt-2 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={() => setShowRarelyTouched(!showRarelyTouched)}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-400"
            >
              <FileQuestion className="w-3.5 h-3.5" />
              <span>Rarely Touched Parameters</span>
              {showRarelyTouched ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>

            {showRarelyTouched && (
              <div className="mt-3 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 max-w-sm">
                {/* black_pixel_threshold: 0-255 (default 10) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-medium text-zinc-300">
                      Black Pixel Threshold
                    </label>
                    <span className="font-mono text-indigo-400 font-bold">
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
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>0</span>
                    <span>Default: 10</span>
                    <span>255</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
