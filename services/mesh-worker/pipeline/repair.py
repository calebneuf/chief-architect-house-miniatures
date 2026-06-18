from __future__ import annotations

import trimesh


def repair_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Apply light repairs suitable for architectural exports."""
    cleaned = mesh.copy()
    cleaned.merge_vertices()
    cleaned.update_faces(cleaned.unique_faces())
    cleaned.update_faces(cleaned.nondegenerate_faces())
    cleaned.remove_unreferenced_vertices()
    cleaned.process(validate=True)
    return cleaned


def remove_small_components(
    mesh: trimesh.Trimesh,
    min_face_count: int = 12,
    min_area_ratio: float = 0.001,
) -> tuple[trimesh.Trimesh, int]:
    """Drop tiny disconnected shells after culling."""
    components = mesh.split(only_watertight=False)
    if len(components) <= 1:
        return mesh, 0

    total_area = sum(component.area for component in components)
    kept: list[trimesh.Trimesh] = []
    removed = 0

    for component in components:
        area_ratio = component.area / total_area if total_area > 0 else 0
        if len(component.faces) < min_face_count or area_ratio < min_area_ratio:
            removed += 1
            continue
        kept.append(component)

    if not kept:
        return mesh, 0

    return trimesh.util.concatenate(kept), removed
