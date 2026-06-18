from __future__ import annotations

import json

import trimesh

from pipeline.load import FileType, load_mesh
from pipeline.log import get_logger
from pipeline.repair import repair_mesh

logger = get_logger(__name__)


def list_mesh_components(mesh: trimesh.Trimesh) -> list[dict[str, object]]:
    """Return disconnected parts for manual cleanup UI."""
    components = mesh.split(only_watertight=False)
    items: list[dict[str, object]] = []

    for index, component in enumerate(components):
        extents = component.bounds[1] - component.bounds[0]
        items.append(
            {
                "id": index,
                "faces": len(component.faces),
                "bounds": component.bounds.tolist(),
                "extents": extents.tolist(),
                "footprint": float(extents[0] * extents[1]),
            }
        )

    items.sort(key=lambda item: float(item["footprint"]), reverse=True)
    return items


def analyze_mesh_bytes(data: bytes, file_type: FileType) -> list[dict[str, object]]:
    mesh = load_mesh(data, file_type)
    mesh = repair_mesh(mesh)
    components = list_mesh_components(mesh)
    logger.info("Analyzed mesh: %d components", len(components))
    return components


def remove_components(mesh: trimesh.Trimesh, exclude_ids: list[int]) -> tuple[trimesh.Trimesh, int]:
    """Drop selected disconnected components before processing."""
    if not exclude_ids:
        return mesh, 0

    exclude = {int(component_id) for component_id in exclude_ids}
    components = mesh.split(only_watertight=False)
    kept: list[trimesh.Trimesh] = []
    removed_faces = 0

    for index, component in enumerate(components):
        if index in exclude:
            removed_faces += len(component.faces)
            continue
        kept.append(component)

    if not kept:
        raise ValueError("Cannot remove every component. Keep at least the main house shell.")

    if removed_faces == 0:
        return mesh, 0

    logger.info("Manual cleanup removed %d components (%d faces)", len(exclude), removed_faces)
    return trimesh.util.concatenate(kept), removed_faces


def parse_exclude_components(raw: str | None) -> list[int]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("exclude_components must be a JSON array of integers.") from exc
    if not isinstance(parsed, list):
        raise ValueError("exclude_components must be a JSON array.")
    return [int(value) for value in parsed]
