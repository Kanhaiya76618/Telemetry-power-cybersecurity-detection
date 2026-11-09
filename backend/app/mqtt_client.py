"""Paho MQTT bridge (runs paho's network loop in its own thread, hands messages to asyncio).

Topics (PDF):  <prefix>/<node>/telemetry  QoS 0
               <prefix>/<node>/emergency  QoS 1
               <prefix>/<node>/ack        QoS 1   (published by this backend)
Extra:         <prefix>/<node>/config     QoS 1 retained (threshold sync to the ESP32)
               <prefix>/_probe/<client>   QoS 1   (broker round-trip probe, monotonic clock)

Moving to the Anubhav private-5G / MEC deployment only changes MQTT_HOST/PORT/credentials.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from typing import Callable, Optional

import paho.mqtt.client as mqtt

from .config import Config

log = logging.getLogger("mqtt")


class MqttBridge:
    def __init__(self, cfg: Config, loop: asyncio.AbstractEventLoop,
                 on_message: Callable[[str, bytes, float], None],
                 on_status: Callable[[], None]):
        self.cfg = cfg
        self.loop = loop
        self._on_message = on_message
        self._on_status = on_status
        self.connected = False
        self.last_error: Optional[str] = None
        self.connects = 0
        self.disconnects = 0
        self.rx = 0
        self.tx = 0
        self.connected_since: Optional[float] = None
        self._probe_sent: dict[int, float] = {}
        self._probe_seq = 0
        self.probe_rtts: deque = deque(maxlen=50)
        self.probe_lost = 0
        self.probe_total = 0
        p = cfg.topic_prefix
        self.probe_topic = f"{p}/_probe/{cfg.mqtt_client_id}"

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=cfg.mqtt_client_id,
                                  clean_session=True)
        if cfg.mqtt_username:
            self.client.username_pw_set(cfg.mqtt_username, cfg.mqtt_password)
        self.client.reconnect_delay_set(min_delay=1, max_delay=15)
        self.client.on_connect = self._handle_connect
        self.client.on_disconnect = self._handle_disconnect
        self.client.on_message = self._handle_message

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        log.info("connecting to mqtt://%s:%s", self.cfg.mqtt_host, self.cfg.mqtt_port)
        self.client.connect_async(self.cfg.mqtt_host, self.cfg.mqtt_port, keepalive=15)
        self.client.loop_start()  # paho handles automatic reconnection

    def stop(self) -> None:
        try:
            self.client.disconnect()
        finally:
            self.client.loop_stop()

    # ------------------------------------------------------------------ callbacks (paho thread)
    def _handle_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            self.connected = False
            self.last_error = f"connect refused: {reason_code}"
            log.error(self.last_error)
        else:
            self.connected = True
            self.connects += 1
            self.connected_since = time.time()
            self.last_error = None
            p = self.cfg.topic_prefix
            client.subscribe([(f"{p}/+/telemetry", 0), (f"{p}/+/emergency", 1), (self.probe_topic, 1)])
            log.info("mqtt connected, subscribed to %s/+/telemetry|emergency", p)
        self.loop.call_soon_threadsafe(self._on_status)

    def _handle_disconnect(self, client, userdata, flags, reason_code, properties):
        self.connected = False
        self.disconnects += 1
        self.connected_since = None
        if reason_code != 0:
            self.last_error = f"disconnected: {reason_code}"
            log.warning("mqtt %s — paho will auto-reconnect", self.last_error)
        self.loop.call_soon_threadsafe(self._on_status)

    def _handle_message(self, client, userdata, msg):
        received = time.monotonic()
        if msg.topic == self.probe_topic:
            try:
                seq = int(json.loads(msg.payload)["probe"])
                sent = self._probe_sent.pop(seq, None)
                if sent is not None:
                    self.probe_rtts.append((received - sent) * 1000)
            except Exception:  # noqa: BLE001
                pass
            return
        self.rx += 1
        self.loop.call_soon_threadsafe(self._on_message, msg.topic, bytes(msg.payload), received)

    # ------------------------------------------------------------------ publishing
    def publish(self, topic: str, payload: dict, qos: int = 1, retain: bool = False) -> bool:
        if not self.connected:
            return False
        info = self.client.publish(topic, json.dumps(payload), qos=qos, retain=retain)
        self.tx += 1
        return info.rc == mqtt.MQTT_ERR_SUCCESS

    def send_ack(self, node: str, payload: dict) -> bool:
        return self.publish(f"{self.cfg.topic_prefix}/{node}/ack", payload, qos=1)

    def send_config(self, node: str, payload: dict) -> bool:
        return self.publish(f"{self.cfg.topic_prefix}/{node}/config", payload, qos=1, retain=True)

    def probe(self) -> None:
        """Publish a QoS1 message to ourselves and time the round trip (monotonic clock)."""
        if not self.connected:
            return
        now = time.monotonic()
        for s, t in list(self._probe_sent.items()):  # expire unanswered probes after 5 s
            if now - t > 5:
                self._probe_sent.pop(s, None)
                self.probe_lost += 1
        self._probe_seq += 1
        self._probe_sent[self._probe_seq] = now
        self.probe_total += 1
        self.client.publish(self.probe_topic, json.dumps({"probe": self._probe_seq}), qos=1)

    def status(self) -> dict:
        rtts = list(self.probe_rtts)
        return {
            "enabled": True,
            "connected": self.connected,
            "host": self.cfg.mqtt_host,
            "port": self.cfg.mqtt_port,
            "authenticated": bool(self.cfg.mqtt_username),
            "connected_since": self.connected_since,
            "connects": self.connects,
            "disconnects": self.disconnects,
            "messages_rx": self.rx,
            "messages_tx": self.tx,
            "last_error": self.last_error,
            "broker_rtt_ms_last": round(rtts[-1], 2) if rtts else None,
            "broker_rtt_ms_avg": round(sum(rtts) / len(rtts), 2) if rtts else None,
            "probe_loss_pct": round(100 * self.probe_lost / self.probe_total, 1) if self.probe_total > 5 else None,
        }
