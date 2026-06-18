from __future__ import annotations

import numpy as np
import trimesh

from pipeline.cull_site import detect_up_axis
from pipeline.log import get_logger

logger = get_logger(__name__)


def detect_ground_floor_level(mesh: trimesh.Trimesh, up_axis: int | None = None) -> float:
    """
    Find the vertical position of the ground floor slab.

    Uses the bottom of the largest above-grade component when possible, otherwise
    the lowest dense horizontal band in the model.
    """
    if len(mesh.faces) == 0:
        axis = up_axis if up_axis is not None else detect_up_axis(mesh)
        return float(mesh.bounds[0][axis])

    axis = up_axis if up_axis is not None else detect_up_axis(mesh)
    horizontal_axes = [index for index in range(3) if index != axis]
    components = mesh.split(only_watertight=False)

    if len(components) > 1:
        def score(component: trimesh.Trimesh) -> tuple[float, float]:
            extents = component.bounds[1] - component.bounds[0]
            footprint = float(extents[horizontal_axes[0]] * extents[horizontal_axes[1]])
            return (footprint, float(component.bounds[0][axis]))

        main = max(components, key=score)
        ground = float(main.bounds[0][axis])
        logger.info("Ground floor from main component bottom: %.3f", ground)
        return ground

    return _ground_from_height_bands(mesh, axis, horizontal_axes)


def detect_ceiling_level(
    mesh: trimesh.Trimesh,
    ground_z: float,
    up_axis: int | None = None,
) -> float:
    """Top of the printable volume — use the full mesh envelope so roofs are kept."""
    axis = up_axis if up_axis is not None else detect_up_axis(mesh)
    ceiling = float(mesh.bounds[1][axis])
    logger.info("Ceiling level: %.3f (ground %.3f)", ceiling, ground_z)
    return ceiling


def slice_below_floor(
    mesh: trimesh.Trimesh,
    ground_z: float,
    up_axis: int | None = None,
) -> tuple[trimesh.Trimesh, int]:
    """Remove all geometry below the detected ground floor."""
    if len(mesh.faces) == 0:
        return mesh, 0

    axis = up_axis if up_axis is not None else detect_up_axis(mesh)
    span = float(mesh.bounds[1][axis] - mesh.bounds[0][axis])
    tolerance = max(span * 0.008, 1e-4)

    centroids = mesh.triangles_center[:, axis]
    keep_mask = centroids >= (ground_z - tolerance)
    if keep_mask.all():
        return mesh, 0

    sliced = mesh.copy()
    sliced.update_faces(keep_mask)
    removed = int(len(mesh.faces) - keep_mask.sum())
    logger.info(
        "Sliced below ground floor %.3f: removed %d faces",
        ground_z,
        removed,
    )
    return sliced, removed


def _ground_from_height_bands(
    mesh: trimesh.Trimesh,
    up_axis: int,
    horizontal_axes: list[int],
) -> float:
    centroids = mesh.triangles_center
    heights = centroids[:, up_axis]
    h_min = float(heights.min())
    h_max = float(heights.max())
    span = h_max - h_min
    if span <= 1e-6:
        return h_min

    bin_count = int(np.clip(len(heights) // 300, 20, 64))
    counts, edges = np.histogram(heights, bins=bin_count, range=(h_min, h_max))
    footprints = np.zeros(len(counts), dtype=np.float64)

    for index in range(len(counts)):
        lower = edges[index]
        upper = edges[index + 1]
        mask = (heights >= lower) & (
            heights < upper if index < len(counts) - 1 else heights <= upper
        )
        if not np.any(mask):
            continue
        points = centroids[mask][:, horizontal_axes]
        extents = points.max(axis=0) - points.min(axis=0)
        footprints[index] = float(extents[0] * extents[1])

    max_footprint = float(footprints.max())
    if max_footprint <= 0:
        return h_min

    threshold = max_footprint * 0.5
    major_bins = [index for index, value in enumerate(footprints) if value >= threshold]
    if not major_bins:
        return h_min

    runs: list[list[int]] = []
    current = [major_bins[0]]
    for index in major_bins[1:]:
        if index == current[-1] + 1:
            current.append(index)
        else:
            runs.append(current)
            current = [index]
    runs.append(current)

    if len(runs) >= 2:
        lower_run = runs[0]
        upper_run = runs[1]
        gap = edges[upper_run[0]] - edges[lower_run[-1] + 1]
        if gap >= span * 0.05:
            ground = float(edges[upper_run[0]])
            logger.info("Ground floor above basement band: %.3f", ground)
            return ground

    ground = float(edges[major_bins[0]])
    logger.info("Ground floor at lowest major band: %.3f", ground)
    return ground
