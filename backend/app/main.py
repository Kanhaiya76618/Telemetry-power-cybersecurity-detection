"""FastAPI application: REST + WebSocket for the 5G Emergency Sensor Network."""
from __future__ import annotations

import csv
import hmac
import io
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Config, config as default_config
from .hub import Hub
from .schemas import AttackSimulation, SettingsUpdate, SimulationCommand
from .security_eval import evaluate as run_security_eval

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")

RANGES = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "24h": 86400}


def create_app(cfg: Optional[Config] = None) -> FastAPI:
    cfg = cfg or default_config

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub = Hub(cfg)
        app.state.hub = hub
        await hub.start()
        yield
        await hub.stop()
        hub.db.close()

    app = FastAPI(title="5G Emergency Sensor Network", version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=cfg.cors_origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type", "X-API-Key"])

    def hub() -> Hub:
        return app.state.hub

    def require_token(x_api_key: Optional[str] = Header(default=None)) -> None:
        """State-changing endpoints require X-API-Key when API_TOKEN is configured."""
        if cfg.api_token and not (x_api_key and hmac.compare_digest(x_api_key, cfg.api_token)):
            raise HTTPException(status_code=401, detail="invalid or missing X-API-Key")

    # ---------------------------------------------------------------- read endpoints
    @app.get("/api/health")
    def health(h: Hub = Depends(hub)):
        return {"status": "ok", "time": time.time(), **h.system_status()}

    @app.get("/api/snapshot")
    def snapshot(h: Hub = Depends(hub)):
        return h.snapshot()

    @app.get("/api/sensors/latest")
    def latest(h: Hub = Depends(hub)):
        return [h.node_view(n) for n in sorted(set(h.devices) | set(h.latest))]

    @app.get("/api/sensors/history")
    def history(node: Optional[str] = None, range: str = Query("5m", pattern="^(1m|5m|15m|1h|24h)$"),
                h: Hub = Depends(hub)):
        return {"node": node, "range": range, "points": h.db.history(node, RANGES[range])}

    @app.get("/api/devices")
    def devices(h: Hub = Depends(hub)):
        return [h.node_view(n) for n in sorted(set(h.devices) | set(h.engine.nodes))]

    @app.get("/api/alerts")
    def alerts(severity: Optional[str] = None, node: Optional[str] = None, since: Optional[float] = None,
               until: Optional[float] = None, q: Optional[str] = None, active: bool = False,
               limit: int = Query(500, le=5000), h: Hub = Depends(hub)):
        if active:
            return h.db.active_alerts()
        return h.db.list_alerts(limit, severity, node, since, until, q)

    @app.get("/api/alerts/export.csv")
    def export_csv(severity: Optional[str] = None, node: Optional[str] = None, q: Optional[str] = None,
                   h: Hub = Depends(hub)):
        rows = h.db.list_alerts(5000, severity, node, None, None, q)
        buf = io.StringIO()
        cols = ["event_id", "device_event_id", "node", "type", "severity", "value", "peak_value", "threshold",
                "state", "source", "simulated", "triggered_at", "acknowledged_at", "resolved_at", "duration_s",
                "delivery_status", "rtt_ms", "note"]
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        iso = lambda t: time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) if t else ""
        for r in rows:
            r = dict(r)
            for k in ("triggered_at", "acknowledged_at", "resolved_at"):
                r[k] = iso(r[k])
            w.writerow(r)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=alert-history.csv"})

    @app.get("/api/alerts/{alert_id}")
    def alert_detail(alert_id: int, h: Hub = Depends(hub)):
        a = h.db.get_alert(alert_id)
        if not a:
            raise HTTPException(404, "alert not found")
        return a

    @app.get("/api/settings")
    def get_settings(h: Hub = Depends(hub)):
        return h.settings()

    @app.get("/api/network")
    def network(h: Hub = Depends(hub)):
        rtts = [a["rtt_ms"] for a in h.db.list_alerts(200) if a.get("rtt_ms") is not None]
        return {
            "mqtt": h.mqtt.status() if h.mqtt else {"enabled": False, "connected": False},
            "ws_clients": h.ws.count,
            "devices": [h.node_view(n) for n in sorted(h.devices)],
            "emergency_ack_rtt_ms": {"count": len(rtts), "last": rtts[0] if rtts else None,
                                     "avg": round(sum(rtts) / len(rtts), 1) if rtts else None,
                                     "method": "ESP32 millis() from emergency publish to delivery ACK"},
            "five_g": {"connected": False, "latency_ms": None, "packet_loss_pct": None, "throughput_mbps": None,
                       "signal_rsrp_dbm": None, "slice": None,
                       "note": "Not available — Anubhav private 5G/MEC not connected. Will be fed by iperf3/"
                               "InfluxDB collectors; MQTT QoS != 5G QoS."},
            "load_profile": None,
        }

    @app.get("/api/security/events")
    def security_events(limit: int = Query(200, le=2000), h: Hub = Depends(hub)):
        evs = h.db.security_events(limit)
        for e in evs:
            e["blocked"], e["simulated"] = bool(e["blocked"]), bool(e["simulated"])
        return evs

    @app.get("/api/security/metrics")
    def security_metrics(h: Hub = Depends(hub)):
        return h.security.metrics()

    @app.get("/api/simulation")
    def sim_status(h: Hub = Depends(hub)):
        return h.sim.status()

    # ---------------------------------------------------------------- state-changing (token-protected)
    @app.post("/api/alerts/{alert_id}/acknowledge", dependencies=[Depends(require_token)])
    async def acknowledge(alert_id: int, h: Hub = Depends(hub)):
        a = await h.acknowledge(alert_id)
        if not a:
            raise HTTPException(404, "alert not found")
        return a

    @app.put("/api/settings", dependencies=[Depends(require_token)])
    async def put_settings(body: SettingsUpdate, h: Hub = Depends(hub)):
        try:
            return await h.update_settings(body.model_dump(exclude_none=True))
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.post("/api/simulation/start", dependencies=[Depends(require_token)])
    async def sim_start(h: Hub = Depends(hub)):
        return await h.sim_start()

    @app.post("/api/simulation/stop", dependencies=[Depends(require_token)])
    async def sim_stop(h: Hub = Depends(hub)):
        return await h.sim_stop()

    @app.post("/api/simulation/command", dependencies=[Depends(require_token)])
    async def sim_command(body: SimulationCommand, h: Hub = Depends(hub)):
        return await h.sim_command(body.action, body.value, body.step)

    @app.post("/api/security/simulate", dependencies=[Depends(require_token)])
    async def security_simulate(body: AttackSimulation, h: Hub = Depends(hub)):
        return {"attack": body.attack, "findings": await h.simulate_attack(body.attack), "simulated": True}

    @app.post("/api/security/evaluate", dependencies=[Depends(require_token)])
    def security_evaluate():
        return run_security_eval()

    # ---------------------------------------------------------------- websocket
    @app.websocket("/ws/monitor")
    async def ws_monitor(ws: WebSocket, token: Optional[str] = None):
        h: Hub = app.state.hub
        if cfg.api_token and not (token and hmac.compare_digest(token, cfg.api_token)):
            await ws.close(code=4401)
            return
        await h.ws.connect(ws)
        try:
            await ws.send_json({"type": "snapshot", "data": h.snapshot()})
            while True:
                msg = await ws.receive_text()  # client pings keep NAT/proxies alive
                if msg == "ping":
                    await ws.send_text('{"type":"pong"}')
        except WebSocketDisconnect:
            pass
        finally:
            await h.ws.disconnect(ws)

    return app


app = create_app()
