"use client";

import type { AppError, ProcessingStage } from "@/lib/types";
import { PROCESS_STEPS, stageLabel, stepState } from "@/lib/process";

type StatusPanelProps = {
  stage: ProcessingStage;
  error: AppError | null;
  fileName: string | null;
  failedStage?: ProcessingStage | null;
};

export function StatusPanel({ stage, error, fileName, failedStage }: StatusPanelProps) {
  const showSteps = stage !== "idle" || Boolean(fileName);

  return (
    <section className="sidebar-section">
      <h2>Status</h2>

      {fileName ? (
        <p className="file-chip" title={fileName}>
          {fileName}
        </p>
      ) : null}

      <p className={`status-line ${stage === "error" ? "error" : ""}`}>
        {error?.message ?? stageLabel(stage)}
      </p>

      {showSteps ? (
        <ol className="step-list">
          {PROCESS_STEPS.map((step) => {
            const state =
              stage === "error"
                ? stepState(step.id, stage, failedStage)
                : stepState(step.id, stage);
            return (
              <li key={step.id} className={`step step-${state}`}>
                <span className="step-marker" aria-hidden />
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {error ? (
        <div className="error-panel" role="alert">
          <strong>{error.title}</strong>
          {error.details ? <p>{error.details}</p> : null}
          {error.suggestions?.length ? (
            <ul>
              {error.suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          ) : null}
          {error.statusCode ? (
            <p className="muted tiny">HTTP {error.statusCode}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
