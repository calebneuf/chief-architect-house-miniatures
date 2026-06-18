from __future__ import annotations

import numpy as np
import trimesh


def detect_up_axis(mesh: trimesh.Trimesh) -> int:
    """
    Guess the vertical axis for a building mesh.

    Houses are usually much wider than they are tall, so the shortest bounding-box
    axis is typically the vertical. Falls back to Z-up for ambiguous cubes.
    """
    extents = mesh.bounds[1] - mesh.bounds[0]
    shortest = int(np.argmin(extents))
    longest = int(np.argmax(extents))
    if extents[shortest] * 2 <= extents[longest]:
        return shortest
    return 2


def estimate_ground_level(mesh: trimesh.Trimesh, up_axis: int) -> float:
    """
    Estimate the grade line between basement mass and above-ground structure.

    Uses face-centroid density along the vertical axis to find the first major
    occupied band above the basement.
    """
    if len(mesh.faces) == 0:
        return float(mesh.bounds[0][up_axis])

    centroids = mesh.triangles_center[:, up_axis]
    h_min = float(centroids.min())
    h_max = float(centroids.max())
    span = h_max - h_min
    if span <= 1e-6:
        return h_min

    counts, edges = np.histogram(centroids, bins=60, range=(h_min, h_max))
    peak = int(counts.max())
    if peak == 0:
        return float(np.percentile(centroids, 32))

    threshold = peak * 0.3
    for index, count in enumerate(counts):
        if count >= threshold:
            return float(edges[index]) - span * 0.02

    return float(np.percentile(centroids, 32))


def cull_below_ground(mesh: trimesh.Trimesh, up_axis: int | None = None) -> tuple[trimesh.Trimesh, int]:
    """Remove below-grade shells and geometry under the main floor level."""
    if len(mesh.faces) == 0:
        return mesh, 0

    axis = up_axis if up_axis is not None else detect_up_axis(mesh)
    components = mesh.split(only_watertight=False)
    span = float(mesh.bounds[1][axis] - mesh.bounds[0][axis])
    tolerance = max(span * 0.01, 1e-6)

    if len(components) > 1:
        horizontal_axes = [index for index in range(3) if index != axis]

        def footprint_area(component: trimesh.Trimesh) -> float:
            extents = component.bounds[1] - component.bounds[0]
            return float(extents[horizontal_axes[0]] * extents[horizontal_axes[1]])

        main = max(components, key=footprint_area)
        grade = float(main.bounds[0][axis])
        kept: list[trimesh.Trimesh] = []
        removed = 0

        for component in components:
            if float(component.bounds[1][axis]) <= grade + tolerance:
                removed += len(component.faces)
                continue
            kept.append(component)

        if not kept or removed == 0:
            return mesh, 0
        return trimesh.util.concatenate(kept), removed

    centroids = mesh.triangles_center[:, axis]
    h_min = float(centroids.min())
    h_max = float(centroids.max())
    span = h_max - h_min
    if span <= 1e-6:
        return mesh, 0

    ground = float(np.percentile(centroids, 42))
    below_fraction = float((centroids < ground).mean())
    if below_fraction < 0.18:
        return mesh, 0

    keep_mask = centroids >= ground
    if keep_mask.all():
        return mesh, 0

    culled = mesh.copy()
    culled.update_faces(keep_mask)
    removed = int(len(mesh.faces) - keep_mask.sum())
    return culled, removed


def cull_exterior_clutter(
    mesh: trimesh.Trimesh,
    up_axis: int | None = None,
    footprint_padding: float = 0.12,
    min_wing_ratio: float = 0.08,
) -> tuple[trimesh.Trimesh, int]:
    """
    Keep the main house footprint and attached wings; drop detached site objects.

    Removes separate shells such as fences and distant landscaping that sit
    outside the primary structure envelope.
    """
    components = mesh.split(only_watertight=False)
    if len(components) <= 1:
        return mesh, 0

    axis = up_axis if up_axis is not None else detect_up_axis(mesh)
    horizontal_axes = [index for index in range(3) if index != axis]

    def footprint_area(component: trimesh.Trimesh) -> float:
        extents = component.bounds[1] - component.bounds[0]
        return float(extents[horizontal_axes[0]] * extents[horizontal_axes[1]])

    main = max(components, key=footprint_area)
    main_index = components.index(main)
    main_center = main.bounds.mean(axis=0)
    main_half = (main.bounds[1] - main.bounds[0]) / 2.0
    for horizontal_axis in horizontal_axes:
        main_half[horizontal_axis] *= 1.0 + footprint_padding

    main_footprint = footprint_area(main)
    kept: list[trimesh.Trimesh] = []
    removed = 0

    for index, component in enumerate(components):
        if index == main_index:
            kept.append(component)
            continue

        center = component.bounds.mean(axis=0)
        inside = all(
            abs(center[horizontal_axis] - main_center[horizontal_axis]) <= main_half[horizontal_axis]
            for horizontal_axis in horizontal_axes
        )
        large_enough = footprint_area(component) >= main_footprint * min_wing_ratio
        if inside or large_enough:
            kept.append(component)
        else:
            removed += 1

    if not kept:
        return mesh, 0

    return trimesh.util.concatenate(kept), removed
