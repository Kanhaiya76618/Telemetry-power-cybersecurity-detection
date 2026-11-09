"""Domain models shared across the backend."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class AlertState(str, Enum):
    NORMAL = "NORMAL"
    WARNING = "WARNING"
    CRITICAL_UNACKNOWLEDGED = "CRITICAL_UNACKNOWLEDGED"
    CRITICAL_ACKNOWLEDGED = "CRITICAL_ACKNOWLEDGED"
    RECOVERED = "RECOVERED"

    @property
    def is_critical(self) -> bool:
        return self in (AlertState.CRITICAL_UNACKNOWLEDGED, AlertState.CRITICAL_ACKNOWLEDGED)


@dataclass
class Thresholds:
    warning_c: float = 40.0
    critical_c: float = 45.0
    recovery_c: float = 43.0
    recovery_seconds: float = 10.0
    offline_seconds: float = 10.0
    flood_max_per_sec: float = 5.0

    def validate(self) -> None:
        if not (self.recovery_c < self.critical_c):
            raise ValueError("recovery threshold must be below the critical threshold")
        if not (self.warning_c < self.critical_c):
            raise ValueError("warning threshold must be below the critical threshold")
        if self.recovery_seconds < 0 or self.offline_seconds < 2:
            raise ValueError("recovery_seconds must be >= 0 and offline_seconds >= 2")
        if self.flood_max_per_sec <= 0:
            raise ValueError("flood_max_per_sec must be positive")
