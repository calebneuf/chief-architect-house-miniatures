"""Validate culler behavior against synthetic representative samples."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.process import process_mesh_bytes

SAMPLES_DIR = Path(__file__).resolve().parents[3] / "samples"
MIN_REMOVAL_RATIO = 0.05


def main() -> None:
    if not SAMPLES_DIR.exists():
        raise SystemExit(f"Samples directory not found: {SAMPLES_DIR}")

    sample_files = sorted(SAMPLES_DIR.glob("*.stl"))
    if not sample_files:
        raise SystemExit("No STL samples found. Run scripts/generate_samples.py first.")

    for sample_path in sample_files:
        data = sample_path.read_bytes()
        result = process_mesh_bytes(data, "stl")
        removal_ratio = result.faces_removed / max(result.faces_before, 1)
        status = "ok" if removal_ratio >= MIN_REMOVAL_RATIO else "check"
        print(
            f"[{status}] {sample_path.name}: "
            f"{result.faces_before} -> {result.faces_after} faces "
            f"({removal_ratio:.1%} removed, {result.processing_ms} ms)"
        )


if __name__ == "__main__":
    main()
