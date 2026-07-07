"""Persistent logging setup: file handlers, crash hooks, dir override."""

import logging
import sys
import threading

from sidecar import logs


def _reset_logging():
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
        h.close()


def test_log_dir_env_override(tmp_path, monkeypatch):
    monkeypatch.setenv("PRISM_LOG_DIR", str(tmp_path / "logs"))
    assert logs.log_dir() == tmp_path / "logs"


def test_configure_writes_to_rotated_file_and_installs_hooks(tmp_path, monkeypatch):
    monkeypatch.setenv("PRISM_LOG_DIR", str(tmp_path))
    orig_sys_hook = sys.excepthook
    orig_thread_hook = threading.excepthook
    try:
        logs.configure()
        logging.getLogger("sidecar.test").info("hello file")
        text = (tmp_path / "sidecar.log").read_text()
        assert "hello file" in text
        # Crash hooks replaced the defaults; faulthandler is armed.
        assert sys.excepthook is not orig_sys_hook
        assert threading.excepthook is not orig_thread_hook
        import faulthandler

        assert faulthandler.is_enabled()
        # The excepthook writes a traceback into the file before death.
        try:
            raise ValueError("boom")
        except ValueError:
            sys.excepthook(*sys.exc_info())
        assert "uncaught exception" in (tmp_path / "sidecar.log").read_text()
        assert (tmp_path / "crash.log").exists()
    finally:
        sys.excepthook = orig_sys_hook
        threading.excepthook = orig_thread_hook
        _reset_logging()
