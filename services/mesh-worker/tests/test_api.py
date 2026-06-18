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
    assert payload["faces_removed"] > 0
    assert payload["faces_after"] > 0
    assert payload["stl_base64"]
