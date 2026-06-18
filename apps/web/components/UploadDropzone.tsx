"use client";

import { useCallback, useState } from "react";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/constants";

type UploadDropzoneProps = {
  disabled?: boolean;
  onFileSelected: (file: File) => void;
  onFileRejected?: (message: string) => void;
};

export function UploadDropzone({ disabled, onFileSelected, onFileRejected }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length || disabled) {
        return;
      }
      const file = files[0];
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".stl") && !lower.endsWith(".obj")) {
        onFileRejected?.("Upload an STL or OBJ file.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        onFileRejected?.(`File exceeds ${MAX_UPLOAD_LABEL} limit.`);
        return;
      }
      onFileSelected(file);
    },
    [disabled, onFileRejected, onFileSelected],
  );

  return (
    <div
      className={`dropzone ${dragging ? "dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <p>Drop STL or OBJ here</p>
      <p className="muted tiny">Chief Architect export</p>
      <label>
        Choose file
        <input
          type="file"
          accept=".stl,.obj"
          disabled={disabled}
          onChange={(event) => handleFiles(event.target.files)}
        />
      </label>
    </div>
  );
}
