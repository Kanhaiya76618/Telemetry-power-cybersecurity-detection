# Hardware wiring

**Assumption:** a common 3-pin DHT11 *module* (sensor on a small PCB with pull-up resistor). Pin order differs between vendors, so always follow the labels printed on your module (`+`/`VCC`, `OUT`/`S`/`DATA`, `-`/`GND`).

| DHT11 module | ESP32 dev board |
|---|---|
| VCC / + | 3V3 |
| DATA / OUT / S | GPIO4 |
| GND / − | GND |

- Bare 4-pin DHT11 (no PCB): pin 1 VCC, pin 2 DATA, pin 3 not connected, pin 4 GND, plus a **10 kΩ pull-up** from DATA to 3V3.
- Use 3V3, not 5V, so DATA stays at ESP32-safe logic levels.
- Avoid GPIO 6–11 (flash) and strapping pins 0, 2, 12, 15 for the sensor.
- DHT11 range: 0–50 °C ±2 °C, 20–90 % RH ±5 %, max ~1 sample/s (firmware uses 2 s).
- To change the pin, edit `DHT_PIN` in the sketch.

## Future: Anubhav 5G board

```
ESP32 + DHT11 ──UART/USB/Ethernet (whatever the board supports)──► Anubhav 5G board ──► private 5G ──► MEC (Mosquitto + backend)
```

Only `MQTT_SERVER`/`MQTT_HOST` change if the 5G board provides IP connectivity. A UART bridge would need a small serial-to-MQTT forwarder on the 5G board.
