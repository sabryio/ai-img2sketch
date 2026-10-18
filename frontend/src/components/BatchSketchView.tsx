import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Film,
  Folder,
  FolderOpen,
  Info,
  Layers,
  Loader2,
  Play,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  useElapsed,
  useGenerateBatch,
  useRunProgress,
  useStoreMedia,
} from "../hooks";
import type { BatchItem, EventData, SketchOptions } from "../rpc/contract";
import {
  artifactDownloadUrl,
  discardArtifact,
  fetchArtifact,
} from "../rpc/artifacts";
import { toAppError } from "../lib/errors";
import {
  IMAGE_EXTENSIONS,
  isImageFile,
  newUploadBucket,
  parentDirectory,
  stageFiles,
} from "../lib/media";
import { getBasename, planInputPath, planOutput } from "../lib/paths";
import { frameDetail, itemDetail } from "../lib/progress";
import {
  isTauriEnvironment,
  pickImageDirectory,
  readHostImageDirectory,
  saveArtifactBlob,
  writeArtifactToFolder,
} from "../lib/tauri";
import { useBackendStore } from "../stores/backend";
import { useNotificationsStore } from "../stores/notifications";
import { AdvancedConfigForm } from "./AdvancedConfigForm";
import { DrawingCanvas } from "./DrawingCanvas";
import { OutputFolderField } from "./OutputFolderField";
import { ProgressBar } from "./ProgressBar";

interface BatchSketchViewProps {
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

interface BatchSummary {
  succeeded: number;
  failed: number;
  total: number;
}

/** The run summary is derived from the per-image results, so it can never disagree with the table. */
function summarize(items: BatchItem[]): BatchSummary {
  const succeeded = items.filter((item) => !item.error).length;
  return { succeeded, failed: items.length - succeeded, total: items.length };
}

/** Output paths of the rows that a batch already deleted from the backend. */
function remainingOutputs(items: BatchItem[], deleted: string[]): string[] {
  return items
    .map((item) => item.output_path)
    .filter(
      (path): path is string => Boolean(path) && !deleted.includes(path as string),
    );
}

export const BatchSketchView: React.FC<BatchSketchViewProps> = ({
  ready,
  latestEvent,
}) => {
  const { mode } = useBackendStore();
  const addToast = useNotificationsStore((state) => state.addToast);
  const storeMedia = useStoreMedia();

  const [inputDir, setInputDir] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [config, setConfig] = useState<SketchOptions>(DEFAULT_CONFIG);
  const [errorDismissed, setErrorDismissed] = useState(false);
  /** True while a picked folder is being uploaded to the backend. */
  const [isStaging, setIsStaging] = useState(false);
  /** Backend path of the row currently being downloaded, `""` when idle. */
  const [downloadingPath, setDownloadingPath] = useState<string>("");
  /** Backend path of the row currently being deleted, `""` when idle. */
  const [deletingPath, setDeletingPath] = useState<string>("");
  /** Container paths this session uploaded, so they can be removed again. */
  const [uploadedInputs, setUploadedInputs] = useState<string[]>([]);
  /** Produced paths already deleted from the backend. */
  const [deletedOutputs, setDeletedOutputs] = useState<string[]>([]);
  const [selectedPreviewVideo, setSelectedPreviewVideo] = useState<{
    image: string;
    path: string;
  } | null>(null);

  /**
   * Where the videos end up. Empty means the backend writes beside each image;
   * a host folder is written by the desktop app after the run, or downloaded
   * when no host write is possible (see `planOutput`).
   */
  const outputPlan = useMemo(
    () => planOutput(outputDir, mode, isTauriEnvironment()),
    [outputDir, mode],
  );

  const inputPlan = useMemo(
    () => planInputPath(inputDir, mode),
    [inputDir, mode],
  );

  const trackUpload = (paths: string[]) => {
    setUploadedInputs((previous) => [...new Set([...previous, ...paths])]);
  };

  /**
   * Hand every produced video to the folder the user asked for when the backend
   * could not write there itself — one toast for the run, not one per file.
   */
  const exportResults = async (backendOutputPaths: string[]): Promise<void> => {
    const exportDir = outputPlan.exportDir;
    if (!exportDir || backendOutputPaths.length === 0) {
      return;
    }

    const written: boolean[] = [];
    for (const backendPath of backendOutputPaths) {
      try {
        const blob = await fetchArtifact(backendPath);
        written.push(
          await writeArtifactToFolder(
            blob,
            exportDir,
            getBasename(backendPath),
          ),
        );
      } catch {
        // Reported in the summary below; the videos stay downloadable either way.
        written.push(false);
      }
    }

    const exported = written.filter(Boolean).length;
    addToast({
      type: exported === written.length ? "success" : "warning",
      title:
        exported === written.length
          ? "Videos Exported"
          : "Some Videos Were Not Exported",
      message: `${exported}/${written.length} videos written to ${exportDir}. The rest are still on the backend: use Download.`,
    });
  };

  const batch = useGenerateBatch({
    onSuccess: async (data) => {
      const summary = summarize(data.items);
      addToast({
        type: summary.failed > 0 ? "warning" : "success",
        title: "Batch Completed",
        message: `Processed ${summary.total} files: ${summary.succeeded} succeeded, ${summary.failed} failed.`,
      });
      await exportResults(
        data.items
          .map((item) => item.output_path)
          .filter((path): path is string => Boolean(path)),
      );
    },
    onError: (error) => {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: appError.status
          ? `Batch Error (${appError.status})`
          : "Batch Generation Failed",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    },
  });

  const elapsedSec = useElapsed(batch.isPending);
  const progress = useRunProgress(latestEvent, batch.isPending, "batch");
  const result = batch.data;
  const summary = result ? summarize(result.items) : null;
  const appError =
    batch.error && !errorDismissed ? toAppError(batch.error, mode) : null;

  const handlePickInputDir = async () => {
    const picked = await pickImageDirectory();
    if (!picked) {
      return;
    }

    // Desktop: a host folder. It is uploaded on submit if the backend cannot
    // read it where it is (see `inputPlan`).
    if (picked.path) {
      setInputDir(picked.path);
      setErrorDismissed(false);
      batch.reset();
      return;
    }

    // Browser: no folder path exists, so upload the images and point the run at
    // the folder they landed in.
    const files = (picked.files ?? []).filter(isImageFile);
    if (files.length === 0) {
      addToast({
        type: "warning",
        title: "No images in that folder",
        message: `Pick a folder containing ${IMAGE_EXTENSIONS.join(", ")} files.`,
      });
      return;
    }

    setIsStaging(true);
    try {
      const paths = await stageFiles(
        files,
        (input) => storeMedia.mutateAsync(input),
        newUploadBucket(),
      );
      const directory = parentDirectory(paths[0]);
      setInputDir(directory);
      trackUpload(paths);
      setErrorDismissed(false);
      batch.reset();
      addToast({
        type: "success",
        title: "Folder Uploaded",
        message: `${paths.length} image(s) uploaded; the backend reads them from ${directory}.`,
      });
    } catch (error) {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: "Could not upload the folder",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    } finally {
      setIsStaging(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputDir.trim();
    if (!trimmed || batch.isPending || !ready) {
      return;
    }

    setErrorDismissed(false);

    // Docker mode has no host mounts: a typed host folder has to be read and
    // uploaded before the backend can scan it.
    let backendInputDir = trimmed;
    if (inputPlan.needsUpload) {
      const files = await readHostImageDirectory(trimmed);
      if (!files || files.length === 0) {
        addToast({
          type: "error",
          title: "Could not read the folder",
          message: `No readable images in ${trimmed}. Use "Select Folder" so the app can upload them to the backend.`,
        });
        return;
      }

      setIsStaging(true);
      try {
        const paths = await stageFiles(
          files,
          (input) => storeMedia.mutateAsync(input),
          newUploadBucket(),
        );
        backendInputDir = parentDirectory(paths[0]);
        setInputDir(backendInputDir);
        trackUpload(paths);
      } catch (error) {
        const appError = toAppError(error, mode);
        addToast({
          type: "error",
          title: "Could not upload the folder",
          message: appError.message,
          verbatim: appError.verbatim,
        });
        return;
      } finally {
        setIsStaging(false);
      }
    }

    try {
      await batch.mutateAsync({
        input_dir: backendInputDir,
        output_dir: outputPlan.backendOutputDir,
        config,
      });
    } catch {
      // Surfaced through the mutation's `onError` and the error banner below.
    }
  };

  /** Fetch one produced video from the backend and save it where asked. */
  const handleDownloadItem = async (item: BatchItem) => {
    if (!item.output_path || downloadingPath) {
      return;
    }

    setDownloadingPath(item.output_path);
    try {
      const blob = await fetchArtifact(item.output_path);
      const outcome = await saveArtifactBlob(
        blob,
        getBasename(item.output_path),
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
      setDownloadingPath("");
    }
  };

  /** Delete one produced video, keeping whatever the user already saved. */
  const deleteOne = async (backendPath: string): Promise<void> => {
    await discardArtifact(backendPath);
    setDeletedOutputs((previous) =>
      previous.includes(backendPath) ? previous : [...previous, backendPath],
    );
  };

  const handleDeleteItem = async (item: BatchItem) => {
    if (!item.output_path || deletingPath) {
      return;
    }

    setDeletingPath(item.output_path);
    try {
      await deleteOne(item.output_path);
      addToast({
        type: "success",
        title: "Deleted from the backend",
        message: `${getBasename(item.output_path)} is gone from the server.`,
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
      setDeletingPath("");
    }
  };

  /** Delete every produced video the run left on the backend. */
  const handleDeleteAll = async () => {
    if (!result) {
      return;
    }

    const pending = remainingOutputs(result.items, deletedOutputs);
    if (pending.length === 0) {
      return;
    }

    setDeletingPath("all");
    try {
      for (const backendPath of pending) {
        await deleteOne(backendPath);
      }
      addToast({
        type: "success",
        title: "Deleted from the backend",
        message: `${pending.length} video(s) removed from the server.`,
      });
    } catch (error) {
      const appError = toAppError(error, mode);
      addToast({
        type: "error",
        title: "Could not delete every video",
        message: appError.message,
        verbatim: appError.verbatim,
      });
    } finally {
      setDeletingPath("");
    }
  };

  /** Remove everything this session uploaded, so nothing is left behind. */
  const handleDeleteUploads = async () => {
    if (uploadedInputs.length === 0 || batch.isPending) {
      return;
    }

    try {
      await Promise.all(uploadedInputs.map((path) => discardArtifact(path)));
      const removed = uploadedInputs.length;
      if (uploadedInputs.includes(inputDir.trim())) {
        setInputDir("");
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

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-6">
      {/* Screen title, its purpose, and the execution mode this run targets */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[19px] font-semibold tracking-[-0.01em] text-room-text">
            <Layers aria-hidden="true" className="h-4 w-4 text-onion" />
            Batch Image Sketch Processing
          </h2>
          <p className="mt-1 text-micro text-room-muted">
            Process entire folders of images sequentially. Corrupt images are
            recorded without stopping the batch.
          </p>
        </div>

        <div className="flex items-center gap-2 text-micro text-room-muted">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor:
                mode === "docker"
                  ? "var(--color-onion)"
                  : "var(--color-committed-soft)",
            }}
          />
          <span>Target Mode:</span>
          <span className="mono text-room-text">{mode} Mode</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* The run's inputs */}
        <div className="region shrink-0 space-y-4 p-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="batch-input-dir"
                className="label flex items-center gap-2"
              >
                <Folder aria-hidden="true" className="h-3.5 w-3.5" />
                Input Images Directory
                <span className="text-alert-soft">*</span>
              </label>
              {inputDir && (
                <span className="mono text-micro text-room-faint">
                  Target Folder
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <input
                id="batch-input-dir"
                type="text"
                value={inputDir}
                onChange={(e) => setInputDir(e.target.value)}
                placeholder="Click 'Select Folder' or paste a folder the backend can read"
                className="field mono flex-1"
                required
              />
              <button
                type="button"
                onClick={handlePickInputDir}
                disabled={batch.isPending || isStaging}
                className="btn shrink-0"
              >
                {isStaging ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                  />
                ) : (
                  <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {isStaging ? "Uploading…" : "Select Folder"}
              </button>
            </div>
          </div>

          {/* What the backend will scan, and who has to move the files */}
          {inputDir && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-micro text-room-muted">
                <Info
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-onion"
                />
                <span>Backend Path ({mode}):</span>
              </div>
              <div className="mono space-y-0.5 pl-5 text-micro text-room-muted">
                <div>
                  Selected: <span className="text-room-text">{inputDir}</span>
                </div>
                <div>
                  Backend sees:{" "}
                  <span className="font-semibold text-onion">
                    {inputPlan.path || "—"}
                  </span>
                </div>
                {inputPlan.needsUpload && (
                  <div className="text-held-soft">
                    &bull; The images are uploaded to the backend when the run
                    starts: the container only reads files it was given.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Files this session put on the backend: the user decides whether they stay */}
          {uploadedInputs.length > 0 && (
            <div className="hairline flex flex-wrap items-center justify-between gap-2 pt-3 text-micro">
              <span className="text-room-muted">
                {uploadedInputs.length} file(s) uploaded to the backend this
                session.
              </span>
              <button
                type="button"
                onClick={handleDeleteUploads}
                disabled={batch.isPending}
                data-testid="batch-delete-uploads"
                className="btn btn-danger"
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                Delete uploads
              </button>
            </div>
          )}

          {/* Where the produced videos should go (default: beside each image) */}
          <div className="hairline pt-4">
            <OutputFolderField
              id="batch-output-dir"
              value={outputDir}
              onChange={setOutputDir}
              plan={outputPlan}
            />
          </div>

          {/* Live status of the run, and the primary action */}
          <div className="hairline flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-micro text-room-muted">
              {batch.isPending ? (
                <span className="flex items-center gap-2 text-onion">
                  <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                  Processing batch images... Elapsed: {elapsedSec}s
                </span>
              ) : (
                <span>
                  Batch processing runs synchronously through all valid image
                  formats.
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={!inputDir.trim() || batch.isPending || !ready}
              className="btn btn-primary shrink-0"
            >
              {batch.isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                  Processing Batch ({elapsedSec}s)...
                </>
              ) : (
                <>
                  <Play aria-hidden="true" className="h-3.5 w-3.5" />
                  Run Batch Generation
                </>
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Advanced Configuration Form */}
        <AdvancedConfigForm
          config={config}
          onChangeConfig={setConfig}
          isBatchMode={true}
        />
      </form>

      {/* Error */}
      {appError && (
        <div
          role="alert"
          data-testid="batch-error"
          className="region flex items-start justify-between gap-4 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-alert-soft"
            />
            <div>
              <h4 className="text-value font-semibold text-room-text">
                Batch Processing Error
              </h4>
              <p className="mt-1 text-micro text-alert-soft">
                {appError.message}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setErrorDismissed(true)}
            className="btn btn-quiet shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {((result && summary) || batch.isPending) && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Summary of the whole run, at the head of the stack */}
          {result && summary && (
            <div className="flex flex-col gap-3 border-b border-room-line pb-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-committed-soft"
                />
                <div>
                  <h3 className="text-value font-semibold text-room-text">
                    Batch Run Complete
                  </h3>
                  <p className="mono text-micro text-room-faint">
                    Input folder: {result.input_dir}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div
                  data-testid="batch-summary"
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro"
                >
                  <span className="tnum font-medium text-committed-soft">
                    {summary.succeeded} Succeeded
                  </span>
                  {summary.failed > 0 && (
                    <span className="tnum font-medium text-alert-soft">
                      {summary.failed} Failed
                    </span>
                  )}
                  <span className="tnum text-room-muted">
                    Total: {summary.total}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => batch.reset()}
                  className="btn btn-quiet"
                >
                  Clear Table
                </button>

                <button
                  type="button"
                  onClick={handleDeleteAll}
                  disabled={
                    Boolean(deletingPath) ||
                    remainingOutputs(result.items, deletedOutputs).length === 0
                  }
                  data-testid="batch-delete-all"
                  title="Delete every produced video from the backend"
                  className="btn btn-danger"
                >
                  {deletingPath === "all" ? (
                    <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                  {deletingPath === "all" ? "Deleting…" : "Delete all"}
                </button>
              </div>
            </div>
          )}

          {/* The image being drawn right now */}
          {batch.isPending && (
            <section className="sheet slip-in flex shrink-0 flex-col lg:flex-1">
              <div className="pegbar">
                <i />
                <i />
                <i />
              </div>
              <div className="flex min-h-0 flex-1 flex-col p-5">
                <DrawingCanvas
                  percent={progress?.percent ?? null}
                  frameSrc={
                    progress?.previewPath
                      ? artifactDownloadUrl(progress.previewPath, "inline")
                      : undefined
                  }
                  className="aspect-video lg:aspect-auto lg:min-h-[220px] lg:flex-1"
                  empty={
                    <span className="mono text-micro text-graphite-3">
                      {progress?.itemName ?? ""}
                    </span>
                  }
                />
                <div className="mt-4">
                  <ProgressBar
                    testId="batch-progress"
                    percent={progress?.percent ?? null}
                    label={progress?.label || "Preparing the batch…"}
                    detail={frameDetail(progress)}
                    itemDetail={itemDetail(progress)}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Every image in the run, in the order the backend scanned them */}
          {result && summary && (
            <div className="fade-in min-h-0 flex-1 overflow-y-auto">
              {result.items.map((item, idx) => {
                const hasError = Boolean(item.error);
                const outputPath = item.output_path ?? "";
                const isDeleted =
                  Boolean(outputPath) && deletedOutputs.includes(outputPath);

                return (
                  <div
                    key={`${item.image}-${idx}`}
                    data-testid="batch-row"
                    className="flex flex-col gap-1.5 border-b border-room-line py-3"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      {hasError ? (
                        <span className="tag tag-alert normal-case">
                          <XCircle aria-hidden="true" className="h-3 w-3" />
                          Failed
                        </span>
                      ) : isDeleted ? (
                        <span className="tag tag-quiet normal-case">
                          <Trash2 aria-hidden="true" className="h-3 w-3" />
                          Deleted
                        </span>
                      ) : (
                        <span className="tag tag-committed normal-case">
                          <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                          Success
                        </span>
                      )}

                      <span className="mono min-w-0 flex-1 truncate text-value text-room-text">
                        {item.image}
                      </span>

                      {!hasError && outputPath && !isDeleted && (
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedPreviewVideo({
                                image: item.image,
                                path: outputPath,
                              })
                            }
                            className="btn btn-quiet"
                          >
                            <Film aria-hidden="true" className="h-3.5 w-3.5" />
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadItem(item)}
                            disabled={Boolean(downloadingPath)}
                            data-testid="batch-download"
                            className="btn"
                          >
                            {downloadingPath === outputPath ? (
                              <Loader2
                                aria-hidden="true"
                                className="h-3.5 w-3.5 animate-spin"
                              />
                            ) : (
                              <Download aria-hidden="true" className="h-3.5 w-3.5" />
                            )}
                            {downloadingPath === outputPath
                              ? "Preparing…"
                              : "Download"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item)}
                            disabled={Boolean(deletingPath)}
                            data-testid="batch-delete"
                            title="Delete this video from the backend"
                            className="btn btn-danger"
                          >
                            {deletingPath === outputPath ? (
                              <Loader2
                                aria-hidden="true"
                                className="h-3.5 w-3.5 animate-spin"
                              />
                            ) : (
                              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                            )}
                            {deletingPath === outputPath ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="label shrink-0">
                        {hasError ? "Error" : "Output"}
                      </span>
                      {hasError ? (
                        <span className="min-w-0 flex-1 truncate text-micro text-alert-soft">
                          {item.error}
                        </span>
                      ) : (
                        <span
                          data-testid="batch-output-path"
                          className={`mono min-w-0 flex-1 truncate text-micro ${
                            isDeleted
                              ? "text-room-faint line-through"
                              : "text-room-muted"
                          }`}
                        >
                          {outputPath || "—"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Video Modal Preview for Batch Items */}
      {selectedPreviewVideo && (
        <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <section className="sheet flex w-full max-w-2xl flex-col">
            <div className="pegbar">
              <i />
              <i />
              <i />
            </div>
            <div className="flex items-start justify-between gap-4 border-b border-sheet-line p-3">
              <div className="min-w-0">
                <h4 className="truncate text-value font-semibold text-graphite">
                  Preview Video: {selectedPreviewVideo.image}
                </h4>
                <p className="mono truncate text-micro text-graphite-3">
                  {selectedPreviewVideo.path}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPreviewVideo(null)}
                className="sheet-btn shrink-0"
              >
                Close
              </button>
            </div>

            <div className="p-3">
              <div className="aspect-video overflow-hidden rounded-sheet border border-sheet-line bg-graphite">
                {/* Streamed from the API: a container path is not playable directly. */}
                <video
                  src={artifactDownloadUrl(selectedPreviewVideo.path, "inline")}
                  controls
                  autoPlay
                  className="h-full w-full object-contain"
                >
                  Video not supported
                </video>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
