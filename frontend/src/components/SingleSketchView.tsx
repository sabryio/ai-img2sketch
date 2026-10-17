import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  FileImage,
  Film,
  FolderOpen,
  Info,
  Loader2,
  Play,
  Sparkles,
  Upload,
} from "lucide-react";
import { useElapsed, useGenerateSketch } from "../hooks";
import type { SketchOptions } from "../rpc/contract";
import { toAppError } from "../lib/errors";
import { mapBackendPathToHost, mapHostPathToBackend } from "../lib/paths";
import {
  convertPathToAssetUrl,
  copyHostFile,
  openImageFileDialog,
} from "../lib/tauri";
import { useBackendStore } from "../stores/backend";
import { useNotificationsStore } from "../stores/notifications";
import { AdvancedConfigForm } from "./AdvancedConfigForm";

interface SingleSketchViewProps {
  /** False once the backend stops answering; the form is then disabled. */
  ready: boolean;
}

/** Form defaults, matching the engine's documented defaults. */
const DEFAULT_CONFIG: SketchOptions = {
  frame_rate: 25,
  split_len: 10,
  object_skip_rate: 8,
  end_duration_sec: 2,
  black_pixel_threshold: 10,
};

export const SingleSketchView: React.FC<SingleSketchViewProps> = ({ ready }) => {
  const { mode, pathConfig } = useBackendStore();
  const addToast = useNotificationsStore((state) => state.addToast);

  const [imagePath, setImagePath] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [objectMaskPath, setObjectMaskPath] = useState<string>("");
  const [handImagePath, setHandImagePath] = useState<string>("");
  const [handMaskPath, setHandMaskPath] = useState<string>("");
  const [config, setConfig] = useState<SketchOptions>(DEFAULT_CONFIG);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [videoAssetUrl, setVideoAssetUrl] = useState<string>("");
  const [videoFailedToLoad, setVideoFailedToLoad] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);
  const [copiedError, setCopiedError] = useState<boolean>(false);

  const sketch = useGenerateSketch({
    onSuccess: (data) => {
      const hostPath = mapBackendPathToHost(data.output_path, mode, pathConfig);
      addToast({
        type: "success",
        title: "Sketch Video Generated",
        message: `Video saved to ${hostPath}`,
      });
    },
    onError: (error) => {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: appError.status
          ? `Error (${appError.status})`
          : "Generation Failed",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    },
  });

  const elapsedSec = useElapsed(sketch.isPending);
  const result = sketch.data;
  const appError =
    sketch.error && !errorDismissed ? toAppError(sketch.error, mode) : null;

  /** Host-visible path of the produced video (Docker paths are translated). */
  const resolvedHostPath = result
    ? mapBackendPathToHost(result.output_path, mode, pathConfig)
    : "";

  // Resolve the asset URL once per result: the Tauri asset protocol is the only
  // way a `<video>` can read a host path, and it is absent in a browser.
  useEffect(() => {
    if (!resolvedHostPath) {
      setVideoAssetUrl("");
      return;
    }

    let cancelled = false;
    setVideoFailedToLoad(false);
    convertPathToAssetUrl(resolvedHostPath).then((url) => {
      if (!cancelled) {
        setVideoAssetUrl(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedHostPath]);

  const handlePickImage = async () => {
    const picked = await openImageFileDialog();
    if (picked) {
      setImagePath(picked);
      setErrorDismissed(false);
      sketch.reset();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = imagePath.trim();
    if (!trimmed || sketch.isPending || !ready) {
      return;
    }

    setErrorDismissed(false);

    // Stage the input where the backend can actually read it. In Docker mode
    // the container only sees the mounted media volume, so a host file has to
    // be copied in first — and if that copy fails the request is never sent,
    // because it could only come back as a 404.
    let backendImagePath = trimmed;
    if (mode === "docker") {
      const mapped = mapHostPathToBackend(trimmed, "docker", pathConfig);
      backendImagePath = mapped.backendPath;
      if (mapped.needsCopy && mapped.destinationHostPath) {
        const copied = await copyHostFile(trimmed, mapped.destinationHostPath);
        if (!copied) {
          addToast({
            type: "error",
            title: "Could not stage the input file",
            message: `Failed to copy ${trimmed} into the mounted media volume (${mapped.destinationHostPath}). The container would not be able to read the original location.`,
          });
          return;
        }
      }
    }

    try {
      await sketch.mutateAsync({
        image_path: backendImagePath,
        output_dir: outputDir.trim() ? outputDir.trim() : undefined,
        object_mask_path: objectMaskPath.trim()
          ? objectMaskPath.trim()
          : undefined,
        hand_image_path: handImagePath.trim()
          ? handImagePath.trim()
          : undefined,
        hand_mask_path: handMaskPath.trim() ? handMaskPath.trim() : undefined,
        config,
      });
    } catch {
      // Surfaced through the mutation's `onError` and the error card below.
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

  // Preview of the mapping the backend will apply to the typed path.
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
            <label
              htmlFor="single-image-path"
              className="text-sm font-semibold text-zinc-200 flex items-center gap-2"
            >
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
                id="single-image-path"
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
              disabled={sketch.isPending}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-md shadow-indigo-600/20 shrink-0"
            >
              <Upload className="w-4 h-4" />
              Pick Image
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
                    &bull; The file is copied into the Docker volume on submit:{" "}
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
            {sketch.isPending ? (
              <span className="flex items-center gap-2 text-indigo-400 animate-pulse font-mono">
                <Clock className="w-4 h-4" />
                Synthesizing sketch frames... Elapsed: {elapsedSec}s
              </span>
            ) : (
              <span>Synchronous generation. May take several seconds.</span>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {result && (
              <button
                type="button"
                onClick={() => sketch.reset()}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                Clear Result
              </button>
            )}

            <button
              type="submit"
              disabled={!imagePath.trim() || sketch.isPending || !ready}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/25"
            >
              {sketch.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating ({elapsedSec}s)...
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

      {/* Error Display Card (404 / 422 / 500 / unreachable) */}
      {appError && (
        <div
          role="alert"
          data-testid="single-error"
          className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-rose-300">
                  {appError.status
                    ? `Request Error ${appError.status}`
                    : "Backend Request Failed"}
                </h4>
                <p className="text-xs text-rose-200/90 mt-1 leading-relaxed">
                  {appError.message}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setErrorDismissed(true)}
              className="text-xs text-rose-400 hover:text-rose-200"
            >
              Dismiss
            </button>
          </div>

          {/* Verbatim backend payload with copy button */}
          {appError.verbatim && (
            <div className="pt-2 border-t border-rose-500/20">
              <div className="flex items-center justify-between text-[11px] text-rose-300/80 mb-1">
                <span className="font-semibold font-mono">
                  Verbatim backend error:
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyVerbatimError(appError.verbatim!)}
                  className="flex items-center gap-1 text-xs text-indigo-300 hover:text-white px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700"
                >
                  <Copy className="w-3 h-3" />
                  {copiedError ? "Copied verbatim!" : "Copy error"}
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-zinc-950 font-mono text-[11px] text-rose-200 overflow-x-auto select-all max-h-48 border border-zinc-900">
                {appError.verbatim}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Generation Result & Video Preview Section */}
      {result && (
        <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl space-y-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5" />
              Sketch Video Generated Successfully
            </div>
          </div>

          {/* Video Player or Fallback */}
          <div className="relative aspect-video max-w-2xl mx-auto rounded-xl overflow-hidden bg-black border border-zinc-800 flex items-center justify-center">
            {videoAssetUrl && !videoFailedToLoad ? (
              <video
                data-testid="single-video"
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
                    The file is on disk. Playback needs the desktop app: a
                    browser sandbox cannot load a local path.
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
                  handleCopyPath(resolvedHostPath || result.output_path)
                }
                className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedPath ? "Copied!" : "Copy path"}
              </button>
            </div>
            <div
              data-testid="single-output-path"
              className="p-2.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-200 break-all select-all"
            >
              {resolvedHostPath || result.output_path}
            </div>

            <div className="flex flex-wrap items-center justify-between pt-2 gap-2 text-xs">
              <span className="text-[11px] text-zinc-500 font-mono">
                Backend output: {result.output_path}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleCopyPath(resolvedHostPath || result.output_path)
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
