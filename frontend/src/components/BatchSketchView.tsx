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
    <div className="space-y-6">
      {/* View Title & Mode Information */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Batch Image Sketch Processing
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Process entire folders of images sequentially. Corrupt images are
            recorded without stopping the batch.
          </p>
        </div>

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
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Input Directory Selection Card */}
        <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <label
              htmlFor="batch-input-dir"
              className="text-sm font-semibold text-zinc-200 flex items-center gap-2"
            >
              <Folder className="w-4 h-4 text-indigo-400" />
              Input Images Directory
              <span className="text-rose-400">*</span>
            </label>
            {inputDir && (
              <span className="text-[11px] text-zinc-500 font-mono">
                Target Folder
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              id="batch-input-dir"
              type="text"
              value={inputDir}
              onChange={(e) => setInputDir(e.target.value)}
              placeholder="Click 'Select Folder' or paste a folder the backend can read"
              className="flex-1 px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
              required
            />
            <button
              type="button"
              onClick={handlePickInputDir}
              disabled={batch.isPending || isStaging}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-md shadow-indigo-600/20 shrink-0"
            >
              {isStaging ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FolderOpen className="w-4 h-4" />
              )}
              {isStaging ? "Uploading…" : "Select Folder"}
            </button>
          </div>

          {/* What the backend will scan, and who has to move the files */}
          {inputDir && (
            <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs text-zinc-400 space-y-1">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Backend Directory ({mode}):</span>
              </div>
              <div className="font-mono text-[11px] text-zinc-400 pl-5 space-y-0.5">
                <div>
                  Selected: <span className="text-zinc-200">{inputDir}</span>
                </div>
                <div>
                  Backend sees:{" "}
                  <span className="text-indigo-300 font-semibold">
                    {inputPlan.path || "—"}
                  </span>
                </div>
                {inputPlan.needsUpload && (
                  <div className="text-amber-400/90 text-[10px]">
                    &bull; The images are uploaded to the backend when the run
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
                onClick={handleDeleteUploads}
                disabled={batch.isPending}
                data-testid="batch-delete-uploads"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-rose-600/20 disabled:opacity-50 text-zinc-300 hover:text-rose-300 border border-zinc-700 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete uploads
              </button>
            </div>
          )}

          {/* Where the produced videos should go (default: beside each image) */}
          <div className="pt-3 border-t border-zinc-800/80">
            <OutputFolderField
              id="batch-output-dir"
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
          isBatchMode={true}
        />

        {/* Action Controls, Live Progress & Submit Button */}
        <div className="space-y-3">
          {batch.isPending && (
            <ProgressBar
              testId="batch-progress"
              percent={progress?.percent ?? null}
              label={progress?.label || "Preparing the batch…"}
              detail={frameDetail(progress)}
              itemDetail={itemDetail(progress)}
            />
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-zinc-500">
              {batch.isPending ? (
                <span className="flex items-center gap-2 text-indigo-400 animate-pulse font-mono">
                  <Clock className="w-4 h-4" />
                  Processing batch images... Elapsed: {elapsedSec}s
                </span>
              ) : (
                <span>
                  Batch processing runs synchronously through all valid image
                  formats.
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {result && (
                <button
                  type="button"
                  onClick={() => batch.reset()}
                  className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
                >
                  Clear Table
                </button>
              )}

              <button
                type="submit"
                disabled={!inputDir.trim() || batch.isPending || !ready}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/25"
              >
                {batch.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing Batch ({elapsedSec}s)...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    Run Batch Generation
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Error banner */}
      {appError && (
        <div
          role="alert"
          data-testid="batch-error"
          className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-rose-300">
                Batch Processing Error
              </h4>
              <p className="text-xs text-rose-200 mt-1">{appError.message}</p>
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
      )}

      {/* Batch Results Table & Summary */}
      {result && summary && (
        <div className="rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl overflow-hidden space-y-4 p-5 animate-fade-in">
          {/* Summary derived from the per-image results */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-zinc-950 border border-zinc-800/80">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  Batch Run Complete
                </h3>
                <p className="text-xs text-zinc-400 font-mono">
                  Input folder: {result.input_dir}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div
                data-testid="batch-summary"
                className="flex items-center gap-3 text-xs font-medium"
              >
                <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {summary.succeeded} Succeeded
                </span>
                {summary.failed > 0 && (
                  <span className="px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    {summary.failed} Failed
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-300">
                  Total: {summary.total}
                </span>
              </div>

              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={
                  Boolean(deletingPath) ||
                  remainingOutputs(result.items, deletedOutputs).length === 0
                }
                data-testid="batch-delete-all"
                title="Delete every produced video from the backend"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-rose-600/20 disabled:opacity-50 text-zinc-300 hover:text-rose-300 text-xs font-medium border border-zinc-700 transition-colors"
              >
                {deletingPath === "all" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {deletingPath === "all" ? "Deleting…" : "Delete all"}
              </button>
            </div>
          </div>

          {/* Items Table */}
          <div className="border border-zinc-800 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-950/80 border-b border-zinc-800 text-zinc-400 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Image Filename</th>
                  <th className="py-3 px-4">
                    Output Video ({mode === "sidecar" ? "host" : "backend"})
                  </th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 font-mono">
                {result.items.map((item, idx) => {
                  const hasError = Boolean(item.error);
                  const outputPath = item.output_path ?? "";
                  const isDeleted =
                    Boolean(outputPath) && deletedOutputs.includes(outputPath);

                  return (
                    <tr
                      key={`${item.image}-${idx}`}
                      data-testid="batch-row"
                      className={`transition-colors ${
                        hasError
                          ? "bg-rose-500/5 hover:bg-rose-500/10"
                          : "hover:bg-zinc-800/50"
                      }`}
                    >
                      {/* Status Column */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {hasError ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle className="w-3.5 h-3.5" />
                            Failed
                          </span>
                        ) : isDeleted ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
                            <Trash2 className="w-3.5 h-3.5" />
                            Deleted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Success
                          </span>
                        )}
                      </td>

                      {/* Image Name */}
                      <td className="py-3 px-4 font-medium text-zinc-200">
                        {item.image}
                      </td>

                      {/* Output or Error Column */}
                      <td className="py-3 px-4 max-w-md truncate">
                        {hasError ? (
                          <span className="text-rose-400 text-xs font-sans">
                            {item.error}
                          </span>
                        ) : (
                          <span
                            data-testid="batch-output-path"
                            className={
                              isDeleted
                                ? "text-zinc-600 text-[11px] line-through"
                                : "text-zinc-400 text-[11px]"
                            }
                          >
                            {outputPath || "—"}
                          </span>
                        )}
                      </td>

                      {/* Action Column */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {!hasError && outputPath && !isDeleted ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedPreviewVideo({
                                  image: item.image,
                                  path: outputPath,
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-sans text-xs transition-colors border border-indigo-500/30"
                            >
                              <Film className="w-3.5 h-3.5" />
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadItem(item)}
                              disabled={Boolean(downloadingPath)}
                              data-testid="batch-download"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 font-sans text-xs transition-colors border border-zinc-700"
                            >
                              {downloadingPath === outputPath ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
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
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-rose-600/20 disabled:opacity-50 text-zinc-300 hover:text-rose-300 font-sans text-xs transition-colors border border-zinc-700"
                            >
                              {deletingPath === outputPath ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                              {deletingPath === outputPath
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-zinc-600 text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Video Modal Preview for Batch Items */}
      {selectedPreviewVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="max-w-2xl w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Preview Video: {selectedPreviewVideo.image}
                </h4>
                <p className="text-xs text-zinc-400 font-mono truncate max-w-md">
                  {selectedPreviewVideo.path}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPreviewVideo(null)}
                className="text-zinc-400 hover:text-white text-xs px-2.5 py-1 rounded-lg bg-zinc-800"
              >
                Close
              </button>
            </div>

            <div className="aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center border border-zinc-800">
              {/* Streamed from the API: a container path is not playable directly. */}
              <video
                src={artifactDownloadUrl(selectedPreviewVideo.path, "inline")}
                controls
                autoPlay
                className="w-full h-full object-contain"
              >
                Video not supported
              </video>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
