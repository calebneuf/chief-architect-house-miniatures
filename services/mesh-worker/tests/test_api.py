from __future__ import annotations

import io

from fastapi.testclient import TestClient

from main import app
from tests.test_pipeline import box_with_interior_wall, export_mesh

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_process_endpoint():
    mesh = box_with_interior_wall()
    stl_bytes = export_mesh(mesh)

    response = client.post(
        "/process",
        files={"file": ("house.stl", io.BytesIO(stl_bytes), "application/octet-stream")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["faces_after"] > 0
    assert payload["stl_base64"]


def test_jobs_endpoint_round_trip():
    mesh = box_with_interior_wall()
    stl_bytes = export_mesh(mesh)

    create = client.post(
        "/jobs",
        files={"file": ("house.stl", io.BytesIO(stl_bytes), "application/octet-stream")},
    )
    assert create.status_code == 200
    job_id = create.json()["job_id"]

    import time

    for _ in range(120):
        status = client.get(f"/jobs/{job_id}")
        assert status.status_code == 200
        payload = status.json()
        if payload["status"] == "complete":
            assert payload["result"]["stl_base64"]
            assert payload["preview_stl_base64"]
            return
        if payload["status"] == "failed":
            raise AssertionError(payload["error"])
        time.sleep(0.25)

    raise AssertionError("job did not complete in time")
