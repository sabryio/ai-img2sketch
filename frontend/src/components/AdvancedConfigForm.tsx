import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileQuestion,
  Folder,
  Hand,
  Sliders,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { SketchConfig } from "../lib/api/types";
import { openDirectoryDialog, openImageFileDialog } from "../lib/tauri";

interface AdvancedConfigFormProps {
  config: SketchConfig;
  onChangeConfig: (newConfig: SketchConfig) => void;
  outputDir: string;
  onChangeOutputDir: (dir: string) => void;
  objectMaskPath?: string;
  onChangeObjectMaskPath?: (path: string) => void;
  handImagePath?: string;
  onChangeHandImagePath?: (path: string) => void;
  handMaskPath?: string;
  onChangeHandMaskPath?: (path: string) => void;
  isBatchMode?: boolean;
}

export const AdvancedConfigForm: React.FC<AdvancedConfigFormProps> = ({
  config,
  onChangeConfig,
  outputDir,
  onChangeOutputDir,
  objectMaskPath = "",
  onChangeObjectMaskPath,
  handImagePath = "",
  onChangeHandImagePath,
  handMaskPath = "",
  onChangeHandMaskPath,
  isBatchMode = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showRarelyTouched, setShowRarelyTouched] = useState(false);

  const updateField = <K extends keyof SketchConfig>(
    key: K,
    value: SketchConfig[K],
  ) => {
    onChangeConfig({
      ...config,
      [key]: value,
    });
  };

  const handlePickOutputDir = async () => {
    const picked = await openDirectoryDialog("Select Output Directory");
    if (picked) {
      onChangeOutputDir(picked);
    }
  };

  const handlePickObjectMask = async () => {
    if (!onChangeObjectMaskPath) return;
    const picked = await openImageFileDialog({
      title: "Select Object Mask Image",
    });
    if (picked) {
      onChangeObjectMaskPath(picked);
    }
  };

  const handlePickHandImage = async () => {
    if (!onChangeHandImagePath) return;
    const picked = await openImageFileDialog({
      title: "Select Drawing Hand Image",
    });
    if (picked) {
      onChangeHandImagePath(picked);
    }
  };

  const handlePickHandMask = async () => {
    if (!onChangeHandMaskPath) return;
    const picked = await openImageFileDialog({
      title: "Select Hand Mask Image",
    });
    if (picked) {
      onChangeHandMaskPath(picked);
    }
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
          {/* Output Directory Field (Visible but optional) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-300">
              Output Directory (Optional)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputDir}
                onChange={(e) => onChangeOutputDir(e.target.value)}
                placeholder="Leave blank for default (e.g. ./output)"
                className="flex-1 px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
              />
              <button
                type="button"
                onClick={handlePickOutputDir}
                className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5 transition-colors border border-zinc-700"
                title="Browse folder"
              >
                <Folder className="w-3.5 h-3.5" />
                Browse
              </button>
              {outputDir && (
                <button
                  type="button"
                  onClick={() => onChangeOutputDir("")}
                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                  title="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-500">
              Where generated MP4 files are written. In Docker mode, mapped to{" "}
              <code className="font-mono text-zinc-400">/app/output</code>.
            </p>
          </div>

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
                  const val =
                    e.target.value === "" ? null : parseFloat(e.target.value);
                  updateField("draw_duration_sec", val);
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
                step={0.5}
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
