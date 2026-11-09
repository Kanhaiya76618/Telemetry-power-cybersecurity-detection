// Copy this file to secrets.h (same folder) and fill in your values.
// secrets.h is git-ignored so real passwords are never committed.
#pragma once

#define WIFI_SSID        "YOUR_WIFI_SSID"       // 2.4 GHz network
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

// The Mac's LAN IP (run `ipconfig getifaddr en0`). NEVER "localhost" on the ESP32.
#define MQTT_SERVER      "192.168.1.100"
#define MQTT_USER        ""   // "" for the anonymous local-demo broker
#define MQTT_PASS        ""   // set when using infrastructure/mosquitto.secure.conf

// Optional P6 device authentication (HMAC-SHA256). "" disables it.
// Must equal DEVICE_HMAC_KEY in the backend .env.
#define DEVICE_HMAC_KEY  ""
