from __future__ import annotations

import base64
import logging

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pipeline.load import detect_file_type
from pipeline.log import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="House Miniature Mesh Worker", version="0.1.0")
logger.info("Mesh worker started; mesh libraries load on first /process request")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 150 * 1024 * 1024
MAX_UPLOAD_LABEL = "150 MB"


class ProcessResponse(BaseModel):
    stl_base64: str
    faces_before: int
    faces_after: int
    faces_removed: int
    components_removed: int
    processing_ms: int


@app.get("/health")
def health() -> dict[str, str]:
    logger.debug("Health check")
    return {"status": "ok"}


@app.post("/process", response_model=ProcessResponse)
async def process(file: UploadFile = File(...)) -> ProcessResponse:
    logger.info("POST /process filename=%s content_type=%s", file.filename, file.content_type)

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required.")

    try:
        file_type = detect_file_type(file.filename)
    except ValueError as exc:
        logger.warning("Unsupported file type: %s", file.filename)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    data = await file.read()
    logger.info(
        "Received upload: name=%s type=%s bytes=%d",
        file.filename,
        file_type,
        len(data),
    )

    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_LABEL} limit.")

    try:
        logger.info("Importing mesh pipeline modules…")
        from pipeline.process import process_mesh_bytes

        result = process_mesh_bytes(data, file_type)
    except ValueError as exc:
        logger.warning("Validation error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Processing failed for %s", file.filename)
        raise HTTPException(status_code=500, detail=f"Mesh processing failed: {exc}") from exc

    logger.info(
        "POST /process complete: %s faces %d -> %d in %d ms",
        file.filename,
        result.faces_before,
        result.faces_after,
        result.processing_ms,
    )

    return ProcessResponse(
        stl_base64=base64.b64encode(result.stl_bytes).decode("ascii"),
        faces_before=result.faces_before,
        faces_after=result.faces_after,
        faces_removed=result.faces_removed,
        components_removed=result.components_removed,
        processing_ms=result.processing_ms,
    )
