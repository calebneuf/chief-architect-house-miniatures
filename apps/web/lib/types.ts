export type ProcessStats = {
  facesBefore: number;
  facesAfter: number;
  facesRemoved: number;
  componentsRemoved: number;
  processingMs: number;
};

export type ProcessResponse = ProcessStats & {
  stlBase64: string;
};

export type ProcessingStage =
  | "idle"
  | "uploading"
  | "analyzing"
  | "culling"
  | "exporting"
  | "done"
  | "error";

export type ViewMode = "original" | "processed";

export type WorkerHealth = "checking" | "online" | "offline";

export type AppError = {
  title: string;
  message: string;
  details?: string;
  suggestions?: string[];
  statusCode?: number;
};

export type ApiErrorPayload = {
  error: string;
  code?: string;
  details?: string;
  suggestions?: string[];
};
