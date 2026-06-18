from __future__ import annotations

import trimesh


def export_stl(mesh: trimesh.Trimesh) -> bytes:
    return mesh.export(file_type="stl")
