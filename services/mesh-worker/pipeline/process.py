from __future__ import annotations

import time
from dataclasses import dataclass

import trimesh

from pipeline.cull_interior import cull_interior_walls
from pipeline.cull_site import cull_below_ground, cull_exterior_clutter, detect_up_axis
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
    up_axis = detect_up_axis(mesh)
    mesh, basement_removed = cull_below_ground(mesh, up_axis=up_axis)
    faces_removed += basement_removed
    mesh, site_removed = cull_exterior_clutter(mesh, up_axis=up_axis)
    components_removed = site_removed
    mesh, small_removed = remove_small_components(mesh)
    components_removed += small_removed

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
