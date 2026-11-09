from fastapi.testclient import TestClient

from app.main import create_app


def test_rest_and_ws(cfg):
    app = create_app(cfg)
    with TestClient(app) as c:
        assert c.get("/api/health").json()["status"] == "ok"
        assert c.get("/api/settings").json()["critical_c"] == 45
        r = c.put("/api/settings", json={"critical_c": 44, "recovery_c": 50})
        assert r.status_code == 422
        assert c.put("/api/settings", json={"critical_c": 46}).json()["critical_c"] == 46
        with c.websocket_connect("/ws/monitor") as ws:
            assert ws.receive_json()["type"] == "snapshot"
            c.post("/api/simulation/command", json={"action": "trigger"})
            seen = set()
            for _ in range(40):
                m = ws.receive_json()
                seen.add(m["type"])
                if m["type"] == "alert" and m["data"]["severity"] == "critical":
                    alert = m["data"]
                    break
            assert alert["simulated"] is True
        acked = c.post(f"/api/alerts/{alert['id']}/acknowledge").json()
        assert acked["state"] == "CRITICAL_ACKNOWLEDGED"
        c.post("/api/simulation/stop")
        assert c.get("/api/alerts").json()
        assert c.get("/api/alerts/export.csv").text.startswith("event_id")
        assert c.get("/api/sensors/history", params={"range": "1m"}).json()["points"]
        assert c.get("/api/network").json()["five_g"]["latency_ms"] is None
        f = c.post("/api/security/simulate", json={"attack": "replay"}).json()
        assert f["findings"][0]["kind"] == "replay"


def test_token_protection(cfg):
    cfg.api_token = "s3cret"
    with TestClient(create_app(cfg)) as c:
        assert c.post("/api/simulation/start").status_code == 401
        assert c.post("/api/simulation/start", headers={"X-API-Key": "s3cret"}).status_code == 200
        c.post("/api/simulation/stop", headers={"X-API-Key": "s3cret"})
