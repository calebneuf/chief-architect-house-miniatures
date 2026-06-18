import type { ProcessResponse, ProcessingStage } from "@/lib/types";

const STAGE_LABELS: Record<ProcessingStage, string> = {
  idle: "Ready to process a model.",
  uploading: "Uploading model…",
  analyzing: "Analyzing mesh…",
  culling: "Removing interior partition walls…",
  exporting: "Exporting printable STL…",
  done: "Processing complete.",
  error: "Processing failed.",
};

export function stageLabel(stage: ProcessingStage): string {
  return STAGE_LABELS[stage];
}

export async function processModel(file: File): Promise<ProcessResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/process", {
    method: "POST",
    body: formData,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Processing failed.");
  }

  return {
    stlBase64: payload.stlBase64,
    facesBefore: payload.facesBefore,
    facesAfter: payload.facesAfter,
    facesRemoved: payload.facesRemoved,
    componentsRemoved: payload.componentsRemoved,
    processingMs: payload.processingMs,
  };
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
