/*
 * 5G Emergency Sensor Network — ESP32 + DHT11 node firmware
 * ----------------------------------------------------------------------------
 * Board:     any ESP32 dev board ("ESP32 Dev Module" in Arduino IDE), ESP32 core 2.x or 3.x
 * Libraries: PubSubClient (Nick O'Leary)  >= 2.8
 *            DHT sensor library (Adafruit) >= 1.4  (+ its dependency "Adafruit Unified Sensor")
 *            WiFi.h, Preferences.h, mbedtls  -> bundled with the ESP32 core
 *
 * Wiring (typical 3-pin DHT11 *module* — CHECK YOUR MODULE'S SILKSCREEN, pinouts vary):
 *   DHT11 VCC  (+) -> ESP32 3V3
 *   DHT11 DATA (S) -> ESP32 GPIO4
 *   DHT11 GND  (-) -> ESP32 GND
 *   (A bare 4-pin DHT11 needs a 10 kΩ pull-up between DATA and 3V3; modules include it.)
 *
 * MQTT topics (from the project PDF):
 *   campus/<NODE_ID>/telemetry   every 2 s, QoS 0
 *   campus/<NODE_ID>/emergency   on threshold crossing  (at-least-once, see note)
 *   campus/<NODE_ID>/ack         subscribed, QoS 1      (delivery + operator ACKs)
 *   campus/<NODE_ID>/config      subscribed, QoS 1, retained (threshold sync from backend)
 *
 * NOTE on QoS: PubSubClient can SUBSCRIBE at QoS 1 but can only PUBLISH at QoS 0. To give
 * emergency messages QoS-1 (at-least-once) semantics, this firmware re-publishes the SAME
 * event_id every EMERGENCY_RETRY_MS until the backend's delivery ACK arrives. The backend
 * deduplicates by event_id, so duplicates never create duplicate alerts.
 *
 * Round-trip time is measured with this device's own monotonic millis() clock from the
 * first emergency publish to the delivery ACK, and reported in the next telemetry message
 * (ack_event_id / ack_rtt_ms). No cross-device clock comparison is made.
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <Preferences.h>
#include "mbedtls/md.h"
#include "esp_task_wdt.h"
#include "esp_system.h"

// Why did the chip last restart? Sent once in the first telemetry after boot.
static const char* resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "power_on";
    case ESP_RST_BROWNOUT: return "brownout";   // supply voltage dipped (weak USB power/cable)
    case ESP_RST_PANIC:    return "crash";
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT:      return "watchdog";
    case ESP_RST_SW:       return "software";   // our own ESP.restart()
    case ESP_RST_EXT:      return "reset_button";
    default:               return "other";
  }
}
bool bootReasonPending = true;

// ============================ USER CONFIGURATION ============================
// Wi-Fi, broker address/credentials and the HMAC key live in secrets.h (git-ignored).
// First time: copy secrets.example.h to secrets.h in this folder and fill it in.
#include "secrets.h"
#define MQTT_PORT        1883

#define NODE_ID          "node1"     // must be in the backend ALLOWED_NODES list
#define TOPIC_PREFIX     "campus"

// Must match CRITICAL_THRESHOLD_C / RECOVERY_THRESHOLD_C in the backend .env.
// The backend also pushes its live thresholds on campus/<node>/config (retained), which
// overrides these defaults at runtime — so changing Settings in the dashboard keeps them in sync.
#define TEMPERATURE_THRESHOLD  45.0f
#define RECOVERY_THRESHOLD     43.0f
#define WARNING_THRESHOLD      40.0f
#define RECOVERY_HOLD_MS       10000UL

#define DHT_PIN          4
#define DHT_TYPE         DHT11
#define SAMPLE_INTERVAL_MS     2000UL   // DHT11 needs >= 1 s between reads
#define EMERGENCY_RETRY_MS     3000UL
#define EMERGENCY_MAX_RETRIES  20
#define RECONNECT_INTERVAL_MS  5000UL
// ============================================================================

DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
Preferences prefs;

char topicTelemetry[64], topicEmergency[64], topicAck[64], topicConfig[64];
char clientId[40];

float criticalC = TEMPERATURE_THRESHOLD;
float recoveryC = RECOVERY_THRESHOLD;
float warningC = WARNING_THRESHOLD;

uint32_t seqNo = 0;
uint32_t eventCounter = 0;            // persisted in NVS -> unique event IDs across reboots
unsigned long lastSample = 0, lastWifiAttempt = 0, lastMqttAttempt = 0;
unsigned long lastWifiLog = 0;
unsigned long lastMqttOkMs = 0;                 // last time the broker connection was up
const unsigned long OFFLINE_REBOOT_MS = 60000;  // self-restart after 60 s without the broker
uint32_t dhtFailures = 0;

// Emergency incident state (one incident = one event_id)
bool incidentActive = false;
char activeEventId[24] = "";
float incidentValue = 0;
bool deliveryAcked = false;
bool operatorAcked = false;
unsigned long incidentStartMs = 0, lastEmergencySend = 0, belowSinceMs = 0;
int emergencyAttempts = 0;

// pending RTT report (sent once in the next telemetry)
bool rttPending = false;
char rttEventId[24] = "";
unsigned long rttMs = 0;

// ---------------------------------------------------------------------------
static void hmacHex(const char* msg, char* out /* 65 bytes */) {
  uint8_t mac[32];
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)DEVICE_HMAC_KEY, strlen(DEVICE_HMAC_KEY));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg, strlen(msg));
  mbedtls_md_hmac_finish(&ctx, mac);
  mbedtls_md_free(&ctx);
  for (int i = 0; i < 32; i++) sprintf(out + i * 2, "%02x", mac[i]);
  out[64] = 0;
}

static bool hmacEnabled() { return strlen(DEVICE_HMAC_KEY) > 0; }

static void fmt1(char* buf, size_t n, float v, bool valid) {
  if (valid) snprintf(buf, n, "%.1f", v); else snprintf(buf, n, "null");
}

// ---------------------------------------------------------------------------
void connectWiFiNonBlocking() {
  if (WiFi.status() == WL_CONNECTED) return;
  unsigned long now = millis();
  // give each attempt 20 s: phone hotspots can be slow to finish the handshake
  if (lastWifiAttempt != 0 && now - lastWifiAttempt < RECONNECT_INTERVAL_MS * 4) return;
  lastWifiAttempt = now;
  WiFi.disconnect();
  // Diagnostics: list visible networks (ESP32 sees 2.4 GHz only) and whether our target is among them
  int n = WiFi.scanNetworks();
  bool found = false;
  Serial.printf("[WiFi] %d network(s) visible (2.4 GHz only):\n", n < 0 ? 0 : n);
  for (int i = 0; i < n && i < 15; i++) {
    bool match = WiFi.SSID(i) == WIFI_SSID;
    found |= match;
    Serial.printf("   %-28s %4d dBm  ch %2d%s\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i), match ? "  <-- target" : "");
  }
  WiFi.scanDelete();
  if (!found) Serial.printf("[WiFi] \"%s\" NOT visible -> hotspot is 5 GHz only, off, or the name differs\n", WIFI_SSID);
  esp_task_wdt_reset();
  Serial.printf("[WiFi] connecting to \"%s\" ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (length > 256) {                       // P6: ignore oversized control messages
    Serial.println("[SEC] dropped oversized control message");
    return;
  }
  char msg[257];
  memcpy(msg, payload, length);
  msg[length] = 0;
  Serial.printf("[MQTT] <- %s %s\n", topic, msg);

  if (strcmp(topic, topicAck) == 0) {
    // expected: {"event_id":"E-0007","type":"delivery"|"operator"}
    const char* p = strstr(msg, "\"event_id\"");
    if (!p) return;
    p = strchr(p + 10, '"');
    if (!p) return;
    char id[24] = {0};
    int i = 0;
    for (p++; *p && *p != '"' && i < 23; p++) id[i++] = *p;
    if (!incidentActive || strcmp(id, activeEventId) != 0) {
      Serial.printf("[ACK] ignored ack for unknown/old event %s\n", id);
      return;
    }
    if (strstr(msg, "operator")) {
      operatorAcked = true;
      Serial.printf("[ACK] operator acknowledged %s\n", id);
    } else if (!deliveryAcked) {
      deliveryAcked = true;
      rttMs = millis() - incidentStartMs;
      strncpy(rttEventId, id, sizeof(rttEventId));
      rttPending = true;
      Serial.printf("[ACK] delivery confirmed for %s, RTT %lu ms (%d attempt(s))\n", id, rttMs, emergencyAttempts);
    }
  } else if (strcmp(topic, topicConfig) == 0) {
    const char* c = strstr(msg, "\"critical_c\"");
    const char* r = strstr(msg, "\"recovery_c\"");
    if (c) { float v = atof(strchr(c, ':') + 1); if (v > 0 && v < 120) criticalC = v; }
    const char* w = strstr(msg, "\"warning_c\"");
    if (w) { float v = atof(strchr(w, ':') + 1); if (v > 0 && v < criticalC) warningC = v; }
    if (r) { float v = atof(strchr(r, ':') + 1); if (v > 0 && v < criticalC) recoveryC = v; }
    Serial.printf("[CFG] thresholds synced from backend: critical=%.1f recovery=%.1f\n", criticalC, recoveryC);
  }
}

void connectMqttNonBlocking() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  unsigned long now = millis();
  if (lastMqttAttempt != 0 && now - lastMqttAttempt < RECONNECT_INTERVAL_MS) return;
  lastMqttAttempt = now;
  Serial.printf("[MQTT] connecting to %s:%d as %s ... ", MQTT_SERVER, MQTT_PORT, clientId);
  bool ok = strlen(MQTT_USER) ? mqtt.connect(clientId, MQTT_USER, MQTT_PASS) : mqtt.connect(clientId);
  if (ok) {
    Serial.println("connected");
    mqtt.subscribe(topicAck, 1);
    mqtt.subscribe(topicConfig, 1);
  } else {
    // -2 = network unreachable / wrong IP / firewall, 5 = not authorized
    Serial.printf("failed, state=%d (retry in %lus)\n", mqtt.state(), RECONNECT_INTERVAL_MS / 1000);
  }
}

// ---------------------------------------------------------------------------
void publishEmergency() {
  char val[12];
  fmt1(val, sizeof val, incidentValue, true);
  char payload[320];
  int n = snprintf(payload, sizeof payload,
                   "{\"node\":\"%s\",\"event_id\":\"%s\",\"ts\":%.3f,\"type\":\"temp\",\"value\":%s,"
                   "\"severity\":\"critical\",\"test\":false",
                   NODE_ID, activeEventId, millis() / 1000.0, val);
  if (hmacEnabled()) {
    char canon[96], sig[65];
    snprintf(canon, sizeof canon, "%s|%s|%s", NODE_ID, activeEventId, val);
    hmacHex(canon, sig);
    n += snprintf(payload + n, sizeof(payload) - n, ",\"sig\":\"%s\"", sig);
  }
  snprintf(payload + n, sizeof(payload) - n, "}");
  emergencyAttempts++;
  lastEmergencySend = millis();
  bool ok = mqtt.connected() && mqtt.publish(topicEmergency, payload);
  Serial.printf("[EMERGENCY] -> %s attempt %d %s\n", activeEventId, emergencyAttempts, ok ? "sent" : "QUEUED (offline)");
}

void evaluateEmergency(float t) {
  unsigned long now = millis();
  if (!incidentActive) {
    if (t >= criticalC) {
      eventCounter++;
      prefs.putUInt("evt", eventCounter);
      snprintf(activeEventId, sizeof activeEventId, "E-%04lu", (unsigned long)eventCounter);
      incidentActive = true;
      incidentValue = t;
      deliveryAcked = operatorAcked = false;
      emergencyAttempts = 0;
      belowSinceMs = 0;
      incidentStartMs = now;
      Serial.printf("[ALERT] CRITICAL %.1f°C >= %.1f°C -> new incident %s\n", t, criticalC, activeEventId);
      publishEmergency();
    }
    return;
  }
  // incident active: hysteresis — only close after staying below recovery for RECOVERY_HOLD_MS
  if (t >= recoveryC) {
    belowSinceMs = 0;
  } else {
    if (belowSinceMs == 0) belowSinceMs = now;
    if (now - belowSinceMs >= RECOVERY_HOLD_MS) {
      Serial.printf("[ALERT] incident %s recovered (%.1f°C)\n", activeEventId, t);
      incidentActive = false;
      activeEventId[0] = 0;
    }
  }
}

void serviceEmergencyRetries() {
  if (!incidentActive || deliveryAcked) return;
  if (emergencyAttempts >= EMERGENCY_MAX_RETRIES) return;
  if (millis() - lastEmergencySend >= EMERGENCY_RETRY_MS) publishEmergency();  // same event_id
}

void sampleAndPublish() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  bool tOk = !isnan(t), hOk = !isnan(h);
  seqNo++;
  if (!tOk || !hOk) {
    dhtFailures++;
    Serial.printf("[DHT] invalid reading (#%lu) — check wiring/pin; publishing nulls\n", (unsigned long)dhtFailures);
  }

  char ts[12], hs[12];
  fmt1(ts, sizeof ts, t, tOk);
  fmt1(hs, sizeof hs, h, hOk);
  char payload[420];
  int n = snprintf(payload, sizeof payload,
                   "{\"node\":\"%s\",\"seq\":%lu,\"ts\":%.3f,\"temp_c\":%s,\"humidity\":%s,"
                   "\"gas_raw\":null,\"flame\":null,\"rssi\":%d",
                   NODE_ID, (unsigned long)seqNo, millis() / 1000.0, ts, hs, WiFi.RSSI());
  if (bootReasonPending) {
    n += snprintf(payload + n, sizeof(payload) - n, ",\"boot\":\"%s\"", resetReasonText());
  }
  if (rttPending) {
    n += snprintf(payload + n, sizeof(payload) - n, ",\"ack_event_id\":\"%s\",\"ack_rtt_ms\":%lu", rttEventId, rttMs);
  }
  if (hmacEnabled()) {
    char canon[96], sig[65];
    snprintf(canon, sizeof canon, "%s|%lu|%s|%s", NODE_ID, (unsigned long)seqNo, ts, hs);
    hmacHex(canon, sig);
    n += snprintf(payload + n, sizeof(payload) - n, ",\"sig\":\"%s\"", sig);
  }
  snprintf(payload + n, sizeof(payload) - n, "}");

  bool ok = mqtt.connected() && mqtt.publish(topicTelemetry, payload);  // QoS 0
  if (ok && rttPending) rttPending = false;
  if (ok) bootReasonPending = false;
  if (tOk) evaluateEmergency(t);  // local detection keeps working even if the network is down
  const char* status = !tOk ? "SENSOR ERROR" : (incidentActive || t >= criticalC) ? "CRITICAL"
                     : (t >= warningC) ? "WARNING" : "NORMAL";
  Serial.printf("\nTemperature: %s°C\nHumidity: %s%%\nStatus: %s\n", ts, hs, status);
  Serial.printf("[TEL] #%lu %s\n", (unsigned long)seqNo, ok ? "published to MQTT" : "NOT published (offline)");
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== 5G Emergency Sensor Node (ESP32 + DHT11) ===");
  prefs.begin("esn", false);
  eventCounter = prefs.getUInt("evt", 0);

  snprintf(topicTelemetry, sizeof topicTelemetry, "%s/%s/telemetry", TOPIC_PREFIX, NODE_ID);
  snprintf(topicEmergency, sizeof topicEmergency, "%s/%s/emergency", TOPIC_PREFIX, NODE_ID);
  snprintf(topicAck, sizeof topicAck, "%s/%s/ack", TOPIC_PREFIX, NODE_ID);
  snprintf(topicConfig, sizeof topicConfig, "%s/%s/config", TOPIC_PREFIX, NODE_ID);
  uint64_t mac = ESP.getEfuseMac();
  snprintf(clientId, sizeof clientId, "esp32-%s-%04X", NODE_ID, (uint16_t)(mac >> 32));

  dht.begin();
  Serial.printf("[BOOT] last reset reason: %s\n", resetReasonText());
  // Hardware task watchdog: reboot automatically if loop() stops running for 30 s.
  esp_task_wdt_config_t wdt = {.timeout_ms = 30000, .idle_core_mask = 0, .trigger_panic = true};
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);  // init if not yet running
  esp_task_wdt_add(NULL);
  WiFi.mode(WIFI_STA);
  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) {
    uint8_t r = info.wifi_sta_disconnected.reason;
    const char* why = (r == 201) ? "network not found (5 GHz / off / wrong name)"
                    : (r == 15 || r == 202 || r == 204 || r == 2) ? "WRONG PASSWORD or security mode"
                    : "see ESP-IDF reason codes";
    Serial.printf("[WiFi] connect failed, reason %u: %s\n", r, why);
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.setAutoReconnect(true);
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(15);
  Serial.printf("Node=%s  broker=%s:%d  critical=%.1f°C  HMAC=%s\n", NODE_ID, MQTT_SERVER, MQTT_PORT,
                criticalC, hmacEnabled() ? "on" : "off");
  connectWiFiNonBlocking();
}

void loop() {
  esp_task_wdt_reset();  // "still alive" — feeds the hardware watchdog
  unsigned long now = millis();
  connectWiFiNonBlocking();
  if (WiFi.status() == WL_CONNECTED) {
    if (now - lastWifiLog > 30000 || lastWifiLog == 0) {
      lastWifiLog = now;
      Serial.printf("[WiFi] connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    }
    connectMqttNonBlocking();
    mqtt.loop();
  }
  // Watchdog: if the broker has been unreachable for too long, reboot to recover the Wi-Fi stack.
  // Local detection keeps running until then; the event counter is kept in NVS across reboots.
  if (mqtt.connected()) {
    lastMqttOkMs = now;
  } else if (now - lastMqttOkMs > OFFLINE_REBOOT_MS) {
    Serial.printf("[WATCHDOG] no broker connection for %lus, restarting...\n", OFFLINE_REBOOT_MS / 1000);
    delay(100);
    ESP.restart();
  }
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    sampleAndPublish();
  }
  serviceEmergencyRetries();
  delay(10);  // yield; keeps loop responsive without blocking acquisition
}
