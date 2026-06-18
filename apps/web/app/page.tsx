"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { WorkspaceCanvas } from "@/components/WorkspaceCanvas";
import {
  base64ToBlobUrl,
  checkWorkerHealth,
  processModel,
  ProcessRequestError,
} from "@/lib/process";
import type { AppError, ProcessStats, ProcessingStage, ViewMode, WorkerHealth } from "@/lib/types";

export default function HomePage() {
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [failedStage, setFailedStage] = useState<ProcessingStage | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("original");
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth>("checking");
  const [workerDetail, setWorkerDetail] = useState("Checking connection…");

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (processedUrl) URL.revokeObjectURL(processedUrl);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl, originalUrl, processedUrl]);

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

  const busy = stage !== "idle" && stage !== "done" && stage !== "error";

  const setFailure = (nextError: AppError, atStage: ProcessingStage) => {
    console.error("[miniature-prep] failed at", atStage, nextError);
    setStage("error");
    setFailedStage(atStage);
    setError(nextError);
  };

  const handleFileSelected = async (file: File) => {
    setError(null);
    setFailedStage(null);
    setStats(null);
    setFileName(file.name);
    setViewMode("original");

    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);

    const nextOriginalUrl = URL.createObjectURL(file);
    setOriginalUrl(nextOriginalUrl);
    setProcessedUrl(null);
    setDownloadUrl(null);

    let currentStage: ProcessingStage = "uploading";

    try {
      currentStage = "uploading";
      console.log("[miniature-prep] stage: uploading", file.name, file.size);
      setStage("uploading");
      currentStage = "analyzing";
      console.log("[miniature-prep] stage: analyzing");
      setStage("analyzing");
      currentStage = "culling";
      console.log("[miniature-prep] stage: culling (waiting for mesh worker…)");
      setStage("culling");

      const result = await processModel(file);

      currentStage = "exporting";
      console.log("[miniature-prep] stage: exporting", result);
      setStage("exporting");
      const processedObjectUrl = base64ToBlobUrl(result.stlBase64, "model/stl");
      const downloadableUrl = base64ToBlobUrl(result.stlBase64, "model/stl");
      setProcessedUrl(processedObjectUrl);
      setDownloadUrl(downloadableUrl);
      setViewMode("processed");
      setStats({
        facesBefore: result.facesBefore,
        facesAfter: result.facesAfter,
        facesRemoved: result.facesRemoved,
        componentsRemoved: result.componentsRemoved,
        processingMs: result.processingMs,
      });
      setStage("done");
      console.log("[miniature-prep] stage: done");
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

  const activeUrl = viewMode === "processed" ? processedUrl : originalUrl;
  const activeLabel =
    viewMode === "processed" ? "Processed miniature" : fileName ? "Original upload" : undefined;

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
        hasProcessed={Boolean(processedUrl)}
        downloadUrl={downloadUrl}
        downloadName={downloadName}
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
        url={activeUrl}
        fileName={
          viewMode === "processed"
            ? "processed.stl"
            : fileName ?? undefined
        }
        label={activeLabel}
      />
    </div>
  );
}
