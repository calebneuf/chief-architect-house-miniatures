"use client";

import { ComponentCleanupPanel } from "@/components/ComponentCleanupPanel";
import type {
  AppError,
  MeshComponent,
  ProcessStats,
  ProcessingStage,
  ViewMode,
  WorkerHealth,
} from "@/lib/types";
import { MAX_UPLOAD_LABEL } from "@/lib/constants";
import { HelpSidebar } from "@/components/HelpSidebar";
import { StatsPanel } from "@/components/StatsPanel";
import { StatusPanel } from "@/components/StatusPanel";
import { UploadDropzone } from "@/components/UploadDropzone";

type AppSidebarProps = {
  busy: boolean;
  stage: ProcessingStage;
  error: AppError | null;
  failedStage: ProcessingStage | null;
  fileName: string | null;
  stats: ProcessStats | null;
  workerHealth: WorkerHealth;
  workerDetail: string;
  viewMode: ViewMode;
  hasProcessed: boolean;
  hasLive: boolean;
  hasCompare: boolean;
  downloadUrl: string | null;
  downloadName: string;
  components: MeshComponent[];
  excludedIds: number[];
  selectedComponentId?: number | null;
  cleanupReady: boolean;
  manualCleanupUsed: boolean;
  onExcludedChange: (ids: number[]) => void;
  onSelectComponent?: (id: number | null) => void;
  onProcess: () => void;
  onFileSelected: (file: File) => void;
  onFileRejected: (message: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
};

export function AppSidebar({
  busy,
  stage,
  error,
  failedStage,
  fileName,
  stats,
  workerHealth,
  workerDetail,
  viewMode,
  hasProcessed,
  hasLive,
  hasCompare,
  downloadUrl,
  downloadName,
  components,
  excludedIds,
  selectedComponentId = null,
  cleanupReady,
  manualCleanupUsed,
  onExcludedChange,
  onSelectComponent,
  onProcess,
  onFileSelected,
  onFileRejected,
  onViewModeChange,
}: AppSidebarProps) {
  const canProcess = cleanupReady && stage === "cleanup" && !busy;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>House Miniature Prep</h1>
        <p className="muted">
          Prepare Chief Architect exports for 3D printing by keeping the above-ground exterior shell.
        </p>
      </div>

      <section className="sidebar-section worker-status">
        <div className="worker-row">
          <span className={`health-dot health-${workerHealth}`} aria-hidden />
          <div>
            <strong>
              {workerHealth === "checking"
                ? "Checking mesh worker…"
                : workerHealth === "online"
                  ? "Mesh worker online"
                  : "Mesh worker offline"}
            </strong>
            <p className="muted tiny">{workerDetail}</p>
          </div>
        </div>
      </section>

      <section className="sidebar-section">
        <h2>Upload</h2>
        <UploadDropzone
          disabled={busy}
          onFileSelected={onFileSelected}
          onFileRejected={onFileRejected}
        />
        <p className="muted tiny">Max size: {MAX_UPLOAD_LABEL}</p>
      </section>

      {cleanupReady && components.length > 0 ? (
        <ComponentCleanupPanel
          components={components}
          excludedIds={excludedIds}
          selectedComponentId={selectedComponentId}
          disabled={busy}
          onExcludedChange={onExcludedChange}
          onSelectComponent={onSelectComponent}
        />
      ) : null}

      {cleanupReady ? (
        <section className="sidebar-section">
          <button
            className="primary block"
            type="button"
            disabled={!canProcess}
            onClick={onProcess}
          >
            {busy ? "Processing…" : "Process model"}
          </button>
        </section>
      ) : null}

      <StatusPanel
        stage={stage}
        error={error}
        fileName={fileName}
        failedStage={failedStage}
        manualCleanup={manualCleanupUsed}
      />

      <StatsPanel stats={stats} compact />

      {fileName ? (
        <section className="sidebar-section">
          <h2>Preview</h2>
          <div className="segmented segmented-4">
            <button
              type="button"
              className={viewMode === "original" ? "active" : ""}
              onClick={() => onViewModeChange("original")}
            >
              Original
            </button>
            <button
              type="button"
              className={viewMode === "compare" ? "active" : ""}
              onClick={() => onViewModeChange("compare")}
              disabled={!hasCompare}
            >
              Compare
            </button>
            <button
              type="button"
              className={viewMode === "live" ? "active" : ""}
              onClick={() => onViewModeChange("live")}
              disabled={!hasLive}
            >
              Live
            </button>
            <button
              type="button"
              className={viewMode === "processed" ? "active" : ""}
              onClick={() => onViewModeChange("processed")}
              disabled={!hasProcessed}
            >
              Processed
            </button>
          </div>
        </section>
      ) : null}

      <section className="sidebar-section">
        {downloadUrl ? (
          <a className="primary block" href={downloadUrl} download={downloadName}>
            Download STL
          </a>
        ) : (
          <button className="primary block" type="button" disabled>
            Download STL
          </button>
        )}
      </section>

      <HelpSidebar compact />
    </aside>
  );
}
