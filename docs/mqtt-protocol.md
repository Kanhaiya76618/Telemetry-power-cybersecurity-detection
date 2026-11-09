# MQTT protocol

Topic prefix `campus` (`TOPIC_PREFIX`). `<node>` = device ID, e.g. `node1`.

| Topic | Direction | MQTT QoS | Retained | Purpose |
|---|---|---|---|---|
| `campus/<node>/telemetry` | device → MEC | 0 | no | readings every 2 s |
| `campus/<node>/emergency` | device → MEC | 1 semantics* | no | threshold crossing |
| `campus/<node>/ack` | MEC → device | 1 | no | delivery + operator acknowledgments |
| `campus/<node>/config` | MEC → device | 1 | yes | threshold sync (extension) |
| `campus/_probe/<client>` | backend ↔ broker | 1 | no | broker RTT probe (extension) |

\*PubSubClient cannot publish at QoS 1. The firmware re-sends the same `event_id` every 3 s until a delivery ACK arrives (at-least-once delivery). The backend deduplicates by `event_id`. A library such as `256dpi/arduino-mqtt` could provide native QoS 1 publishing later.

## Telemetry (PDF format + DHT11 humidity)

```json
{"node":"node1","seq":1042,"ts":1792990000.123,"temp_c":31.4,"humidity":62.5,"gas_raw":null,"flame":null}
```

Optional extensions: `rssi` (dBm), `ack_event_id` + `ack_rtt_ms` (RTT report, sent once), `sig` (HMAC). An invalid DHT read is sent as `null`; the reading is stored but never counts as "safe". `ts` is device uptime (the ESP32 has no RTC/NTP) and is informational only.

## Emergency

```json
{"node":"node1","event_id":"E-0007","ts":1792990012.456,"type":"temp","value":46.5,"severity":"critical","test":false}
```

Event IDs: `E-%04u` from a counter persisted in ESP32 NVS, so they stay unique across reboots. One incident = one ID; the device re-arms only after the temperature stays below the recovery threshold for 10 s. Backend-detected alerts use `B-<epoch>-<n>`; when both detect the same incident, the device ID is linked to the backend alert (`device_event_id`), so only one alert appears.

## ACK

```json
{"event_id":"E-0007","type":"delivery"}
{"event_id":"E-0007","type":"operator"}
```

`delivery` is sent immediately when the backend receives the emergency. The ESP32 measures `millis()` from its first emergency publish to this ACK, so the RTT uses one monotonic clock. `operator` is sent when someone clicks Acknowledge in the dashboard.

## Config (retained)

```json
{"critical_c":45.0,"recovery_c":43.0,"warning_c":40.0}
```

## Signatures (optional, P6)

Signatures are HMAC-SHA256 hex of a canonical string, with floats formatted to one decimal and missing values written as `null`:

- telemetry: `node|seq|temp|humidity`, e.g. `node1|1042|31.4|62.5`
- emergency: `node|event_id|value`

## MQTT QoS vs 5G QoS

MQTT QoS (0/1/2) is an application-layer delivery guarantee between client and broker. 5G QoS (5QI, GBR, network slicing) is radio/core network prioritisation. The future experiment (no / medium / heavy `iperf3` load) measures how the network affects emergency delivery. This Wi-Fi prototype measures neither 5G metric.
