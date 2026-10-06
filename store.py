"""Local SQLite store. Everything fetched is kept, so history outlives tokens and outages."""
import json
import sqlite3
import threading
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily (       -- one value per local day per metric
  date TEXT NOT NULL,                    -- YYYY-MM-DD, user's local day
  metric TEXT NOT NULL,
  value REAL,
  extra TEXT,                            -- JSON: raw API point or breakdown
  updated_at REAL NOT NULL,
  PRIMARY KEY (date, metric)
);
CREATE TABLE IF NOT EXISTS series (      -- intraday buckets (hourly steps, 5-min heart rate)
  metric TEXT NOT NULL,
  ts TEXT NOT NULL,                      -- bucket start, UTC ISO-8601
  value REAL,
  extra TEXT,
  PRIMARY KEY (metric, ts)
);
CREATE TABLE IF NOT EXISTS sessions (    -- sleep and exercise, full API payload kept
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  local_date TEXT NOT NULL,              -- sleep: date woken up; exercise: start date
  start_ts TEXT NOT NULL,
  end_ts TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_kind_date ON sessions(kind, local_date);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sync_log (
  ts REAL NOT NULL, kind TEXT, ok INTEGER, calls INTEGER, message TEXT
);
"""


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()

    def _x(self, sql, args=()):
        with self.lock:
            return self.db.execute(sql, args)

    def tx(self):
        return _Tx(self)

    # ---- writes ------------------------------------------------------------
    def put_daily(self, date, metric, value, extra=None):
        self._x("INSERT INTO daily VALUES (?,?,?,?,?) ON CONFLICT(date, metric) DO UPDATE SET "
                "value=excluded.value, extra=excluded.extra, updated_at=excluded.updated_at",
                (date, metric, value, json.dumps(extra) if extra is not None else None, time.time()))

    def put_series(self, metric, ts, value, extra=None):
        self._x("INSERT INTO series VALUES (?,?,?,?) ON CONFLICT(metric, ts) DO UPDATE SET "
                "value=excluded.value, extra=excluded.extra",
                (metric, ts, value, json.dumps(extra) if extra is not None else None))

    def put_session(self, sid, kind, local_date, start_ts, end_ts, payload):
        self._x("INSERT INTO sessions VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "local_date=excluded.local_date, start_ts=excluded.start_ts, end_ts=excluded.end_ts, "
                "payload=excluded.payload, updated_at=excluded.updated_at",
                (sid, kind, local_date, start_ts, end_ts, json.dumps(payload), time.time()))

    def set_meta(self, key, value):
        self._x("INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)))

    def log(self, kind, ok, calls, message=""):
        self._x("INSERT INTO sync_log VALUES (?,?,?,?,?)", (time.time(), kind, int(ok), calls, message))
        self._x("DELETE FROM sync_log WHERE ts < ?", (time.time() - 30 * 86400,))

    # ---- reads -------------------------------------------------------------
    def meta(self, key, default=None):
        row = self._x("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def daily(self, start, end, metrics=None):
        sql = "SELECT date, metric, value, extra FROM daily WHERE date BETWEEN ? AND ?"
        args = [start, end]
        if metrics:
            sql += f" AND metric IN ({','.join('?' * len(metrics))})"
            args += list(metrics)
        return self._x(sql + " ORDER BY date", args).fetchall()

    def first_date(self):
        row = self._x("SELECT min(date) FROM daily").fetchone()
        return row[0] if row else None

    def series(self, metric, start_ts, end_ts):
        return self._x("SELECT ts, value, extra FROM series WHERE metric=? AND ts >= ? AND ts < ? ORDER BY ts",
                       (metric, start_ts, end_ts)).fetchall()

    def sessions(self, kind, start_date, end_date):
        rows = self._x("SELECT * FROM sessions WHERE kind=? AND local_date BETWEEN ? AND ? ORDER BY start_ts",
                       (kind, start_date, end_date)).fetchall()
        return [dict(r, payload=json.loads(r["payload"])) for r in rows]

    def last_log(self, n=10):
        return [dict(r) for r in self._x("SELECT * FROM sync_log ORDER BY ts DESC LIMIT ?", (n,)).fetchall()]


class _Tx:
    def __init__(self, store):
        self.s = store

    def __enter__(self):
        self.s.lock.acquire()
        self.s.db.execute("BEGIN")
        return self.s

    def __exit__(self, exc_type, *_):
        try:
            self.s.db.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.s.lock.release()
