"""The processing pipeline: MQTT/simulation -> security -> validation -> storage -> alert engine -> WebSockets."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from typing import Optional

from pydantic import ValidationError

from .alert_engine import AlertEngine
from .config import Config
from .database import Database
from .models import Thresholds
from .schemas import Emergency, Telemetry
from .security import Finding, SecurityMonitor, canonical_string, sign
from .simulation import Simulator
from .websocket_manager import WebSocketManager

log = logging.getLogger("hub")
THRESHOLD_KEYS = ("warning_c", "critical_c", "recovery_c", "recovery_seconds", "offline_seconds", "flood_max_per_sec")


class Hub:
    def __init__(self, cfg: Config, db: Optional[Database] = None, clock=time.monotonic):
        self.cfg = cfg
        self.clock = clock
        self.db = db or Database(cfg.db_path)
        stored = self.db.get_settings()
        self.thresholds = Thresholds(
            **{k: float(stored.get(k, getattr(cfg, k, getattr(Thresholds, k)))) for k in THRESHOLD_KEYS}
        )
        self.thresholds.validate()
        self.engine = AlertEngine(self.db, self.thresholds, clock=clock)
        self.security = SecurityMonitor(cfg.allowed_nodes, cfg.device_hmac_key,
                                        self.thresholds.flood_max_per_sec, clock=clock)
        self.ws = WebSocketManager()
        self.mqtt = None
        self.sim = Simulator(cfg.simulation_node, self._sim_emit)
        self.started_at = time.time()
        self.devices: dict[str, dict] = {}
        for d in self.db.devices():  # after restart everything starts OFFLINE until heard from
            self.devices[d["node"]] = {
                "node": d["node"], "simulated": bool(d["simulated"]), "online": False,
                "last_seen": d["last_seen"], "_mono": None, "msg_count": d["msg_count"],
                "last_seq": d["last_seq"], "rssi": None, "rx_times": deque(maxlen=120),
            }
        self.latest: dict[str, dict] = {r["node"]: _reading_out(r) for r in self.db.latest_readings()}
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=5000)
        self._tasks: list[asyncio.Task] = []

    # ================================================================ lifecycle
    async def start(self) -> None:
        loop = asyncio.get_running_loop()
        await self.close_simulated_alerts("backend restarted (simulation not running)")
        self._tasks.append(asyncio.create_task(self._consumer()))
        self._tasks.append(asyncio.create_task(self._monitor()))
        if self.cfg.mqtt_enabled:
            from .mqtt_client import MqttBridge

            self.mqtt = MqttBridge(self.cfg, loop, self._enqueue, self._mqtt_status_changed)
            self.mqtt.start()

    async def stop(self) -> None:
        await self.sim.stop()
        for t in self._tasks:
            t.cancel()
        if self.mqtt:
            self.mqtt.stop()

    def _enqueue(self, topic: str, raw: bytes, rx_mono: float) -> None:
        try:
            self._queue.put_nowait((topic, raw, rx_mono))
        except asyncio.QueueFull:
            log.error("ingest queue full — dropping message on %s", topic)

    async def _consumer(self) -> None:
        while True:
            topic, raw, _ = await self._queue.get()
            try:
                await self.handle_mqtt(topic, raw)
            except Exception:  # noqa: BLE001
                log.exception("failed processing %s", topic)

    def _mqtt_status_changed(self) -> None:
        asyncio.ensure_future(self.ws.broadcast("system", self.system_status()))
        if self.mqtt and self.mqtt.connected:
            self.push_config()

    async def _monitor(self) -> None:
        tick = 0
        while True:
            await asyncio.sleep(1)
            tick += 1
            await self.check_offline()
            if self.mqtt and tick % 5 == 0:
                self.mqtt.probe()
            if tick % 5 == 0:
                await self.ws.broadcast("system", self.system_status())
            if tick % 3600 == 0:
                self.db.prune_readings()

    # ================================================================ MQTT ingest
    async def handle_mqtt(self, topic: str, raw: bytes) -> None:
        parsed, findings = self.security.inspect(topic, raw)
        for f in findings:
            await self._record_finding(f, topic, simulated=False)
        if any(f.blocking for f in findings) or parsed is None:
            return
        kind = topic.rsplit("/", 1)[-1]
        if kind == "telemetry":
            try:
                t = Telemetry.model_validate(parsed)
            except ValidationError as e:
                await self._record_finding(Finding("malformed_payload", _short(e), parsed.get("node")), topic, False)
                return
            await self.ingest_reading(t.node, t.temp_c, t.humidity, t.seq, t.ts, simulated=False, rssi=t.rssi)
            if t.ack_event_id and t.ack_rtt_ms is not None:
                await self._record_rtt(t.ack_event_id, t.ack_rtt_ms)
        elif kind == "emergency":
            try:
                e = Emergency.model_validate(parsed)
            except ValidationError as ex:
                await self._record_finding(Finding("malformed_payload", _short(ex), parsed.get("node")), topic, False)
                return
            await self.handle_emergency(e)

    async def handle_emergency(self, e: Emergency, simulated: bool = False) -> Optional[dict]:
        await self._mark_seen_async(e.node, simulated, None)
        alert, is_new = self.engine.handle_device_emergency(e.node, e.event_id, e.value, simulated, e.test)
        acked = False
        if self.mqtt and not simulated:  # delivery ACK (QoS1) so the device can time the round trip
            acked = self.mqtt.send_ack(e.node, {"event_id": e.event_id, "type": "delivery"})
        if alert:
            if acked and not alert.get("rtt_ms"):
                alert = self.db.update_alert(alert["id"], delivery_status="received (QoS1), delivery ACK sent")
            await self.ws.broadcast("alert", alert)
            await self.ws.broadcast("node", self.node_view(e.node))
        log.warning("device emergency %s from %s (%s)", e.event_id, e.node, "new" if is_new else "dedup")
        return alert

    async def _record_rtt(self, event_id: str, rtt_ms: float) -> None:
        alert = self.db.find_alert_by_event(event_id)
        if alert and alert.get("rtt_ms") is None:
            alert = self.db.update_alert(alert["id"], rtt_ms=rtt_ms,
                                         delivery_status="delivered — ACK round trip confirmed by device")
            await self.ws.broadcast("alert", alert)

    async def _record_finding(self, f: Finding, topic: Optional[str], simulated: bool) -> None:
        ev = self.db.insert_security_event(ts=time.time(), node=f.node, topic=topic, kind=f.kind,
                                           severity=f.severity, detail=f.detail, blocked=f.blocking,
                                           simulated=simulated)
        ev["blocked"], ev["simulated"] = bool(ev["blocked"]), bool(ev["simulated"])
        log.info("security %s %s: %s", f.kind, f.node, f.detail)
        await self.ws.broadcast("security", {"event": ev, "metrics": self.security.metrics()})

    # ================================================================ common reading path
    async def ingest_reading(self, node: str, temp: Optional[float], hum: Optional[float], seq: Optional[int],
                             device_ts: Optional[float], simulated: bool, rssi: Optional[int] = None) -> None:
        now = time.time()
        await self._mark_seen_async(node, simulated, seq, rssi)
        self.db.insert_reading(node, seq, device_ts, now, temp, hum, simulated)
        reading = {"node": node, "seq": seq, "received_at": now, "temp_c": temp, "humidity": hum,
                   "simulated": simulated, "valid": temp is not None}
        self.latest[node] = reading
        await self.ws.broadcast("reading", reading)
        res = self.engine.evaluate(node, temp, simulated)
        for a in res.alerts:
            await self.ws.broadcast("alert", a)
        if res.state_changed or res.alerts:
            await self.ws.broadcast("node", self.node_view(node))

    async def _sim_emit(self, node: str, temp: float, hum: float, seq: int) -> None:
        await self.ingest_reading(node, temp, hum, seq, None, simulated=True)

    # ================================================================ device tracking
    def _mark_seen(self, node: str, simulated: bool, seq: Optional[int], rssi=None) -> bool:
        d = self.devices.get(node)
        if d is None:
            d = self.devices[node] = {"node": node, "simulated": simulated, "online": False, "last_seen": None,
                                      "_mono": None, "msg_count": 0, "last_seq": None, "rssi": None,
                                      "rx_times": deque(maxlen=120)}
        came_online = not d["online"]
        d.update(online=True, last_seen=time.time(), _mono=self.clock(), simulated=simulated)
        d["msg_count"] += 1
        d["rx_times"].append(self.clock())
        if seq is not None:
            d["last_seq"] = seq
        if rssi is not None:
            d["rssi"] = rssi
        self.db.upsert_device(node, d["last_seen"], seq, simulated)
        return came_online

    async def _mark_seen_async(self, node, simulated, seq, rssi=None) -> None:
        if self._mark_seen(node, simulated, seq, rssi):
            a = None if simulated else self.engine.set_offline(node, False)
            if a:
                await self.ws.broadcast("alert", a)
            await self.ws.broadcast("node", self.node_view(node))

    async def check_offline(self) -> None:
        now = self.clock()
        for node, d in self.devices.items():
            if d["online"] and (d["_mono"] is None or now - d["_mono"] > self.thresholds.offline_seconds):
                d["online"] = False
                log.warning("device %s OFFLINE (no data for %.0fs)", node, self.thresholds.offline_seconds)
                if not d["simulated"]:
                    a = self.engine.set_offline(node, True)
                    if a:
                        await self.ws.broadcast("alert", a)
                await self.ws.broadcast("node", self.node_view(node))

    def node_view(self, node: str) -> dict:
        d = self.devices.get(node, {})
        ns = self.engine.nodes.get(node)
        now = self.clock()
        rate = sum(1 for t in d.get("rx_times", []) if now - t <= 60) if d else 0
        latest = self.latest.get(node)
        return {
            "node": node,
            "simulated": bool(d.get("simulated", ns.simulated if ns else False)),
            "online": bool(d.get("online", False)),
            "last_seen": d.get("last_seen"),
            "msg_count": d.get("msg_count", 0),
            "last_seq": d.get("last_seq"),
            "rssi": d.get("rssi"),
            "msgs_last_60s": rate,
            "state": ns.state.value if ns else "NORMAL",
            "critical_alert_id": ns.critical_alert_id if ns else None,
            "latest": latest,
        }

    # ================================================================ operator actions
    async def acknowledge(self, alert_id: int) -> Optional[dict]:
        alert = self.engine.acknowledge(alert_id)
        if not alert:
            return None
        if self.mqtt and not alert["simulated"]:
            ok = self.mqtt.send_ack(alert["node"], {"event_id": alert["device_event_id"] or alert["event_id"],
                                                   "type": "operator"})
            if ok and alert["delivery_status"] and "operator" not in alert["delivery_status"]:
                alert = self.db.update_alert(alert_id, delivery_status=alert["delivery_status"] + "; operator ACK sent")
        await self.ws.broadcast("alert", alert)
        await self.ws.broadcast("node", self.node_view(alert["node"]))
        return alert

    async def update_settings(self, values: dict) -> dict:
        candidate = Thresholds(**{**self.settings(), **{k: float(v) for k, v in values.items() if v is not None}})
        candidate.validate()
        for k in THRESHOLD_KEYS:
            setattr(self.thresholds, k, getattr(candidate, k))
        self.security.flood_max_per_sec = self.thresholds.flood_max_per_sec
        self.db.save_settings(self.settings())
        self.push_config()
        await self.ws.broadcast("settings", self.settings())
        return self.settings()

    def push_config(self) -> None:
        """Retained config message keeps the ESP32 threshold in sync with the backend."""
        if not self.mqtt:
            return
        for node in self.cfg.allowed_nodes:
            self.mqtt.send_config(node, {"critical_c": self.thresholds.critical_c,
                                         "recovery_c": self.thresholds.recovery_c,
                                         "warning_c": self.thresholds.warning_c})

    def settings(self) -> dict:
        return {k: getattr(self.thresholds, k) for k in THRESHOLD_KEYS}

    # ================================================================ simulation
    async def sim_start(self) -> dict:
        await self.sim.start()
        await self.ws.broadcast("simulation", self.sim.status())
        return self.sim.status()

    async def sim_stop(self) -> dict:
        await self.sim.stop()
        await self.close_simulated_alerts("simulation stopped")
        await self.ws.broadcast("simulation", self.sim.status())
        return self.sim.status()

    async def close_simulated_alerts(self, note: str) -> None:
        """A stopped simulator can never recover on its own, so its open alerts are closed
        (clearly noted) instead of leaving a fake emergency active forever."""
        for a in self.db.active_alerts():
            if a["simulated"] and a["node"] == self.sim.node:
                a = self.db.update_alert(a["id"], state="ENDED", resolved_at=time.time(), note=note)
                await self.ws.broadcast("alert", a)
        ns = self.engine.nodes.get(self.sim.node)
        if ns:
            ns.critical_alert_id = ns.warning_alert_id = None
            ns.below_since = None
            ns.state = ns.state.__class__.NORMAL
            await self.ws.broadcast("node", self.node_view(self.sim.node))

    async def sim_command(self, action: str, value=None, step: float = 2.0) -> dict:
        self.sim.command(action, value, step, self.thresholds.critical_c)
        if not self.sim.running:
            await self.sim.start()
        await self.ws.broadcast("simulation", self.sim.status())
        return self.sim.status()

    async def simulate_attack(self, attack: str) -> list[dict]:
        """Runs a crafted attack through an isolated sandbox detector (same rules & config).
        Nothing is ingested, so attack demos can never create fake sensor readings or alerts."""
        key = self.cfg.device_hmac_key or "sandbox-demo-key"
        node = (self.cfg.allowed_nodes or ["node1"])[0]
        clock = {"t": 0.0}
        sb = SecurityMonitor([node], key, self.thresholds.flood_max_per_sec, clock=lambda: clock["t"])
        topic = f"{self.cfg.topic_prefix}/{node}/telemetry"

        def tel(seq, temp, k=key, n=node):
            d = {"node": n, "seq": seq, "temp_c": temp, "humidity": 55.0}
            d["sig"] = sign(k, canonical_string(n, seq, temp, 55.0)) if k else "00"
            return json.dumps(d).encode()

        for i in range(1, 13):  # warm-up baseline
            clock["t"] = i * 2.0
            sb.inspect(topic, tel(i, 28.0 + (i % 3) * 0.1))
        clock["t"] = 25.0  # attack arrives mid-stream (no silence gap)
        msgs: list[tuple[str, bytes]] = {
            "replay": [(topic, tel(5, 28.1))],
            "flood": [(topic, tel(20 + i, 28.0)) for i in range(int(self.thresholds.flood_max_per_sec) + 3)],
            "spoof": [(f"{self.cfg.topic_prefix}/rogue7/telemetry", tel(1, 25.0, n="rogue7")),
                      (topic, tel(40, 25.0, n="rogue7"))],
            "forged_signature": [(topic, tel(50, 80.0, k="attacker-key"))],
            "malformed": [(topic, b'{"node":"' + node.encode() + b'","seq":')],
            "sensor_tamper": [(topic, tel(60, 88.0))],
        }[attack]
        found: list[dict] = []
        for tp, raw in msgs:
            clock["t"] += 0.05
            _, fs = sb.inspect(tp, raw)
            for f in fs:
                await self._record_finding(f, tp, simulated=True)
                found.append({"kind": f.kind, "detail": f.detail, "blocked": f.blocking})
        return found

    # ================================================================ views
    def system_status(self) -> dict:
        return {
            "backend": "online",
            "uptime_s": round(time.time() - self.started_at),
            "mqtt": self.mqtt.status() if self.mqtt else {"enabled": False, "connected": False},
            "ws_clients": self.ws.count,
            "api_auth": bool(self.cfg.api_token),
            "primary_node": (self.cfg.allowed_nodes or ["node1"])[0],
            "simulation": self.sim.status(),
            "transport": "Wi-Fi (local)  — 5G not connected",
            "security": self.security.metrics(),
        }

    def snapshot(self) -> dict:
        nodes = set(self.devices) | set(self.engine.nodes) | set(self.latest)
        return {
            "system": self.system_status(),
            "nodes": [self.node_view(n) for n in sorted(nodes)],
            "active_alerts": self.db.active_alerts(),
            "settings": self.settings(),
            "security": self.security.metrics(),
        }


def _reading_out(r: dict) -> dict:
    return {"node": r["node"], "seq": r["seq"], "received_at": r["received_at"], "temp_c": r["temp_c"],
            "humidity": r["humidity"], "simulated": bool(r["simulated"]), "valid": r["temp_c"] is not None}


def _short(e: ValidationError) -> str:
    err = e.errors()[0]
    return f"schema: {'.'.join(map(str, err['loc']))} {err['msg']}"[:160]
