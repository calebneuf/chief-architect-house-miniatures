from __future__ import annotations

import numpy as np
import trimesh
from scipy.sparse import csgraph
from scipy.sparse import lil_matrix

from pipeline.cull_interior import _exterior_visible_faces, ray_count_for_mesh
from pipeline.log import get_logger

logger = get_logger(__name__)


def prune_interior_partitions(
    mesh: trimesh.Trimesh,
    ray_count: int | None = None,
) -> tuple[trimesh.Trimesh, int]:
    """
    Remove only fully enclosed interior partitions.

    Chief Architect exports walls, roofs, and floors as many separate components.
    Those pieces are kept even when ray tests miss them, as long as they belong to
    the building envelope.
    """
    if len(mesh.faces) == 0:
        return mesh, 0

    labels = _face_component_labels(mesh)
    unique_labels = np.unique(labels)
    if len(unique_labels) <= 1:
        return mesh, 0

    if ray_count is None:
        ray_count = ray_count_for_mesh(len(mesh.faces))

    visible_faces = _exterior_visible_faces(mesh, ray_count=ray_count)
    main_component = _main_building_component(mesh, labels)
    main_bounds = _mask_bounds(mesh, labels == main_component)
    inset = _inset_bounds(main_bounds, fraction=0.04)
    span = float(np.max(main_bounds[1] - main_bounds[0]))
    thin_limit = max(span * 0.04, 1e-3)

    keep = np.ones(len(mesh.faces), dtype=bool)
    removed_faces = 0

    for component_id in unique_labels:
        if component_id == main_component:
            continue

        component_mask = labels == component_id
        component_bounds = _mask_bounds(mesh, component_mask)
        visible_count = int((visible_faces & component_mask).sum())

        if visible_count > 0:
            continue

        center = component_bounds.mean(axis=0)
        if not _point_inside(inset, center):
            continue

        thickness = float(np.min(component_bounds[1] - component_bounds[0]))
        if thickness > thin_limit:
            continue

        keep[component_mask] = False
        removed_faces += int(component_mask.sum())
        logger.debug(
            "Dropped interior partition component %d (%d faces)",
            int(component_id),
            int(component_mask.sum()),
        )

    if removed_faces == 0:
        return mesh, 0

    pruned = mesh.copy()
    pruned.update_faces(keep)
    logger.info(
        "Pruned %d interior partition faces (%d components scanned, %d rays)",
        removed_faces,
        len(unique_labels),
        ray_count,
    )
    return pruned, removed_faces


def _main_building_component(mesh: trimesh.Trimesh, labels: np.ndarray) -> int:
    """Largest horizontal footprint defines the primary house volume."""
    centroids = mesh.triangles_center
    up_axis = int(np.argmin(mesh.extents))
    horizontal_axes = [index for index in range(3) if index != up_axis]

    best_component = 0
    best_score = (-1.0, -1)

    for component_id in np.unique(labels):
        component_mask = labels == component_id
        points = centroids[component_mask]
        extents = points.max(axis=0) - points.min(axis=0)
        footprint = float(extents[horizontal_axes[0]] * extents[horizontal_axes[1]])
        score = (footprint, int(component_mask.sum()))
        if score > best_score:
            best_score = score
            best_component = int(component_id)

    return best_component


def _inset_bounds(bounds: np.ndarray, fraction: float) -> np.ndarray:
    span = bounds[1] - bounds[0]
    padding = span * fraction
    return np.array([bounds[0] + padding, bounds[1] - padding])


def _point_inside(bounds: np.ndarray, point: np.ndarray) -> bool:
    return bool(np.all(point >= bounds[0]) and np.all(point <= bounds[1]))


def _mask_bounds(mesh: trimesh.Trimesh, mask: np.ndarray) -> np.ndarray:
    points = mesh.triangles_center[mask]
    return np.array([points.min(axis=0), points.max(axis=0)])


def _face_component_labels(mesh: trimesh.Trimesh) -> np.ndarray:
    face_count = len(mesh.faces)
    adjacency = lil_matrix((face_count, face_count), dtype=bool)
    for face_a, face_b in mesh.face_adjacency:
        adjacency[face_a, face_b] = True
        adjacency[face_b, face_a] = True

    _, labels = csgraph.connected_components(adjacency, directed=False)
    return labels
