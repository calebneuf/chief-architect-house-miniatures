from __future__ import annotations

import numpy as np
import trimesh
from scipy.sparse import csgraph
from scipy.sparse import lil_matrix

from pipeline.cull_interior import _exterior_visible_faces, ray_count_for_mesh
from pipeline.cull_site import detect_up_axis
from pipeline.log import get_logger

logger = get_logger(__name__)


def extract_exterior_shell(
    mesh: trimesh.Trimesh,
    ray_count: int | None = None,
) -> tuple[trimesh.Trimesh, int]:
    """
    Keep the full exterior building envelope and drop separate interior partitions.

    The largest footprint component is always kept whole so wall and roof detail is
    preserved. Smaller detached components are removed when they are almost fully
    hidden inside the outer shell.
    """
    if len(mesh.faces) == 0:
        return mesh, 0

    if ray_count is None:
        ray_count = ray_count_for_mesh(len(mesh.faces))

    up_axis = detect_up_axis(mesh)
    horizontal_axes = [index for index in range(3) if index != up_axis]

    labels = _face_component_labels(mesh)
    component_sizes = np.bincount(labels)
    visible_faces = _exterior_visible_faces(mesh, ray_count=ray_count)

    main_component = _main_building_component(mesh, labels, horizontal_axes)
    keep = np.zeros(len(mesh.faces), dtype=bool)

    for component_id in range(len(component_sizes)):
        if component_sizes[component_id] == 0:
            continue

        component_mask = labels == component_id
        visible_count = int((visible_faces & component_mask).sum())
        visible_fraction = visible_count / int(component_mask.sum())

        if component_id == main_component:
            keep_component = True
        elif visible_fraction >= 0.35:
            keep_component = True
        elif visible_count == 0:
            keep_component = False
        else:
            keep_component = visible_fraction >= 0.12

        if keep_component:
            keep[component_mask] = True

        logger.debug(
            "Shell component %d: faces=%d visible=%d (%.1f%%) main=%s keep=%s",
            component_id,
            int(component_mask.sum()),
            visible_count,
            visible_fraction * 100,
            component_id == main_component,
            keep_component,
        )

    logger.info(
        "Exterior shell: %d / %d faces kept (%d rays, main component %d)",
        int(keep.sum()),
        len(mesh.faces),
        ray_count,
        main_component,
    )

    if keep.all():
        return mesh, 0

    shell = mesh.copy()
    shell.update_faces(keep)
    removed_faces = int(len(mesh.faces) - keep.sum())
    return shell, removed_faces


def _main_building_component(
    mesh: trimesh.Trimesh,
    labels: np.ndarray,
    horizontal_axes: list[int],
) -> int:
    """Pick the primary house component by horizontal footprint, then face count."""
    centroids = mesh.triangles_center
    best_component = 0
    best_score = (-1.0, -1)

    for component_id in np.unique(labels):
        component_mask = labels == component_id
        points = centroids[component_mask]
        mins = points.min(axis=0)
        maxs = points.max(axis=0)
        extents = maxs - mins
        footprint = float(extents[horizontal_axes[0]] * extents[horizontal_axes[1]])
        score = (footprint, int(component_mask.sum()))
        if score > best_score:
            best_score = score
            best_component = int(component_id)

    return best_component


def _face_component_labels(mesh: trimesh.Trimesh) -> np.ndarray:
    face_count = len(mesh.faces)
    adjacency = lil_matrix((face_count, face_count), dtype=bool)
    for face_a, face_b in mesh.face_adjacency:
        adjacency[face_a, face_b] = True
        adjacency[face_b, face_a] = True

    _, labels = csgraph.connected_components(adjacency, directed=False)
    return labels
