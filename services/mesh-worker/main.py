from __future__ import annotations

import base64

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pipeline.load import detect_file_type
from pipeline.process import process_mesh_bytes

app = FastAPI(title="House Miniature Mesh Worker", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


class ProcessResponse(BaseModel):
    stl_base64: str
    faces_before: int
    faces_after: int
    faces_removed: int
    components_removed: int
    processing_ms: int


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/process", response_model=ProcessResponse)
async def process(file: UploadFile = File(...)) -> ProcessResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required.")

    try:
        file_type = detect_file_type(file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit.")

    try:
        result = process_mesh_bytes(data, file_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mesh processing failed: {exc}") from exc

    return ProcessResponse(
        stl_base64=base64.b64encode(result.stl_bytes).decode("ascii"),
        faces_before=result.faces_before,
        faces_after=result.faces_after,
        faces_removed=result.faces_removed,
        components_removed=result.components_removed,
        processing_ms=result.processing_ms,
    )
