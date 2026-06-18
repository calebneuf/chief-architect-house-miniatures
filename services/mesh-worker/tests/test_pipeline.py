from __future__ import annotations

import io

import numpy as np
import trimesh

from pipeline.cull_site import cull_below_ground, cull_exterior_clutter
from pipeline.export import export_stl
from pipeline.exterior_shell import extract_exterior_shell
from pipeline.load import load_mesh
from pipeline.process import process_mesh_bytes
from pipeline.repair import repair_mesh
from pipeline.solidify import solidify_mesh


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


def house_with_basement() -> trimesh.Trimesh:
    above = trimesh.creation.box(extents=(10, 10, 5))
    above.apply_translation((0, 0, 2.5))
    basement = trimesh.creation.box(extents=(10, 10, 4))
    basement.apply_translation((0, 0, -2))
    return trimesh.util.concatenate([above, basement])


def house_with_fence() -> trimesh.Trimesh:
    house = trimesh.creation.box(extents=(10, 10, 5))
    house.apply_translation((0, 0, 2.5))
    fence = trimesh.creation.box(extents=(0.1, 20, 2))
    fence.apply_translation((0, 12, 1))
    return trimesh.util.concatenate([house, fence])


def export_mesh(mesh: trimesh.Trimesh) -> bytes:
    return export_stl(mesh)


def test_extract_shell_removes_interior_partition():
    mesh = repair_mesh(box_with_interior_wall())
    faces_before = len(mesh.faces)

    shell, removed = extract_exterior_shell(mesh, ray_count=800)
    faces_after = len(shell.faces)

    assert removed > 0
    assert faces_after < faces_before
    assert np.allclose(shell.extents, mesh.extents, rtol=0.05)


def test_extract_shell_keeps_full_exterior_on_sparse_rays():
    """Low ray counts must not carve holes in the exterior shell."""
    mesh = repair_mesh(box_with_interior_wall())
    for _ in range(3):
        mesh = mesh.subdivide()
    mesh = repair_mesh(mesh)

    shell, removed = extract_exterior_shell(mesh, ray_count=300)

    assert removed > 0
    assert len(shell.faces) >= len(mesh.faces) * 0.45
    assert np.allclose(shell.extents, mesh.extents, rtol=0.05)


def test_solidify_preserves_footprint():
    mesh = repair_mesh(box_with_interior_wall())
    reference = mesh.extents.copy()
    solid = solidify_mesh(mesh, voxels_per_axis=48, reference_extents=reference)

    assert len(solid.faces) > 0
    assert solid.is_watertight
    assert np.allclose(solid.extents[:2], reference[:2], rtol=0.12)


def test_process_mesh_bytes_round_trip():
    mesh = box_with_interior_wall()
    stl_bytes = export_mesh(mesh)

    result = process_mesh_bytes(stl_bytes, "stl")

    assert result.faces_removed > 0
    assert len(result.stl_bytes) > 0

    reloaded = load_mesh(result.stl_bytes, "stl")
    assert len(reloaded.faces) == result.faces_after
    assert np.allclose(reloaded.extents[:2], mesh.extents[:2], rtol=0.15)


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


def test_l_shaped_shell_drops_interior_partition():
    try:
        mesh = repair_mesh(l_shaped_shell_with_partition())
    except Exception:
        # Manifold boolean may be unavailable in some environments.
        return

    shell, removed = extract_exterior_shell(mesh, ray_count=1000)
    assert removed > 0
    assert len(shell.faces) > 0


def test_cull_below_ground_removes_basement():
    mesh = repair_mesh(house_with_basement())
    faces_before = len(mesh.faces)

    culled, removed = cull_below_ground(mesh)
    faces_after = len(culled.faces)

    assert removed > 0
    assert faces_after < faces_before
    assert culled.bounds[0][2] >= -0.5


def test_cull_exterior_clutter_removes_fence():
    mesh = repair_mesh(house_with_fence())
    components_before = len(mesh.split(only_watertight=False))

    culled, removed = cull_exterior_clutter(mesh)

    assert removed > 0
    assert len(culled.split(only_watertight=False)) < components_before


def test_process_removes_basement_and_fence():
    mesh = trimesh.util.concatenate([house_with_basement(), house_with_fence()])

    result = process_mesh_bytes(export_mesh(mesh), "stl")
    assert result.components_removed > 0
    assert result.faces_removed > 0
