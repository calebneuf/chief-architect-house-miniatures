from __future__ import annotations

import base64
from typing import Callable

import trimesh

from pipeline.export import export_stl
from pipeline.log import get_logger

logger = get_logger(__name__)

StageCallback = Callable[[str, float, trimesh.Trimesh | None], None]

PREVIEW_FACE_LIMIT = 30_000


def preview_stl_base64(mesh: trimesh.Trimesh) -> str:
    """Encode a lightweight STL preview for live browser updates."""
    preview = mesh
    if len(mesh.faces) > PREVIEW_FACE_LIMIT:
        try:
            preview = mesh.simplify_quadric_decimation(PREVIEW_FACE_LIMIT)
        except Exception as exc:
            logger.debug("Preview decimation failed, using full mesh: %s", exc)
    return base64.b64encode(export_stl(preview)).decode("ascii")
