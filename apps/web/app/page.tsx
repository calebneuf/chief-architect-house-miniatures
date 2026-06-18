"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { WorkspaceCanvas } from "@/components/WorkspaceCanvas";
import {
  analyzeModel,
  base64ToArrayBuffer,
  base64ToBlobUrl,
  checkWorkerHealth,
  processModel,
  ProcessRequestError,
} from "@/lib/process";
import type {
  AppError,
  MeshComponent,
  ProcessStats,
  ProcessingStage,
  ViewMode,
  WorkerHealth,
} from "@/lib/types";

export default function HomePage() {
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [failedStage, setFailedStage] = useState<ProcessingStage | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<ArrayBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<ArrayBuffer | null>(null);
  const [liveBuffer, setLiveBuffer] = useState<ArrayBuffer | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("original");
  const [compareSplit, setCompareSplit] = useState(0.5);
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth>("checking");
  const [workerDetail, setWorkerDetail] = useState("Checking connection…");
  const [components, setComponents] = useState<MeshComponent[]>([]);
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [cleanupReady, setCleanupReady] = useState(false);
  const [manualCleanupUsed, setManualCleanupUsed] = useState(false);
  const [preserveLiveView, setPreserveLiveView] = useState(false);
  const downloadUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshHealth() {
      setWorkerHealth("checking");
      const result = await checkWorkerHealth();
      if (cancelled) {
        return;
      }
      setWorkerHealth(result.online ? "online" : "offline");
      setWorkerDetail(result.detail);
    }

    refreshHealth();
    const interval = window.setInterval(refreshHealth, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const busy =
    stage !== "idle" &&
    stage !== "cleanup" &&
    stage !== "done" &&
    stage !== "error";

  const setFailure = (nextError: AppError, atStage: ProcessingStage) => {
    console.error("[miniature-prep] failed at", atStage, nextError);
    setStage("error");
    setFailedStage(atStage);
    setError(nextError);
  };

  const updateLivePreview = (stlBase64: string) => {
    const isFollowUpPreview = Boolean(liveBuffer);
    setPreserveLiveView(isFollowUpPreview);
    setLiveBuffer(base64ToArrayBuffer(stlBase64));
  };

  const handleFileSelected = async (file: File) => {
    setError(null);
    setFailedStage(null);
    setStats(null);
    setFileName(file.name);
    setUploadedFile(file);
    setViewMode("original");
    setPreserveLiveView(false);
    setCleanupReady(false);
    setManualCleanupUsed(false);
    setExcludedIds([]);
    setComponents([]);
    setProcessedBuffer(null);
    setLiveBuffer(null);
    setCompareSplit(0.5);

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    setDownloadUrl(null);

    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (readError) {
      setFailure(
        {
          title: "Could not read file",
          message: readError instanceof Error ? readError.message : "Failed to read the upload.",
        },
        "uploading",
      );
      return;
    }

    setOriginalBuffer(buffer);

    try {
      setStage("analyzing");
      const analyzed = await analyzeModel(file);
      setComponents(analyzed);
      setStage("cleanup");
      setCleanupReady(true);
    } catch (analyzeError) {
      if (analyzeError instanceof ProcessRequestError) {
        setFailure(analyzeError.appError, "analyzing");
        return;
      }
      setFailure(
        {
          title: "Analysis failed",
          message:
            analyzeError instanceof Error ? analyzeError.message : "An unexpected error occurred.",
        },
        "analyzing",
      );
    }
  };

  const handleProcess = async () => {
    if (!uploadedFile) {
      return;
    }

    setError(null);
    setFailedStage(null);
    setStats(null);
    setManualCleanupUsed(true);
    setLiveBuffer(null);
    setProcessedBuffer(null);
    setPreserveLiveView(false);

    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    setDownloadUrl(null);

    let currentStage: ProcessingStage = "uploading";

    try {
      currentStage = "uploading";
      setStage("uploading");

      const result = await processModel(uploadedFile, {
        excludeComponents: excludedIds,
        manualCleanup: true,
        onStage: (nextStage, progress) => {
          currentStage = nextStage;
          setStage(nextStage);
          console.log("[miniature-prep] stage:", nextStage, `${Math.round(progress * 100)}%`);
        },
        onPreview: (stlBase64) => {
          console.log("[miniature-prep] live preview update");
          updateLivePreview(stlBase64);
        },
      });

      currentStage = "complete";
      setStage("complete");
      const processed = base64ToArrayBuffer(result.stlBase64);
      setProcessedBuffer(processed);
      const downloadableUrl = base64ToBlobUrl(result.stlBase64, "model/stl");
      downloadUrlRef.current = downloadableUrl;
      setDownloadUrl(downloadableUrl);
      setViewMode("compare");
      setStats({
        facesBefore: result.facesBefore,
        facesAfter: result.facesAfter,
        facesRemoved: result.facesRemoved,
        componentsRemoved: result.componentsRemoved,
        processingMs: result.processingMs,
        groundFloorZ: result.groundFloorZ,
        ceilingZ: result.ceilingZ,
      });
      setStage("done");
    } catch (processingError) {
      if (processingError instanceof ProcessRequestError) {
        setFailure(processingError.appError, currentStage);
        return;
      }
      setFailure(
        {
          title: "Processing failed",
          message:
            processingError instanceof Error
              ? processingError.message
              : "An unexpected error occurred.",
        },
        currentStage,
      );
    }
  };

  const downloadName = useMemo(() => {
    if (!fileName) return "miniature.stl";
    const base = fileName.replace(/\.(stl|obj)$/i, "");
    return `${base}-miniature.stl`;
  }, [fileName]);

  const compareSource = useMemo(() => {
    if (viewMode === "compare") {
      if (processedBuffer) {
        return { arrayBuffer: processedBuffer, fileName: "processed.stl" };
      }
      if (liveBuffer) {
        return { arrayBuffer: liveBuffer, fileName: "preview.stl" };
      }
    }
    if (viewMode === "processed" && processedBuffer) {
      return { arrayBuffer: processedBuffer, fileName: "processed.stl" };
    }
    if (viewMode === "live" && liveBuffer) {
      return { arrayBuffer: liveBuffer, fileName: "preview.stl" };
    }
    return null;
  }, [liveBuffer, processedBuffer, viewMode]);

  const primarySource = useMemo(() => {
    if (!originalBuffer && !fileName) {
      return null;
    }
    return {
      arrayBuffer: originalBuffer,
      fileName: fileName ?? "model.stl",
    };
  }, [fileName, originalBuffer]);

  const secondarySource = viewMode === "compare" ? compareSource : null;

  const singleSource =
    viewMode === "original" || viewMode === "compare"
      ? primarySource
      : compareSource ?? primarySource;

  const activeLabel =
    viewMode === "compare"
      ? "Original"
      : viewMode === "processed"
        ? "Processed miniature"
        : viewMode === "live"
          ? "Live preview"
          : fileName
            ? "Original upload"
            : undefined;

  const secondaryLabel = viewMode === "compare"
    ? processedBuffer
      ? "Processed"
      : "Live preview"
    : undefined;

  return (
    <div className="app-shell">
      <AppSidebar
        busy={busy}
        stage={stage}
        error={error}
        failedStage={failedStage}
        fileName={fileName}
        stats={stats}
        workerHealth={workerHealth}
        workerDetail={workerDetail}
        viewMode={viewMode}
        hasProcessed={Boolean(processedBuffer)}
        hasLive={Boolean(liveBuffer)}
        hasCompare={Boolean(originalBuffer && (processedBuffer || liveBuffer))}
        downloadUrl={downloadUrl}
        downloadName={downloadName}
        components={components}
        excludedIds={excludedIds}
        cleanupReady={cleanupReady}
        manualCleanupUsed={manualCleanupUsed}
        onExcludedChange={setExcludedIds}
        onProcess={handleProcess}
        onFileSelected={handleFileSelected}
        onFileRejected={(message) => {
          setFailure(
            {
              title: "Upload rejected",
              message,
            },
            "uploading",
          );
        }}
        onViewModeChange={setViewMode}
      />
      <WorkspaceCanvas
        source={viewMode === "compare" ? primarySource : singleSource}
        label={activeLabel}
        preserveView={viewMode === "live" && preserveLiveView}
        compare={secondarySource}
        compareLabel={secondaryLabel}
        compareSplit={compareSplit}
        onCompareSplitChange={setCompareSplit}
      />
    </div>
  );
}
