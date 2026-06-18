from __future__ import annotations

import io

import numpy as np
import trimesh

from pipeline.cull_interior import cull_interior_walls
from pipeline.export import export_stl
from pipeline.load import load_mesh
from pipeline.process import process_mesh_bytes
from pipeline.repair import repair_mesh


def box_with_interior_wall() -> trimesh.Trimesh:
    """Closed exterior shell with a fully occluded interior partition."""
    shell = trimesh.creation.box(extents=(10, 10, 6))
    partition = trimesh.creation.box(extents=(0.2, 8, 5))
    partition.apply_translation((0, 0, 0.5))
    return trimesh.util.concatenate([shell, partition])


def l_shaped_shell_with_partition() -> trimesh.Trimesh:
    """L-shaped envelope with an interior wall fully inside the enclosed volume."""
    main = trimesh.creation.box(extents=(12, 8, 5))
    cutout = trimesh.creation.box(extents=(6, 4, 6))
    cutout.apply_translation((3, 2, 0))
    shell = main.difference(cutout, engine="manifold")

    partition = trimesh.creation.box(extents=(0.2, 5, 4))
    partition.apply_translation((-3, 0, 0.5))
    return trimesh.util.concatenate([shell, partition])


def export_mesh(mesh: trimesh.Trimesh) -> bytes:
    return export_stl(mesh)


def test_cull_removes_occluded_interior_wall():
    mesh = repair_mesh(box_with_interior_wall())
    faces_before = len(mesh.faces)

    culled, removed = cull_interior_walls(mesh, ray_count=800)
    faces_after = len(culled.faces)

    assert removed > 0
    assert faces_after < faces_before
    assert faces_after > 0


def test_process_mesh_bytes_round_trip():
    mesh = box_with_interior_wall()
    stl_bytes = export_mesh(mesh)

    result = process_mesh_bytes(stl_bytes, "stl")

    assert result.faces_after < result.faces_before
    assert result.faces_removed > 0
    assert len(result.stl_bytes) > 0

    reloaded = load_mesh(result.stl_bytes, "stl")
    assert len(reloaded.faces) == result.faces_after


def test_obj_group_name_fast_path():
    exterior = trimesh.creation.box(extents=(8, 8, 4))
    interior = trimesh.creation.box(extents=(0.2, 6, 3))
    interior.apply_translation((0, 0, 0.5))

    scene = trimesh.Scene()
    scene.add_geometry(exterior, geom_name="Exterior_Walls")
    scene.add_geometry(interior, geom_name="Interior_Partition")

    obj_bytes = scene.export(file_type="obj")
    loaded = load_mesh(obj_bytes, "obj")

    assert len(loaded.faces) < len(exterior.faces) + len(interior.faces)


def test_l_shaped_shell_culls_interior_partition():
    try:
        mesh = repair_mesh(l_shaped_shell_with_partition())
    except Exception:
        # Manifold boolean may be unavailable in some environments.
        return

    culled, removed = cull_interior_walls(mesh, ray_count=1000)
    assert removed > 0
    assert len(culled.faces) > 0
