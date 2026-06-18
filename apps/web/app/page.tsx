"use client";

import { useEffect, useMemo, useState } from "react";
import { HelpSidebar } from "@/components/HelpSidebar";
import { ModelViewer } from "@/components/ModelViewer";
import { StatsPanel } from "@/components/StatsPanel";
import { UploadDropzone } from "@/components/UploadDropzone";
import { base64ToBlobUrl, processModel, stageLabel } from "@/lib/process";
import type { ProcessStats, ProcessingStage } from "@/lib/types";

export default function HomePage() {
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (processedUrl) URL.revokeObjectURL(processedUrl);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl, originalUrl, processedUrl]);

  const busy = stage !== "idle" && stage !== "done" && stage !== "error";

  const handleFileSelected = async (file: File) => {
    setError(null);
    setStats(null);
    setFileName(file.name);

    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);

    const nextOriginalUrl = URL.createObjectURL(file);
    setOriginalUrl(nextOriginalUrl);
    setProcessedUrl(null);
    setDownloadUrl(null);

    try {
      setStage("uploading");
      await new Promise((resolve) => setTimeout(resolve, 150));
      setStage("analyzing");
      await new Promise((resolve) => setTimeout(resolve, 150));
      setStage("culling");

      const result = await processModel(file);

      setStage("exporting");
      const processedObjectUrl = base64ToBlobUrl(result.stlBase64, "model/stl");
      const downloadableUrl = base64ToBlobUrl(result.stlBase64, "model/stl");
      setProcessedUrl(processedObjectUrl);
      setDownloadUrl(downloadableUrl);
      setStats({
        facesBefore: result.facesBefore,
        facesAfter: result.facesAfter,
        facesRemoved: result.facesRemoved,
        componentsRemoved: result.componentsRemoved,
        processingMs: result.processingMs,
      });
      setStage("done");
    } catch (processingError) {
      setStage("error");
      setError(
        processingError instanceof Error
          ? processingError.message
          : "Processing failed.",
      );
    }
  };

  const downloadName = useMemo(() => {
    if (!fileName) return "miniature.stl";
    const base = fileName.replace(/\.(stl|obj)$/i, "");
    return `${base}-miniature.stl`;
  }, [fileName]);

  return (
    <main className="page">
      <section className="hero">
        <h1>House Miniature Prep</h1>
        <p>
          Upload a Chief Architect STL or OBJ export and prepare an above-ground exterior
          miniature by removing interior walls, basements, and site clutter.
        </p>
      </section>

      <div className="layout">
        <section className="panel">
          <h2>Upload and process</h2>
          <UploadDropzone
            disabled={busy}
            onFileSelected={handleFileSelected}
            onFileRejected={(message) => {
              setError(message);
              setStage("error");
            }}
          />
          <p className={`status ${stage === "error" ? "error" : ""}`}>
            {error ?? stageLabel(stage)}
          </p>

          <div className="viewer-grid">
            <ModelViewer title="Original" url={originalUrl} fileName={fileName ?? undefined} />
            <ModelViewer
              title="Processed"
              url={processedUrl}
              fileName={processedUrl ? "processed.stl" : undefined}
            />
          </div>

          <div className="actions">
            {downloadUrl ? (
              <a className="primary" href={downloadUrl} download={downloadName}>
                Download STL
              </a>
            ) : (
              <button className="primary" type="button" disabled>
                Download STL
              </button>
            )}
          </div>
        </section>

        <aside style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
          <StatsPanel stats={stats} />
          <HelpSidebar />
        </aside>
      </div>
    </main>
  );
}
