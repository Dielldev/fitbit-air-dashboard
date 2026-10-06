"""Local Fitbit Air dashboard. Run: python3 server.py  ->  http://127.0.0.1:8787

Serves the web UI and a small JSON API from the local SQLite store, and keeps the
store fresh in the background:
  * every 2 min: two cheap calls to see if Google has anything new (device sync time, today's steps)
  * if it has (or 60 min passed): a full pull of the recent window
"""
import csv
import hmac
import io
import json
import mimetypes
import os
import secrets
import statistics
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from healthapi import ApiError, Auth, AuthRequired, Client
from store import Store
from sync import Syncer, parse_ts

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DASH_DATA", ROOT / "data"))
WEB = ROOT / "web"
HOST = "127.0.0.1"
PORT = int(os.environ.get("DASH_PORT", 8787))
PROBE_EVERY = 2 * 60
FULL_EVERY = 60 * 60

DEFAULT_GOALS = {"name": "", "steps": 10000, "sleep_hours": 8, "azm_week": 150, "active_minutes": 30}


def goals():
    p = DATA / "goals.json"
    if not p.exists():
        p.write_text(json.dumps(DEFAULT_GOALS, indent=2))
    try:
        return {**DEFAULT_GOALS, **json.loads(p.read_text())}
    except ValueError:
        return DEFAULT_GOALS


def widget_secret():
    """Key the desktop widget sends to /api/widget. Delete data/widget_secret and restart to rotate it."""
    p = DATA / "widget_secret"
    if not p.exists():
        try:
            with os.fdopen(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
                f.write(secrets.token_urlsafe(32) + "\n")
        except FileExistsError:
            pass
    return p.read_text().strip()


DATA.mkdir(parents=True, exist_ok=True)
os.chmod(DATA, 0o700)  # health data and tokens: readable by you only
WIDGET_SECRET = widget_secret()
auth = Auth(DATA)
client = Client(auth)
store = Store(DATA / "health.db")
syncer = Syncer(client, store)
wake = threading.Event()
state = {"next_probe_at": None, "force": False}


# ---------------------------------------------------------------- scheduler --
def scheduler():
    first = True
    while True:
        try:
            if auth.status()["connected"]:
                due_full = time.time() - (store.meta("last_ok_at") or 0) > FULL_EVERY
                if first or state["force"] or due_full:
                    state["force"] = False
                    syncer.run("startup" if first else ("manual" if not due_full else "hourly"))
                elif syncer.has_new_data():
                    syncer.run("new-data")
                first = False
        except AuthRequired:
            pass  # UI shows the reconnect banner; nothing to do until the user signs in
        except Exception as e:
            print(f"[sync] {type(e).__name__}: {e}", file=sys.stderr)
        state["next_probe_at"] = time.time() + PROBE_EVERY
        wake.wait(PROBE_EVERY)
        wake.clear()


def request_sync():
    state["force"] = True
    wake.set()


# ------------------------------------------------------------ dashboard data --
def _num(x):
    return None if x is None else (round(x, 2) if isinstance(x, float) else x)


def build_dashboard(days, on=None):
    tz = syncer.tz()
    now = datetime.now(tz)
    today = now.date()
    try:
        sel = min(date.fromisoformat(on), today) if on else today
    except ValueError:
        sel = today
    is_today = sel == today
    days = max(7, min(int(days), 365))
    g = goals()
    settings = store.meta("settings") or {}
    first = store.first_date()
    first_d = date.fromisoformat(first) if first else today
    start = max(today - timedelta(days=days - 1), first_d)  # days before the Air existed aren't "missing"

    rows = store.daily(min(start, sel - timedelta(days=60), today - timedelta(days=14)).isoformat(), today.isoformat())
    by_metric, extras = {}, {}
    for r in rows:
        by_metric.setdefault(r["metric"], {})[r["date"]] = r["value"]
        if r["metric"] == "sleep" and r["extra"]:
            extras.setdefault("sleep", {})[r["date"]] = json.loads(r["extra"])

    def val(metric, d):
        return by_metric.get(metric, {}).get(d.isoformat() if isinstance(d, date) else d)

    def window(metric, end, n):
        return [_num(val(metric, end - timedelta(days=n - 1 - i))) for i in range(n)]

    def latest(metric, within):
        # Overnight metrics land hours after waking, so "today" may fall back a day or two.
        # A past day shows only its own value.
        for i in range(within if is_today else 1):
            d = sel - timedelta(days=i)
            v = val(metric, d)
            if v is not None:
                return d.isoformat(), v
        return None, None

    def baseline(metric, end_exclusive, n=30):
        """Personal normal: mean and sd over the previous n days with data (missing days skipped, never zero)."""
        vals = [v for d, v in by_metric.get(metric, {}).items()
                if (end_exclusive - timedelta(days=n)).isoformat() <= d < end_exclusive.isoformat() and v is not None]
        if len(vals) < 3:
            return {"n": len(vals)}
        return {"n": len(vals), "mean": statistics.fmean(vals), "sd": statistics.pstdev(vals)}

    # ---- the selected day ----------------------------------------------------------
    day0 = datetime.combine(sel, datetime.min.time(), tz)
    day1 = datetime.combine(sel + timedelta(days=1), datetime.min.time(), tz)
    utc = lambda dt: dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    steps_h = [{"ts": r["ts"], "v": r["value"]} for r in store.series("steps_h", utc(day0), utc(day1))]
    hr = [{"ts": r["ts"], "v": round(r["value"], 1), **(json.loads(r["extra"]) if r["extra"] else {})}
          for r in store.series("hr_5m", utc(day0), utc(day1))]

    # Your usual day, from the 14 days before: hourly steps (days without data skipped, not zero).
    per_day = {}
    for p in store.series("steps_h", utc(day0 - timedelta(days=14)), utc(day0)):
        t = parse_ts(p["ts"]).astimezone(tz)
        per_day.setdefault(t.date(), [0.0] * 24)[t.hour] += p["value"]
    typical_by_hour = [round(statistics.fmean(h[i] for h in per_day.values())) for i in range(24)] if per_day else []
    usual = None
    if is_today and len(per_day) >= 3:
        usual = round(statistics.fmean(sum(h[:now.hour]) + h[now.hour] * now.minute / 60 for h in per_day.values()))

    week_azm = window("azm", sel, 7)
    act = {k: val(f"active_{k}", sel) for k in ("light", "moderate", "vigorous")}
    day_block = {
        "date": sel.isoformat(), "is_today": is_today,
        "day_start": day0.timestamp() * 1000, "day_end": day1.timestamp() * 1000,
        "steps": val("steps", sel), "steps_usual_by_now": usual,
        "distance_km": _num(val("distance_km", sel)), "calories": _num(val("calories", sel)),
        "azm": val("azm", sel),
        "azm_week": sum(v for v in week_azm if v) if any(v is not None for v in week_azm) else None,
        "active": act,
        "hr_min": val("hr_min", sel), "hr_max": val("hr_max", sel), "hr_avg": _num(val("hr_avg", sel)),
        "sedentary": val("sedentary", sel), "sit_longest": val("sit_longest", sel),
        "steps_hourly": steps_h, "steps_typical_by_hour": typical_by_hour, "hr": hr,
    }

    # ---- sleep: the night ending on the selected day -----------------------------------
    sleep_date, sleep_min = latest("sleep", 2)
    sleep_block = None
    if sleep_date:
        x = extras.get("sleep", {}).get(sleep_date, {})
        sess = next((s for s in store.sessions("sleep", sleep_date, sleep_date) if s["id"] == x.get("id")), None)
        stages = [{"type": st.get("type"), "start": st["startTime"], "end": st["endTime"]}
                  for st in ((sess or {}).get("payload", {}).get("sleep", {}).get("stages") or [])
                  if st.get("startTime") and st.get("endTime")]
        prev = [v for d, v in by_metric.get("sleep", {}).items()
                if (date.fromisoformat(sleep_date) - timedelta(days=7)).isoformat() <= d < sleep_date]
        sleep_block = {
            "date": sleep_date, "minutes": sleep_min, "on_selected": sleep_date == sel.isoformat(),
            "start": x.get("start"), "end": x.get("end"), "inBed": x.get("inBed"),
            "stages_summary": x.get("stages") or {}, "efficiency": val("sleep_eff", sleep_date),
            "avg7": round(statistics.fmean(prev)) if len(prev) >= 3 else None,
            "nap": val("nap", sel), "timeline": stages,
        }

    # ---- overnight vitals vs personal normal -------------------------------------------
    specs = [
        ("rhr", "Resting heart rate", "bpm", 0, "lower"),
        ("hrv", "Heart rate variability", "ms", 0, "higher"),
        ("resp_rate", "Breathing rate", "br/min", 1, "neutral"),
        ("spo2", "Blood oxygen", "%", 1, "neutral"),
        ("temp_delta", "Skin temperature", "°C", 1, "neutral"),
    ]
    recovery = []
    for key, label, unit, dp, better in specs:
        d, v = latest(key, 3)
        b = baseline(key, date.fromisoformat(d) if d else sel)
        recovery.append({"key": key, "label": label, "unit": unit, "dp": dp, "better": better,
                         "date": d, "value": _num(v), "baseline": {k: _num(x) for k, x in b.items()},
                         "spark": window(key, sel, 14)})
    vo2_d, vo2 = None, None
    for i in range(30):
        v = val("vo2max", sel - timedelta(days=i))
        if v is not None:
            vo2_d, vo2 = (sel - timedelta(days=i)).isoformat(), v
            break

    # ---- streak strip: last 14 days ending today ---------------------------------------
    strip = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        s = val("steps", d)
        strip.append({"date": d.isoformat(), "steps": s, "met": s is not None and s >= g["steps"],
                      "has_data": d >= first_d})
    streak = 0
    for item in reversed(strip[:-1] if not strip[-1]["met"] else strip):  # today still counts once it's met
        if not item["met"]:
            break
        streak += 1

    # ---- the 7 days ending on the selected day, and 14-day minis -------------------------
    week = [{"date": (sel - timedelta(days=6 - i)).isoformat(), "steps": val("steps", sel - timedelta(days=6 - i))}
            for i in range(7)]
    recent_dates = [(sel - timedelta(days=13 - i)).isoformat() for i in range(14)]
    recent = {m: window(m, sel, 14) for m in ("rhr", "hrv", "sleep", "sedentary", "azm", "steps")}

    # ---- trends range (ends today) -------------------------------------------------------
    dates = [(start + timedelta(days=i)).isoformat() for i in range((today - start).days + 1)]
    trend_metrics = ["steps", "sleep", "rhr", "hrv", "azm", "calories", "distance_km", "sedentary",
                     "spo2", "resp_rate", "temp_delta"]
    series = {m: [_num(val(m, d)) for d in dates] for m in trend_metrics}

    workouts = []
    for s in reversed(store.sessions("exercise", start.isoformat(), today.isoformat())[-20:]):
        ex = s["payload"].get("exercise", {})
        ms = ex.get("metricsSummary") or {}
        workouts.append({
            "date": s["local_date"], "start": s["start_ts"],
            "minutes": round((parse_ts(s["end_ts"]) - parse_ts(s["start_ts"])).total_seconds() / 60),
            "type": ex.get("displayName") or (ex.get("exerciseType") or "Workout").replace("_", " ").title(),
            "calories": _num(ms.get("caloriesKcal")),
            "distance_km": round(float(ms["distanceMillimeters"]) / 1e6, 2) if ms.get("distanceMillimeters") else None,
            "avg_hr": float(ms["averageHeartRateBeatsPerMinute"]) if ms.get("averageHeartRateBeatsPerMinute") else None,
            "azm": float(ms["activeZoneMinutes"]) if ms.get("activeZoneMinutes") else None,
        })

    return {
        # The page passes tz to Intl, which only accepts IANA names ("Europe/Berlin", not "CEST").
        "now": now.isoformat(), "today": today.isoformat(), "tz": getattr(tz, "key", None), "goals": g,
        "units": {"distance": settings.get("distanceUnit"), "temperature": settings.get("temperatureUnit")},
        "status": status_block(),
        "day": day_block, "sleep": sleep_block, "recovery": recovery,
        "vo2max": {"date": vo2_d, "value": _num(vo2)},
        "strip": {"days": strip, "streak": streak},
        "week": week, "recent": {"dates": recent_dates, **recent},
        "range": {"days": days, "dates": dates, "series": series, "first_date": first},
        "workouts": workouts,
    }


def build_widget():
    """Today at a glance for the Übersicht widget: the dashboard's own numbers, trimmed to a short allowlist.
    Nothing here identifies the Google account or carries a token."""
    d = build_dashboard(7)
    day, g, st = d["day"], d["goals"], d["status"]
    rhr = next((r for r in d["recovery"] if r["key"] == "rhr"), {})
    last = day["hr"][-1] if day["hr"] else None
    sl = d["sleep"]
    units = d["units"]
    fahrenheit = "FAHRENHEIT" in (units.get("temperature") or "")
    miles = "MILES" in (units.get("distance") or "")

    # Normal / High / Low against your own 30-day normal, with the dashboard's minimum bands.
    bands = {"rhr": 2, "hrv": 4, "resp_rate": 0.6, "spo2": 1, "temp_delta": 0.5 if fahrenheit else 0.3}

    def vital(r):
        v, b, unit = r["value"], r["baseline"], r["unit"]
        mean, sd = b.get("mean"), b.get("sd")
        if r["key"] == "temp_delta" and fahrenheit:  # a temperature difference: scale only, no offset
            v, mean, sd = (None if x is None else x * 1.8 for x in (v, mean, sd))
            unit = "°F"
        band = max(sd or 0, bands[r["key"]]) if mean is not None else None
        status = (None if v is None else "learning" if mean is None
                  else "normal" if abs(v - mean) <= band else "high" if v > mean else "low")
        return {"value": _num(v), "unit": unit, "dp": r["dp"], "date": r["date"], "normal": _num(mean),
                "band": _num(band), "status": status, "nights": b.get("n", 0)}

    rec = {r["key"]: r for r in d["recovery"]}
    act = day["active"]
    active = None if act["moderate"] is None and act["vigorous"] is None else (act["moderate"] or 0) + (act["vigorous"] or 0)
    km = day["distance_km"]
    return {
        "v": 1, "now": d["now"], "date": day["date"],
        "steps": {"value": day["steps"], "goal": g["steps"], "usual_by_now": day["steps_usual_by_now"]},
        "heart": {"resting": rhr.get("value"), "resting_date": rhr.get("date"),
                  "latest": last["v"] if last else None, "latest_at": last["ts"] if last else None,
                  "min": day["hr_min"], "max": day["hr_max"]},
        "sleep": sl and {"minutes": sl["minutes"], "date": sl["date"], "start": sl["start"], "end": sl["end"],
                         "goal_minutes": round(g["sleep_hours"] * 60)},
        "activity": {"sitting_min": day["sedentary"], "sitting_longest_min": day["sit_longest"],
                     "azm": day["azm"], "azm_week": day["azm_week"], "azm_goal": g["azm_week"],
                     "active_min": active, "active_goal": g["active_minutes"],
                     "distance": None if km is None else round(km * 0.621371 if miles else km, 2),
                     "distance_unit": "mi" if miles else "km", "calories": day["calories"]},
        "vitals": {"rhr": vital(rec["rhr"]), "hrv": vital(rec["hrv"]), "breathing": vital(rec["resp_rate"]),
                   "spo2": vital(rec["spo2"]), "skin_temp": vital(rec["temp_delta"]),
                   "vo2max": {"value": d["vo2max"]["value"], "unit": "ml/kg/min", "dp": 0, "date": d["vo2max"]["date"]}},
        "sync": {"air_last_sync": st["device"]["last_sync"], "pulled_at": st["last_ok_at"],
                 "google_connected": st["auth"]["connected"],
                 "login_expires_at": st["auth"].get("refresh_expires_at"), "syncing": st["running"]},
    }


def status_block():
    dev = store.meta("device") or {}
    return {
        "auth": auth.status(),
        "device": {"name": dev.get("deviceVersion"), "battery": dev.get("batteryLevel"),
                   "battery_status": dev.get("batteryStatus"), "last_sync": dev.get("lastSyncTime")},
        "last_ok_at": store.meta("last_ok_at"),
        "last_run_at": store.meta("last_run_at"),
        "last_error": store.meta("last_error"),
        "running": syncer.running,
        "next_probe_at": state["next_probe_at"],
        "probe_every": PROBE_EVERY,
    }


def export_csv():
    rows = store.daily("0000-01-01", "9999-12-31")
    metrics = sorted({r["metric"] for r in rows})
    table = {}
    for r in rows:
        table.setdefault(r["date"], {})[r["metric"]] = r["value"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date"] + metrics)
    for d in sorted(table):
        w.writerow([d] + [("" if table[d].get(m) is None else round(table[d][m], 3)) for m in metrics])
    return buf.getvalue()


# ------------------------------------------------------------------- HTTP ----
class Handler(BaseHTTPRequestHandler):
    server_version = "AirDash/1.0"

    def log_message(self, fmt, *args):
        pass

    def _host_ok(self):
        # Refuse requests whose Host isn't us (blocks DNS-rebinding pages from reading health data).
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def _widget_key_ok(self):
        # Header only (never a query string), so the key stays out of URLs, logs and process lists.
        given = self.headers.get("Authorization") or ""
        return given.startswith("Bearer ") and hmac.compare_digest(given[7:].strip().encode(), WIDGET_SECRET.encode())

    def _send(self, code, body, ctype="application/json", headers=None):
        data = body if isinstance(body, bytes) else (body.encode() if isinstance(body, str) else json.dumps(body).encode())
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.end_headers()

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        try:
            if u.path == "/" and "code" in q:            # OAuth redirect lands here
                auth.complete(q["code"], q.get("state", ""))
                request_sync()
                return self._redirect("/")
            if u.path == "/" and "error" in q:
                return self._send(400, f"Google sign-in was cancelled or failed: {q['error']}. <a href='/'>Back</a>",
                                  "text/html; charset=utf-8")
            if u.path == "/auth/login":
                return self._redirect(auth.login_url(f"http://{HOST}:{PORT}/"))
            if u.path == "/api/widget":
                if not self._widget_key_ok():
                    return self._send(401, {"error": "unauthorized"}, headers={"WWW-Authenticate": "Bearer"})
                return self._send(200, build_widget())
            if u.path == "/api/dashboard":
                return self._send(200, build_dashboard(q.get("days", 30), q.get("date")))
            if u.path == "/api/status":
                return self._send(200, status_block())
            if u.path == "/api/export.csv":
                return self._send(200, export_csv(), "text/csv; charset=utf-8",
                                  {"Content-Disposition": "attachment; filename=fitbit-air-daily.csv"})
            return self._static(u.path)
        except AuthRequired as e:
            return self._send(401, {"error": "auth", "message": str(e)})
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"error": type(e).__name__, "message": str(e)})

    def do_POST(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        if self.path == "/api/sync":
            if not auth.status()["connected"]:
                return self._send(401, {"error": "auth"})
            request_sync()
            return self._send(202, {"ok": True})
        return self._send(404, {"error": "not found"})

    def _static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        f = (WEB / rel).resolve()
        if not str(f).startswith(str(WEB.resolve())) or not f.is_file():
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        return self._send(200, f.read_bytes(), ctype)


def main():
    if not os.environ.get("DASH_NO_SYNC"):  # DASH_NO_SYNC=1 serves the stored data without calling Google
        threading.Thread(target=scheduler, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print(f"Fitbit Air dashboard → {url}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
