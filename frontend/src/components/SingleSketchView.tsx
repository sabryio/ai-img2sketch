import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileImage,
  Film,
  FolderOpen,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";
import { SketchConfig, SketchRequest } from "../lib/api/types";
import {
  mapBackendPathToHost,
  mapHostPathToBackend,
  toMediaAssetUrl,
} from "../lib/paths";
import { convertPathToAssetUrl, openImageFileDialog } from "../lib/tauri";
import { useBackendStore } from "../stores/backend";
import { useGenerationStore } from "../stores/generation";
import { AdvancedConfigForm } from "./AdvancedConfigForm";

export const SingleSketchView: React.FC = () => {
  const { mode, pathConfig, ready, simulatorActive } = useBackendStore();
  const {
    inFlightSingle,
    singleElapsedSec,
    singleResult,
    singleResolvedHostPath,
    lastError,
    executeSingleGeneration,
    resetSingleResult,
    clearLastError,
  } = useGenerationStore();

  const [imagePath, setImagePath] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [objectMaskPath, setObjectMaskPath] = useState<string>("");
  const [handImagePath, setHandImagePath] = useState<string>("");
  const [handMaskPath, setHandMaskPath] = useState<string>("");
  const [videoAssetUrl, setVideoAssetUrl] = useState<string>("");
  const [videoFailedToLoad, setVideoFailedToLoad] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);
  const [copiedError, setCopiedError] = useState<boolean>(false);

  const [config, setConfig] = useState<SketchConfig>({
    frame_rate: 25,
    split_len: 10,
    object_skip_rate: 8,
    draw_duration_sec: null,
    end_duration_sec: 2,
    black_pixel_threshold: 10,
  });

  const handlePickImage = async () => {
    const picked = await openImageFileDialog();
    if (picked) {
      setImagePath(picked);
      resetSingleResult();
      clearLastError();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imagePath.trim() || inFlightSingle || !ready) return;

    setVideoFailedToLoad(false);

    const req: SketchRequest = {
      image_path: imagePath.trim(),
      output_dir: outputDir.trim() ? outputDir.trim() : null,
      object_mask_path: objectMaskPath.trim() ? objectMaskPath.trim() : null,
      hand_image_path: handImagePath.trim() ? handImagePath.trim() : null,
      hand_mask_path: handMaskPath.trim() ? handMaskPath.trim() : null,
      config,
    };

    const res = await executeSingleGeneration(req);
    if (res?.output_path) {
      // Resolve asset URL for the video player
      const hostPath = mapBackendPathToHost(res.output_path, mode, pathConfig);
      const url = await convertPathToAssetUrl(hostPath);
      setVideoAssetUrl(url || toMediaAssetUrl(hostPath));
    }
  };

  const handleCopyPath = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2500);
  };

  const handleCopyVerbatimError = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedError(true);
    setTimeout(() => setCopiedError(false), 2500);
  };

  // Preview path mapping explanation
  const pathMappingInfo = imagePath
    ? mapHostPathToBackend(imagePath, mode, pathConfig)
    : null;

  return (
    <div className="space-y-6">
      {/* View Title & Mode Information */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            Synthesize Sketch Video
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Convert any 2D image into an animated drawing sketch video with
            realistic stroke ordering.
          </p>
        </div>

        {/* Mode Indicator & Path Advice */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs">
          <span className="text-zinc-400">Target Mode:</span>
          <span
            className={`font-semibold capitalize px-2 py-0.5 rounded text-[11px] ${
              mode === "docker"
                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            }`}
          >
            {mode} Mode
          </span>
          <span className="text-[11px] text-zinc-500 hidden md:inline">
            {mode === "docker"
              ? "(Volumes: ./media & ./output)"
              : "(Native Direct Host FS)"}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Main Image Selection Card */}
        <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <FileImage className="w-4 h-4 text-indigo-400" />
              Source Image File
              <span className="text-rose-400">*</span>
            </label>
            {imagePath && (
              <span className="text-[11px] text-zinc-500 font-mono">
                Selected
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={imagePath}
                onChange={(e) => setImagePath(e.target.value)}
                placeholder="Click 'Pick Image' or enter file path (e.g. ./media/portrait.png)"
                className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                required
              />
            </div>
            <button
              type="button"
              onClick={handlePickImage}
              disabled={inFlightSingle}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-md shadow-indigo-600/20 shrink-0"
            >
              <Upload className="w-4 h-4" />
              Pick Image
            </button>
          </div>

          {/* Quick Demo Pre-fill for Web Testing */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
            <span className="text-zinc-500">Quick samples:</span>
            <button
              type="button"
              onClick={() => setImagePath("./media/demo_portrait.png")}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-[10px] transition-colors"
            >
              ./media/demo_portrait.png
            </button>
            <button
              type="button"
              onClick={() => setImagePath("./media/sample_landscape.jpg")}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-[10px] transition-colors"
            >
              ./media/sample_landscape.jpg
            </button>
          </div>

          {/* Path Mapping Clarification Helper */}
          {pathMappingInfo && (
            <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs text-zinc-400 space-y-1">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Backend Path Mapping ({mode}):</span>
              </div>
              <div className="font-mono text-[11px] text-zinc-400 pl-5 space-y-0.5">
                <div>
                  Host path: <span className="text-zinc-200">{imagePath}</span>
                </div>
                <div>
                  Backend sees:{" "}
                  <span className="text-indigo-300 font-semibold">
                    {pathMappingInfo.backendPath}
                  </span>
                </div>
                {pathMappingInfo.needsCopy && (
                  <div className="text-amber-400/90 text-[10px]">
                    &bull; File will be automatically synced to Docker volume:{" "}
                    {pathMappingInfo.destinationHostPath}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Collapsible Advanced Configuration Form */}
        <AdvancedConfigForm
          config={config}
          onChangeConfig={setConfig}
          outputDir={outputDir}
          onChangeOutputDir={setOutputDir}
          objectMaskPath={objectMaskPath}
          onChangeObjectMaskPath={setObjectMaskPath}
          handImagePath={handImagePath}
          onChangeHandImagePath={setHandImagePath}
          handMaskPath={handMaskPath}
          onChangeHandMaskPath={setHandMaskPath}
          isBatchMode={false}
        />

        {/* Action Controls & Submit Button */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-zinc-500">
            {inFlightSingle ? (
              <span className="flex items-center gap-2 text-indigo-400 animate-pulse font-mono">
                <Clock className="w-4 h-4" />
                Synthesizing sketch frames... Elapsed: {singleElapsedSec}s
              </span>
            ) : (
              <span>Synchronous generation. May take several seconds.</span>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {singleResult && (
              <button
                type="button"
                onClick={resetSingleResult}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                Clear Result
              </button>
            )}

            <button
              type="submit"
              disabled={!imagePath.trim() || inFlightSingle || !ready}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/25"
            >
              {inFlightSingle ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating ({singleElapsedSec}s)...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  Generate Sketch Video
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Error Display Card (if 404, 422, or 500) */}
      {lastError && (
        <div
          role="alert"
          className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-rose-300">
                  {lastError.status
                    ? `Request Error ${lastError.status}`
                    : "Backend Request Failed"}
                </h4>
                <p className="text-xs text-rose-200/90 mt-1 leading-relaxed">
                  {lastError.message}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={clearLastError}
              className="text-xs text-rose-400 hover:text-rose-200"
            >
              Dismiss
            </button>
          </div>

          {/* 500 Verbatim Error with Copy Button */}
          {lastError.verbatim && (
            <div className="pt-2 border-t border-rose-500/20">
              <div className="flex items-center justify-between text-[11px] text-rose-300/80 mb-1">
                <span className="font-semibold font-mono">
                  Verbatim backend error:
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyVerbatimError(lastError.verbatim!)}
                  className="flex items-center gap-1 text-xs text-indigo-300 hover:text-white px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700"
                >
                  <Copy className="w-3 h-3" />
                  {copiedError ? "Copied verbatim!" : "Copy error"}
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-zinc-950 font-mono text-[11px] text-rose-200 overflow-x-auto select-all max-h-48 border border-zinc-900">
                {lastError.verbatim}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Generation Result & Video Preview Section */}
      {singleResult && (
        <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl space-y-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5" />
              Sketch Video Generated Successfully
            </div>
            {singleResult.duration_sec && (
              <span className="text-xs text-zinc-400 font-mono">
                Duration: {singleResult.duration_sec}s
                {singleResult.frame_count
                  ? ` &bull; ${singleResult.frame_count} frames`
                  : ""}
              </span>
            )}
          </div>

          {/* Video Player or Fallback */}
          <div className="relative aspect-video max-w-2xl mx-auto rounded-xl overflow-hidden bg-black border border-zinc-800 flex items-center justify-center">
            {videoAssetUrl && !videoFailedToLoad ? (
              <video
                src={videoAssetUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
                onError={() => {
                  setVideoFailedToLoad(true);
                }}
              >
                Your browser/webview does not support the video tag.
              </video>
            ) : (
              <div className="p-6 text-center space-y-3">
                <Film className="w-12 h-12 text-zinc-600 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-zinc-300">
                    Video generated at output path
                  </p>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                    In web preview, direct asset protocol loading (
                    <code className="font-mono text-zinc-400">asset://</code>)
                    may be restricted by the browser sandbox.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Output Path & Reveal Button */}
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-semibold text-zinc-300">
                Resolved Host Output:
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopyPath(
                    singleResolvedHostPath || singleResult.output_path,
                  )
                }
                className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedPath ? "Copied!" : "Copy path"}
              </button>
            </div>
            <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-200 break-all select-all">
              {singleResolvedHostPath || singleResult.output_path}
            </div>

            <div className="flex flex-wrap items-center justify-between pt-2 gap-2 text-xs">
              <span className="text-[11px] text-zinc-500 font-mono">
                Backend output: {singleResult.output_path}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopyPath(
                    singleResolvedHostPath || singleResult.output_path,
                  )
                }
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1.5 transition-colors border border-zinc-700"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Reveal in folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
