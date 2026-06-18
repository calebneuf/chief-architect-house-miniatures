from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from typing import Iterator


def setup_logging() -> None:
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


@contextmanager
def log_step(logger: logging.Logger, label: str) -> Iterator[None]:
    logger.info("→ %s", label)
    started = time.perf_counter()
    try:
        yield
    except Exception:
        logger.exception("✗ %s failed after %.2fs", label, time.perf_counter() - started)
        raise
    else:
        logger.info("✓ %s (%.2fs)", label, time.perf_counter() - started)
