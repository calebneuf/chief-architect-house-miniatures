from __future__ import annotations

import time
from dataclasses import dataclass

import trimesh

from pipeline.cull_interior import cull_interior_walls
from pipeline.export import export_stl
from pipeline.load import FileType, load_mesh
from pipeline.repair import remove_small_components, repair_mesh


@dataclass
class ProcessResult:
    stl_bytes: bytes
    faces_before: int
    faces_after: int
    faces_removed: int
    components_removed: int
    processing_ms: int


def process_mesh_bytes(data: bytes, file_type: FileType) -> ProcessResult:
    started = time.perf_counter()

    mesh = load_mesh(data, file_type)
    faces_before = len(mesh.faces)

    mesh = repair_mesh(mesh)
    mesh, faces_removed = cull_interior_walls(mesh)
    mesh, components_removed = remove_small_components(mesh)

    faces_after = len(mesh.faces)
    stl_bytes = export_stl(mesh)

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return ProcessResult(
        stl_bytes=stl_bytes,
        faces_before=faces_before,
        faces_after=faces_after,
        faces_removed=faces_removed,
        components_removed=components_removed,
        processing_ms=elapsed_ms,
    )
