"""Pydantic schemas for MQTT payloads and REST bodies."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

NODE_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"


class Telemetry(BaseModel):
    """campus/<node>/telemetry (MQTT QoS 0). Extends the PDF format with humidity."""

    model_config = ConfigDict(extra="ignore")
    node: str = Field(pattern=NODE_PATTERN)
    seq: int = Field(ge=0, le=2**32)
    ts: Optional[float] = None  # device clock — informational only, never compared cross-device
    temp_c: Optional[float] = Field(default=None, ge=-40, le=125)
    humidity: Optional[float] = Field(default=None, ge=0, le=100)
    gas_raw: Optional[int] = None
    flame: Optional[int] = None
    sig: Optional[str] = Field(default=None, max_length=128)
    # Optional ACK round-trip report measured on the ESP32's own monotonic millis() clock
    ack_event_id: Optional[str] = Field(default=None, max_length=48)
    ack_rtt_ms: Optional[float] = Field(default=None, ge=0, le=600000)
    rssi: Optional[int] = None


class Emergency(BaseModel):
    """campus/<node>/emergency (MQTT QoS 1)."""

    model_config = ConfigDict(extra="ignore")
    node: str = Field(pattern=NODE_PATTERN)
    event_id: str = Field(min_length=1, max_length=48)
    ts: Optional[float] = None
    type: str = Field(default="temp", max_length=16)
    value: Optional[float] = None
    severity: Literal["critical", "warning", "info"] = "critical"
    test: bool = False
    seq: Optional[int] = None
    sig: Optional[str] = Field(default=None, max_length=128)


class SettingsUpdate(BaseModel):
    warning_c: Optional[float] = Field(default=None, ge=-20, le=120)
    critical_c: Optional[float] = Field(default=None, ge=-20, le=120)
    recovery_c: Optional[float] = Field(default=None, ge=-20, le=120)
    recovery_seconds: Optional[float] = Field(default=None, ge=0, le=3600)
    offline_seconds: Optional[float] = Field(default=None, ge=2, le=3600)
    flood_max_per_sec: Optional[float] = Field(default=None, gt=0, le=1000)


class SimulationCommand(BaseModel):
    action: Literal["set", "increase", "decrease", "trigger", "reset"]
    value: Optional[float] = Field(default=None, ge=-20, le=90)
    step: float = Field(default=2.0, gt=0, le=20)

    @model_validator(mode="after")
    def _need_value(self):
        if self.action == "set" and self.value is None:
            raise ValueError("value is required for action=set")
        return self


class AttackSimulation(BaseModel):
    attack: Literal["replay", "flood", "spoof", "forged_signature", "malformed", "sensor_tamper"]
