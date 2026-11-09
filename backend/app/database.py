"""SQLite persistence (readings, alerts, devices, settings, security events)."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node TEXT NOT NULL,
    seq INTEGER,
    device_ts REAL,
    received_at REAL NOT NULL,
    temp_c REAL,
    humidity REAL,
    simulated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_readings_node_time ON readings(node, received_at);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    device_event_id TEXT,
    node TEXT NOT NULL,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    value REAL,
    peak_value REAL,
    threshold REAL,
    state TEXT NOT NULL,
    source TEXT NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 0,
    triggered_at REAL NOT NULL,
    acknowledged_at REAL,
    resolved_at REAL,
    delivery_status TEXT,
    rtt_ms REAL,
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts(triggered_at);

CREATE TABLE IF NOT EXISTS devices (
    node TEXT PRIMARY KEY,
    first_seen REAL,
    last_seen REAL,
    last_seq INTEGER,
    msg_count INTEGER DEFAULT 0,
    simulated INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    node TEXT,
    topic TEXT,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    detail TEXT,
    blocked INTEGER NOT NULL DEFAULT 0,
    simulated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sec_time ON security_events(ts);
"""

ALERT_COLUMNS = (
    "id event_id device_event_id node type severity value peak_value threshold state source "
    "simulated triggered_at acknowledged_at resolved_at delivery_status rtt_ms note"
).split()


class Database:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.execute("PRAGMA journal_mode=WAL") if path != ":memory:" else None
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _exec(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def _all(self, sql: str, params: tuple | dict = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    # ---------------- readings ----------------
    def insert_reading(self, node, seq, device_ts, received_at, temp_c, humidity, simulated) -> int:
        return self._exec(
            "INSERT INTO readings(node,seq,device_ts,received_at,temp_c,humidity,simulated)"
            " VALUES (?,?,?,?,?,?,?)",
            (node, seq, device_ts, received_at, temp_c, humidity, int(simulated)),
        ).lastrowid

    def latest_readings(self) -> list[dict]:
        return self._all(
            "SELECT r.* FROM readings r JOIN (SELECT node, MAX(id) mid FROM readings GROUP BY node) m"
            " ON r.id = m.mid ORDER BY r.received_at DESC"
        )

    def history(self, node: Optional[str], seconds: float, max_points: int = 600) -> list[dict]:
        since = time.time() - seconds
        where, params = "received_at >= ?", [since]
        if node:
            where += " AND node = ?"
            params.append(node)
        count = self._all(f"SELECT COUNT(*) c FROM readings WHERE {where}", tuple(params))[0]["c"]
        if count <= max_points:
            return self._all(
                f"SELECT node, seq, received_at, temp_c, humidity, simulated FROM readings"
                f" WHERE {where} ORDER BY received_at",
                tuple(params),
            )
        bucket = seconds / max_points  # downsample by time-bucket averaging
        return self._all(
            f"SELECT node, MAX(seq) seq, AVG(received_at) received_at, AVG(temp_c) temp_c,"
            f" AVG(humidity) humidity, MAX(simulated) simulated FROM readings WHERE {where}"
            f" GROUP BY node, CAST((received_at - ?) / ? AS INTEGER) ORDER BY received_at",
            tuple(params + [since, bucket]),
        )

    def reading_count(self, node: Optional[str] = None) -> int:
        if node:
            return self._all("SELECT COUNT(*) c FROM readings WHERE node=?", (node,))[0]["c"]
        return self._all("SELECT COUNT(*) c FROM readings")[0]["c"]

    def prune_readings(self, older_than_s: float = 7 * 86400) -> None:
        self._exec("DELETE FROM readings WHERE received_at < ?", (time.time() - older_than_s,))

    # ---------------- alerts ----------------
    def insert_alert(self, **fields: Any) -> dict:
        cols = [c for c in fields if c in ALERT_COLUMNS and c != "id"]
        cur = self._exec(
            f"INSERT INTO alerts({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            tuple(int(fields[c]) if isinstance(fields[c], bool) else fields[c] for c in cols),
        )
        return self.get_alert(cur.lastrowid)

    def update_alert(self, alert_id: int, **fields: Any) -> dict:
        cols = [c for c in fields if c in ALERT_COLUMNS and c != "id"]
        if cols:
            self._exec(
                f"UPDATE alerts SET {','.join(c + '=?' for c in cols)} WHERE id=?",
                tuple(fields[c] for c in cols) + (alert_id,),
            )
        return self.get_alert(alert_id)

    def get_alert(self, alert_id: int) -> Optional[dict]:
        rows = self._all("SELECT * FROM alerts WHERE id=?", (alert_id,))
        return _alert_out(rows[0]) if rows else None

    def find_alert_by_event(self, event_id: str) -> Optional[dict]:
        rows = self._all(
            "SELECT * FROM alerts WHERE event_id=? OR device_event_id=?", (event_id, event_id)
        )
        return _alert_out(rows[0]) if rows else None

    def active_alerts(self) -> list[dict]:
        return [_alert_out(r) for r in self._all("SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY id")]

    def list_alerts(
        self,
        limit: int = 500,
        severity: Optional[str] = None,
        node: Optional[str] = None,
        since: Optional[float] = None,
        until: Optional[float] = None,
        q: Optional[str] = None,
    ) -> list[dict]:
        where, params = ["1=1"], []
        if severity:
            where.append("severity=?"); params.append(severity)
        if node:
            where.append("node=?"); params.append(node)
        if since:
            where.append("triggered_at>=?"); params.append(since)
        if until:
            where.append("triggered_at<=?"); params.append(until)
        if q:
            where.append("(event_id LIKE ? OR device_event_id LIKE ? OR node LIKE ? OR type LIKE ? OR state LIKE ?)")
            params += [f"%{q}%"] * 5
        params.append(limit)
        return [
            _alert_out(r)
            for r in self._all(
                f"SELECT * FROM alerts WHERE {' AND '.join(where)} ORDER BY triggered_at DESC LIMIT ?",
                tuple(params),
            )
        ]

    # ---------------- devices ----------------
    def upsert_device(self, node: str, seen_at: float, seq: Optional[int], simulated: bool) -> None:
        self._exec(
            "INSERT INTO devices(node, first_seen, last_seen, last_seq, msg_count, simulated)"
            " VALUES (?,?,?,?,1,?) ON CONFLICT(node) DO UPDATE SET last_seen=excluded.last_seen,"
            " last_seq=COALESCE(excluded.last_seq, last_seq), msg_count=msg_count+1",
            (node, seen_at, seen_at, seq, int(simulated)),
        )

    def devices(self) -> list[dict]:
        return self._all("SELECT * FROM devices ORDER BY node")

    # ---------------- settings ----------------
    def get_settings(self) -> dict:
        return {r["key"]: json.loads(r["value"]) for r in self._all("SELECT key, value FROM settings")}

    def save_settings(self, values: dict) -> None:
        for k, v in values.items():
            self._exec(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )

    # ---------------- security ----------------
    def insert_security_event(self, **f: Any) -> dict:
        cur = self._exec(
            "INSERT INTO security_events(ts,node,topic,kind,severity,detail,blocked,simulated)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (f["ts"], f.get("node"), f.get("topic"), f["kind"], f["severity"], f.get("detail"),
             int(f.get("blocked", False)), int(f.get("simulated", False))),
        )
        return self._all("SELECT * FROM security_events WHERE id=?", (cur.lastrowid,))[0]

    def security_events(self, limit: int = 200) -> list[dict]:
        return self._all("SELECT * FROM security_events ORDER BY id DESC LIMIT ?", (limit,))


def _alert_out(row: dict) -> dict:
    row = dict(row)
    row["simulated"] = bool(row["simulated"])
    end = row["resolved_at"] or time.time()
    row["duration_s"] = round(end - row["triggered_at"], 1)
    return row
