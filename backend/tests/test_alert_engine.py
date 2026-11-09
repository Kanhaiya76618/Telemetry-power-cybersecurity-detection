from app.alert_engine import AlertEngine
from app.database import Database
from app.models import AlertState, Thresholds


def make(clock, db=None):
    db = db or Database(":memory:")
    return AlertEngine(db, Thresholds(40, 45, 43, 10, 10), clock=clock), db


def test_normal_reading(clock):
    e, db = make(clock)
    r = e.evaluate("node1", 29.5)
    assert e.nodes["node1"].state == AlertState.NORMAL
    assert r.alerts == [] and db.list_alerts() == []


def test_warning_threshold(clock):
    e, db = make(clock)
    e.evaluate("node1", 40.0)
    assert e.nodes["node1"].state == AlertState.WARNING
    assert db.list_alerts()[0]["severity"] == "warning"


def test_critical_creates_single_emergency(clock):
    e, db = make(clock)
    r = e.evaluate("node1", 45.0)
    assert e.nodes["node1"].state == AlertState.CRITICAL_UNACKNOWLEDGED
    assert len(r.alerts) == 1 and r.alerts[0]["severity"] == "critical"
    for t in (46.5, 47.0, 45.2, 44.0):  # still in the same incident -> no new alerts
        clock.advance(2)
        e.evaluate("node1", t)
    crit = [a for a in db.list_alerts() if a["severity"] == "critical"]
    assert len(crit) == 1 and crit[0]["peak_value"] == 47.0


def test_acknowledge_keeps_critical_truthful(clock):
    e, db = make(clock)
    a = e.evaluate("node1", 46.5).alerts[0]
    acked = e.acknowledge(a["id"])
    assert acked["state"] == "CRITICAL_ACKNOWLEDGED" and acked["acknowledged_at"]
    assert acked["resolved_at"] is None
    assert e.nodes["node1"].state == AlertState.CRITICAL_ACKNOWLEDGED
    e.evaluate("node1", 47)  # still hot -> still critical, not "safe"
    assert e.nodes["node1"].state.is_critical


def test_recovery_hysteresis(clock):
    e, db = make(clock)
    a = e.evaluate("node1", 46).alerts[0]
    # fluctuating around 45 must not toggle the alarm
    for t in (44.8, 45.1, 44.5, 45.3, 43.5):
        clock.advance(2)
        e.evaluate("node1", t)
        assert e.nodes["node1"].state.is_critical
    # below recovery but not long enough
    clock.advance(2); e.evaluate("node1", 42.0)
    clock.advance(5); e.evaluate("node1", 42.0)
    assert e.nodes["node1"].state.is_critical
    # bounce above recovery resets the timer
    clock.advance(2); e.evaluate("node1", 43.5)
    clock.advance(9); e.evaluate("node1", 41.0)
    assert e.nodes["node1"].state.is_critical
    clock.advance(10); e.evaluate("node1", 41.0)
    assert e.nodes["node1"].state == AlertState.RECOVERED
    assert db.get_alert(a["id"])["resolved_at"] is not None
    clock.advance(11); e.evaluate("node1", 30.0)
    assert e.nodes["node1"].state == AlertState.NORMAL


def test_missing_reading_is_not_safe(clock):
    e, db = make(clock)
    e.evaluate("node1", 46)
    clock.advance(30)
    e.evaluate("node1", None)  # DHT failure
    assert e.nodes["node1"].state.is_critical


def test_device_emergency_dedup(clock):
    e, db = make(clock)
    a, new = e.handle_device_emergency("node1", "E-0007", 46.5, False, False)
    assert new
    a2, new2 = e.handle_device_emergency("node1", "E-0007", 46.5, False, False)
    assert not new2 and a2["id"] == a["id"]
    e.evaluate("node1", 46.6)  # backend detection of the same incident -> no duplicate
    assert len([x for x in db.list_alerts() if x["severity"] == "critical"]) == 1


def test_backend_first_then_device_links(clock):
    e, db = make(clock)
    a = e.evaluate("node1", 46).alerts[0]
    linked, new = e.handle_device_emergency("node1", "E-0001", 46, False, False)
    assert not new and linked["id"] == a["id"] and linked["device_event_id"] == "E-0001"


def test_restart_restores_active_alert(clock, tmp_path):
    db = Database(str(tmp_path / "r.db"))
    e, _ = make(clock, db)
    a = e.evaluate("node1", 47).alerts[0]
    e2 = AlertEngine(db, Thresholds(40, 45, 43, 10, 10), clock=clock)  # simulated restart
    assert e2.nodes["node1"].critical_alert_id == a["id"]
    assert e2.nodes["node1"].state == AlertState.CRITICAL_UNACKNOWLEDGED
    e2.evaluate("node1", 47.5)
    assert len([x for x in db.list_alerts() if x["severity"] == "critical"]) == 1
