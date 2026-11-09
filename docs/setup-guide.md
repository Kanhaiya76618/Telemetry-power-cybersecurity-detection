# macOS setup guide

Run every command from the repo root (`5g-emergency-network/`) unless noted.

## 1. Install tools

```bash
xcode-select --install            # if git/clang are missing
brew install python@3.12 node     # Python 3.11+ and Node 20+
brew install --cask docker        # then open Docker Desktop once
brew install mosquitto            # optional: gives mosquitto_sub / mosquitto_pub for debugging
```

## 2. Backend (Python virtual environment)

```bash
cp .env.example .env
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q          # should print: 27 passed
```

## 3. Start Mosquitto

```bash
docker compose -f infrastructure/docker-compose.yml up -d
docker logs -f esn-mosquitto           # should show "Opening ipv4 listen socket on port 1883"
```

The demo config (`infrastructure/mosquitto.conf`) allows anonymous access — use it only on your own isolated Wi-Fi/hotspot. Mosquitto 2 only listens on localhost unless a `listener` is declared; this config declares `listener 1883 0.0.0.0` and Docker publishes the port to the LAN.

No Docker? `brew install mosquitto` and run `mosquitto -c infrastructure/mosquitto.local-brew.conf` after creating that file with the same two lines: `listener 1883 0.0.0.0` and `allow_anonymous true`.

## 4. Find the MacBook's IP (for the ESP32)

```bash
ipconfig getifaddr en0
```

(If empty, try `en1`, or System Settings → Wi-Fi → Details → IP address.) Put this IP in `MQTT_SERVER` in the sketch. **Never `localhost`** in the ESP32: there it means the ESP32 itself. The backend runs on the Mac, so `MQTT_HOST=localhost` in `.env` is correct.

macOS firewall: if enabled, allow incoming connections for Docker (or `mosquitto`). The ESP32 and the Mac must be on the same network; guest Wi-Fi often isolates clients.

## 5. Start the backend

```bash
cd backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Check: `curl -s localhost:8000/api/health` → `"mqtt": {"connected": true ...}`.

## 6. Start the dashboard

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Phones/tablets on the same Wi-Fi can use `http://<mac-ip>:5173`.

## 7. Enable the siren

On first load, click **Enable Emergency Audio** (browsers block sound until you click). Settings → *Test siren (3 s)* checks the speakers. If the browser still blocks audio, the emergency overlay shows an **Activate sound** button, and visual alerts always work.

## 8. Demo without an ESP32

Overview → Demo Simulation: **Start**, then the preset buttons 28° → 38° → 42° (warning) → 46° (critical, siren) → **Acknowledge** → 41° → 30° (recovers after 10 s below 43 °C). Everything is labelled *Simulated*.

## 9. ESP32: Phase 1 (sensor only)

1. Arduino IDE → Boards Manager → install **esp32 by Espressif Systems**. Board: **ESP32 Dev Module**.
2. Library Manager: **DHT sensor library** (Adafruit), accept **Adafruit Unified Sensor**; **PubSubClient** (Nick O'Leary).
3. Wire per [hardware-wiring.md](hardware-wiring.md). Open `esp32/phase1_serial_test/phase1_serial_test.ino`, upload, and open Serial Monitor at **115200** baud:

```
Temperature: 29.5°C
Humidity: 62%
Status: NORMAL
```

### Upload / serial-port errors (the error you hit before)

- Port missing: use a **data** USB cable (many are charge-only). Check with `ls /dev/cu.*` and look for `cu.usbserial-*`, `cu.SLAB_USBtoUART` or `cu.wchusbserial*`.
- CP210x boards need the Silicon Labs VCP driver; CH340/CH9102 boards need the WCH driver (macOS 13+ usually includes it). After installing, allow it in System Settings → Privacy & Security.
- `Failed to connect to ESP32: Timed out waiting for packet header`: hold **BOOT**, press **EN/RST**, release BOOT when "Connecting…" appears. Or lower Tools → Upload Speed to 115200.
- `Resource busy` / port in use: close the Serial Monitor/Plotter or any other app using the port.
- Garbage text in Serial Monitor: set the baud rate to 115200.

## 10. ESP32: full firmware

Open `esp32/emergency_sensor/emergency_sensor.ino` and edit the configuration block: `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_SERVER` (your Mac IP from step 4), and optionally `NODE_ID` and `TEMPERATURE_THRESHOLD` (keep it equal to `CRITICAL_THRESHOLD_C`). Upload. Serial Monitor shows Wi-Fi/MQTT connection, then readings every 2 s. Within ~2 s the dashboard should show **ESP32 connected**.

ESP32 Wi-Fi is 2.4 GHz only. It cannot join a 5 GHz-only network.

## 11. Verify MQTT telemetry

```bash
mosquitto_sub -h localhost -t 'campus/#' -v
```

Without brew mosquitto:

```bash
docker exec -it esn-mosquitto mosquitto_sub -t 'campus/#' -v
```

Publish a fake reading by hand (it shows as real `node1` data, so use this for debugging only):

```bash
mosquitto_pub -h localhost -t campus/node1/telemetry -m '{"node":"node1","seq":100000,"temp_c":30.1,"humidity":55}'
```

## 12. Test a real emergency

Warm the DHT11 carefully: hold it in your hand, use a hair dryer at a distance, or temporarily lower the critical threshold in Settings (e.g. 32 °C). The backend pushes the new threshold to the ESP32. Do not use an open flame. DHT11 is specified up to 50 °C.

## 13. Debugging connection failures

| Symptom | Check |
|---|---|
| Dashboard: "Backend connection closed" | Is uvicorn running on :8000? Look at the terminal output. |
| MQTT down on dashboard | `docker ps` shows esn-mosquitto? `.env` MQTT_HOST/PORT correct? |
| ESP32 `state=-2` | Wrong `MQTT_SERVER` IP, different network, or macOS firewall blocking. |
| ESP32 `state=5` | Broker requires auth: set MQTT_USER/MQTT_PASS. |
| ESP32 online but "unknown_device" security events | `NODE_ID` is not in `ALLOWED_NODES`. |
| `auth_failure` events | `DEVICE_HMAC_KEY` differs between `.env` and the sketch. |
| Readings `INVALID` | DHT11 wiring/pin; module needs 3V3 and GND; DATA on GPIO4. |

## 14. Authenticated broker (lab / shared network)

```bash
./infrastructure/create-mqtt-users.sh          # creates mec-backend + node1 users
docker compose -f infrastructure/docker-compose.yml down
MOSQUITTO_CONF=mosquitto.secure.conf docker compose -f infrastructure/docker-compose.yml up -d
```

Then set `MQTT_USERNAME/MQTT_PASSWORD` in `.env` and `MQTT_USER/MQTT_PASS` in the sketch. `infrastructure/acl` limits each identity to its own topics. TLS: generate a CA and server certificate (e.g. `openssl req -x509 ...`) into `infrastructure/certs/` and uncomment the 8883 listener. The ESP32 then needs `WiFiClientSecure` with the CA certificate.
