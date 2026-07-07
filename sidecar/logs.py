"""Persistent sidecar logging: rotated file logs plus crash hooks.

Everything lands under one log root shared with the Rust shell (see
``docs/milestone-3-test-suite/observability/design.md``):

- ``sidecar.log`` — every stdlib logging record (mirrors the stderr stream)
- ``crash.log``  — faulthandler output for native-level faults (torch/librosa)

Uncaught exceptions on any thread are logged CRITICAL with traceback before
the process dies, so a dead sidecar always leaves an artifact.
"""

import faulthandler
import logging
import os
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def log_dir() -> Path:
    """The shared log root; ``PRISM_LOG_DIR`` overrides for dev/tests."""
    override = os.environ.get("PRISM_LOG_DIR")
    if override:
        return Path(override)
    return Path.home() / "Library" / "Application Support" / "Prism" / "logs"


def configure() -> None:
    """Set up stderr + rotating-file logging and the crash hooks."""
    level = (
        logging.DEBUG
        if os.environ.get("PRISM_LOG", "").lower() == "debug"
        else logging.INFO
    )
    root = log_dir()
    root.mkdir(parents=True, exist_ok=True)

    # stderr keeps the dev terminal informative; the file survives the process.
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    handlers.append(
        RotatingFileHandler(
            root / "sidecar.log", maxBytes=5 * 1024 * 1024, backupCount=3
        )
    )
    # force: replace any pre-existing root handlers (re-configuration, tests) so
    # the file handler always attaches.
    logging.basicConfig(level=level, format=_FORMAT, handlers=handlers, force=True)

    log = logging.getLogger("sidecar.logs")

    # Uncaught exceptions (main thread and workers) must leave a traceback in
    # the file before the process dies.
    def excepthook(exc_type, exc, tb):
        log.critical("uncaught exception", exc_info=(exc_type, exc, tb))

    def thread_excepthook(args: threading.ExceptHookArgs):
        log.critical(
            "uncaught exception in thread %s",
            args.thread.name if args.thread else "?",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    sys.excepthook = excepthook
    threading.excepthook = thread_excepthook

    # Native-level faults (segfaults inside torch/librosa) dump all thread
    # stacks here; no Python hook can catch those. The handle is kept open for
    # the process lifetime by design.
    crash = (root / "crash.log").open("a")
    faulthandler.enable(file=crash)
