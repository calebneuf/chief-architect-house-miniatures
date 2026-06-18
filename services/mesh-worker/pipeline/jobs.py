from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from pipeline.log import get_logger

logger = get_logger(__name__)

JobStatus = Literal["queued", "running", "complete", "failed"]


@dataclass
class JobRecord:
    id: str
    status: JobStatus = "queued"
    stage: str = "queued"
    progress: float = 0.0
    preview_stl_base64: str | None = None
    result: dict | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()

    def create(self) -> JobRecord:
        job = JobRecord(id=str(uuid.uuid4()))
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        stage: str | None = None,
        progress: float | None = None,
        preview_stl_base64: str | None = None,
        result: dict | None = None,
        error: str | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            if status is not None:
                job.status = status
            if stage is not None:
                job.stage = stage
            if progress is not None:
                job.progress = progress
            if preview_stl_base64 is not None:
                job.preview_stl_base64 = preview_stl_base64
            if result is not None:
                job.result = result
            if error is not None:
                job.error = error
            job.updated_at = time.time()

    def prune_old(self, max_age_seconds: int = 3600) -> None:
        cutoff = time.time() - max_age_seconds
        with self._lock:
            stale = [job_id for job_id, job in self._jobs.items() if job.updated_at < cutoff]
            for job_id in stale:
                del self._jobs[job_id]
        if stale:
            logger.debug("Pruned %d old jobs", len(stale))


job_store = JobStore()
