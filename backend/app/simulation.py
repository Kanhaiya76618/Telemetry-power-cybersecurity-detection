"""Demo simulation: synthetic DHT11-like readings fed through the SAME pipeline as real data.

Simulated readings use a dedicated node id (default ``node1-sim``) and are stored/broadcast
with ``simulated=true`` so they can never be mistaken for real ESP32 data.
"""
from __future__ import annotations

import asyncio
import random
from typing import Awaitable, Callable, Optional


class Simulator:
    def __init__(self, node: str, emit: Callable[[str, float, float, int], Awaitable[None]],
                 interval: float = 1.0):
        self.node = node
        self.emit = emit
        self.interval = interval
        self.running = False
        self.temp = 28.0
        self.target = 28.0
        self.humidity = 60.0
        self.seq = 0
        self._task: Optional[asyncio.Task] = None
        self._rnd = random.Random()

    def status(self) -> dict:
        return {"running": self.running, "node": self.node, "temp_c": round(self.temp, 1),
                "target_c": round(self.target, 1), "humidity": round(self.humidity, 1),
                "interval_s": self.interval}

    async def start(self) -> None:
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def command(self, action: str, value: Optional[float] = None, step: float = 2.0, critical: float = 45.0):
        if action == "set":
            self.target = self.temp = float(value)
        elif action == "increase":
            self.target = self.temp = self.temp + step
        elif action == "decrease":
            self.target = self.temp = self.temp - step
        elif action == "trigger":
            self.target = self.temp = critical + 1.5
        elif action == "reset":
            self.target = self.temp = 28.0
            self.humidity = 60.0

    def tick(self) -> tuple[float, float]:
        # drift toward target, tiny sensor noise (DHT11 resolution ~0.1 °C)
        self.temp += (self.target - self.temp) * 0.3 + self._rnd.gauss(0, 0.08)
        self.humidity = min(95.0, max(20.0, self.humidity + self._rnd.gauss(0, 0.4)
                                      - (self.temp - 28) * 0.02))
        self.seq += 1
        return round(self.temp, 1), round(self.humidity, 1)

    async def _run(self) -> None:
        while self.running:
            t, h = self.tick()
            await self.emit(self.node, t, h, self.seq)
            await asyncio.sleep(self.interval)
