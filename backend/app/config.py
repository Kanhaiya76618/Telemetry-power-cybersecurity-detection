"""Environment-driven configuration.

Everything network-specific (broker host, topics prefix, node allow-list) lives here so
the transport can move from local Wi-Fi to the Anubhav private-5G / MEC deployment by
changing environment variables only — no application code changes.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # optional .env support
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:  # pragma: no cover
    pass


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


@dataclass
class Config:
    # MQTT transport
    mqtt_enabled: bool = field(default_factory=lambda: _bool("MQTT_ENABLED", True))
    mqtt_host: str = field(default_factory=lambda: os.getenv("MQTT_HOST", "localhost"))
    mqtt_port: int = field(default_factory=lambda: int(os.getenv("MQTT_PORT", "1883")))
    mqtt_username: str = field(default_factory=lambda: os.getenv("MQTT_USERNAME", ""))
    mqtt_password: str = field(default_factory=lambda: os.getenv("MQTT_PASSWORD", ""))
    mqtt_client_id: str = field(default_factory=lambda: os.getenv("MQTT_CLIENT_ID", "mec-backend"))
    topic_prefix: str = field(default_factory=lambda: os.getenv("TOPIC_PREFIX", "campus"))

    # Storage / API
    db_path: str = field(
        default_factory=lambda: os.getenv(
            "DB_PATH", str(Path(__file__).resolve().parents[1] / "data" / "emergency.db")
        )
    )
    api_token: str = field(default_factory=lambda: os.getenv("API_TOKEN", ""))
    cors_origins: list[str] = field(
        default_factory=lambda: [
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if o.strip()
        ]
    )

    # Default thresholds (runtime-editable via PUT /api/settings, persisted in SQLite)
    warning_c: float = field(default_factory=lambda: _float("WARNING_THRESHOLD_C", 40.0))
    critical_c: float = field(default_factory=lambda: _float("CRITICAL_THRESHOLD_C", 45.0))
    recovery_c: float = field(default_factory=lambda: _float("RECOVERY_THRESHOLD_C", 43.0))
    recovery_seconds: float = field(default_factory=lambda: _float("RECOVERY_SECONDS", 10.0))
    offline_seconds: float = field(default_factory=lambda: _float("OFFLINE_TIMEOUT_SECONDS", 10.0))

    # P6 lightweight security
    allowed_nodes: list[str] = field(
        default_factory=lambda: [
            n.strip() for n in os.getenv("ALLOWED_NODES", "node1").split(",") if n.strip()
        ]
    )
    device_hmac_key: str = field(default_factory=lambda: os.getenv("DEVICE_HMAC_KEY", ""))
    flood_max_per_sec: float = field(default_factory=lambda: _float("FLOOD_MAX_PER_SEC", 5.0))

    simulation_node: str = field(default_factory=lambda: os.getenv("SIMULATION_NODE", "node1-sim"))


config = Config()
