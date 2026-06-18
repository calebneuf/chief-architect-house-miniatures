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
