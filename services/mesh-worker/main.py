from __future__ import annotations

import asyncio
import base64
import logging
import threading

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pipeline.jobs import job_store
from pipeline.load import detect_file_type
from pipeline.log import setup_logging
from pipeline.preview import preview_stl_base64

setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="House Miniature Mesh Worker", version="0.2.0")
logger.info("Mesh worker started; mesh libraries load on first request")

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
    ground_floor_z: float = 0.0
    ceiling_z: float = 0.0


class JobCreateResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    stage: str
    progress: float
    preview_stl_base64: str | None = None
    result: ProcessResponse | None = None
    error: str | None = None


def _run_job(job_id: str, data: bytes, file_type: str) -> None:
    job_store.update(job_id, status="running", stage="loading", progress=0.05)

    def on_stage(stage: str, progress: float, mesh) -> None:
        preview = preview_stl_base64(mesh) if mesh is not None else None
        job_store.update(
            job_id,
            stage=stage,
            progress=progress,
            preview_stl_base64=preview,
        )

    try:
        from pipeline.process import process_mesh_bytes

        result = process_mesh_bytes(data, file_type, on_stage=on_stage)
        payload = ProcessResponse(
            stl_base64=base64.b64encode(result.stl_bytes).decode("ascii"),
            faces_before=result.faces_before,
            faces_after=result.faces_after,
            faces_removed=result.faces_removed,
            components_removed=result.components_removed,
            processing_ms=result.processing_ms,
            ground_floor_z=result.ground_floor_z,
            ceiling_z=result.ceiling_z,
        )
        job_store.update(
            job_id,
            status="complete",
            stage="complete",
            progress=1.0,
            result=payload.model_dump(),
        )
    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        job_store.update(job_id, status="failed", stage="failed", error=str(exc))


@app.get("/health")
def health() -> dict[str, str]:
    logger.debug("Health check")
    return {"status": "ok"}


@app.post("/jobs", response_model=JobCreateResponse)
async def create_job(file: UploadFile = File(...)) -> JobCreateResponse:
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
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_LABEL} limit.")

    job = job_store.create()
    thread = threading.Thread(
        target=_run_job,
        args=(job.id, data, file_type),
        daemon=True,
    )
    thread.start()
    job_store.prune_old()
    return JobCreateResponse(job_id=job.id)


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    result = ProcessResponse(**job.result) if job.result else None
    return JobStatusResponse(
        job_id=job.id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        preview_stl_base64=job.preview_stl_base64,
        result=result,
        error=job.error,
    )


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

        result = await asyncio.to_thread(process_mesh_bytes, data, file_type)
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
        ground_floor_z=result.ground_floor_z,
        ceiling_z=result.ceiling_z,
    )
