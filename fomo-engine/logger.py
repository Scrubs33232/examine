"""
Logging setup shared by every module.

Installs a filter that redacts any substring matching a known secret
(API key/secret/password pulled from the environment) before a record is
emitted, so an accidental `logger.debug(some_object_containing_a_key)` can
never leak credentials into log files or stdout.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path


class SecretRedactionFilter(logging.Filter):
    def __init__(self, secrets: list[str]):
        super().__init__()
        self._secrets = [s for s in secrets if s]

    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        msg = record.getMessage()
        for secret in self._secrets:
            if secret in msg:
                msg = msg.replace(secret, "***REDACTED***")
        record.msg = msg
        record.args = ()
        return True


def setup_logging(level: str = "INFO", log_file: str = "logs/fomo_engine.log") -> logging.Logger:
    secrets = [
        os.getenv("EXCHANGE_API_KEY", ""),
        os.getenv("EXCHANGE_API_SECRET", ""),
        os.getenv("EXCHANGE_API_PASSWORD", ""),
    ]
    redaction_filter = SecretRedactionFilter(secrets)

    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    stream_handler.addFilter(redaction_filter)

    file_handler = RotatingFileHandler(log_path, maxBytes=5_000_000, backupCount=5)
    file_handler.setFormatter(formatter)
    file_handler.addFilter(redaction_filter)

    root = logging.getLogger("fomo_engine")
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(stream_handler)
    root.addHandler(file_handler)
    root.propagate = False
    return root


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"fomo_engine.{name}")
