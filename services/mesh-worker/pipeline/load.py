from __future__ import annotations

import io
from typing import Literal

import numpy as np
import trimesh

FileType = Literal["stl", "obj"]

INTERIOR_NAME_HINTS = (
    "interior",
    "partition",
    "inner wall",
    "int wall",
    "room divider",
)


def detect_file_type(filename: str) -> FileType:
    lower = filename.lower()
    if lower.endswith(".stl"):
        return "stl"
    if lower.endswith(".obj"):
        return "obj"
    raise ValueError("Unsupported file type. Upload an STL or OBJ file.")


def load_mesh(data: bytes | str, file_type: FileType) -> trimesh.Trimesh:
    if isinstance(data, str):
        data = data.encode("utf-8")

    if file_type == "obj":
        grouped = _load_obj_groups(data)
        if grouped:
            exterior_meshes = [
                mesh for name, mesh in grouped if not _is_interior_name(name)
            ]
            if exterior_meshes and len(exterior_meshes) < len(grouped):
                return trimesh.util.concatenate(exterior_meshes)

    loaded = trimesh.load(
        io.BytesIO(data),
        file_type=file_type,
        force="mesh",
        process=False,
    )
    return _coerce_to_trimesh(loaded)


def _load_obj_groups(data: bytes) -> list[tuple[str, trimesh.Trimesh]]:
    """Parse OBJ object/group sections into named meshes."""
    text = data.decode("utf-8", errors="ignore")
    all_vertices: list[list[float]] = []
    groups: list[tuple[str, trimesh.Trimesh]] = []
    current_name = "default"
    current_faces: list[list[int]] = []

    def flush() -> None:
        nonlocal current_name, current_faces
        if not current_faces:
            return

        used = sorted({index for face in current_faces for index in face})
        remap = {old: new for new, old in enumerate(used)}
        vertices = np.array([all_vertices[index] for index in used], dtype=np.float64)
        faces = np.array([[remap[index] for index in face] for face in current_faces], dtype=np.int64)
        groups.append((current_name, trimesh.Trimesh(vertices=vertices, faces=faces, process=False)))
        current_faces = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("o ") or line.startswith("g "):
            flush()
            current_name = line.split(maxsplit=1)[1].strip()
            continue
        if line.startswith("v "):
            _, x, y, z = line.split(maxsplit=3)
            all_vertices.append([float(x), float(y), float(z)])
            continue
        if line.startswith("f "):
            face_indices: list[int] = []
            for token in line.split()[1:]:
                vertex_index = int(token.split("/")[0])
                face_indices.append(
                    vertex_index - 1 if vertex_index > 0 else len(all_vertices) + vertex_index
                )
            if len(face_indices) >= 3:
                for i in range(1, len(face_indices) - 1):
                    current_faces.append([face_indices[0], face_indices[i], face_indices[i + 1]])

    flush()
    return groups


def _coerce_to_trimesh(loaded: trimesh.Trimesh | trimesh.Scene) -> trimesh.Trimesh:
    if isinstance(loaded, trimesh.Trimesh):
        return loaded

    if isinstance(loaded, trimesh.Scene):
        named_meshes = _scene_named_meshes(loaded)
        if named_meshes:
            exterior_meshes = [
                mesh for name, mesh in named_meshes if not _is_interior_name(name)
            ]
            if exterior_meshes:
                return trimesh.util.concatenate(exterior_meshes)

        meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise ValueError("No mesh geometry found in file.")
        return trimesh.util.concatenate(meshes)

    raise ValueError("Could not load mesh from file.")


def _scene_named_meshes(scene: trimesh.Scene) -> list[tuple[str, trimesh.Trimesh]]:
    named: list[tuple[str, trimesh.Trimesh]] = []
    for geometry_name, geometry in scene.geometry.items():
        if not isinstance(geometry, trimesh.Trimesh):
            continue
        mesh = geometry.copy()
        for node_name in scene.graph.nodes_geometry:
            transform, node_geometry_name = scene.graph[node_name]
            if node_geometry_name == geometry_name:
                mesh.apply_transform(transform)
                label = f"{node_name} {geometry_name}".strip()
                named.append((label, mesh))
                break
        else:
            named.append((geometry_name, mesh))
    return named


def _is_interior_name(name: str) -> bool:
    lower = name.lower()
    return any(hint in lower for hint in INTERIOR_NAME_HINTS)
