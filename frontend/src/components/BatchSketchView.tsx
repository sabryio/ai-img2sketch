import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Film,
  Folder,
  FolderOpen,
  Info,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  BatchItemResult,
  BatchSketchRequest,
  SketchConfig,
} from "../lib/api/types";
import { mapBackendPathToHost, mapHostPathToBackend } from "../lib/paths";
import { convertPathToAssetUrl, openDirectoryDialog } from "../lib/tauri";
import { useBackendStore } from "../stores/backend";
import { useGenerationStore } from "../stores/generation";
import { AdvancedConfigForm } from "./AdvancedConfigForm";

export const BatchSketchView: React.FC = () => {
  const { mode, pathConfig, ready } = useBackendStore();
  const {
    inFlightBatch,
    batchElapsedSec,
    batchResult,
    batchSummary,
    lastError,
    executeBatchGeneration,
    resetBatchResult,
    clearLastError,
  } = useGenerationStore();

  const [inputDir, setInputDir] = useState<string>("");
  const [outputDir, setOutputDir] = useState<string>("");
  const [selectedPreviewVideo, setSelectedPreviewVideo] = useState<{
    image: string;
    path: string;
    assetUrl: string;
  } | null>(null);

  const [config, setConfig] = useState<SketchConfig>({
    frame_rate: 25,
    split_len: 10,
    object_skip_rate: 8,
    draw_duration_sec: null,
    end_duration_sec: 2,
    black_pixel_threshold: 10,
  });

  const handlePickInputDir = async () => {
    const picked = await openDirectoryDialog(
      "Select Input Directory of Images",
    );
    if (picked) {
      setInputDir(picked);
      resetBatchResult();
      clearLastError();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputDir.trim() || inFlightBatch || !ready) return;

    const req: BatchSketchRequest = {
      input_dir: inputDir.trim(),
      output_dir: outputDir.trim() ? outputDir.trim() : null,
      config,
    };

    await executeBatchGeneration(req);
  };

  const handlePreviewItem = async (item: BatchItemResult) => {
    if (!item.output_path) return;
    const url = await convertPathToAssetUrl(item.output_path);
    setSelectedPreviewVideo({
      image: item.image,
      path: item.output_path,
      assetUrl: url || item.output_path,
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
            <label className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
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
              disabled={inFlightBatch}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-md shadow-indigo-600/20 shrink-0"
            >
              <FolderOpen className="w-4 h-4" />
              Select Folder
            </button>
          </div>

          {/* Quick Demo Pre-fill for Web Testing */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
            <span className="text-zinc-500">Quick batch samples:</span>
            <button
              type="button"
              onClick={() => setInputDir("./media/sample_batch")}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-[10px] transition-colors"
            >
              ./media/sample_batch
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
            {inFlightBatch ? (
              <span className="flex items-center gap-2 text-indigo-400 animate-pulse font-mono">
                <Clock className="w-4 h-4" />
                Processing batch images... Elapsed: {batchElapsedSec}s
              </span>
            ) : (
              <span>
                Batch processing runs synchronously through all valid image
                formats.
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {batchResult && (
              <button
                type="button"
                onClick={resetBatchResult}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                Clear Table
              </button>
            )}

            <button
              type="submit"
              disabled={!inputDir.trim() || inFlightBatch || !ready}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-all shadow-lg shadow-indigo-600/25"
            >
              {inFlightBatch ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing Batch ({batchElapsedSec}s)...
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
      {lastError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-rose-300">
                Batch Processing Error
              </h4>
              <p className="text-xs text-rose-200 mt-1">{lastError.message}</p>
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
      )}

      {/* Batch Results Table & Summary */}
      {batchResult && (
        <div className="rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl overflow-hidden space-y-4 p-5 animate-fade-in">
          {/* Summary Line from batch.completed payload */}
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
                  Input folder: {inputDir}
                </p>
              </div>
            </div>

            {batchSummary && (
              <div className="flex items-center gap-3 text-xs font-medium">
                <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {batchSummary.succeeded} Succeeded
                </span>
                {batchSummary.failed > 0 && (
                  <span className="px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    {batchSummary.failed} Failed
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-300">
                  Total: {batchSummary.total}
                </span>
              </div>
            )}
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
                {batchResult.items.map((item, idx) => {
                  const hasError = Boolean(item.error);

                  return (
                    <tr
                      key={idx}
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
                            {item.output_path || "—"}
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
