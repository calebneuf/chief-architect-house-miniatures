from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import trimesh

from pipeline.cull_site import cull_exterior_clutter, detect_up_axis
from pipeline.components import remove_components
from pipeline.export import export_stl
from pipeline.floor_detect import (
    detect_ceiling_level,
    detect_ground_floor_level,
    slice_below_floor,
)
from pipeline.floor_solid import extrude_floor_plan_solid
from pipeline.load import FileType, load_mesh
from pipeline.log import get_logger, log_step
from pipeline.prune_interior import prune_interior_partitions
from pipeline.repair import repair_mesh

logger = get_logger(__name__)

StageCallback = Callable[[str, float, trimesh.Trimesh | None], None]


@dataclass
class ProcessResult:
    stl_bytes: bytes
    faces_before: int
    faces_after: int
    faces_removed: int
    components_removed: int
    processing_ms: int
    ground_floor_z: float
    ceiling_z: float


def process_mesh_bytes(
    data: bytes,
    file_type: FileType,
    on_stage: StageCallback | None = None,
    exclude_components: list[int] | None = None,
    manual_cleanup: bool = False,
) -> ProcessResult:
    started = time.perf_counter()

    def report(stage: str, progress: float, mesh: trimesh.Trimesh | None = None) -> None:
        if on_stage is not None:
            on_stage(stage, progress, mesh)

    logger.info(
        "Starting pipeline: type=%s size=%.2f MB",
        file_type,
        len(data) / (1024 * 1024),
    )
    report("loading", 0.05, None)

    with log_step(logger, "load mesh"):
        mesh = load_mesh(data, file_type)
        faces_before = len(mesh.faces)
        up_axis = detect_up_axis(mesh)
        axis_name = ("X", "Y", "Z")[up_axis]
        logger.debug(
            "Loaded mesh: faces=%d vertices=%d bounds=%s up=%s",
            faces_before,
            len(mesh.vertices),
            mesh.bounds.tolist(),
            axis_name,
        )

    report("loading", 0.1, mesh)

    with log_step(logger, "repair mesh"):
        mesh = repair_mesh(mesh)
        logger.debug("After repair: faces=%d", len(mesh.faces))

    report("repairing", 0.18, mesh)

    if exclude_components:
        mesh, manual_removed = remove_components(mesh, exclude_components)
        logger.info("Manual cleanup removed %d faces before pipeline", manual_removed)

    if not manual_cleanup:
        with log_step(logger, "cull exterior clutter"):
            mesh, site_removed = cull_exterior_clutter(mesh, up_axis=up_axis)
            logger.info("Exterior clutter removed %d detached components", site_removed)
        report("removing_site", 0.28, mesh)
    else:
        site_removed = 0
        report("removing_site", 0.28, mesh)

    ground_z = detect_ground_floor_level(mesh, up_axis=up_axis)
    ceiling_z = detect_ceiling_level(mesh, ground_z, up_axis=up_axis)

    with log_step(logger, "slice below ground floor"):
        mesh, basement_removed = slice_below_floor(mesh, ground_z, up_axis=up_axis)
        logger.info(
            "Basement slice at %.3f removed %d faces",
            ground_z,
            basement_removed,
        )

    report("slicing_floor", 0.42, mesh)

    with log_step(logger, "prune interior partitions"):
        mesh, interior_removed = prune_interior_partitions(mesh)
        logger.info(
            "Interior partition prune removed %d faces (%d remaining)",
            interior_removed,
            len(mesh.faces),
        )

    report("pruning_interior", 0.58, mesh)

    with log_step(logger, "extrude floor plan solid"):
        solid = extrude_floor_plan_solid(
            mesh,
            up_axis=up_axis,
            ground_z=ground_z,
            ceiling_z=ceiling_z,
        )
        logger.info("Extruded solid: %d faces", len(solid.faces))

    report("extruding_solid", 0.88, solid)

    faces_removed = interior_removed + basement_removed
    components_removed = site_removed

    with log_step(logger, "export STL"):
        faces_after = len(solid.faces)
        stl_bytes = export_stl(solid)
        logger.debug("Exported STL: %.2f MB", len(stl_bytes) / (1024 * 1024))

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "Pipeline complete: faces %d -> %d (removed %d) in %d ms",
        faces_before,
        faces_after,
        faces_removed,
        elapsed_ms,
    )

    report("complete", 1.0, solid)

    return ProcessResult(
        stl_bytes=stl_bytes,
        faces_before=faces_before,
        faces_after=faces_after,
        faces_removed=faces_removed,
        components_removed=components_removed,
        processing_ms=elapsed_ms,
        ground_floor_z=ground_z,
        ceiling_z=ceiling_z,
    )
