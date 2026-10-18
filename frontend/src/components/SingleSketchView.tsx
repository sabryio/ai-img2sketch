import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Copy,
  Download,
  FileImage,
  Film,
  Loader2,
  Play,
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
import { DrawingCanvas } from "./DrawingCanvas";
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
  /** The source image URL the artifact route refused, so the sheet falls back. */
  const [failedSourceUrl, setFailedSourceUrl] = useState<string>("");
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

  /** The selected image, once the backend can serve it without an upload. */
  const sourceImageUrl =
    imagePath.trim().length > 0 && !inputPlan.needsUpload
      ? artifactDownloadUrl(imagePath.trim(), "inline")
      : "";

  const showsVideo =
    Boolean(result) && !resultDeleted && !videoFailedToLoad && !sketch.isPending;
  const showsSourceImage =
    Boolean(sourceImageUrl) &&
    sourceImageUrl !== failedSourceUrl &&
    !showsVideo &&
    !sketch.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-7 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[392px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
      {/* The sheet header is its own column: it scrolls when the parameters
          outgrow the window, so the page itself never has to. */}
      <section className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto lg:pr-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-room-text">
          Synthesize Sketch Video
        </h2>
        <p className="mt-1.5 text-micro text-room-muted">
          Convert any 2D image into an animated drawing sketch video with
          realistic stroke ordering.
        </p>

        <div className="row mt-5 items-center">
          <span className="label">Target Mode:</span>
          <span className="flex flex-col items-end gap-1">
            <span className="tag tag-pencil normal-case">{mode} Mode</span>
            <span className="text-micro text-room-faint">
              {mode === "docker"
                ? "(Upload in, download out)"
                : "(Native Direct Host FS)"}
            </span>
          </span>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="row flex-col items-stretch">
            <div className="flex items-baseline justify-between gap-3">
              <label
                htmlFor="single-image-path"
                className="label flex items-center gap-1.5"
              >
                <FileImage
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-onion"
                />
                Source Image File
                <span className="text-alert-soft">*</span>
              </label>
              {imagePath && (
                <span className="text-micro text-room-faint">Selected</span>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                id="single-image-path"
                type="text"
                value={imagePath}
                onChange={(e) => setImagePath(e.target.value)}
                placeholder="Click 'Pick Image' or paste a path the backend can read"
                required
                className="field mono min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={handlePickImage}
                disabled={sketch.isPending || isStaging}
                className="btn shrink-0"
              >
                {isStaging ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                  />
                ) : (
                  <Upload aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {isStaging ? "Uploading…" : "Pick Image"}
              </button>
            </div>
          </div>

          <OutputFolderField
            id="single-output-dir"
            value={outputDir}
            onChange={setOutputDir}
            plan={outputPlan}
            input={{ path: imagePath, plan: inputPlan, mode }}
          />

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

          <div className="mt-6 flex flex-col gap-3">
            {result && (
              <button
                type="button"
                onClick={() => sketch.reset()}
                className="btn btn-quiet self-start"
              >
                Clear Result
              </button>
            )}

            <button
              type="submit"
              disabled={!imagePath.trim() || sketch.isPending || !ready}
              className="btn btn-primary w-full"
            >
              {sketch.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Generating ({elapsedSec}s)...
                </>
              ) : (
                <>
                  <Play aria-hidden="true" className="h-4 w-4" />
                  Generate Sketch Video
                </>
              )}
            </button>

            <p className="text-micro text-room-muted">
              {sketch.isPending ? (
                <span className="mono flex items-center gap-1.5">
                  <Clock
                    aria-hidden="true"
                    className="h-3.5 w-3.5 text-onion"
                  />
                  Synthesizing sketch frames... Elapsed: {elapsedSec}s
                </span>
              ) : (
                "Synchronous generation. May take several seconds."
              )}
            </p>

            {uploadedInputs.length > 0 && (
              <div className="row items-center">
                <span className="text-micro text-room-muted">
                  {uploadedInputs.length} file(s) uploaded to the backend this
                  session.
                </span>
                <button
                  type="button"
                  onClick={handleDeleteInputs}
                  disabled={sketch.isPending}
                  data-testid="single-delete-uploads"
                  className="btn btn-quiet shrink-0"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  Delete uploads
                </button>
              </div>
            )}
          </div>
        </form>
      </section>

      <section className="sheet flex min-h-0 flex-col">
        <div className="pegbar">
          <i />
          <i />
          <i />
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-5">
          <DrawingCanvas
            className="aspect-video lg:aspect-auto lg:min-h-[200px] lg:flex-1"
            percent={sketch.isPending ? (progress?.percent ?? null) : undefined}
            frameSrc={
              sketch.isPending && progress?.previewPath
                ? artifactDownloadUrl(progress.previewPath, "inline")
                : undefined
            }
            underlay={
              sketch.isPending && sourceImageUrl ? (
                <img
                  src={sourceImageUrl}
                  alt=""
                  className="h-full w-full object-contain"
                  onError={() => setFailedSourceUrl(sourceImageUrl)}
                />
              ) : undefined
            }
            media={
              showsVideo ? (
                <video
                  data-testid="single-video"
                  src={previewUrl}
                  controls
                  autoPlay
                  className="h-full w-full object-contain"
                  onError={() => {
                    setVideoFailedToLoad(true);
                  }}
                >
                  Your browser/webview does not support the video tag.
                </video>
              ) : showsSourceImage ? (
                <img
                  src={sourceImageUrl}
                  alt="Selected source image"
                  className="h-full w-full object-contain"
                  onError={() => setFailedSourceUrl(sourceImageUrl)}
                />
              ) : undefined
            }
            empty={
              resultDeleted ? (
                <div className="space-y-1.5">
                  <p className="text-value font-semibold text-graphite-2">
                    Deleted from the backend
                  </p>
                  <p className="max-w-[44ch] text-micro text-graphite-3">
                    The file is gone from the server. Run the sketch again if
                    you need another copy.
                  </p>
                </div>
              ) : videoFailedToLoad && !showsSourceImage && !sketch.isPending ? (
                <div className="space-y-1.5">
                  <Film
                    aria-hidden="true"
                    className="mx-auto h-5 w-5 text-graphite-3"
                  />
                  <p className="text-value font-semibold text-graphite-2">
                    The video could not be played here
                  </p>
                  <p className="max-w-[44ch] text-micro text-graphite-3">
                    The file exists on the backend. Use Download MP4 to save it.
                  </p>
                </div>
              ) : !result && !showsSourceImage && !sketch.isPending ? (
                <p className="max-w-[40ch] text-micro text-graphite-3">
                  Pick a source image, then generate the sketch — the render
                  lands here.
                </p>
              ) : undefined
            }
          />

          {videoFailedToLoad && showsSourceImage && (
            <div className="mt-3 flex items-start gap-2.5 border-t border-sheet-line pt-3">
              <Film
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-graphite-3"
              />
              <div>
                <p className="text-value font-semibold text-graphite-2">
                  The video could not be played here
                </p>
                <p className="mt-1 text-micro text-graphite-3">
                  The file exists on the backend. Use Download MP4 to save it.
                </p>
              </div>
            </div>
          )}

          {sketch.isPending && (
            <div className="mt-4">
              <ProgressBar
                testId="single-progress"
                percent={progress?.percent ?? null}
                label={progress?.label || "Preparing the sketch…"}
                detail={frameDetail(progress)}
              />
            </div>
          )}

          {appError && (
            <div
              role="alert"
              data-testid="single-error"
              className="mt-4 border-t border-sheet-line pt-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-alert-ink"
                  />
                  <div>
                    <h4 className="text-value font-semibold text-alert-ink">
                      {appError.status
                        ? `Request Error ${appError.status}`
                        : "Backend Request Failed"}
                    </h4>
                    <p className="mt-1 text-micro text-graphite-2">
                      {appError.message}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setErrorDismissed(true)}
                  className="sheet-btn shrink-0"
                >
                  Dismiss
                </button>
              </div>

              {appError.verbatim && (
                <div className="mt-3 border-t border-sheet-line pt-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="sheet-label">Verbatim backend error:</span>
                    <button
                      type="button"
                      onClick={() => handleCopyVerbatimError(appError.verbatim!)}
                      className="sheet-btn"
                    >
                      <Copy aria-hidden="true" className="h-3 w-3" />
                      {copiedError ? "Copied verbatim!" : "Copy error"}
                    </button>
                  </div>
                  <pre className="mono max-h-48 overflow-x-auto rounded-sheet border border-sheet-line bg-sheet-raised p-3 text-micro text-graphite-2 select-all">
                    {appError.verbatim}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {result && (
          <div className="fade-in mt-auto border-t border-sheet-line p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="sheet-label shrink-0">
                {mode === "sidecar"
                  ? "Output File (host):"
                  : "File on the Backend:"}
              </span>
              <span
                data-testid="single-output-path"
                className="mono min-w-0 flex-1 truncate text-micro text-graphite-2"
              >
                {result.output_path}
              </span>
              <button
                type="button"
                onClick={() => handleCopyPath(result.output_path)}
                className="sheet-btn shrink-0"
              >
                <Copy aria-hidden="true" className="h-3 w-3" />
                {copiedPath ? "Copied!" : "Copy path"}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading || resultDeleted}
                data-testid="single-download"
                className="sheet-btn sheet-btn-solid shrink-0"
              >
                {isDownloading ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                  />
                ) : (
                  <Download aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {isDownloading ? "Preparing…" : "Download MP4"}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || resultDeleted}
                data-testid="single-delete"
                title="Delete the file from the backend"
                className="sheet-btn shrink-0"
              >
                {isDeleting ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                  />
                ) : (
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>

            <p className="mt-2 text-micro text-graphite-3">
              {mode === "sidecar"
                ? "Written directly by the native backend, at the path above."
                : "Kept inside the backend until you download it. Deleting it here does not touch a copy you already saved, and the container's scratch space is cleared on restart anyway."}
            </p>
          </div>
        )}
    </section>
  </div>
  );
};
