export type MeshComponent = {
  id: number;
  faces: number;
  bounds: number[][];
  extents: number[];
  footprint: number;
};

export type ProcessStats = {
  facesBefore: number;
  facesAfter: number;
  facesRemoved: number;
  componentsRemoved: number;
  processingMs: number;
  groundFloorZ?: number;
  ceilingZ?: number;
};

export type ProcessResponse = ProcessStats & {
  stlBase64: string;
};

export type ProcessingStage =
  | "idle"
  | "analyzing"
  | "cleanup"
  | "uploading"
  | "loading"
  | "repairing"
  | "removing_site"
  | "slicing_floor"
  | "pruning_interior"
  | "extruding_solid"
  | "complete"
  | "done"
  | "error";

export type JobStatus = "queued" | "running" | "complete" | "failed";

export type JobPollResponse = {
  jobId: string;
  status: JobStatus;
  stage: string;
  progress: number;
  previewStlBase64: string | null;
  error: string | null;
  result: ProcessResponse | null;
};

export type ViewMode = "original" | "processed" | "live" | "compare";

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
