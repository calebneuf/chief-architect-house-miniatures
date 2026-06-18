"use client";

import { useCallback, useState } from "react";

type UploadDropzoneProps = {
  disabled?: boolean;
  onFileSelected: (file: File) => void;
};

export function UploadDropzone({ disabled, onFileSelected }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length || disabled) {
        return;
      }
      const file = files[0];
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".stl") && !lower.endsWith(".obj")) {
        return;
      }
      onFileSelected(file);
    },
    [disabled, onFileSelected],
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
      <p>Drop an STL or OBJ export from Chief Architect here.</p>
      <p className="muted">Maximum file size: 50 MB</p>
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
