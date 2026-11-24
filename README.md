# 5G Emergency Sensor Network + Lightweight IoT Security Framework (P6)

A real-time **IoT emergency monitoring system** built for the **Bharat 5G Use Case Lab (Anubhav board, private 5G + MEC)**.
An **ESP32 + DHT11** sensor node sends temperature and humidity over **MQTT** to an **edge (MEC) server**, which detects
dangerous temperatures and raises a **live alarm with a railway-crossing siren** on a web dashboard. Every message is first
checked by a **lightweight cybersecurity framework** (Problem Statement 6), which blocks spoofing, replay, flooding and
forged messages in microseconds.

> 🎥 **Video walkthrough (voice commentary):** https://drive.google.com/file/d/1goDVXPjjS4W79gbDVUpTSeuKAckxThmv/view?usp=sharing

**Status:** working prototype, tested end to end on **real hardware over Wi-Fi**, with the laptop acting as the MEC
edge server. The design is **5G-ready**: moving to private 5G + MEC changes only the broker address. 5G latency,
slicing and QoS have **not** been measured yet (see [Roadmap](#14-roadmap)). This is a prototype, **not certified for life-safety use**.

---

## Table of contents
1. [The problem](#1-the-problem)
2. [What the system does](#2-what-the-system-does)
3. [Architecture](#3-architecture)
4. [Where 5G and MEC fit](#4-where-5g-and-mec-fit)
5. [Hardware](#5-hardware)
6. [MQTT protocol](#6-mqtt-protocol)
7. [Alert logic](#7-alert-logic)
8. [Cybersecurity framework (Problem Statement 6)](#8-cybersecurity-framework-problem-statement-6)
9. [Web dashboard](#9-web-dashboard)
10. [Project structure](#10-project-structure)
11. [Installation and running](#11-installation-and-running)
12. [Demo guide](#12-demo-guide)
13. [Testing](#13-testing)
14. [Roadmap](#14-roadmap)
15. [Troubleshooting](#15-troubleshooting)
16. [Reference: API, configuration, security deployment](#16-reference)

---

## 1. The problem

IoT sensors (temperature, smoke, gas, fire) are spreading into campuses, factories and hospitals. They create a conflict:

| They must be… | But they are… |
|---|---|
| **Fast:** an emergency must arrive in milliseconds | on **shared, congested networks** |
| **Trusted:** a fire alarm must never be faked or hidden | **exposed** to spoofing, replay and flooding attacks |
| **Secure** | **too small** for normal security tools (an ESP32 has ~320 KB RAM) |

**Research question (P6):** *Can an edge-based lightweight detector find abnormal IoT behaviour while staying within the
resource limits of an embedded / edge device, without delaying emergency alerts?*

## 2. What the system does

- Reads temperature and humidity every **2 seconds** from a DHT11 on an ESP32.
- Sends readings over **MQTT** to a **Mosquitto broker** on the edge server.
- **Inspects every message for attacks** before trusting it.
- Detects **warning (≥ 40 °C)** and **critical (≥ 45 °C)** temperatures with **hysteresis**.
- Pushes everything live to a **React dashboard** over WebSocket: gauge, charts, **red emergency overlay + railway siren**.
- Sends an **ACK** back to the ESP32, which measures the **round-trip time** on its own clock.
- Stores readings, alerts and security events in **SQLite**: alert history with CSV export.
- Includes a **simulation mode** and a **guided demo**, so the whole story can be shown without hardware.

## 3. Architecture

```
 ① SENSE          ② SEND               ③ CARRY                 ④ PROCESS at the edge (MEC)                  ⑤ SHOW
┌────────┐     ┌──────────┐   MQTT   ┌──────────────┐     ┌────────────────────────────────────┐  WebSocket  ┌──────────────┐
│ DHT11  │────►│  ESP32   │─────────►│ Wi-Fi (now)  │────►│ Mosquitto broker (port 1883)       │────────────►│ React        │
│ sensor │     │ firmware │          │ Private 5G   │     │   ↓                                │             │ dashboard    │
└────────┘     │ (local   │◄─────────│ (planned,    │◄────│ FastAPI backend                    │             │ + siren      │
               │ detection)│  ACK +   │ Anubhav board)│     │   ├─ ① security check (P6)         │             │ + alerts     │
               └──────────┘  config  └──────────────┘     │   ├─ ② validation (Pydantic)       │             └──────────────┘
                                                           │   ├─ ③ alert engine (hysteresis)   │
                                                           │   └─ ④ SQLite storage              │
                                                           └────────────────────────────────────┘
```

| Layer | Technology |
|---|---|
| Sensor node | ESP32 Dev Module, DHT11, Arduino (C++), PubSubClient, mbedTLS (HMAC) |
| Messaging | MQTT, Eclipse Mosquitto 2 |
| Edge backend | Python 3.11+, FastAPI, Paho-MQTT, Pydantic, SQLite, WebSockets |
| Security / ML | Custom rule engine, scikit-learn (Decision Tree, Logistic Regression, Isolation Forest) |
| Dashboard | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Recharts, Web Audio API |
| Infrastructure | Docker Compose / Homebrew Mosquitto, MEC Ubuntu VM |

## 4. Where 5G and MEC fit

- **MEC (Multi-access Edge Computing):** the broker, security checks and alert engine run **at the edge**, close to the
  sensor, instead of in a distant cloud. That gives lower latency and keeps data in the private network. Today the
  **laptop plays the MEC role**; in the lab, the same software runs on the **MEC VM** (Mosquitto is already installed there).
- **Planned 5G path:**
  `ESP32 + DHT11 → (UART) → Anubhav 5G board → private 5G (gNB / CU-DU) → 5G core → MEC server → dashboard`
- **5G-ready:** switching transport only changes `MQTT_SERVER` in the ESP32 `secrets.h` and `MQTT_HOST` in `.env`.
- **MQTT QoS ≠ 5G QoS.** MQTT QoS 0/1 is an application-level delivery guarantee (which we use). 5G QoS (5QI, QoS flows,
  **network slicing**) is network-level prioritisation configured in the 5G core, which we have **not** configured yet.
  With slicing, emergency alerts could use a **URLLC** slice that stays fast even when video traffic congests the network.
- The dashboard's **Network Monitoring** page has a 5G/MEC panel that shows **"Not available"** until real 5G
  measurements exist. We never display invented 5G numbers.

## 5. Hardware

| Item | Notes |
|---|---|
| ESP32 Dev Module | any ESP32 board with CP2102/CH340 USB (`/dev/cu.usbserial-*` on macOS) |
| DHT11 module | temperature ±2 °C, humidity ±5 %, 0–50 °C range |
| USB data cable | a charge-only cable will not show a port |
| 2.4 GHz Wi-Fi / phone hotspot | **the ESP32 cannot use 5 GHz Wi-Fi** |

**Wiring (typical 3-pin DHT11 module; check your module's labels):**

| DHT11 | ESP32 |
|---|---|
| VCC (+) | 3V3 |
| DATA (OUT/S) | GPIO 4 |
| GND (−) | GND |

**Firmware features** (`esp32/emergency_sensor/emergency_sensor.ino`):
- telemetry every 2 s; local critical detection (works even when offline)
- emergency events with unique IDs stored in flash; re-sent until ACKed (at-least-once)
- ACK round-trip time measured with `millis()` and reported back
- thresholds synced live from the backend (`campus/node1/config`)
- optional HMAC-SHA256 signatures
- **watchdogs:** a hardware task watchdog (reboots if the program freezes for 30 s) and a connection watchdog (reboots after 60 s without the broker)
- **Wi-Fi diagnostics:** lists visible networks and prints why a connection failed (e.g. `reason 201: network not found` means a 5 GHz/off hotspot; wrong-password reasons are labelled)
- reports its last reset reason (`power_on`, `brownout`, `watchdog`, …)

## 6. MQTT protocol

| Topic | Direction | QoS | Purpose |
|---|---|---|---|
| `campus/node1/telemetry` | ESP32 → edge | 0 | reading every 2 s |
| `campus/node1/emergency` | ESP32 → edge | 1* | threshold crossed |
| `campus/node1/ack` | edge → ESP32 | 1 | delivery + operator acknowledgement |
| `campus/node1/config` | edge → ESP32 | 1, retained | threshold sync |

\*PubSubClient can only publish at QoS 0, so the firmware re-sends the same `event_id` until the ACK arrives, and the backend removes duplicates.

```jsonc
// telemetry
{"node":"node1","seq":29,"ts":58.2,"temp_c":30.4,"humidity":59.0,"gas_raw":null,"flame":null,"rssi":-60}
// emergency
{"node":"node1","event_id":"E-0007","value":46.5,"severity":"critical","test":false}
// ack
{"event_id":"E-0007","type":"delivery"}
```
Full details: [docs/mqtt-protocol.md](docs/mqtt-protocol.md).

## 7. Alert logic

```
NORMAL ──≥40°C──► WARNING ──≥45°C──► CRITICAL_UNACKNOWLEDGED ──ack──► CRITICAL_ACKNOWLEDGED ──<43°C for 10 s──► RECOVERED
```
- **Detection runs on the server** (`alert_engine.py`) and on the ESP32. Both are reconciled by event ID, so there are no duplicate alerts.
- **Hysteresis:** critical at ≥ 45 °C, cleared only after **10 s below 43 °C**, so the alarm never flickers.
- **Mute ≠ safe:** muting stops the sound only. **Acknowledge ≠ safe:** it records the response, and the alert stays red while it's hot.
- **Offline ≠ safe:** no data for 10 s marks the sensor offline and creates a connectivity alert.
- All thresholds are editable in **Settings**, saved in SQLite, and pushed to the ESP32 automatically.

## 8. Cybersecurity framework (Problem Statement 6)

Every MQTT message passes through `SecurityMonitor.inspect()` (`backend/app/security.py`) **before** anything else.

| # | Check | How | Action |
|---|---|---|---|
| 1 | Oversize payload | > 1024 bytes | 🚫 block |
| 2 | Malformed data | invalid JSON / missing fields | 🚫 block |
| 3 | Spoofing | topic node ≠ payload node | 🚫 block |
| 4 | Unknown device | not in `ALLOWED_NODES` | 🚫 block |
| 5 | Flooding / DoS | > 5 msgs in a 1 s sliding window | 🚫 block |
| 6 | Forged message | HMAC-SHA256 signature mismatch | 🚫 block |
| 7 | Replay | sequence number not increasing (a reboot after ≥ 5 s silence is allowed) | 🚫 block |
| 8 | Impossible value | outside 0–60 °C | ⚠️ flag |
| 9 | Sudden jump | > 4 °C per second | ⚠️ flag |
| 10 | Behavioural anomaly | EWMA z-score > 6 | ⚠️ flag |

**Design principle:** clear attacks are **blocked**, but suspicious readings are only **flagged**, because a real fire can
heat fast and **a real emergency must never be hidden**. Cost: about **8 µs per message, ~576 bytes per device**.

Also provided: Mosquitto **password + per-device ACL** configuration (`infrastructure/`), and a **sandboxed attack
simulator**: dashboard attack buttons run in an isolated copy of the detector and never inject fake data.

### Evaluation: baseline vs rules vs lightweight ML
`backend/app/security_eval.py` generates a **labelled, controlled dataset** (~3,100 normal messages with real heating
episodes, plus ~400 injected attacks of 7 types), trains the ML models on one generated run, and tests every detector on another.

| Configuration | F1 | False positives | Time / message | Size |
|---|---|---|---|---|
| Baseline (no security) | 0.000 | 0 % | – | – |
| **Rule-based (ours)** | **1.000** | **0 %** | **~8 µs** | **0.6 KB** |
| Decision Tree | 1.000 | 0 % | ~45 µs | 2.0 KB |
| Logistic Regression | 0.995 | 0 % | ~150 µs | 1.4 KB |
| Isolation Forest | 0.713 | 10.3 % | ~1,700 µs | 404 KB |

**Finding:** lightweight rules match the best ML model at about **6× lower latency**. The 2 KB decision tree is the best
candidate for on-device deployment, and Isolation Forest is unsuitable for microcontrollers.
⚠️ These results are on **synthetic** data and must be repeated on real captured traffic. Energy use is not yet measured.
Details: [docs/security-framework.md](docs/security-framework.md).

## 9. Web dashboard

| Page | What it shows |
|---|---|
| **Overview** | live data-flow diagram, temperature gauge, humidity, stats, chart, system setup checklist, simulation |
| **Live Monitoring** | per-device gauge, 1-minute live stream, raw incoming readings |
| **Sensor Analytics** | min/max/avg/σ, history (1 m – 24 h) |
| **Emergency Alerts** | active alerts with acknowledge, alert state model |
| **Alert History** | search, filters (severity/device/date), detail drawer, **CSV export** |
| **Cybersecurity (P6)** | detector metrics, live incident feed, attack simulator, benchmark |
| **Network Monitoring** | broker status and RTT, device heartbeat, ACK RTT, 5G/MEC panel |
| **Device Management** | device cards, online/offline, wiring reference |
| **Settings** | thresholds, siren volume and test, API token |

**Interactive features:**
- 🔄 **Live data-flow diagram:** each reading animates ESP32 → Wi-Fi/5G → MQTT → security → dashboard (cyan = real, purple = simulated); click any stage to open it.
- ✨ **Guided demo:** one click narrates a full emergency (normal → warning → critical → acknowledge → recovery) in about a minute.
- ⌨️ **Command palette:** **⌘K** or **/** to jump to pages or run actions (start demo, trigger emergency, test siren).
- 🔔 **Pop-up notifications:** device online/offline, warnings, critical alerts, recovery, security events.
- ✅ **System setup checklist:** shows what isn't working (backend, broker, ESP32, audio) and the exact fix.
- 🚨 **Railway siren** (Web Audio API): two-tone crossing bell, never overlaps, mute ≠ clear, handles browser autoplay rules.
- 📱 Responsive (laptop, tablet, phone); simulated data always labelled; offline sensors never shown as safe.

## 10. Project structure

```
5g-emergency-network/
├── backend/                     Python edge server (FastAPI)
│   ├── app/
│   │   ├── main.py              REST API + /ws/monitor WebSocket
│   │   ├── hub.py               pipeline: MQTT → security → validation → storage → alerts → WebSocket
│   │   ├── alert_engine.py      thresholds, hysteresis, alert states, dedup, offline detection
│   │   ├── security.py          P6 lightweight security detector
│   │   ├── security_eval.py     baseline vs rules vs ML evaluation
│   │   ├── mqtt_client.py       Paho MQTT bridge (auto-reconnect, broker RTT probe)
│   │   ├── simulation.py        demo simulator
│   │   ├── database.py          SQLite persistence
│   │   ├── schemas.py, models.py, config.py, websocket_manager.py
│   ├── tests/                   28 pytest tests
│   └── requirements.txt
├── frontend/                    React + TypeScript dashboard
│   └── src/  pages/ components/ hooks/ services/ audio/RailwaySiren.ts  test/ (11 tests)
├── esp32/
│   ├── phase1_serial_test/      Phase 1: DHT11 → Serial Monitor only
│   └── emergency_sensor/        full firmware + secrets.example.h
├── infrastructure/              docker-compose.yml, mosquitto.conf (demo), mosquitto.secure.conf, acl, user script
├── docs/                        setup-guide, hardware-wiring, mqtt-protocol, security-framework
├── .env.example
└── README.md
```

## 11. Installation and running

### Requirements
- **Python 3.11+**, **Node.js 20+**, **Mosquitto** (`brew install mosquitto` on macOS, `sudo apt install mosquitto mosquitto-clients` on Ubuntu)
- **Arduino IDE 2.x** with **esp32 by Espressif** (board package) and the libraries **PubSubClient** and **DHT sensor library** (+ Adafruit Unified Sensor)

### Step 1: Get the code and configure
```bash
git clone <this-repository-url>
cd 5g-emergency-network
cp .env.example .env
```

### Step 2: Start the MQTT broker (terminal 1)
```bash
printf 'listener 1883 0.0.0.0\nallow_anonymous true\n' > /tmp/mosquitto-demo.conf
mosquitto -c /tmp/mosquitto-demo.conf -v
```
(Use `/opt/homebrew/sbin/mosquitto` if `mosquitto` is not found on macOS. For an authenticated setup, see [§16](#mqtt-security-on-a-shared--lab-network).)

### Step 3: Start the backend (terminal 2)
```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Check it: `curl -s localhost:8000/api/health` should show `"connected": true`.

### Step 4: Start the dashboard (terminal 3)
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173** and click **Enable Emergency Audio**.

### Step 5: Connect the real ESP32 (optional; the demo works without it)
1. Wire the DHT11 (see [§5](#5-hardware)). Optionally upload `esp32/phase1_serial_test` first to verify the sensor.
2. Copy `esp32/emergency_sensor/secrets.example.h` to `secrets.h` and fill in:
   ```cpp
   #define WIFI_SSID      "your 2.4 GHz Wi-Fi or hotspot"
   #define WIFI_PASSWORD  "its password"
   #define MQTT_SERVER    "your computer's IP"   // macOS: ipconfig getifaddr en0 — never "localhost"
   ```
3. Arduino IDE: open `emergency_sensor.ino`, **Board: ESP32 Dev Module**, choose the USB port, and click **Upload** (hold **BOOT** if it sticks at "Connecting…").
4. The computer and the ESP32 **must be on the same network**. The Serial Monitor (115200) shows `[WiFi] connected` → `[MQTT] connected` → `[TEL] published to MQTT`.
5. The dashboard shows **ESP32 connected** with live readings.

`secrets.h` is git-ignored, so real passwords are never committed.

## 12. Demo guide

**Without hardware (about 1 minute):** Overview → **Guided demo** → Start. It walks through normal → warning → critical
(siren) → acknowledge → cooling (hysteresis) → recovered, explaining each step.

**With hardware:** hold the DHT11 between your fingers. To make it trigger easily, lower the thresholds in
**Settings** (e.g. 31/33/32 °C); the ESP32 receives them automatically.

**Security:** Cybersecurity page → click **Flood / DoS**, **Replay**, **Spoofed device** (shown as BLOCKED), then **Run benchmark**.

**Keyboard:** press **⌘K** and type "demo", "trigger" or "siren".

## 13. Testing

```bash
cd backend  && .venv/bin/python -m pytest -q          # 28 tests: thresholds, hysteresis, dedup, ACK, offline,
                                                      # restart recovery, simulation, security rules, API, auth
cd frontend && npm test                               # 11 tests: siren (no overlap, autoplay), alarm logic,
                                                      # WebSocket reconnect, gauge offline state, overlay
cd backend  && .venv/bin/python -m app.security_eval  # prints the rules-vs-ML comparison table
```

**Verified on hardware:** ESP32 + DHT11 live data over a phone hotspot → Mosquitto → backend → dashboard. A real critical
alert was triggered by warming the sensor, acknowledged and recovered.

## 14. Roadmap

| Done ✅ | Next ⏳ |
|---|---|
| ESP32 + DHT11 live over Wi-Fi/MQTT | Anubhav 5G board + private 5G |
| Edge backend, dashboard, siren, history | Run the stack on the MEC VM (Mosquitto installed there) |
| Real emergency on hardware | Measure 5G latency, packet loss, throughput (ping/iperf3) |
| P6 security framework + ML comparison | Alerts under no / medium / heavy load (20 alerts × 3 levels) |
| Watchdogs + Wi-Fi diagnostics | 5QI / **network slicing** (URLLC) for emergency traffic |
| Interactive UX (guided demo, ⌘K, data-flow) | MQ-2 gas + flame sensors; INA219 energy measurement; on-device decision tree; TLS |

## 15. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Dashboard: "ESP32 offline" | The computer and the ESP32 are on different networks, or the hotspot is off. Put both on the same **2.4 GHz** network and press **EN/RST**. |
| Serial: `reason 201: network not found` | The Wi-Fi is **5 GHz**, off, or the name differs. Set the hotspot **AP band to 2.4 GHz**. |
| Serial: wrong-password reason | Fix `WIFI_PASSWORD` in `secrets.h` (case-sensitive). |
| Serial: `[MQTT] failed, state=-2` | Wrong `MQTT_SERVER` IP, broker not running, or a firewall. Check `ipconfig getifaddr en0`. |
| Serial: nothing at all after replugging | The board is stuck in boot mode; press **EN/RST**. Power from a charger/power bank for demos. |
| Upload: "port busy" | Close the Arduino Serial Monitor. |
| No USB port shown | Use a **data** cable; install the CP210x/CH340 driver. |
| "MQTT down" on dashboard | Start Mosquitto (Step 2). |
| No siren | Click **Enable Emergency Audio** (browser autoplay policy). |
| Check MQTT traffic | `mosquitto_sub -h localhost -t 'campus/#' -v` |

## 16. Reference

### REST API (port 8000)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | backend + MQTT status |
| GET | `/api/sensors/latest`, `/api/sensors/history?node=&range=1m\|5m\|15m\|1h\|24h` | readings |
| GET | `/api/devices`, `/api/network` | devices, network metrics |
| GET | `/api/alerts`, `/api/alerts/{id}`, `/api/alerts/export.csv` | alert history |
| POST | `/api/alerts/{id}/acknowledge` | acknowledge |
| GET/PUT | `/api/settings` | thresholds |
| POST | `/api/simulation/start\|stop\|command` | simulator |
| GET | `/api/security/events`, `/api/security/metrics` | security |
| POST | `/api/security/simulate`, `/api/security/evaluate` | attack demo, benchmark |
| WS | `/ws/monitor` | live push of readings, alerts, status |

State-changing endpoints require `X-API-Key` when `API_TOKEN` is set.

### Configuration (`.env`)
| Variable | Default | Meaning |
|---|---|---|
| `MQTT_HOST` / `MQTT_PORT` | localhost / 1883 | broker (set to the MEC IP in the lab) |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | broker login |
| `WARNING_THRESHOLD_C` / `CRITICAL_THRESHOLD_C` / `RECOVERY_THRESHOLD_C` | 40 / 45 / 43 | alert levels |
| `RECOVERY_SECONDS` / `OFFLINE_TIMEOUT_SECONDS` | 10 / 10 | hysteresis hold, offline timeout |
| `ALLOWED_NODES` | node1 | provisioned devices |
| `DEVICE_HMAC_KEY` | empty | optional message signing (same value in `secrets.h`) |
| `FLOOD_MAX_PER_SEC` | 5 | flood limit |
| `API_TOKEN` | empty | protect state-changing API calls |

### MQTT security on a shared / lab network
On the MEC VM (Ubuntu), Mosquitto is configured with authentication and per-device topic permissions:
```bash
sudo mosquitto_passwd -c /etc/mosquitto/passwd mec-backend    # prompts for a password
sudo mosquitto_passwd /etc/mosquitto/passwd node1
sudo cp infrastructure/acl /etc/mosquitto/acl
# /etc/mosquitto/conf.d/lab.conf:
#   listener 1883 0.0.0.0
#   allow_anonymous false
#   password_file /etc/mosquitto/passwd
#   acl_file /etc/mosquitto/acl
sudo chown root:mosquitto /etc/mosquitto/passwd /etc/mosquitto/acl && sudo chmod 640 /etc/mosquitto/passwd /etc/mosquitto/acl
sudo systemctl restart mosquitto && sudo ss -ltnp | grep 1883     # expect 0.0.0.0:1883
```
Then set `MQTT_USERNAME/PASSWORD` in `.env` and `MQTT_USER/PASS` in `secrets.h`. Add TLS (port 8883) for production.

---

**Project:** 5G QoS-Aware Emergency Sensor Network, Bharat 5G Use Case Lab (Anubhav board), with Problem Statement 6:
Lightweight Cybersecurity Framework for IoT Devices.
**Author:** Kanhaiya Mehta, IIIT Dharwad.
