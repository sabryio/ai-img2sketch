import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileImage,
  Film,
  Info,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useElapsed,
  useGenerateSketch,
  useRunProgress,
  useStoreMedia,
} from "../hooks";
import type { EventData, SketchOptions } from "../rpc/contract";
import {
  artifactDownloadUrl,
  discardArtifact,
  fetchArtifact,
} from "../rpc/artifacts";
import { toAppError } from "../lib/errors";
import { stageFiles } from "../lib/media";
import { getBasename, planInputPath, planOutput } from "../lib/paths";
import { frameDetail } from "../lib/progress";
import {
  isTauriEnvironment,
  pickImageFile,
  readHostImageFile,
  saveArtifactBlob,
  writeArtifactToFolder,
} from "../lib/tauri";
import { useBackendStore } from "../stores/backend";
import { useNotificationsStore } from "../stores/notifications";
import { AdvancedConfigForm } from "./AdvancedConfigForm";
import { OutputFolderField } from "./OutputFolderField";
import { ProgressBar } from "./ProgressBar";

interface SingleSketchViewProps {
  /** False once the backend stops answering; the form is then disabled. */
  ready: boolean;
  /** Newest event on the stream; the live progress bar reads it. */
  latestEvent?: EventData;
}

/** Form defaults, matching the engine's documented defaults. */
const DEFAULT_CONFIG: SketchOptions = {
  frame_rate: 25,
  split_len: 10,
  object_skip_rate: 8,
  end_duration_sec: 2,
  black_pixel_threshold: 10,
};

export const SingleSketchView: React.FC<SingleSketchViewProps> = ({
  ready,
  latestEvent,
}) => {
  const { mode } = useBackendStore();
  const addToast = useNotificationsStore((state) => state.addToast);
  const storeMedia = useStoreMedia();

  const [imagePath, setImagePath] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [objectMaskPath, setObjectMaskPath] = useState<string>("");
  const [handImagePath, setHandImagePath] = useState<string>("");
  const [handMaskPath, setHandMaskPath] = useState<string>("");
  const [config, setConfig] = useState<SketchOptions>(DEFAULT_CONFIG);
  const [errorDismissed, setErrorDismissed] = useState(false);
  /** True while bytes are being handed to the backend (pick or submit). */
  const [isStaging, setIsStaging] = useState(false);
  /** True while a produced video is being fetched and handed to the user. */
  const [isDownloading, setIsDownloading] = useState(false);
  /** True while a produced video is being deleted from the backend. */
  const [isDeleting, setIsDeleting] = useState(false);
  const [videoFailedToLoad, setVideoFailedToLoad] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);
  const [copiedError, setCopiedError] = useState<boolean>(false);
  /** Container paths this session uploaded, so they can be removed again. */
  const [uploadedInputs, setUploadedInputs] = useState<string[]>([]);
  /** Produced paths already deleted from the backend. */
  const [deletedOutputs, setDeletedOutputs] = useState<string[]>([]);

  /**
   * Where the video ends up. Empty means the backend writes beside the image; a
   * host folder is written by the desktop app after the render, or downloaded
   * when no host write is possible (see `planOutput`).
   */
  const outputPlan = useMemo(
    () => planOutput(outputDir, mode, isTauriEnvironment()),
    [outputDir, mode],
  );

  /**
   * Whether the backend can read the typed path, or the bytes have to be
   * uploaded first. Docker mode has no host mounts, so a host path always has to
   * be sent; a path the API already returned (the result of an upload) is used
   * as-is.
   */
  const inputPlan = useMemo(() => planInputPath(imagePath, mode), [imagePath, mode]);

  const trackUpload = (path: string) => {
    setUploadedInputs((previous) =>
      previous.includes(path) ? previous : [...previous, path],
    );
  };

  /**
   * Hand a finished video to the folder the user asked for when the backend
   * could not write there itself: fetch it, then write it (desktop only).
   */
  const exportResult = async (backendOutputPath: string): Promise<void> => {
    const exportDir = outputPlan.exportDir;
    if (!exportDir) {
      return;
    }

    try {
      const blob = await fetchArtifact(backendOutputPath);
      const written = await writeArtifactToFolder(
        blob,
        exportDir,
        getBasename(backendOutputPath),
      );

      addToast(
        written
          ? {
              type: "success",
              title: "Video Exported",
              message: `Saved to ${exportDir}`,
            }
          : {
              type: "warning",
              title: "Could not export the video",
              message: `The backend rendered it inside its container, but nothing was written to ${exportDir}. Use "Download MP4" to save it instead.`,
            },
      );
    } catch (error) {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: "Could not export the video",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    }
  };

  const sketch = useGenerateSketch({
    onSuccess: async (data) => {
      addToast({
        type: "success",
        title: "Sketch Video Generated",
        message:
          mode === "sidecar"
            ? `Video saved to ${data.output_path}`
            : `${getBasename(data.output_path)} is ready. Download it to keep a copy, or delete it from the backend.`,
      });
      await exportResult(data.output_path);
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
  const progress = useRunProgress(latestEvent, sketch.isPending, "single");
  const result = sketch.data;
  const appError =
    sketch.error && !errorDismissed ? toAppError(sketch.error, mode) : null;
  const resultDeleted = result
    ? deletedOutputs.includes(result.output_path)
    : false;

  const handlePickImage = async () => {
    const picked = await pickImageFile();
    if (!picked) {
      return;
    }

    // Desktop: the shell hands over a host path. It is uploaded on submit if the
    // backend cannot read it where it is (see `inputPlan`).
    if (picked.path) {
      setImagePath(picked.path);
      setErrorDismissed(false);
      sketch.reset();
      return;
    }

    // Browser: the file exists only as bytes, so upload it now and keep the path
    // the backend reported back — it is readable by definition.
    if (!picked.file) {
      return;
    }

    setIsStaging(true);
    try {
      const [storedPath] = await stageFiles([picked.file], (input) =>
        storeMedia.mutateAsync(input),
      );
      setImagePath(storedPath);
      trackUpload(storedPath);
      setErrorDismissed(false);
      sketch.reset();
    } catch (error) {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: "Could not upload the image",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    } finally {
      setIsStaging(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = imagePath.trim();
    if (!trimmed || sketch.isPending || !ready) {
      return;
    }

    setErrorDismissed(false);

    // Docker mode has no host mounts, so a typed host path has to travel through
    // the API before the backend can open it. Failing here is better than
    // sending it: the only possible answer would be a 404.
    let backendImagePath = trimmed;
    if (inputPlan.needsUpload) {
      const file = await readHostImageFile(trimmed);
      if (!file) {
        addToast({
          type: "error",
          title: "Could not read the image",
          message: `Failed to read ${trimmed}. Use "Pick Image" so the app can upload the file to the backend.`,
        });
        return;
      }

      setIsStaging(true);
      try {
        const [storedPath] = await stageFiles([file], (input) =>
          storeMedia.mutateAsync(input),
        );
        backendImagePath = storedPath;
        setImagePath(storedPath);
        trackUpload(storedPath);
      } catch (error) {
        const appError = toAppError(error, mode);
        addToast({
          type: "error",
          title: "Could not upload the image",
          message: appError.message,
          verbatim: appError.verbatim,
        });
        return;
      } finally {
        setIsStaging(false);
      }
    }

    try {
      await sketch.mutateAsync({
        image_path: backendImagePath,
        output_dir: outputPlan.backendOutputDir,
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

  /** Fetch the produced video from the backend and save it where asked. */
  const handleDownload = async () => {
    if (!result || isDownloading || resultDeleted) {
      return;
    }

    setIsDownloading(true);
    try {
      const blob = await fetchArtifact(result.output_path);
      const outcome = await saveArtifactBlob(
        blob,
        getBasename(result.output_path),
      );
      if (!outcome.saved) {
        return;
      }

      addToast({
        type: outcome.viaBrowserDownload ? "info" : "success",
        title: outcome.viaBrowserDownload ? "Download Started" : "Video Saved",
        message: outcome.viaBrowserDownload
          ? `${outcome.destination} — the browser chose the folder.`
          : `Saved to ${outcome.destination}`,
      });
    } catch (error) {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: "Download Failed",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  /** Delete the produced video from the backend, keeping the user's copy. */
  const handleDelete = async () => {
    if (!result || isDeleting || resultDeleted) {
      return;
    }

    setIsDeleting(true);
    try {
      await discardArtifact(result.output_path);
      setDeletedOutputs((previous) => [...previous, result.output_path]);
      addToast({
        type: "success",
        title: "Deleted from the backend",
        message: `${getBasename(result.output_path)} is gone from the server. Any copy you downloaded is untouched.`,
      });
    } catch (error) {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: "Could not delete the video",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  /** Remove everything this session uploaded, so nothing is left behind. */
  const handleDeleteInputs = async () => {
    if (uploadedInputs.length === 0 || sketch.isPending) {
      return;
    }

    try {
      await Promise.all(uploadedInputs.map((path) => discardArtifact(path)));
      const removed = uploadedInputs.length;
      if (uploadedInputs.includes(imagePath.trim())) {
        // The field points at a file that no longer exists.
        setImagePath("");
      }
      setUploadedInputs([]);
      addToast({
        type: "success",
        title: "Uploads deleted",
        message: `${removed} file(s) removed from the backend.`,
      });
    } catch (error) {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: "Could not delete the uploads",
        message: appError.message,
        verbatim: appError.verbatim,
      });
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

  const previewUrl = result ? artifactDownloadUrl(result.output_path, "inline") : "";

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

        {/* Mode Indicator */}
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
              ? "(Upload in, download out)"
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
                placeholder="Click 'Pick Image' or paste a path the backend can read"
                className="w-full px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                required
              />
            </div>
            <button
              type="button"
              onClick={handlePickImage}
              disabled={sketch.isPending || isStaging}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-md shadow-indigo-600/20 shrink-0"
            >
              {isStaging ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {isStaging ? "Uploading…" : "Pick Image"}
            </button>
          </div>

          {/* What the backend will read, and who has to move the file */}
          {imagePath && (
            <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs text-zinc-400 space-y-1">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Backend Path ({mode}):</span>
              </div>
              <div className="font-mono text-[11px] text-zinc-400 pl-5 space-y-0.5">
                <div>
                  Selected: <span className="text-zinc-200">{imagePath}</span>
                </div>
                <div>
                  Backend sees:{" "}
                  <span className="text-indigo-300 font-semibold">
                    {inputPlan.path || "—"}
                  </span>
                </div>
                {inputPlan.needsUpload && (
                  <div className="text-amber-400/90 text-[10px]">
                    &bull; The file is uploaded to the backend when the run
                    starts: the container only reads files it was given.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Files this session put on the backend: the user decides whether they stay */}
          {uploadedInputs.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-zinc-500">
                {uploadedInputs.length} file(s) uploaded to the backend this
                session.
              </span>
              <button
                type="button"
                onClick={handleDeleteInputs}
                disabled={sketch.isPending}
                data-testid="single-delete-uploads"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-rose-600/20 disabled:opacity-50 text-zinc-300 hover:text-rose-300 border border-zinc-700 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete uploads
              </button>
            </div>
          )}

          {/* Where the produced video should go (default: beside the image) */}
          <div className="pt-3 border-t border-zinc-800/80">
            <OutputFolderField
              id="single-output-dir"
              value={outputDir}
              onChange={setOutputDir}
              plan={outputPlan}
            />
          </div>
        </div>

        {/* Collapsible Advanced Configuration Form */}
        <AdvancedConfigForm
          config={config}
          onChangeConfig={setConfig}
          objectMaskPath={objectMaskPath}
          onChangeObjectMaskPath={setObjectMaskPath}
          handImagePath={handImagePath}
          onChangeHandImagePath={setHandImagePath}
          handMaskPath={handMaskPath}
          onChangeHandMaskPath={setHandMaskPath}
          onUploaded={trackUpload}
          isBatchMode={false}
        />

        {/* Action Controls, Live Progress & Submit Button */}
        <div className="space-y-3">
          {sketch.isPending && (
            <ProgressBar
              testId="single-progress"
              percent={progress?.percent ?? null}
              label={progress?.label || "Preparing the sketch…"}
              detail={frameDetail(progress)}
            />
          )}

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5" />
              Sketch Video Generated Successfully
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || resultDeleted}
                data-testid="single-delete"
                title="Delete the file from the backend"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600/20 disabled:opacity-50 text-zinc-300 hover:text-rose-300 text-xs font-medium border border-zinc-700 transition-colors"
              >
                {isDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {isDeleting ? "Deleting…" : "Delete"}
              </button>

              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading || resultDeleted}
                data-testid="single-download"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
              >
                {isDownloading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {isDownloading ? "Preparing…" : "Download MP4"}
              </button>
            </div>
          </div>

          {/* Video Player or Fallback */}
          <div className="relative aspect-video max-w-2xl mx-auto rounded-xl overflow-hidden bg-black border border-zinc-800 flex items-center justify-center">
            {resultDeleted ? (
              <div className="p-6 text-center space-y-2">
                <Trash2 className="w-12 h-12 text-zinc-600 mx-auto" />
                <p className="text-sm font-semibold text-zinc-300">
                  Deleted from the backend
                </p>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  The file is gone from the server. Run the sketch again if you
                  need another copy.
                </p>
              </div>
            ) : videoFailedToLoad ? (
              <div className="p-6 text-center space-y-3">
                <Film className="w-12 h-12 text-zinc-600 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-zinc-300">
                    The video could not be played here
                  </p>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                    The file exists on the backend. Use Download MP4 to save it.
                  </p>
                </div>
              </div>
            ) : (
              <video
                data-testid="single-video"
                src={previewUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
                onError={() => {
                  setVideoFailedToLoad(true);
                }}
              >
                Your browser/webview does not support the video tag.
              </video>
            )}
          </div>

          {/* Backend File Path & Download Actions */}
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-semibold text-zinc-300">
                {mode === "sidecar"
                  ? "Output File (host):"
                  : "File on the Backend:"}
              </span>
              <button
                type="button"
                onClick={() => handleCopyPath(result.output_path)}
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
              {result.output_path}
            </div>

            <div className="text-[11px] text-zinc-500">
              {mode === "sidecar"
                ? "Written directly by the native backend, at the path above."
                : "Kept inside the backend until you download it. Deleting it here does not touch a copy you already saved, and the container's scratch space is cleared on restart anyway."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
