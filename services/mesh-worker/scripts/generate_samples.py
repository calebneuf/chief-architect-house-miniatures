"""Generate representative synthetic house meshes for manual tuning."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tests.test_pipeline import box_with_interior_wall, export_mesh, l_shaped_shell_with_partition
import trimesh


def messy_house_with_fixture() -> trimesh.Trimesh:
    """House shell with interior wall and a small interior fixture."""
    base = box_with_interior_wall()
    fixture = trimesh.creation.icosphere(radius=0.4)
    fixture.apply_translation((2, 2, 1))
    return trimesh.util.concatenate([base, fixture])


def main() -> None:
    output_dir = Path(__file__).resolve().parents[3] / "samples"
    output_dir.mkdir(parents=True, exist_ok=True)

    samples = {
        "simple-house-with-partitions.stl": box_with_interior_wall(),
        "messy-house-with-fixture.stl": messy_house_with_fixture(),
    }

    try:
        samples["l-shaped-house.stl"] = l_shaped_shell_with_partition()
    except Exception:
        pass

    for name, mesh in samples.items():
        path = output_dir / name
        path.write_bytes(export_mesh(mesh))
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
