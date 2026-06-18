from __future__ import annotations

import numpy as np
import trimesh

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
    Fill the enclosed volume inside the exterior shell.

    The exterior envelope is preserved; interior partitions are absorbed into a
    single printable solid.
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

    solid = _fill_enclosed_volume(mesh, pitch=pitch)
    if solid is None:
        logger.warning("Cavity fill failed; returning exterior shell without solid fill")
        return mesh

    if not _shape_preserved(reference_extents, solid.extents):
        logger.warning(
            "Cavity fill distorted footprint (input %s, output %s); keeping exterior shell",
            np.round(reference_extents, 2).tolist(),
            np.round(solid.extents, 2).tolist(),
        )
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


def _fill_enclosed_volume(mesh: trimesh.Trimesh, pitch: float) -> trimesh.Trimesh | None:
    try:
        voxels = mesh.voxelized(pitch=pitch)
    except Exception as exc:
        logger.warning("Voxelization failed: %s", exc)
        return None

    if voxels.filled_count == 0:
        logger.warning("Voxelization produced an empty grid")
        return None

    logger.debug(
        "Voxel grid shape=%s filled=%d",
        voxels.shape,
        voxels.filled_count,
    )

    try:
        filled = voxels.fill()
        solid = filled.marching_cubes
        solid.apply_transform(filled.transform)
    except Exception as exc:
        logger.warning("Marching cubes failed: %s", exc)
        return None

    if len(solid.faces) == 0:
        return None

    return solid


def _shape_preserved(
    reference_extents: np.ndarray,
    output_extents: np.ndarray,
    min_horizontal_ratio: float = 0.65,
    max_horizontal_ratio: float = 1.12,
) -> bool:
    """
    Reject voxel fills that collapse or inflate the house footprint.

    Compares horizontal spans only so roof height can change slightly.
    """
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
