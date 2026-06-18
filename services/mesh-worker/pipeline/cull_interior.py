from __future__ import annotations

import numpy as np
import trimesh


def cull_interior_walls(
    mesh: trimesh.Trimesh,
    ray_count: int = 1200,
    neighbor_expansion: int = 2,
) -> tuple[trimesh.Trimesh, int]:
    """
    Keep geometry visible from outside the building envelope.

    Interior partition walls are occluded by the exterior shell and removed.
    """
    if len(mesh.faces) == 0:
        return mesh, 0

    visible_faces = _exterior_visible_faces(mesh, ray_count=ray_count)
    if not visible_faces.any():
        return mesh, 0

    keep_mask = _expand_face_neighborhood(mesh, visible_faces, neighbor_expansion)
    culled = mesh.copy()
    culled.update_faces(keep_mask)

    removed_faces = int(len(mesh.faces) - keep_mask.sum())
    return culled, removed_faces


def _exterior_visible_faces(mesh: trimesh.Trimesh, ray_count: int) -> np.ndarray:
    """Mark faces hit by outward rays cast from a sphere around the model."""
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


def _expand_face_neighborhood(
    mesh: trimesh.Trimesh,
    seed_mask: np.ndarray,
    depth: int,
) -> np.ndarray:
    """Grow the keep-set across adjacent faces on the same connected shell."""
    if depth <= 0:
        return seed_mask

    expanded = seed_mask.copy()
    adjacency = mesh.face_adjacency

    for _ in range(depth):
        next_mask = expanded.copy()
        for face_a, face_b in adjacency:
            if expanded[face_a] or expanded[face_b]:
                next_mask[face_a] = True
                next_mask[face_b] = True
        expanded = next_mask

    return expanded


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
