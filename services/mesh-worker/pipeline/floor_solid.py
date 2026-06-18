from __future__ import annotations

import numpy as np
import trimesh
from scipy import ndimage

from pipeline.floor_detect import detect_ceiling_level, detect_ground_floor_level
from pipeline.cull_site import detect_up_axis
from pipeline.log import get_logger

logger = get_logger(__name__)

DEFAULT_CELLS_PER_AXIS = 128
MIN_CELLS_PER_AXIS = 72
MAX_CELLS_PER_AXIS = 180


def extrude_floor_plan_solid(
    mesh: trimesh.Trimesh,
    up_axis: int | None = None,
    ground_z: float | None = None,
    ceiling_z: float | None = None,
    cells_per_axis: int | None = None,
) -> trimesh.Trimesh:
    """
    Build a printable solid from the ground-floor footprint extruded to the roof.

    Each footprint column is filled only up to the roof height at that (x, y),
    so gables and sloped roofs are preserved instead of a flat block.
    """
    if len(mesh.faces) == 0:
        return mesh

    axis = up_axis if up_axis is not None else detect_up_axis(mesh)
    horizontal_axes = [index for index in range(3) if index != axis]

    if ground_z is None:
        ground_z = detect_ground_floor_level(mesh, up_axis=axis)
    if ceiling_z is None:
        ceiling_z = detect_ceiling_level(mesh, ground_z, up_axis=axis)

    if ceiling_z - ground_z <= 1e-4:
        raise ValueError("Ceiling must be above ground floor.")

    if cells_per_axis is None:
        cells_per_axis = _cells_per_axis_for_mesh(mesh)

    footprint, pitch, origin = _floor_footprint_mask(
        mesh,
        up_axis=axis,
        horizontal_axes=horizontal_axes,
        ground_z=ground_z,
        ceiling_z=ceiling_z,
        cells_per_axis=cells_per_axis,
    )

    roof_heights = _roof_height_grid(
        mesh,
        footprint=footprint,
        pitch=pitch,
        origin=origin,
        ground_z=ground_z,
        ceiling_z=ceiling_z,
        up_axis=axis,
        horizontal_axes=horizontal_axes,
    )

    solid = _extrude_footprint(
        footprint,
        roof_heights=roof_heights,
        pitch=pitch,
        origin=origin,
        ground_z=ground_z,
        up_axis=axis,
        horizontal_axes=horizontal_axes,
    )

    solid.merge_vertices()
    solid.update_faces(solid.nondegenerate_faces())
    solid.remove_unreferenced_vertices()
    solid.process(validate=False)

    occupied = roof_heights[footprint] - ground_z
    logger.info(
        "Floor-plan solid: %d faces, footprint %dx%d, roof span %.3f–%.3f",
        len(solid.faces),
        footprint.shape[0],
        footprint.shape[1],
        float(occupied.min()) if occupied.size else 0.0,
        float(occupied.max()) if occupied.size else 0.0,
    )
    return solid


def _cells_per_axis_for_mesh(mesh: trimesh.Trimesh) -> int:
    face_count = len(mesh.faces)
    if face_count > 2_000_000:
        return MIN_CELLS_PER_AXIS
    if face_count > 1_000_000:
        return 96
    return DEFAULT_CELLS_PER_AXIS


def _floor_footprint_mask(
    mesh: trimesh.Trimesh,
    up_axis: int,
    horizontal_axes: list[int],
    ground_z: float,
    ceiling_z: float,
    cells_per_axis: int,
) -> tuple[np.ndarray, float, np.ndarray]:
    ha0, ha1 = horizontal_axes
    bounds = mesh.bounds
    span0 = float(bounds[1][ha0] - bounds[0][ha0])
    span1 = float(bounds[1][ha1] - bounds[0][ha1])
    pitch = max(span0, span1) / cells_per_axis
    pitch = max(pitch, 1e-4)

    nx = int(np.ceil(span0 / pitch)) + 1
    ny = int(np.ceil(span1 / pitch)) + 1
    occupied = np.zeros((nx, ny), dtype=bool)

    for face in mesh.faces:
        triangle = mesh.vertices[face]
        heights = triangle[:, up_axis]
        if float(heights.max()) < ground_z or float(heights.min()) > ceiling_z:
            continue

        xs = triangle[:, ha0]
        ys = triangle[:, ha1]
        ix0 = int(np.floor((xs.min() - bounds[0][ha0]) / pitch))
        ix1 = int(np.ceil((xs.max() - bounds[0][ha0]) / pitch))
        iy0 = int(np.floor((ys.min() - bounds[0][ha1]) / pitch))
        iy1 = int(np.ceil((ys.max() - bounds[0][ha1]) / pitch))
        ix0 = max(ix0, 0)
        iy0 = max(iy0, 0)
        ix1 = min(ix1, nx - 1)
        iy1 = min(iy1, ny - 1)
        occupied[ix0 : ix1 + 1, iy0 : iy1 + 1] = True

    occupied = ndimage.binary_dilation(occupied, iterations=1)
    occupied = ndimage.binary_fill_holes(occupied)
    occupied = ndimage.binary_closing(occupied, iterations=1)

    if not occupied.any():
        raise ValueError("Could not detect a floor footprint.")

    origin = bounds[0].copy()
    return occupied, pitch, origin


def _roof_height_grid(
    mesh: trimesh.Trimesh,
    footprint: np.ndarray,
    pitch: float,
    origin: np.ndarray,
    ground_z: float,
    ceiling_z: float,
    up_axis: int,
    horizontal_axes: list[int],
) -> np.ndarray:
    """Sample the roof envelope height at each footprint column."""
    ha0, ha1 = horizontal_axes
    nx, ny = footprint.shape
    roof = np.full((nx, ny), ground_z, dtype=np.float64)
    tolerance = max(float(mesh.extents.max()) * 0.008, pitch * 0.5)

    occupied_coords = np.argwhere(footprint)
    if len(occupied_coords) == 0:
        return roof

    geometry_cap = _geometry_roof_cap(
        mesh,
        footprint,
        pitch,
        origin,
        ground_z,
        ceiling_z,
        up_axis,
        horizontal_axes,
        tolerance,
    )

    ray_cap = _ray_roof_cap(
        mesh,
        occupied_coords,
        pitch,
        origin,
        ground_z,
        up_axis,
        horizontal_axes,
        tolerance,
    )

    for index, (ix, iy) in enumerate(occupied_coords):
        candidates = [geometry_cap[ix, iy], ray_cap[index]]
        height = max(candidates)
        height = min(height, ceiling_z + tolerance)
        roof[ix, iy] = max(height, ground_z + tolerance)

    return roof


def _geometry_roof_cap(
    mesh: trimesh.Trimesh,
    footprint: np.ndarray,
    pitch: float,
    origin: np.ndarray,
    ground_z: float,
    ceiling_z: float,
    up_axis: int,
    horizontal_axes: list[int],
    tolerance: float,
) -> np.ndarray:
    """Upper bound of shell geometry projected into each column."""
    ha0, ha1 = horizontal_axes
    nx, ny = footprint.shape
    cap = np.full((nx, ny), ground_z, dtype=np.float64)

    points = np.vstack((mesh.triangles_center, mesh.vertices))
    for point in points:
        height = float(point[up_axis])
        if height < ground_z + tolerance or height > ceiling_z + tolerance:
            continue

        ix = int((point[ha0] - origin[ha0]) / pitch)
        iy = int((point[ha1] - origin[ha1]) / pitch)
        if 0 <= ix < nx and 0 <= iy < ny and footprint[ix, iy]:
            cap[ix, iy] = max(cap[ix, iy], height)

    return cap


def _ray_roof_cap(
    mesh: trimesh.Trimesh,
    occupied_coords: np.ndarray,
    pitch: float,
    origin: np.ndarray,
    ground_z: float,
    up_axis: int,
    horizontal_axes: list[int],
    tolerance: float,
) -> np.ndarray:
    """Cast downward from above to find the roof surface in each column."""
    ha0, ha1 = horizontal_axes
    count = len(occupied_coords)
    caps = np.full(count, ground_z, dtype=np.float64)

    up = np.zeros(3, dtype=np.float64)
    up[up_axis] = 1.0
    down = -up

    ray_height = float(mesh.bounds[1][up_axis]) + max(float(mesh.extents.max()) * 0.05, pitch)
    origins = np.tile(origin, (count, 1))
    for index, (ix, iy) in enumerate(occupied_coords):
        origins[index, ha0] = origin[ha0] + (ix + 0.5) * pitch
        origins[index, ha1] = origin[ha1] + (iy + 0.5) * pitch
        origins[index, up_axis] = ray_height

    directions = np.tile(down, (count, 1))
    intersector = trimesh.ray.ray_triangle.RayMeshIntersector(mesh)
    locations, ray_indices, _ = intersector.intersects_location(
        ray_origins=origins,
        ray_directions=directions,
        multiple_hits=True,
    )

    if len(locations) == 0:
        return caps

    for location, ray_index in zip(locations, ray_indices):
        height = float(location[up_axis])
        if height < ground_z + tolerance:
            continue
        caps[ray_index] = max(caps[ray_index], height)

    return caps


def _extrude_footprint(
    footprint: np.ndarray,
    roof_heights: np.ndarray,
    pitch: float,
    origin: np.ndarray,
    ground_z: float,
    up_axis: int,
    horizontal_axes: list[int],
) -> trimesh.Trimesh:
    ha0, ha1 = horizontal_axes
    min_height = max(pitch * 0.25, 1e-4)
    boxes: list[trimesh.Trimesh] = []

    for ix in range(footprint.shape[0]):
        for iy in range(footprint.shape[1]):
            if not footprint[ix, iy]:
                continue

            top_z = float(roof_heights[ix, iy])
            if top_z - ground_z < min_height:
                continue

            mins = origin.copy()
            maxs = origin.copy()
            mins[ha0] = origin[ha0] + ix * pitch
            maxs[ha0] = mins[ha0] + pitch
            mins[ha1] = origin[ha1] + iy * pitch
            maxs[ha1] = mins[ha1] + pitch
            mins[up_axis] = ground_z
            maxs[up_axis] = top_z

            extents = maxs - mins
            center = (mins + maxs) / 2.0
            box = trimesh.creation.box(extents=extents)
            box.apply_translation(center)
            boxes.append(box)

    if not boxes:
        raise ValueError("Footprint produced no solid geometry.")

    if len(boxes) == 1:
        return boxes[0]

    return trimesh.util.concatenate(boxes)
