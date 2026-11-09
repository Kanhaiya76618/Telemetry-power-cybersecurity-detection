"""Problem Statement 6 — Lightweight IoT security / anomaly-detection framework.

A rule + statistics based intrusion detector designed to be cheap enough to run on the
MEC/edge gateway in front of resource-constrained sensors (and simple enough that the same
rules can be ported to the ESP32). Each MQTT message is inspected *before* it can reach the
alert engine. All checks are O(1) per message with a few bytes of state per device.

Detections (kind -> blocking?):
  payload_too_large   yes   oversized MQTT payload (resource-exhaustion attempt)
  malformed_payload   yes   invalid JSON / schema violation
  topic_mismatch      yes   payload node differs from topic node (spoofing)
  unknown_device      yes   node not in the provisioned allow-list
  auth_failure        yes   missing/invalid HMAC-SHA256 device signature (when a key is set)
  replay              yes   sequence number not increasing (replayed / re-ordered frame)
  flood               yes   message rate above limit (DoS)
  implausible_jump    no    physically implausible temperature change rate (sensor tamper)
  statistical_outlier no    EWMA z-score outlier (behavioural anomaly)
  out_of_range        no    outside DHT11 plausible operating range
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

MAX_PAYLOAD_BYTES = 1024
BLOCKING = {"payload_too_large", "malformed_payload", "topic_mismatch", "unknown_device",
            "auth_failure", "replay", "flood"}
SEVERITY = {
    "payload_too_large": "high", "malformed_payload": "medium", "topic_mismatch": "high",
    "unknown_device": "high", "auth_failure": "high", "replay": "high", "flood": "high",
    "implausible_jump": "medium", "statistical_outlier": "low", "out_of_range": "medium",
}


@dataclass
class Finding:
    kind: str
    detail: str
    node: Optional[str] = None

    @property
    def blocking(self) -> bool:
        return self.kind in BLOCKING

    @property
    def severity(self) -> str:
        return SEVERITY[self.kind]


@dataclass
class _DeviceProfile:
    last_seq: Optional[int] = None
    last_temp: Optional[float] = None
    last_t: Optional[float] = None
    ewma: Optional[float] = None
    ewvar: float = 0.0
    n: int = 0
    last_msg_t: Optional[float] = None
    window: deque = field(default_factory=lambda: deque(maxlen=64))


def canonical_string(node: str, seq: int, temp: Optional[float], hum: Optional[float]) -> str:
    """Exact string the ESP32 signs. Floats use one decimal so both sides format identically."""
    f = lambda v: "null" if v is None else f"{v:.1f}"
    return f"{node}|{seq}|{f(temp)}|{f(hum)}"


def sign(key: str, msg: str) -> str:
    return hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()


class SecurityMonitor:
    def __init__(self, allowed_nodes: list[str], hmac_key: str = "", flood_max_per_sec: float = 5.0,
                 clock=time.monotonic):
        self.allowed = set(allowed_nodes)
        self.hmac_key = hmac_key
        self.flood_max_per_sec = flood_max_per_sec
        self.clock = clock
        self.profiles: dict[str, _DeviceProfile] = {}
        # resource metrics for the detector itself
        self.inspected = 0
        self.blocked = 0
        self.by_kind: dict[str, int] = {}
        self._lat_ns: deque = deque(maxlen=2000)

    # ------------------------------------------------------------------ main entry
    def inspect(self, topic: str, raw: bytes, now: Optional[float] = None) -> tuple[Optional[dict], list[Finding]]:
        """Returns (parsed_payload_or_None, findings). A blocking finding means: drop the message."""
        t0 = time.perf_counter_ns()
        now = self.clock() if now is None else now
        findings = self._inspect(topic, raw, now)
        parsed = findings[1]
        out = findings[0]
        self.inspected += 1
        if any(f.blocking for f in out):
            self.blocked += 1
        for f in out:
            self.by_kind[f.kind] = self.by_kind.get(f.kind, 0) + 1
        self._lat_ns.append(time.perf_counter_ns() - t0)
        return parsed, out

    def _inspect(self, topic: str, raw: bytes, now: float):
        parts = topic.split("/")
        topic_node = parts[1] if len(parts) >= 3 else None
        kind = parts[-1]
        if len(raw) > MAX_PAYLOAD_BYTES:
            return [Finding("payload_too_large", f"{len(raw)} bytes > {MAX_PAYLOAD_BYTES}", topic_node)], None
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("payload is not a JSON object")
        except Exception as e:  # noqa: BLE001
            return [Finding("malformed_payload", f"invalid JSON: {str(e)[:80]}", topic_node)], None

        node = data.get("node")
        if not isinstance(node, str):
            return [Finding("malformed_payload", "missing 'node' field", topic_node)], None
        if topic_node and node != topic_node:
            return [Finding("topic_mismatch", f"topic node '{topic_node}' != payload node '{node}'", node)], data
        if self.allowed and node not in self.allowed:
            return [Finding("unknown_device", f"node '{node}' is not provisioned", node)], data

        p = self.profiles.setdefault(node, _DeviceProfile())
        findings: list[Finding] = []

        # flood / DoS — sliding 1 s window
        p.window.append(now)
        recent = sum(1 for ts in p.window if now - ts <= 1.0)
        if recent > self.flood_max_per_sec:
            return [Finding("flood", f"{recent} msgs/s > {self.flood_max_per_sec:g}", node)], data

        seq = data.get("seq")
        temp = data.get("temp_c") if kind == "telemetry" else data.get("value")
        hum = data.get("humidity") if kind == "telemetry" else None

        # device authentication (HMAC-SHA256 over canonical string)
        if self.hmac_key and kind in ("telemetry", "emergency"):
            if kind == "emergency":
                msg = f"{node}|{data.get('event_id')}|{'null' if temp is None else f'{float(temp):.1f}'}"
            else:
                try:
                    msg = canonical_string(node, int(seq), _f(temp), _f(hum))
                except (TypeError, ValueError):
                    return [Finding("malformed_payload", "bad seq/value types", node)], data
            sig = data.get("sig")
            if not isinstance(sig, str) or not hmac.compare_digest(sig.lower(), sign(self.hmac_key, msg)):
                return [Finding("auth_failure", "missing or invalid device signature", node)], data

        # replay / re-ordering (allow a counter reset after a device reboot)
        if kind == "telemetry" and isinstance(seq, int):
            if p.last_seq is not None and seq <= p.last_seq:
                # A reboot restarts the counter near 0. The first few numbers are used up while
                # the device reconnects, so accept a small seq that follows a silence (the device
                # was down). A replay inside a live stream (no gap) is still blocked.
                silent_for = now - p.last_msg_t if p.last_msg_t is not None else 0.0
                rebooted = seq <= 100 and silent_for >= 5.0
                if not rebooted:
                    return [Finding("replay", f"seq {seq} <= last seq {p.last_seq}", node)], data
            p.last_seq = seq
            p.last_msg_t = now

        # behavioural anomaly checks (non-blocking, flag only)
        if kind == "telemetry" and isinstance(temp, (int, float)):
            temp = float(temp)
            if not (0.0 <= temp <= 60.0):
                findings.append(Finding("out_of_range", f"{temp:.1f}°C outside DHT11 plausible range", node))
            if p.last_temp is not None and p.last_t is not None:
                dt = max(now - p.last_t, 0.5)
                rate = abs(temp - p.last_temp) / dt
                if rate > 4.0:
                    findings.append(Finding("implausible_jump", f"{rate:.1f} °C/s change", node))
            if p.n >= 10 and p.ewma is not None:
                std = max(math.sqrt(p.ewvar), 0.5)
                z = abs(temp - p.ewma) / std
                if z > 6 and not any(f.kind == "implausible_jump" for f in findings):
                    findings.append(Finding("statistical_outlier", f"z-score {z:.1f}", node))
            if any(f.kind in ("implausible_jump", "out_of_range") for f in findings):
                return findings, data  # don't let a tampered value poison the baseline
            # update EWMA mean/variance
            a = 0.1
            if p.ewma is None:
                p.ewma = temp
            else:
                d = temp - p.ewma
                p.ewma += a * d
                p.ewvar = (1 - a) * (p.ewvar + a * d * d)
            p.n += 1
            p.last_temp, p.last_t = temp, now
        return findings, data

    def reset_device(self, node: str) -> None:
        self.profiles.pop(node, None)

    def metrics(self) -> dict:
        lat = sorted(self._lat_ns)
        pct = lambda q: round(lat[min(len(lat) - 1, int(q * len(lat)))] / 1000, 2) if lat else None
        state_bytes = sum(64 + 8 * len(p.window) for p in self.profiles.values())
        return {
            "inspected": self.inspected,
            "blocked": self.blocked,
            "by_kind": self.by_kind,
            "latency_us_avg": round(sum(lat) / len(lat) / 1000, 2) if lat else None,
            "latency_us_p95": pct(0.95),
            "latency_us_max": pct(1.0),
            "state_bytes_est": state_bytes,
            "devices_profiled": len(self.profiles),
            "hmac_enabled": bool(self.hmac_key),
            "allowed_nodes": sorted(self.allowed),
        }


def _f(v) -> Optional[float]:
    return None if v is None else float(v)
