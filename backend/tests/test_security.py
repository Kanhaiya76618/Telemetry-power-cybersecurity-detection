import json

from app.security import SecurityMonitor, canonical_string, sign
from app.security_eval import evaluate


def msg(seq, temp=28.0, node="node1", key=""):
    d = {"node": node, "seq": seq, "temp_c": temp, "humidity": 50.0}
    if key:
        d["sig"] = sign(key, canonical_string(node, seq, temp, 50.0))
    return json.dumps(d).encode()


def kinds(fs):
    return {f.kind for f in fs}


def test_replay_and_reboot(clock):
    m = SecurityMonitor(["node1"], clock=clock)
    for s in range(1, 20):
        clock.advance(2); assert m.inspect("campus/node1/telemetry", msg(s))[1] == []
    clock.advance(2)
    assert "replay" in kinds(m.inspect("campus/node1/telemetry", msg(5))[1])
    clock.advance(20)  # device was down, rebooted; first seq after reconnect is 8
    assert m.inspect("campus/node1/telemetry", msg(8))[1] == []
    clock.advance(2)
    assert m.inspect("campus/node1/telemetry", msg(9))[1] == []
    clock.advance(1)
    assert "replay" in kinds(m.inspect("campus/node1/telemetry", msg(4))[1])  # replay in live stream


def test_flood(clock):
    m = SecurityMonitor(["node1"], flood_max_per_sec=5, clock=clock)
    res = [m.inspect("campus/node1/telemetry", msg(i))[1] for i in range(1, 10)]
    assert any("flood" in kinds(r) for r in res)


def test_spoof_unknown_and_topic_mismatch(clock):
    m = SecurityMonitor(["node1"], clock=clock)
    assert "unknown_device" in kinds(m.inspect("campus/evil/telemetry", msg(1, node="evil"))[1])
    assert "topic_mismatch" in kinds(m.inspect("campus/node1/telemetry", msg(1, node="evil"))[1])


def test_hmac(clock):
    m = SecurityMonitor(["node1"], hmac_key="k", clock=clock)
    assert m.inspect("campus/node1/telemetry", msg(1, key="k"))[1] == []
    clock.advance(2)
    assert "auth_failure" in kinds(m.inspect("campus/node1/telemetry", msg(2, key="wrong"))[1])
    clock.advance(2)
    assert "auth_failure" in kinds(m.inspect("campus/node1/telemetry", msg(3))[1])


def test_tamper_jump_flag_only(clock):
    m = SecurityMonitor(["node1"], clock=clock)
    for s in range(1, 15):
        clock.advance(2); m.inspect("campus/node1/telemetry", msg(s, 28.0))
    clock.advance(2)
    fs = m.inspect("campus/node1/telemetry", msg(15, 70.0))[1]
    assert "implausible_jump" in kinds(fs) and not any(f.blocking for f in fs)


def test_oversize_payload(clock):
    m = SecurityMonitor(["node1"], clock=clock)
    assert "payload_too_large" in kinds(m.inspect("campus/node1/telemetry", b"{" + b" " * 5000 + b"}")[1])


def test_benchmark_comparison():
    r = evaluate(n_normal=1200)
    by = {c["name"]: c for c in r["configs"]}
    assert by["Baseline"]["recall"] == 0
    rule = by["Rule-based"]
    assert rule["recall"] > 0.95 and rule["precision"] > 0.9 and rule["false_positive_rate"] < 0.02
    if r["ml_available"]:
        assert {"Decision Tree", "Logistic Regression", "Isolation Forest"} <= set(by)
