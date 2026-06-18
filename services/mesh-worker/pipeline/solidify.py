from __future__ import annotations

import trimesh

from pipeline.log import get_logger

logger = get_logger(__name__)

DEFAULT_VOXELS_PER_AXIS = 128
MIN_VOXELS_PER_AXIS = 64
MAX_VOXELS_PER_AXIS = 192


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
) -> trimesh.Trimesh:
    """
    Turn a hollow architectural shell into one watertight solid suitable for printing.

    Interior partitions disappear inside the filled volume.
    """
    if len(mesh.faces) == 0:
        return mesh

    if voxels_per_axis is None:
        voxels_per_axis = _voxels_per_axis_for_mesh(mesh)

    pitch = voxel_pitch(mesh, voxels_per_axis=voxels_per_axis)
    logger.info(
        "Solidifying mesh: pitch=%.4f (%.0f voxels on longest axis)",
        pitch,
        mesh.extents.max() / pitch,
    )

    voxels = mesh.voxelized(pitch=pitch)
    logger.debug(
        "Voxel grid shape=%s filled=%d",
        voxels.shape,
        voxels.filled_count,
    )

    filled = voxels.fill()
    solid = filled.marching_cubes

    solid.merge_vertices()
    solid.update_faces(solid.nondegenerate_faces())
    solid.remove_unreferenced_vertices()
    solid.process(validate=False)

    logger.info(
        "Solidified: %d faces (watertight=%s)",
        len(solid.faces),
        solid.is_watertight,
    )
    return solid


def _voxels_per_axis_for_mesh(mesh: trimesh.Trimesh) -> int:
    face_count = len(mesh.faces)
    if face_count > 2_000_000:
        return MIN_VOXELS_PER_AXIS
    if face_count > 1_000_000:
        return 96
    return DEFAULT_VOXELS_PER_AXIS
