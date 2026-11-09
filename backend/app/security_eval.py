"""P6 experimental evaluation: labeled synthetic traffic -> detection metrics.

Generates a normal DHT11-like telemetry stream (0.5 Hz, slow drift + sensor noise, an
occasional legitimate heating episode) and injects labeled attacks. Reports accuracy,
precision, recall, F1, false-positive rate, per-message detection latency, detector state
memory and CPU time. This is a SYNTHETIC benchmark — results describe the detector on this
generated dataset, not field performance.

Run:  python -m app.security_eval
"""
from __future__ import annotations

import json
import math
import random
import resource
import sys
import time

from .security import SecurityMonitor, canonical_string, sign

ATTACKS = ["replay", "flood", "spoof", "forged_signature", "malformed", "sensor_tamper", "oversize"]


def _telemetry(node, seq, temp, hum, key):
    d = {"node": node, "seq": seq, "ts": None, "temp_c": round(temp, 1), "humidity": round(hum, 1)}
    if key:
        d["sig"] = sign(key, canonical_string(node, seq, d["temp_c"], d["humidity"]))
    return d


def generate(n_normal: int = 3000, attack_ratio: float = 0.08, seed: int = 7, key: str = "eval-key"):
    rnd = random.Random(seed)
    node, t, seq, temp, hum = "node1", 0.0, 0, 28.0, 60.0
    sent: list[dict] = []
    events = []  # (time, topic, raw_bytes, is_attack, attack_kind)
    heating = 0
    for _ in range(n_normal):
        t += 2.0
        seq += 1
        if heating == 0 and rnd.random() < 0.004:
            heating = 40  # legitimate gradual heat event (~1 °C/s max)
        if heating:
            temp += rnd.uniform(0.3, 1.2) if heating > 20 else -rnd.uniform(0.3, 1.2)
            heating -= 1
        else:
            temp += (28.0 - temp) * 0.02 + rnd.gauss(0, 0.15)
        hum = min(95, max(20, hum + rnd.gauss(0, 0.3)))
        d = _telemetry(node, seq, temp, hum, key)
        sent.append(d)
        events.append((t, "campus/node1/telemetry", json.dumps(d).encode(), False, None))

        if rnd.random() < attack_ratio:
            kind = rnd.choice(ATTACKS)
            ta = t + 0.3
            if kind == "replay" and len(sent) > 5:
                raw = json.dumps(rnd.choice(sent[:-2])).encode()
                events.append((ta, "campus/node1/telemetry", raw, True, kind))
            elif kind == "flood":
                for i in range(12):
                    seq += 1
                    d2 = _telemetry(node, seq, temp, hum, key)
                    events.append((ta + i * 0.02, "campus/node1/telemetry", json.dumps(d2).encode(), i >= 4, kind))
                    sent.append(d2)
            elif kind == "spoof":
                d2 = _telemetry("rogue7", 1, 25.0, 50.0, key)
                events.append((ta, "campus/rogue7/telemetry", json.dumps(d2).encode(), True, kind))
            elif kind == "forged_signature":
                seq += 1
                d2 = _telemetry(node, seq, 80.0, 10.0, "")
                d2["sig"] = "0" * 64
                events.append((ta, "campus/node1/telemetry", json.dumps(d2).encode(), True, kind))
            elif kind == "malformed":
                events.append((ta, "campus/node1/telemetry", b'{"node": "node1", "seq": ', True, kind))
            elif kind == "sensor_tamper":
                seq += 1
                d2 = _telemetry(node, seq, temp + rnd.choice([-1, 1]) * rnd.uniform(15, 30), hum, key)
                events.append((ta, "campus/node1/telemetry", json.dumps(d2).encode(), True, kind))
                sent.append(d2)
            elif kind == "oversize":
                events.append((ta, "campus/node1/telemetry", b"{" + b" " * 4096 + b"}", True, kind))
    return events


def _scores(y, pred) -> dict:
    tp = sum(1 for a, b in zip(y, pred) if a and b)
    fp = sum(1 for a, b in zip(y, pred) if not a and b)
    tn = sum(1 for a, b in zip(y, pred) if not a and not b)
    fn = sum(1 for a, b in zip(y, pred) if a and not b)
    total = max(1, tp + fp + tn + fn)
    pr = tp / (tp + fp) if tp + fp else 0.0
    rc = tp / (tp + fn) if tp + fn else 0.0
    return {"accuracy": round((tp + tn) / total, 4), "precision": round(pr, 4), "recall": round(rc, 4),
            "f1": round(2 * pr * rc / (pr + rc), 4) if pr + rc else 0.0,
            "false_positive_rate": round(fp / (fp + tn), 4) if fp + tn else 0.0,
            "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn}}


class FeatureExtractor:
    """Stateful per-message features (same information the rule engine sees, no labels)."""
    NAMES = ["size", "json_ok", "known_node", "topic_match", "sig_ok", "seq_delta", "dt",
             "rate_1s", "temp", "temp_rate", "zscore"]

    def __init__(self, allowed, key):
        self.allowed, self.key = set(allowed), key
        self.last_seq = None
        self.last_t = None
        self.last_temp = None
        self.times: list = []
        self.ewma, self.ewvar, self.n = None, 0.0, 0

    def __call__(self, ts, topic, raw):
        f = dict.fromkeys(self.NAMES, 0.0)
        f["size"] = min(len(raw), 8192) / 1024
        self.times = [t for t in self.times if ts - t <= 1.0] + [ts]
        f["rate_1s"] = len(self.times)
        f["dt"] = min(ts - self.last_t, 10.0) if self.last_t is not None else 2.0
        self.last_t = ts
        try:
            d = json.loads(raw)
            assert isinstance(d, dict)
        except Exception:
            return [f[k] for k in self.NAMES]
        f["json_ok"] = 1.0
        node = d.get("node")
        f["known_node"] = float(node in self.allowed)
        f["topic_match"] = float(topic.split("/")[1] == node)
        seq, temp, hum = d.get("seq"), d.get("temp_c"), d.get("humidity")
        try:
            f["sig_ok"] = float(d.get("sig") == sign(self.key, canonical_string(node, int(seq), temp, hum)))
        except Exception:
            f["sig_ok"] = 0.0
        if isinstance(seq, int):
            f["seq_delta"] = max(-5.0, min(5.0, seq - self.last_seq)) if self.last_seq is not None else 1.0
            self.last_seq = max(seq, self.last_seq or 0)
        if isinstance(temp, (int, float)):
            f["temp"] = float(temp)
            if self.last_temp is not None:
                f["temp_rate"] = abs(temp - self.last_temp) / max(f["dt"], 0.5)
            if self.ewma is not None and self.n > 5:
                f["zscore"] = min(50.0, abs(temp - self.ewma) / max(math.sqrt(self.ewvar), 0.5))
            if f["temp_rate"] <= 4:
                self.last_temp = float(temp)
                d_ = temp - (self.ewma if self.ewma is not None else temp)
                self.ewma = temp if self.ewma is None else self.ewma + 0.1 * d_
                self.ewvar = 0.9 * (self.ewvar + 0.1 * d_ * d_)
                self.n += 1
        return [f[k] for k in self.NAMES]


def _dataset(seed, n_normal, key):
    ev = generate(n_normal, 0.08, seed, key)
    fx = FeatureExtractor(["node1"], key)
    X = [fx(ts, topic, raw) for ts, topic, raw, _, _ in ev]
    y = [int(a) for *_, a, _ in ev]
    return ev, X, y


def evaluate(n_normal: int = 3000, seed: int = 7) -> dict:
    """Compare Baseline (no detection), Rule-based detector and lightweight ML models
    (Decision Tree, Logistic Regression, Isolation Forest) on the same held-out test set."""
    key = "eval-key"
    events, X_test, y_test = _dataset(seed, n_normal, key)
    configs = []

    configs.append({"name": "Baseline", "kind": "baseline", **_scores(y_test, [0] * len(y_test)),
                    "latency_us_per_msg": 0.0, "model_bytes": None})

    clock = {"t": 0.0}
    mon = SecurityMonitor(["node1"], hmac_key=key, flood_max_per_sec=5, clock=lambda: clock["t"])
    pred, t0 = [], time.perf_counter()
    for ts, topic, raw, _, _ in events:
        clock["t"] = ts
        pred.append(int(bool(mon.inspect(topic, raw, now=ts)[1])))
    lat = (time.perf_counter() - t0) / len(events) * 1e6
    configs.append({"name": "Rule-based", "kind": "rule", **_scores(y_test, pred),
                    "latency_us_per_msg": round(lat, 2), "model_bytes": mon.metrics()["state_bytes_est"]})

    ml_available = True
    try:
        import pickle
        from sklearn.ensemble import IsolationForest
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        from sklearn.tree import DecisionTreeClassifier

        _, X_train, y_train = _dataset(seed + 100, n_normal, key)  # separate training run
        models = [
            ("Decision Tree", DecisionTreeClassifier(max_depth=6, random_state=0), True),
            ("Logistic Regression", make_pipeline(StandardScaler(), LogisticRegression(max_iter=500)), True),
            ("Isolation Forest", IsolationForest(n_estimators=50, contamination=0.08, random_state=0), False),
        ]
        for name, model, supervised in models:
            if supervised:
                model.fit(X_train, y_train)
            else:  # unsupervised: learns "normal" only
                model.fit([x for x, lbl in zip(X_train, y_train) if not lbl])
            t0 = time.perf_counter()
            raw_pred = [model.predict([x])[0] for x in X_test]  # per-message, like streaming
            lat = (time.perf_counter() - t0) / len(X_test) * 1e6
            p = [int(v == -1) for v in raw_pred] if not supervised else [int(v) for v in raw_pred]
            configs.append({"name": name, "kind": "ml", **_scores(y_test, p),
                            "latency_us_per_msg": round(lat, 2), "model_bytes": len(pickle.dumps(model))})
    except ImportError:
        ml_available = False

    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {
        "dataset": "synthetic (labeled, controlled)",
        "messages": len(y_test),
        "attacks": sum(y_test),
        "ml_available": ml_available,
        "configs": configs,
        "per_attack_detection_rate_rule": _per_kind(events),
        "process_peak_rss_mb": round(rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024, 1),
        "energy_consumption": "Not available (requires hardware power measurement)",
    }


def _per_kind(events) -> dict:
    clock = {"t": 0.0}
    mon = SecurityMonitor(["node1"], hmac_key="eval-key", flood_max_per_sec=5, clock=lambda: clock["t"])
    agg: dict = {}
    for ts, topic, raw, is_attack, kind in events:
        clock["t"] = ts
        hit = bool(mon.inspect(topic, raw, now=ts)[1])
        if is_attack:
            a = agg.setdefault(kind, [0, 0]); a[0] += 1; a[1] += hit
    return {k: round(v[1] / v[0], 3) for k, v in agg.items()}


if __name__ == "__main__":
    r = evaluate()
    print(f"{r['messages']} msgs, {r['attacks']} attacks ({r['dataset']})")
    print(f"{'config':22} {'acc':>6} {'prec':>6} {'rec':>6} {'f1':>6} {'fpr':>6} {'us/msg':>8} {'bytes':>8}")
    for c in r["configs"]:
        print(f"{c['name']:22} {c['accuracy']:6.3f} {c['precision']:6.3f} {c['recall']:6.3f} {c['f1']:6.3f} "
              f"{c['false_positive_rate']:6.3f} {c['latency_us_per_msg']:8.1f} {str(c['model_bytes']):>8}")
    print("rule per-attack:", r["per_attack_detection_rate_rule"])
