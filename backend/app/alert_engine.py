"""Server-side threshold detection and alert state machine.

The engine is the single source of truth for alert state. Real ESP32 telemetry and
simulation readings go through exactly the same ``evaluate`` call.

States: NORMAL -> WARNING -> CRITICAL_UNACKNOWLEDGED -> CRITICAL_ACKNOWLEDGED -> RECOVERED -> NORMAL

Hysteresis: critical triggers at ``critical_c``; the alert is only resolved once the
temperature stays below ``recovery_c`` for ``recovery_seconds`` (monotonic clock).
Muting audio is purely a client concern and never touches this state.
"""
from __future__ import annotations

import itertools
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from .database import Database
from .models import AlertState, Thresholds

log = logging.getLogger("alert_engine")


@dataclass
class NodeState:
    node: str
    simulated: bool = False
    state: AlertState = AlertState.NORMAL
    critical_alert_id: Optional[int] = None
    warning_alert_id: Optional[int] = None
    offline_alert_id: Optional[int] = None
    below_since: Optional[float] = None  # monotonic
    recovered_at: Optional[float] = None  # monotonic
    last_temp: Optional[float] = None

    def public(self) -> dict:
        return {
            "node": self.node,
            "simulated": self.simulated,
            "state": self.state.value,
            "critical_alert_id": self.critical_alert_id,
            "last_temp": self.last_temp,
        }


@dataclass
class EngineResult:
    state_changed: bool = False
    alerts: list[dict] = field(default_factory=list)


class AlertEngine:
    def __init__(
        self,
        db: Database,
        thresholds: Thresholds,
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], float] = time.time,
    ):
        self.db = db
        self.t = thresholds
        self.clock = clock
        self.wall = wall
        self.nodes: dict[str, NodeState] = {}
        self._counter = itertools.count(1)
        self._restore()

    # ------------------------------------------------------------------ restore
    def _restore(self) -> None:
        """After a backend restart, re-attach still-open alerts so emergencies are not lost."""
        for a in self.db.active_alerts():
            ns = self._node(a["node"], a["simulated"])
            if a["type"] == "temp" and a["severity"] == "critical":
                ns.critical_alert_id = a["id"]
                ns.state = AlertState(a["state"]) if a["state"] in AlertState.__members__ else AlertState.CRITICAL_UNACKNOWLEDGED
                ns.last_temp = a["peak_value"]
            elif a["type"] == "temp" and a["severity"] == "warning":
                ns.warning_alert_id = a["id"]
                if not ns.state.is_critical:
                    ns.state = AlertState.WARNING
            elif a["type"] == "device_offline":
                ns.offline_alert_id = a["id"]
        if self.nodes:
            log.info("restored alert state for %s", list(self.nodes))

    def _node(self, node: str, simulated: bool = False) -> NodeState:
        if node not in self.nodes:
            self.nodes[node] = NodeState(node=node, simulated=simulated)
        return self.nodes[node]

    def _new_event_id(self) -> str:
        return f"B-{int(self.wall())}-{next(self._counter):03d}"

    # ------------------------------------------------------------------ evaluation
    def evaluate(self, node: str, temp: Optional[float], simulated: bool = False) -> EngineResult:
        res = EngineResult()
        ns = self._node(node, simulated)
        if temp is None:  # invalid / missing DHT reading: never treated as "safe"
            return res
        prev = ns.state
        now = self.clock()
        ns.last_temp = temp
        t = self.t

        if ns.critical_alert_id is not None:
            alert = self.db.get_alert(ns.critical_alert_id)
            if alert and (alert["peak_value"] is None or temp > alert["peak_value"]):
                res.alerts.append(self.db.update_alert(ns.critical_alert_id, peak_value=temp))
            if temp >= t.recovery_c:
                ns.below_since = None
            else:
                if ns.below_since is None:
                    ns.below_since = now
                if now - ns.below_since >= t.recovery_seconds:
                    res.alerts.append(
                        self.db.update_alert(
                            ns.critical_alert_id, state=AlertState.RECOVERED.value, resolved_at=self.wall()
                        )
                    )
                    ns.critical_alert_id = None
                    ns.below_since = None
                    ns.recovered_at = now
                    ns.state = AlertState.RECOVERED
        elif temp >= t.critical_c:
            if ns.warning_alert_id is not None:
                res.alerts.append(self._close_warning(ns, "escalated to critical"))
            alert = self.db.insert_alert(
                event_id=self._new_event_id(),
                node=node,
                type="temp",
                severity="critical",
                value=temp,
                peak_value=temp,
                threshold=t.critical_c,
                state=AlertState.CRITICAL_UNACKNOWLEDGED.value,
                source="backend",
                simulated=simulated,
                triggered_at=self.wall(),
                delivery_status="pushed to dashboards",
            )
            ns.critical_alert_id = alert["id"]
            ns.state = AlertState.CRITICAL_UNACKNOWLEDGED
            ns.below_since = None
            res.alerts.append(alert)
            log.warning("CRITICAL %s %.1f°C (alert %s)", node, temp, alert["event_id"])
        else:
            in_recovery_window = (
                ns.state == AlertState.RECOVERED
                and ns.recovered_at is not None
                and now - ns.recovered_at < max(t.recovery_seconds, 5.0)
            )
            if temp >= t.warning_c:
                if ns.warning_alert_id is None:
                    alert = self.db.insert_alert(
                        event_id=self._new_event_id(), node=node, type="temp", severity="warning",
                        value=temp, peak_value=temp, threshold=t.warning_c, state=AlertState.WARNING.value,
                        source="backend", simulated=simulated, triggered_at=self.wall(),
                        delivery_status="pushed to dashboards",
                    )
                    ns.warning_alert_id = alert["id"]
                    res.alerts.append(alert)
                else:
                    a = self.db.get_alert(ns.warning_alert_id)
                    if a and temp > (a["peak_value"] or -999):
                        res.alerts.append(self.db.update_alert(ns.warning_alert_id, peak_value=temp))
                ns.state = AlertState.WARNING
            else:
                if ns.warning_alert_id is not None:
                    res.alerts.append(self._close_warning(ns, "returned below warning threshold"))
                ns.state = AlertState.RECOVERED if in_recovery_window else AlertState.NORMAL

        res.state_changed = prev != ns.state
        return res

    def _close_warning(self, ns: NodeState, note: str) -> dict:
        a = self.db.update_alert(
            ns.warning_alert_id, state=AlertState.RECOVERED.value, resolved_at=self.wall(), note=note
        )
        ns.warning_alert_id = None
        return a

    # ------------------------------------------------------------------ device-side emergencies
    def handle_device_emergency(
        self, node: str, event_id: str, value: Optional[float], simulated: bool, test: bool
    ) -> tuple[Optional[dict], bool]:
        """Returns (alert, is_new). Deduplicates by event_id and by active incident."""
        existing = self.db.find_alert_by_event(event_id)
        if existing:
            return existing, False
        ns = self._node(node, simulated)
        if ns.critical_alert_id is not None:  # backend already detected it -> link, don't duplicate
            alert = self.db.get_alert(ns.critical_alert_id)
            if alert and not alert["device_event_id"]:
                alert = self.db.update_alert(ns.critical_alert_id, device_event_id=event_id, source="backend+device")
            return alert, False
        if ns.warning_alert_id is not None:
            self._close_warning(ns, "escalated by device emergency")
        alert = self.db.insert_alert(
            event_id=self._new_event_id(), device_event_id=event_id, node=node, type="temp",
            severity="critical", value=value, peak_value=value, threshold=self.t.critical_c,
            state=AlertState.CRITICAL_UNACKNOWLEDGED.value, source="device",
            simulated=simulated or test, triggered_at=self.wall(), delivery_status="received via MQTT QoS1",
            note="device test event" if test else None,
        )
        ns.critical_alert_id = alert["id"]
        ns.state = AlertState.CRITICAL_UNACKNOWLEDGED
        ns.below_since = None
        if value is not None:
            ns.last_temp = value
        return alert, True

    # ------------------------------------------------------------------ operator actions
    def acknowledge(self, alert_id: int) -> Optional[dict]:
        alert = self.db.get_alert(alert_id)
        if not alert:
            return None
        if alert["acknowledged_at"]:
            return alert
        fields = {"acknowledged_at": self.wall()}
        ns = self.nodes.get(alert["node"])
        if alert["resolved_at"] is None and alert["severity"] == "critical":
            fields["state"] = AlertState.CRITICAL_ACKNOWLEDGED.value
            if ns and ns.critical_alert_id == alert_id:
                ns.state = AlertState.CRITICAL_ACKNOWLEDGED
        return self.db.update_alert(alert_id, **fields)

    # ------------------------------------------------------------------ connectivity
    def set_offline(self, node: str, offline: bool, simulated: bool = False) -> Optional[dict]:
        ns = self._node(node, simulated)
        if offline and ns.offline_alert_id is None:
            a = self.db.insert_alert(
                event_id=self._new_event_id(), node=node, type="device_offline", severity="warning",
                value=None, threshold=self.t.offline_seconds, state="OFFLINE", source="backend",
                simulated=simulated, triggered_at=self.wall(), delivery_status="pushed to dashboards",
                note=f"no telemetry for > {self.t.offline_seconds:.0f}s",
            )
            ns.offline_alert_id = a["id"]
            return a
        if not offline and ns.offline_alert_id is not None:
            a = self.db.update_alert(ns.offline_alert_id, state="RECONNECTED", resolved_at=self.wall())
            ns.offline_alert_id = None
            return a
        return None

    def snapshot(self) -> list[dict]:
        return [ns.public() for ns in self.nodes.values()]
