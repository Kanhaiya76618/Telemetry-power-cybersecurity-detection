# 5G Emergency Sensor Network + Lightweight IoT Security (P6)

Real-time emergency monitoring for an **ESP32 + DHT11** node over **MQTT**, with a FastAPI edge
backend (the future MEC server role), a React command-center dashboard with a
**railway-crossing siren**, and a **lightweight cybersecurity framework** (Problem Statement 6)
that inspects every MQTT message and compares rule-based vs ML detectors.

```
DHT11 → ESP32 → Wi-Fi → Mosquitto (MQTT) → FastAPI backend ──WebSocket──► React dashboard
                                              │  ├─ P6 security detector (before anything else)
                                              │  ├─ alert engine (thresholds + hysteresis)
                                              │  └─ SQLite (readings, alerts, security events)
                                              └─ ACKs + threshold config back to the ESP32
```

Status: **working prototype on local Wi-Fi**. 5G/MEC is *not* connected yet; no 5G QoS,
slicing or latency is measured or claimed. Not certified for life-safety use.

## Project structure

| Path | What |
|---|---|
| `backend/app/` | FastAPI app: `main.py` (REST + `/ws/monitor`), `hub.py` (pipeline), `alert_engine.py`, `security.py` (P6 detector), `security_eval.py` (baseline/rule/ML benchmark), `mqtt_client.py`, `simulation.py`, `database.py` |
| `backend/tests/` | 27 pytest tests (thresholds, hysteresis, dedup, ACK, offline, restart, simulation, security, API) |
| `frontend/src/` | React + TS + Vite + Tailwind + Motion + Recharts. `audio/RailwaySiren.ts` = Web Audio siren |
| `esp32/phase1_serial_test/` | Phase 1: DHT11 → Serial Monitor only |
| `esp32/emergency_sensor/` | Full firmware: Wi-Fi + MQTT + emergency events + ACK RTT + optional HMAC |
| `infrastructure/` | Mosquitto (Docker Compose): demo config, authenticated config, ACL |
| `docs/` | [setup-guide](docs/setup-guide.md), [hardware-wiring](docs/hardware-wiring.md), [mqtt-protocol](docs/mqtt-protocol.md), [security-framework](docs/security-framework.md) |

## Quick start (macOS)

```bash
cd 5g-emergency-network
cp .env.example .env
docker compose -f infrastructure/docker-compose.yml up -d      # MQTT broker on :1883
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

New terminal:

```bash
cd 5g-emergency-network/frontend && npm install && npm run dev
```

Open http://localhost:5173 → click **Enable Emergency Audio** → Overview → **Demo Simulation → Start**.
No ESP32 needed for the demo. Full steps, ESP32 upload and troubleshooting are in [docs/setup-guide.md](docs/setup-guide.md).

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q            # 27 tests
cd frontend && npm test                                # 11 tests
cd backend && .venv/bin/python -m app.security_eval    # P6 research comparison table
```

## Engineering decisions (beyond the PDF)

- **Detection is server-side.** `alert_engine.py` is the single source of truth; the ESP32 detects too (works offline) and both are reconciled by event ID, so there are no duplicate alerts.
- **Hysteresis:** critical at ≥ 45 °C; resolved only after staying < 43 °C for 10 s (all configurable in Settings, persisted in SQLite, pushed to the ESP32 on `campus/<node>/config`).
- **Alert states:** `NORMAL → WARNING → CRITICAL_UNACKNOWLEDGED → CRITICAL_ACKNOWLEDGED → RECOVERED`. Mute = audio only. Acknowledge never marks the temperature as safe.
- **Offline ≠ safe:** no telemetry for `OFFLINE_TIMEOUT_SECONDS` → device offline, a connectivity alert is created, and the gauge shows "Sensor offline — no live data".
- **QoS:** PubSubClient can only *publish* at QoS 0, so the firmware gives emergency messages at-least-once semantics by re-sending the same `event_id` until the backend's delivery ACK (backend dedupes). See [mqtt-protocol](docs/mqtt-protocol.md).
- **Latency measurement:** only single-clock monotonic measurements: ESP32 `millis()` (emergency → ACK) and backend `time.monotonic()` (QoS-1 broker probe). No cross-device timestamp comparison.
- **Simulation** uses node `node1-sim`, flows through the same `ingest_reading → AlertEngine` path, and is labelled *Simulated* everywhere (dashed purple line on charts).
- **Security attack demos** run in a sandbox copy of the detector, so they can never inject fake readings or alerts.
- **Transport portability:** moving to the Anubhav 5G board / MEC server = change `MQTT_HOST/PORT/credentials` in `.env` and `MQTT_SERVER` in the sketch.

## Before deploying on the lab network

1. Use `infrastructure/mosquitto.secure.conf` (passwords + per-device ACL), create users with `infrastructure/create-mqtt-users.sh`, add TLS (port 8883).
2. Set `API_TOKEN` in `.env` (dashboard Settings → API access). Set `DEVICE_HMAC_KEY` in both `.env` and the sketch.
3. Restrict `CORS_ORIGINS`, run the backend behind HTTPS, and firewall port 1883/8883 to the lab subnet.
