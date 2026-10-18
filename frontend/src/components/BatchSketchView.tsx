import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Film,
  Folder,
  FolderOpen,
  Info,
  Layers,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { useElapsed, useGenerateBatch } from "../hooks";
import type { BatchItem, SketchOptions } from "../rpc/contract";
import { toAppError } from "../lib/errors";
import { mapBackendPathToHost, mapHostPathToBackend } from "../lib/paths";
import { convertPathToAssetUrl, openDirectoryDialog } from "../lib/tauri";
import { useBackendStore } from "../stores/backend";
import { useNotificationsStore } from "../stores/notifications";
import { AdvancedConfigForm } from "./AdvancedConfigForm";

interface BatchSketchViewProps {
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

export const BatchSketchView: React.FC<BatchSketchViewProps> = ({ ready }) => {
  const { mode, pathConfig } = useBackendStore();
  const addToast = useNotificationsStore((state) => state.addToast);

  const [inputDir, setInputDir] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [config, setConfig] = useState<SketchOptions>(DEFAULT_CONFIG);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [selectedPreviewVideo, setSelectedPreviewVideo] = useState<{
    image: string;
    path: string;
    assetUrl: string;
  } | null>(null);

  const batch = useGenerateBatch({
    onSuccess: (data) => {
      const summary = summarize(data.items);
      addToast({
        type: summary.failed > 0 ? "warning" : "success",
        title: "Batch Completed",
        message: `Processed ${summary.total} files: ${summary.succeeded} succeeded, ${summary.failed} failed.`,
      });
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
  const result = batch.data;
  const summary = result ? summarize(result.items) : null;
  const appError =
    batch.error && !errorDismissed ? toAppError(batch.error, mode) : null;

  const handlePickInputDir = async () => {
    const picked = await openDirectoryDialog(
      "Select Input Directory of Images",
    );
    if (picked) {
      setInputDir(picked);
      setErrorDismissed(false);
      batch.reset();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputDir.trim();
    if (!trimmed || batch.isPending || !ready) {
      return;
    }

    setErrorDismissed(false);

    // Both modes go through the mapper: sidecar only normalizes separators,
    // Docker rewrites into the mounted volume the container can see.
    const backendInputDir = mapHostPathToBackend(
      trimmed,
      mode,
      pathConfig,
    ).backendPath;

    try {
      await batch.mutateAsync({
        input_dir: backendInputDir,
        output_dir: outputDir.trim() ? outputDir.trim() : undefined,
        config,
      });
    } catch {
      // Surfaced through the mutation's `onError` and the error banner below.
    }
  };

  const handlePreviewItem = async (item: BatchItem) => {
    if (!item.output_path) return;
    const hostPath = mapBackendPathToHost(item.output_path, mode, pathConfig);
    const url = await convertPathToAssetUrl(hostPath);
    setSelectedPreviewVideo({
      image: item.image,
      path: hostPath,
      assetUrl: url,
    });
  };

  const pathMappingInfo = inputDir
    ? mapHostPathToBackend(inputDir, mode, pathConfig)
    : null;

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
              placeholder="e.g. ./media/batch_images or /path/to/folder"
              className="flex-1 px-3.5 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
              required
            />
            <button
              type="button"
              onClick={handlePickInputDir}
              disabled={batch.isPending}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-md shadow-indigo-600/20 shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
              Select Folder
            </button>
          </div>

          {/* Path Mapping helper */}
          {pathMappingInfo && (
            <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs text-zinc-400 space-y-1">
              <div className="flex items-center gap-2 text-zinc-300 font-medium">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Backend Directory Mapping ({mode}):</span>
              </div>
              <div className="font-mono text-[11px] text-zinc-400 pl-5">
                Backend directory request:{" "}
                <span className="text-indigo-300 font-semibold">
                  {pathMappingInfo.backendPath}
                </span>
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
          isBatchMode={true}
        />

        {/* Action Controls & Submit Button */}
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
          </div>

          {/* Items Table */}
          <div className="border border-zinc-800 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-950/80 border-b border-zinc-800 text-zinc-400 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Image Filename</th>
                  <th className="py-3 px-4">Host Output Video Path</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 font-mono">
                {result.items.map((item, idx) => {
                  const hasError = Boolean(item.error);
                  const hostPath = item.output_path
                    ? mapBackendPathToHost(item.output_path, mode, pathConfig)
                    : "";

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
                          <span className="text-zinc-400 text-[11px]">
                            {hostPath || "—"}
                          </span>
                        )}
                      </td>

                      {/* Action Column */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {!hasError && item.output_path ? (
                          <button
                            type="button"
                            onClick={() => handlePreviewItem(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-sans text-xs transition-colors border border-indigo-500/30"
                          >
                            <Film className="w-3.5 h-3.5" />
                            Preview
                          </button>
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
              <video
                src={selectedPreviewVideo.assetUrl}
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
