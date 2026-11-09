/*
 * PHASE 1 milestone: ESP32 -> DHT11 -> Serial Monitor (no Wi-Fi, no MQTT).
 * Upload this first to prove the board, USB port and sensor wiring work.
 *
 * Library: "DHT sensor library" by Adafruit (+ "Adafruit Unified Sensor").
 * Wiring:  DHT11 VCC -> 3V3, DATA -> GPIO4, GND -> GND  (check your module's labels)
 * Serial Monitor: 115200 baud.
 */
#include <DHT.h>

#define DHT_PIN   4
#define DHT_TYPE  DHT11
#define WARNING_C   40.0f   // same defaults as the backend
#define CRITICAL_C  45.0f

DHT dht(DHT_PIN, DHT_TYPE);

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Phase 1: DHT11 serial test ===");
  dht.begin();
}

void loop() {
  delay(2000);                       // DHT11 max sample rate ~1 Hz
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) {
    Serial.println("DHT11 read failed - check wiring, pin (GPIO4) and 3V3/GND");
    return;
  }
  const char* status = t >= CRITICAL_C ? "CRITICAL" : t >= WARNING_C ? "WARNING" : "NORMAL";
  Serial.printf("Temperature: %.1f°C\nHumidity: %.0f%%\nStatus: %s\n\n", t, h, status);
}
