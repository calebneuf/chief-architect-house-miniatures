import type {
  ApiErrorPayload,
  AppError,
  JobPollResponse,
  ProcessResponse,
  ProcessingStage,
} from "@/lib/types";

export const PROCESS_STEPS: { id: ProcessingStage; label: string }[] = [
  { id: "uploading", label: "Upload file" },
  { id: "loading", label: "Load model" },
  { id: "repairing", label: "Repair mesh" },
  { id: "removing_site", label: "Remove site clutter" },
  { id: "slicing_floor", label: "Slice at ground floor" },
  { id: "pruning_interior", label: "Remove interior walls" },
  { id: "extruding_solid", label: "Extrude to roof shape" },
  { id: "complete", label: "Finish export" },
];

const STAGE_LABELS: Record<ProcessingStage, string> = {
  idle: "Upload a Chief Architect STL or OBJ to begin.",
  uploading: "Sending your model to the server…",
  loading: "Loading geometry…",
  repairing: "Repairing mesh…",
  removing_site: "Removing fences and detached site objects…",
  slicing_floor: "Detecting ground floor and cutting off basements…",
  pruning_interior: "Removing interior partitions…",
  extruding_solid:
    "Extruding the floor plan up to the roof surface… Preview updates live.",
  complete: "Packaging final STL…",
  done: "Processing finished. Review the result in the workspace.",
  error: "Processing failed.",
};

const WORKER_STAGE_TO_UI: Record<string, ProcessingStage> = {
  queued: "uploading",
  loading: "loading",
  repairing: "repairing",
  removing_site: "removing_site",
  slicing_floor: "slicing_floor",
  pruning_interior: "pruning_interior",
  extruding_solid: "extruding_solid",
  complete: "complete",
  failed: "error",
};

const DEBUG = process.env.NODE_ENV !== "production";

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    console.log("[miniature-prep]", ...args);
  }
}

export function stageLabel(stage: ProcessingStage): string {
  return STAGE_LABELS[stage];
}

export function mapWorkerStage(stage: string): ProcessingStage {
  return WORKER_STAGE_TO_UI[stage] ?? "loading";
}

export class ProcessRequestError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = "ProcessRequestError";
    this.appError = appError;
  }
}

function toAppError(payload: ApiErrorPayload, statusCode: number): AppError {
  const suggestions = payload.suggestions ?? [];

  if (payload.code === "WORKER_UNREACHABLE") {
    return {
      title: "Mesh worker is not running",
      message: payload.error,
      details: payload.details,
      suggestions: suggestions.length
        ? suggestions
        : [
            "The worker may be busy on a large file — check mesh-worker logs first.",
            "Start the mesh-worker container in Dockge.",
            "Confirm MESH_WORKER_URL=http://mesh-worker:8000 on the web service.",
          ],
      statusCode,
    };
  }

  if (payload.code === "WORKER_TIMEOUT") {
    return {
      title: "Processing is taking too long",
      message: payload.error,
      details: payload.details,
      suggestions: suggestions.length
        ? suggestions
        : [
            "Check mesh-worker logs — processing may still be running.",
            "Hide extra layers in Chief Architect to reduce export size.",
          ],
      statusCode,
    };
  }

  if (statusCode === 413) {
    return {
      title: "File is too large",
      message: payload.error,
      details: payload.details,
      suggestions: ["Export a smaller model from Chief Architect or hide extra layers before export."],
      statusCode,
    };
  }

  return {
    title: "Processing failed",
    message: payload.error,
    details: payload.details,
    suggestions: suggestions.length ? suggestions : ["Try re-exporting from Chief Architect and upload again."],
    statusCode,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export type ProcessModelOptions = {
  onStage?: (stage: ProcessingStage, progress: number) => void;
  onPreview?: (stlBase64: string) => void;
};

export async function processModel(
  file: File,
  options: ProcessModelOptions = {},
): Promise<ProcessResponse> {
  debugLog("processModel:start", { name: file.name, bytes: file.size });
  const formData = new FormData();
  formData.append("file", file);

  let createResponse: Response;
  try {
    createResponse = await fetch("/api/jobs", {
      method: "POST",
      body: formData,
    });
  } catch (cause) {
    throw new ProcessRequestError({
      title: "Could not reach the web API",
      message: "The browser failed to contact /api/jobs.",
      details: cause instanceof Error ? cause.message : undefined,
      suggestions: ["Refresh the page and try again."],
    });
  }

  let createPayload: ApiErrorPayload & { jobId?: string };
  try {
    createPayload = await createResponse.json();
  } catch {
    throw new ProcessRequestError({
      title: "Unexpected server response",
      message: "The server returned a non-JSON response when starting the job.",
      statusCode: createResponse.status,
    });
  }

  if (!createResponse.ok || !createPayload.jobId) {
    throw new ProcessRequestError(toAppError(createPayload, createResponse.status));
  }

  const jobId = createPayload.jobId;
  debugLog("processModel:job", jobId);

  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(1500);

    let pollResponse: Response;
    try {
      pollResponse = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
    } catch (cause) {
      debugLog("processModel:poll-error", cause);
      continue;
    }

    let pollPayload: JobPollResponse & ApiErrorPayload;
    try {
      pollPayload = await pollResponse.json();
    } catch {
      continue;
    }

    if (!pollResponse.ok) {
      throw new ProcessRequestError(toAppError(pollPayload, pollResponse.status));
    }

    const uiStage = mapWorkerStage(pollPayload.stage);
    options.onStage?.(uiStage, pollPayload.progress);
    debugLog("processModel:stage", pollPayload.stage, pollPayload.progress);

    if (pollPayload.previewStlBase64) {
      options.onPreview?.(pollPayload.previewStlBase64);
    }

    if (pollPayload.status === "complete" && pollPayload.result) {
      return pollPayload.result;
    }

    if (pollPayload.status === "failed") {
      throw new ProcessRequestError({
        title: "Processing failed",
        message: pollPayload.error ?? "The mesh worker reported a failure.",
        suggestions: ["Check mesh-worker logs for the full traceback."],
      });
    }
  }

  throw new ProcessRequestError({
    title: "Processing timed out",
    message: "No result after 20 minutes.",
    details: "The mesh worker did not finish within the allowed window.",
    suggestions: ["Check mesh-worker logs — the job may still be running."],
  });
}

export async function checkWorkerHealth(): Promise<{ online: boolean; detail: string }> {
  try {
    debugLog("health:check");
    const response = await fetch("/api/health", { cache: "no-store" });
    const payload = await response.json();
    debugLog("health:response", response.status, payload);
    if (!response.ok) {
      return {
        online: false,
        detail: payload.details ?? payload.error ?? "Health check failed.",
      };
    }
    return {
      online: payload.status === "ok",
      detail: payload.workerUrl ?? "Worker reachable",
    };
  } catch (cause) {
    return {
      online: false,
      detail: cause instanceof Error ? cause.message : "Health check failed.",
    };
  }
}

export function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

export function stepState(
  stepId: ProcessingStage,
  currentStage: ProcessingStage,
  failedStage?: ProcessingStage | null,
): "complete" | "active" | "pending" | "error" {
  const order: ProcessingStage[] = [
    "uploading",
    "loading",
    "repairing",
    "removing_site",
    "slicing_floor",
    "pruning_interior",
    "extruding_solid",
    "complete",
    "done",
  ];

  if (currentStage === "error" && failedStage) {
    const failedIndex = order.indexOf(failedStage);
    const stepIndex = order.indexOf(stepId);
    if (stepIndex < failedIndex) {
      return "complete";
    }
    if (stepIndex === failedIndex) {
      return "error";
    }
    return "pending";
  }

  if (currentStage === "idle") {
    return "pending";
  }

  const stepIndex = order.indexOf(stepId);
  const currentIndex = order.indexOf(currentStage);
  if (currentIndex === -1) {
    return "pending";
  }
  if (stepIndex < currentIndex || currentStage === "done") {
    return "complete";
  }
  if (stepIndex === currentIndex) {
    return "active";
  }
  return "pending";
}
