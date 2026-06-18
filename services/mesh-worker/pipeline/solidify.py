from __future__ import annotations

import numpy as np
import trimesh
from scipy import ndimage

from pipeline.cull_site import detect_up_axis
from pipeline.log import get_logger

logger = get_logger(__name__)

DEFAULT_VOXELS_PER_AXIS = 112
MIN_VOXELS_PER_AXIS = 72
MAX_VOXELS_PER_AXIS = 160


def voxel_pitch(mesh: trimesh.Trimesh, voxels_per_axis: int = DEFAULT_VOXELS_PER_AXIS) -> float:
    """Pick a voxel size that scales with model size and stays within practical limits."""
    longest = float(mesh.extents.max())
    if longest <= 0:
        return 1.0
    pitch = longest / voxels_per_axis
    return max(pitch, longest / MAX_VOXELS_PER_AXIS, 1e-4)


def solidify_mesh(
    mesh: trimesh.Trimesh,
    voxels_per_axis: int | None = None,
    reference_extents: np.ndarray | None = None,
) -> trimesh.Trimesh:
    """
    Merge separate architectural surfaces into one printable solid.

    Voxels bridge small gaps between disconnected walls/floors/roofs, then the
    enclosed volume is filled.
    """
    if len(mesh.faces) == 0:
        return mesh

    if reference_extents is None:
        reference_extents = mesh.extents.copy()

    if voxels_per_axis is None:
        voxels_per_axis = _voxels_per_axis_for_mesh(mesh)

    pitch = voxel_pitch(mesh, voxels_per_axis=voxels_per_axis)
    logger.info(
        "Filling interior cavity: pitch=%.4f (%.0f voxels on longest axis)",
        pitch,
        mesh.extents.max() / pitch,
    )

    dilation_schedule = (2, 3, 4)
    solid: trimesh.Trimesh | None = None

    for dilation in dilation_schedule:
        candidate = _fill_enclosed_volume(mesh, pitch=pitch, dilation_iterations=dilation)
        if candidate is None:
            continue
        if _shape_preserved(reference_extents, candidate.extents):
            solid = candidate
            logger.info("Cavity fill succeeded with dilation=%d", dilation)
            break
        logger.debug(
            "Dilation %d distorted footprint (output %s)",
            dilation,
            np.round(candidate.extents, 2).tolist(),
        )

    if solid is None:
        logger.warning("Cavity fill failed; returning shell geometry without solid fill")
        return mesh

    solid.merge_vertices()
    solid.update_faces(solid.nondegenerate_faces())
    solid.remove_unreferenced_vertices()
    solid.process(validate=False)

    logger.info(
        "Filled interior: %d faces (watertight=%s, extents=%s)",
        len(solid.faces),
        solid.is_watertight,
        np.round(solid.extents, 2).tolist(),
    )
    return solid


def _fill_enclosed_volume(
    mesh: trimesh.Trimesh,
    pitch: float,
    dilation_iterations: int,
) -> trimesh.Trimesh | None:
    try:
        voxels = mesh.voxelized(pitch=pitch)
    except Exception as exc:
        logger.warning("Voxelization failed: %s", exc)
        return None

    if voxels.filled_count == 0:
        logger.warning("Voxelization produced an empty grid")
        return None

    matrix = voxels.matrix.copy()
    if dilation_iterations > 0:
        matrix = ndimage.binary_dilation(matrix, iterations=dilation_iterations)

    matrix = ndimage.binary_fill_holes(matrix)

    logger.debug(
        "Voxel grid shape=%s surface=%d solid=%d dilation=%d",
        voxels.shape,
        int(voxels.filled_count),
        int(matrix.sum()),
        dilation_iterations,
    )

    try:
        solid = matrix_to_mesh(matrix, transform=voxels.transform)
    except Exception as exc:
        logger.warning("Marching cubes failed: %s", exc)
        return None

    if len(solid.faces) == 0:
        return None

    return solid


def matrix_to_mesh(matrix: np.ndarray, transform: np.ndarray) -> trimesh.Trimesh:
    """Convert a filled voxel matrix to world-space mesh."""
    from trimesh.voxel import ops

    mesh = ops.matrix_to_marching_cubes(matrix=matrix)
    mesh.apply_transform(transform)
    return mesh


def _shape_preserved(
    reference_extents: np.ndarray,
    output_extents: np.ndarray,
    min_horizontal_ratio: float = 0.82,
    max_horizontal_ratio: float = 1.08,
) -> bool:
    """Reject fills that collapse or swell the house footprint."""
    up_axis = int(np.argmin(reference_extents))
    horizontal_axes = [index for index in range(3) if index != up_axis]

    for axis in horizontal_axes:
        reference_span = float(reference_extents[axis])
        output_span = float(output_extents[axis])
        if reference_span <= 1e-6:
            continue
        ratio = output_span / reference_span
        if ratio < min_horizontal_ratio or ratio > max_horizontal_ratio:
            return False

    return True


def _voxels_per_axis_for_mesh(mesh: trimesh.Trimesh) -> int:
    face_count = len(mesh.faces)
    if face_count > 2_000_000:
        return MIN_VOXELS_PER_AXIS
    if face_count > 1_000_000:
        return 88
    return DEFAULT_VOXELS_PER_AXIS
