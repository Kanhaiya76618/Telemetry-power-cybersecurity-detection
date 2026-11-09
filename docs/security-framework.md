# Problem Statement 6: lightweight IoT security framework

**Research question:** Can an edge-based lightweight model detect abnormal IoT behaviour within the resource limits of an embedded device?

Cybersecurity is the main research contribution. The emergency temperature system is the real IoT application used to test it. Security alerts (`security_events` table, *Cybersecurity* page) are kept separate from environmental alerts (`alerts` table).

## Layers

| Layer | Mechanism | Where |
|---|---|---|
| A. Device authentication | Mosquitto users + per-device ACL (`infrastructure/acl`), optional TLS; per-message HMAC-SHA256 (`DEVICE_HMAC_KEY`) | broker, ESP32, `security.py` |
| A. Secure provisioning | `ALLOWED_NODES` allow-list; topic/payload node must match | `security.py` |
| B. Behavioural rules | flood rate, replay (sequence numbers), implausible change rate, EWMA z-score, DHT11 range, payload size, schema | `security.py` |
| C. Lightweight ML | Decision Tree, Logistic Regression, Isolation Forest on 11 per-message features | `security_eval.py` |

Every MQTT message goes through `SecurityMonitor.inspect()` **before** validation, storage or the alert engine. Blocking findings drop the message. Data-integrity anomalies are *flagged* but not dropped, because a real fire can also produce fast temperature rises. Device reboots (sequence counter resets) and reconnects are treated as connectivity events, not attacks.

| Behaviour | Classification |
|---|---|
| one reading every 2 s | normal |
| disconnect/reconnect, seq reset after reboot | connectivity event (device offline alert) |
| burst above `FLOOD_MAX_PER_SEC` | `flood`, blocked |
| unprovisioned node / topic spoof | `unknown_device` / `topic_mismatch`, blocked |
| bad or missing signature | `auth_failure`, blocked |
| old sequence number | `replay`, blocked |
| impossible value or change rate | `out_of_range` / `implausible_jump`, flagged |
| repeated broker auth failures | visible in Mosquitto logs (`connection_messages true`); ingesting them is future work |

## Experiments (Phase 4)

```bash
cd backend && .venv/bin/python -m app.security_eval
```

Or use Dashboard → Cybersecurity (P6) → **Run benchmark**. The benchmark generates a labelled, controlled synthetic dataset: about 3,100 normal DHT11-like messages with legitimate heating episodes, plus about 400 injected attacks. ML models train on one generated run and are tested on a different one. Example output from this machine:

| Configuration | Accuracy | Precision | Recall | F1 | FPR | µs/msg | Size |
|---|---|---|---|---|---|---|---|
| Baseline (no detection) | 0.886 | 0 | 0 | 0 | 0 | 0 | — |
| Rule-based | 1.000 | 1.000 | 0.998 | 0.999 | 0.000 | ~8 | 0.6 KB state |
| Decision Tree | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | ~47 | 2.0 KB |
| Logistic Regression | 0.999 | 1.000 | 0.990 | 0.995 | 0.000 | ~150 | 1.4 KB |
| Isolation Forest | 0.908 | 0.554 | 1.000 | 0.713 | 0.103 | ~1700 | 404 KB |

**Interpretation:**

- On this synthetic data, the rule-based detector and a depth-6 decision tree are equally accurate.
- The rules are about 6× faster and need no training.
- The decision tree (2 KB, a set of if/else comparisons) is the best candidate to port to the ESP32.
- Unsupervised Isolation Forest has a 10 % false-positive rate and is about 400 KB, so it is too heavy for the node.

These numbers come from generated data. They need to be repeated with real captured traffic from your devices before you draw research conclusions. Energy consumption is reported as *not available* until a power meter (e.g. INA219 on the ESP32 supply) is added.

Run attacks only against your own devices on an isolated lab network.

## Next steps

1. Capture real traffic (normal operation, reboots, Wi-Fi drops) to replace or augment the synthetic set.
2. Export the decision tree (`sklearn.tree.export_text`) to C for on-device detection, and measure flash/RAM/latency on the ESP32.
3. Ingest Mosquitto auth-failure logs as security events (repeated authentication failures).
4. Repeat under 5G load profiles (no / medium / heavy `iperf3`) on the Anubhav MEC setup.
