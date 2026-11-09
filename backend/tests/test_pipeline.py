import json

from app.hub import Hub
from app.models import AlertState


def tel(seq, temp, hum=55.0, node="node1"):
    return json.dumps({"node": node, "seq": seq, "ts": 1.0, "temp_c": temp, "humidity": hum,
                       "gas_raw": None, "flame": None}).encode()


async def test_mqtt_telemetry_end_to_end(hub, clock):
    for i, t in enumerate([29.5, 38, 42, 46], start=1):
        clock.advance(2)
        await hub.handle_mqtt("campus/node1/telemetry", tel(i, t))
    v = hub.node_view("node1")
    assert v["online"] and v["state"] == "CRITICAL_UNACKNOWLEDGED"
    assert hub.db.reading_count("node1") == 4


async def test_invalid_messages_are_rejected(hub, clock):
    await hub.handle_mqtt("campus/node1/telemetry", b"not json")
    await hub.handle_mqtt("campus/node1/telemetry", json.dumps({"node": "node1", "seq": -1}).encode())
    await hub.handle_mqtt("campus/node1/telemetry", json.dumps({"node": "node1", "seq": 1, "temp_c": 999}).encode())
    assert hub.db.reading_count() == 0
    kinds = {e["kind"] for e in hub.db.security_events()}
    assert "malformed_payload" in kinds


async def test_missing_sensor_value_stored_but_not_evaluated(hub, clock):
    await hub.handle_mqtt("campus/node1/telemetry", tel(1, None, None))
    assert hub.db.reading_count() == 1
    assert hub.latest["node1"]["valid"] is False
    assert hub.engine.nodes["node1"].state == AlertState.NORMAL


async def test_device_emergency_and_duplicate(hub, clock):
    payload = json.dumps({"node": "node1", "event_id": "E-0007", "ts": 1.0, "type": "temp",
                          "value": 46.5, "severity": "critical", "test": False}).encode()
    await hub.handle_mqtt("campus/node1/emergency", payload)
    clock.advance(1)
    await hub.handle_mqtt("campus/node1/emergency", payload)  # QoS1 redelivery
    await hub.handle_mqtt("campus/node1/telemetry", tel(1, 46.6))
    crit = [a for a in hub.db.list_alerts() if a["severity"] == "critical"]
    assert len(crit) == 1 and crit[0]["device_event_id"] == "E-0007"


async def test_ack_rtt_reported_by_device(hub, clock):
    await hub.handle_mqtt("campus/node1/emergency", json.dumps(
        {"node": "node1", "event_id": "E-0009", "value": 47, "severity": "critical"}).encode())
    d = json.loads(tel(2, 47)); d.update(ack_event_id="E-0009", ack_rtt_ms=38.5)
    await hub.handle_mqtt("campus/node1/telemetry", json.dumps(d).encode())
    assert hub.db.find_alert_by_event("E-0009")["rtt_ms"] == 38.5


async def test_device_disconnection_not_safe(hub, clock):
    await hub.handle_mqtt("campus/node1/telemetry", tel(1, 29.0))
    assert hub.node_view("node1")["online"]
    clock.advance(11)
    await hub.check_offline()
    v = hub.node_view("node1")
    assert v["online"] is False
    offline = [a for a in hub.db.active_alerts() if a["type"] == "device_offline"]
    assert len(offline) == 1
    clock.advance(1)
    await hub.handle_mqtt("campus/node1/telemetry", tel(2, 29.0))
    assert hub.node_view("node1")["online"]
    assert not [a for a in hub.db.active_alerts() if a["type"] == "device_offline"]


async def test_simulation_uses_same_engine_and_is_labeled(hub, clock):
    hub.sim.command("trigger", critical=hub.thresholds.critical_c)
    t, h = hub.sim.tick()
    await hub._sim_emit(hub.sim.node, t, h, 1)
    v = hub.node_view(hub.sim.node)
    assert v["simulated"] and v["state"] == "CRITICAL_UNACKNOWLEDGED"
    a = hub.db.active_alerts()[0]
    assert a["simulated"] is True
    pts = hub.db.history(hub.sim.node, 60)
    assert pts and all(p["simulated"] for p in pts)
    # real node unaffected
    assert "node1" not in hub.engine.nodes


async def test_simulation_full_demo(hub, clock):
    node = hub.sim.node
    async def feed(temp):
        clock.advance(2)
        await hub._sim_emit(node, temp, 50, 0)
    for t in (28, 38):
        await feed(t)
    assert hub.node_view(node)["state"] == "NORMAL"
    await feed(42); assert hub.node_view(node)["state"] == "WARNING"
    await feed(46); assert hub.node_view(node)["state"] == "CRITICAL_UNACKNOWLEDGED"
    aid = hub.node_view(node)["critical_alert_id"]
    await hub.acknowledge(aid); assert hub.node_view(node)["state"] == "CRITICAL_ACKNOWLEDGED"
    await feed(40); await feed(40)
    for _ in range(6):
        await feed(39)
    assert hub.node_view(node)["state"] == "RECOVERED"
    clock.advance(11); await feed(30)
    assert hub.node_view(node)["state"] == "NORMAL"


async def test_backend_restart_recovers(cfg, clock):
    h1 = Hub(cfg, clock=clock)
    await h1.handle_mqtt("campus/node1/telemetry", tel(1, 47))
    await h1.update_settings({"critical_c": 44, "recovery_c": 42})
    h1.db.close()
    h2 = Hub(cfg, clock=clock)
    assert h2.settings()["critical_c"] == 44
    assert h2.engine.nodes["node1"].state == AlertState.CRITICAL_UNACKNOWLEDGED
    assert h2.node_view("node1")["online"] is False  # unknown until heard from again
    h2.db.close()


async def test_stopping_simulation_ends_its_emergency(hub, clock):
    await hub._sim_emit(hub.sim.node, 47.0, 40, 1)
    assert hub.db.active_alerts()
    await hub.sim_stop()
    assert not hub.db.active_alerts()
    assert hub.node_view(hub.sim.node)["state"] == "NORMAL"
