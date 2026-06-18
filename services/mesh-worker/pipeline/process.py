from __future__ import annotations

import time
from dataclasses import dataclass

import trimesh

from pipeline.cull_interior import cull_interior_walls, ray_count_for_mesh
from pipeline.cull_site import cull_below_ground, cull_exterior_clutter, detect_up_axis
from pipeline.export import export_stl
from pipeline.load import FileType, load_mesh
from pipeline.log import get_logger, log_step
from pipeline.repair import remove_small_components, repair_mesh
from pipeline.solidify import solidify_mesh

logger = get_logger(__name__)


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
    logger.info(
        "Starting pipeline: type=%s size=%.2f MB",
        file_type,
        len(data) / (1024 * 1024),
    )

    with log_step(logger, "load mesh"):
        mesh = load_mesh(data, file_type)
        faces_before = len(mesh.faces)
        logger.debug(
            "Loaded mesh: faces=%d vertices=%d bounds=%s",
            faces_before,
            len(mesh.vertices),
            mesh.bounds.tolist(),
        )

    with log_step(logger, "repair mesh"):
        mesh = repair_mesh(mesh)
        logger.debug("After repair: faces=%d", len(mesh.faces))

    with log_step(logger, "cull interior walls"):
        ray_count = ray_count_for_mesh(len(mesh.faces))
        logger.info("Using %d exterior rays for %s faces", ray_count, f"{len(mesh.faces):,}")
        mesh, interior_removed = cull_interior_walls(mesh, ray_count=ray_count)
        logger.info(
            "Interior cull removed %d faces (%d -> %d)",
            interior_removed,
            faces_before,
            len(mesh.faces),
        )

    up_axis = detect_up_axis(mesh)
    axis_name = ("X", "Y", "Z")[up_axis]
    logger.debug("Detected vertical axis: %s", axis_name)

    with log_step(logger, "cull below ground"):
        mesh, basement_removed = cull_below_ground(mesh, up_axis=up_axis)
        logger.info("Below-ground cull removed %d faces", basement_removed)

    with log_step(logger, "cull exterior clutter"):
        mesh, site_removed = cull_exterior_clutter(mesh, up_axis=up_axis)
        logger.info("Exterior clutter removed %d detached components", site_removed)

    with log_step(logger, "remove small components"):
        mesh, small_removed = remove_small_components(mesh)
        logger.info("Removed %d small floating components", small_removed)

    with log_step(logger, "solidify house"):
        faces_before_solidify = len(mesh.faces)
        mesh = solidify_mesh(mesh)
        logger.info(
            "Solidified mesh: %d -> %d faces",
            faces_before_solidify,
            len(mesh.faces),
        )

    faces_removed = interior_removed + basement_removed
    components_removed = site_removed + small_removed

    with log_step(logger, "export STL"):
        faces_after = len(mesh.faces)
        stl_bytes = export_stl(mesh)
        logger.debug("Exported STL: %.2f MB", len(stl_bytes) / (1024 * 1024))

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "Pipeline complete: faces %d -> %d (removed %d) in %d ms",
        faces_before,
        faces_after,
        faces_removed,
        elapsed_ms,
    )

    return ProcessResult(
        stl_bytes=stl_bytes,
        faces_before=faces_before,
        faces_after=faces_after,
        faces_removed=faces_removed,
        components_removed=components_removed,
        processing_ms=elapsed_ms,
    )
