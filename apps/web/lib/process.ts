import type { ApiErrorPayload, AppError, ProcessResponse, ProcessingStage } from "@/lib/types";

export const PROCESS_STEPS: { id: ProcessingStage; label: string }[] = [
  { id: "uploading", label: "Upload file" },
  { id: "analyzing", label: "Analyze mesh" },
  { id: "culling", label: "Remove interior & site geometry" },
  { id: "exporting", label: "Export printable STL" },
];

const STAGE_LABELS: Record<ProcessingStage, string> = {
  idle: "Upload a Chief Architect STL or OBJ to begin.",
  uploading: "Sending your model to the server…",
  analyzing: "Reading geometry and preparing the mesh…",
  culling: "Removing interior walls and filling the house into one solid printable model… Large files may take several minutes.",
  exporting: "Building the processed STL preview…",
  done: "Processing finished. Review the result in the workspace.",
  error: "Processing failed.",
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

export async function processModel(file: File): Promise<ProcessResponse> {
  debugLog("processModel:start", { name: file.name, bytes: file.size });
  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    debugLog("processModel:POST /api/process");
    response = await fetch("/api/process", {
      method: "POST",
      body: formData,
    });
  } catch (cause) {
    debugLog("processModel:network-error", cause);
    throw new ProcessRequestError({
      title: "Could not reach the web API",
      message: "The browser failed to contact /api/process.",
      details: cause instanceof Error ? cause.message : undefined,
      suggestions: [
        "Refresh the page and try again.",
        "Confirm the web container is running.",
      ],
    });
  }

  let payload: ApiErrorPayload & Partial<ProcessResponse & { stl_base64?: string }>;
  try {
    payload = await response.json();
  } catch {
    throw new ProcessRequestError({
      title: "Unexpected server response",
      message: "The server returned a non-JSON response.",
      statusCode: response.status,
      suggestions: ["Check the web and mesh-worker container logs."],
    });
  }

  if (!response.ok) {
    debugLog("processModel:api-error", response.status, payload);
    throw new ProcessRequestError(toAppError(payload, response.status));
  }

  debugLog("processModel:complete", {
    facesBefore: payload.facesBefore,
    facesAfter: payload.facesAfter,
    processingMs: payload.processingMs,
  });

  return {
    stlBase64: payload.stlBase64 ?? "",
    facesBefore: payload.facesBefore ?? 0,
    facesAfter: payload.facesAfter ?? 0,
    facesRemoved: payload.facesRemoved ?? 0,
    componentsRemoved: payload.componentsRemoved ?? 0,
    processingMs: payload.processingMs ?? 0,
  };
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
    "analyzing",
    "culling",
    "exporting",
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
