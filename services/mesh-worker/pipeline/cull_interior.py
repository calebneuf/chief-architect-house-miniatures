from __future__ import annotations

import numpy as np
import trimesh
from scipy.sparse import csgraph
from scipy.sparse import lil_matrix

from pipeline.log import get_logger

logger = get_logger(__name__)


def ray_count_for_mesh(face_count: int) -> int:
    """Use fewer exterior rays on very large meshes to keep processing practical."""
    if face_count > 2_000_000:
        return 400
    if face_count > 1_000_000:
        return 600
    if face_count > 500_000:
        return 900
    return 1200


def cull_interior_walls(
    mesh: trimesh.Trimesh,
    ray_count: int = 1200,
    min_visible_fraction: float = 0.22,
) -> tuple[trimesh.Trimesh, int]:
    """
    Drop fully enclosed interior partitions while keeping exterior shells intact.

    Faces are grouped into connected components. A component is kept when it is
    the main building shell (any exterior visibility) or when a large enough share
    of its faces are directly visible from outside.
    """
    if len(mesh.faces) == 0:
        return mesh, 0

    visible_faces = _exterior_visible_faces(mesh, ray_count=ray_count)
    keep_mask = _components_to_keep(
        mesh,
        visible_faces,
        min_visible_fraction=min_visible_fraction,
    )
    logger.debug(
        "Exterior visibility: %d / %d faces directly visible (%d rays)",
        int(visible_faces.sum()),
        len(mesh.faces),
        ray_count,
    )
    logger.debug(
        "Component keep mask retains %d / %d faces",
        int(keep_mask.sum()),
        len(mesh.faces),
    )

    if keep_mask.all():
        return mesh, 0

    culled = mesh.copy()
    culled.update_faces(keep_mask)
    removed_faces = int(len(mesh.faces) - keep_mask.sum())
    return culled, removed_faces


def _components_to_keep(
    mesh: trimesh.Trimesh,
    visible_faces: np.ndarray,
    min_visible_fraction: float,
) -> np.ndarray:
    labels = _face_component_labels(mesh)
    keep = np.zeros(len(mesh.faces), dtype=bool)

    component_sizes = np.bincount(labels)
    dominant_components = {
        int(index)
        for index, size in enumerate(component_sizes)
        if size >= component_sizes.max() * 0.35
    }

    for component_id in range(len(component_sizes)):
        if component_sizes[component_id] == 0:
            continue

        component_mask = labels == component_id
        visible_count = int((visible_faces & component_mask).sum())
        visible_fraction = visible_count / int(component_mask.sum())

        if component_id in dominant_components:
            keep_component = visible_count > 0
        else:
            keep_component = visible_fraction >= min_visible_fraction

        if keep_component:
            keep[component_mask] = True

        logger.debug(
            "Component %d: faces=%d visible=%d (%.1f%%) dominant=%s keep=%s",
            component_id,
            int(component_mask.sum()),
            visible_count,
            visible_fraction * 100,
            component_id in dominant_components,
            keep_component,
        )

    return keep


def _face_component_labels(mesh: trimesh.Trimesh) -> np.ndarray:
    face_count = len(mesh.faces)
    adjacency = lil_matrix((face_count, face_count), dtype=bool)
    for face_a, face_b in mesh.face_adjacency:
        adjacency[face_a, face_b] = True
        adjacency[face_b, face_a] = True

    _, labels = csgraph.connected_components(adjacency, directed=False)
    return labels


def _exterior_visible_faces(mesh: trimesh.Trimesh, ray_count: int) -> np.ndarray:
    """Mark faces hit as the closest surface along inward rays from outside."""
    bounds = mesh.bounds
    center = bounds.mean(axis=0)
    radius = np.linalg.norm(bounds[1] - bounds[0]) * 0.6 + 1e-6

    directions = _fibonacci_sphere(ray_count)
    origins = center + directions * (radius * 1.15)

    intersector = trimesh.ray.ray_triangle.RayMeshIntersector(mesh)
    visible = np.zeros(len(mesh.faces), dtype=bool)

    for origin, direction in zip(origins, directions):
        locations, _, index_tri = intersector.intersects_location(
            ray_origins=[origin],
            ray_directions=[-direction],
            multiple_hits=True,
        )
        if len(index_tri) == 0:
            continue

        distances = np.linalg.norm(locations - origin, axis=1)
        closest = index_tri[np.argmin(distances)]
        visible[closest] = True

    return visible


def _fibonacci_sphere(samples: int) -> np.ndarray:
    """Evenly distribute ray directions on a unit sphere."""
    indices = np.arange(samples, dtype=np.float64)
    phi = np.arccos(1 - 2 * (indices + 0.5) / samples)
    theta = np.pi * (1 + 5**0.5) * indices

    x = np.cos(theta) * np.sin(phi)
    y = np.sin(theta) * np.sin(phi)
    z = np.cos(phi)
    directions = np.column_stack((x, y, z))
    norms = np.linalg.norm(directions, axis=1, keepdims=True)
    return directions / np.maximum(norms, 1e-12)
