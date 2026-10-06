"""Made-up data to try the dashboard (and take screenshots) without a Fitbit or a Google login.

    python3 demo.py
    DASH_DATA=demo-data DASH_NO_SYNC=1 python3 server.py

Writes 90 days of plausible steps, heart rate, sleep and vitals into ./demo-data. Nothing here is real.
"""
import json
import math
import random
import shutil
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from store import Store

OUT = Path(__file__).resolve().parent / "demo-data"
DAYS = 90
rnd = random.Random(7)
tz = datetime.now().astimezone().tzinfo
now = datetime.now(tz)
today = now.date()


def utc(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local(d, hour, minute=0):
    return datetime.combine(d, datetime.min.time(), tz) + timedelta(hours=hour, minutes=minute)


# Share of a day's steps in each hour: a morning walk, lunch, an evening peak.
SHAPE = [0, 0, 0, 0, 0, 0, 1, 6, 9, 5, 4, 5, 8, 6, 4, 4, 5, 8, 10, 9, 6, 4, 2, 1]


def hourly(total):
    w = [s * rnd.uniform(0.6, 1.4) for s in SHAPE]
    return [round(total * x / sum(w)) for x in w]


def sleep_night(d, store):
    """The night that ends on day d: stages in ~90-minute cycles, deeper early, more REM late."""
    bed = local(d - timedelta(days=1), 23, rnd.randint(-40, 35))
    t, stages, cycle = bed + timedelta(minutes=rnd.randint(6, 18)), [], 0
    end = local(d, 6, rnd.randint(35, 75))
    stages.append(("AWAKE", bed, t))
    while t < end - timedelta(minutes=20):
        plan = [("LIGHT", rnd.randint(25, 40)), ("DEEP", max(5, rnd.randint(18, 32) - cycle * 6)),
                ("LIGHT", rnd.randint(10, 20)), ("REM", rnd.randint(10, 18) + cycle * 6)]
        if rnd.random() < 0.35:
            plan.append(("AWAKE", rnd.randint(2, 6)))
        for kind, m in plan:
            e = min(t + timedelta(minutes=m), end)
            if e > t:
                stages.append((kind, t, e))
            t = e
        cycle += 1
    stages.append(("AWAKE", t, end))
    summary = {}
    for kind, a, b in stages:
        summary[kind] = summary.get(kind, 0) + (b - a).total_seconds() / 60
    in_bed = (end - bed).total_seconds() / 60
    asleep = in_bed - summary.get("AWAKE", 0)
    sid = f"demo-sleep-{d.isoformat()}"
    off = f"{int(bed.utcoffset().total_seconds())}s"
    payload = {"name": sid, "sleep": {
        "type": "STAGES",
        "interval": {"startTime": utc(bed), "endTime": utc(end), "startUtcOffset": off, "endUtcOffset": off},
        "stages": [{"type": k, "startTime": utc(a), "endTime": utc(b)} for k, a, b in stages],
        "summary": {"minutesAsleep": asleep, "minutesInSleepPeriod": in_bed,
                    "stagesSummary": [{"type": k, "minutes": round(v)} for k, v in summary.items()]}}}
    store.put_session(sid, "sleep", d.isoformat(), utc(bed), utc(end), payload)
    store.put_daily(d.isoformat(), "sleep", round(asleep), {
        "id": sid, "type": "STAGES", "start": utc(bed), "end": utc(end), "startOffset": off, "endOffset": off,
        "stages": {k: round(v) for k, v in summary.items()}, "inBed": round(in_bed), "toFallAsleep": 12})
    store.put_daily(d.isoformat(), "sleep_eff", round(100 * asleep / in_bed, 1))
    for k, v in summary.items():
        store.put_daily(d.isoformat(), f"sleep_{k.lower()}", round(v))
    store.put_daily(d.isoformat(), "bedtime", bed.hour * 60 + bed.minute - (1440 if bed.hour >= 12 else 0))
    store.put_daily(d.isoformat(), "waketime", end.hour * 60 + end.minute)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(mode=0o700)
    store = Store(OUT / "health.db")
    # The server needs an OAuth client and a login to start; these are placeholders that never reach Google.
    (OUT / "client_secret.json").write_text(json.dumps({"installed": {"client_id": "demo", "client_secret": "demo"}}))
    (OUT / "auth.json").write_text(json.dumps({
        "access_token": "demo", "refresh_token": "demo", "access_expires_at": time.time() + 86400 * 30,
        "login_at": time.time() - 2 * 86400, "refresh_expires_at": time.time() + 5 * 86400, "source": "demo"}))
    (OUT / "goals.json").write_text(json.dumps(
        {"name": "Alex", "steps": 10000, "sleep_hours": 8, "azm_week": 150, "active_minutes": 30}, indent=2))

    with store.tx():
        for i in range(DAYS, -1, -1):
            d = today - timedelta(days=i)
            ds = d.isoformat()
            weekend = d.weekday() >= 5
            trend = 1 + 0.12 * (1 - i / DAYS)                       # slowly getting more active
            steps = max(2500, round(rnd.gauss(8800 if weekend else 10200, 2300) * trend))
            if 1 <= i <= 6:                                        # a current streak worth a flame or six
                steps = max(steps, rnd.randint(10300, 13200))
            hours = hourly(steps)
            if d == today:                                         # only the hours so far, a bit ahead of usual
                hours = [h if k < now.hour else round(h * now.minute / 60) if k == now.hour else 0
                         for k, h in enumerate(hourly(round(steps * 1.08)))]
                steps = sum(hours)
            if i <= 15:
                for k, v in enumerate(hours):
                    if v:
                        store.put_series("steps_h", utc(local(d, k)), v)
            store.put_daily(ds, "steps", steps)
            store.put_daily(ds, "distance_km", round(steps * 0.00076, 3))
            store.put_daily(ds, "calories", round(1850 + steps * 0.045 + rnd.uniform(-60, 60)))
            vig = rnd.choice([0, 0, 0, 0, 6, 9, 12]) if d != today else 9
            mod = rnd.randint(2, 12)
            store.put_daily(ds, "active_vigorous", vig)
            store.put_daily(ds, "active_moderate", mod)
            store.put_daily(ds, "active_light", rnd.randint(150, 260))
            store.put_daily(ds, "azm", mod + 2 * vig)
            store.put_daily(ds, "sedentary", rnd.randint(380, 560) if d != today else 312)
            store.put_daily(ds, "sit_longest", rnd.randint(55, 140) if d != today else 74)
            store.put_daily(ds, "hr_min", rnd.randint(50, 55))
            store.put_daily(ds, "hr_max", rnd.randint(128, 168) if vig else rnd.randint(105, 125))
            store.put_daily(ds, "hr_avg", round(rnd.uniform(68, 76), 1))
            # Overnight vitals, with one recent rough night so the dashboard has something to flag.
            rough = i == 9
            store.put_daily(ds, "rhr", round(rnd.gauss(57, 0.8) + (4 if rough else 0)))
            store.put_daily(ds, "hrv", round(rnd.gauss(46, 2.5) - (9 if rough else 0) + (1 - i / DAYS) * 3))
            store.put_daily(ds, "resp_rate", round(rnd.gauss(14.6, 0.25), 1))
            store.put_daily(ds, "spo2", round(rnd.gauss(96.6, 0.35), 1))
            store.put_daily(ds, "temp_delta", round(rnd.gauss(0, 0.12) + (0.5 if rough else 0), 2))
            if i % 7 == 3:
                store.put_daily(ds, "vo2max", round(44 + (1 - i / DAYS) * 1.5, 1))
            sleep_night(d, store)
            if vig and i % 2 == 0:
                start = local(d, 7, 10)
                km = round(rnd.uniform(4.5, 8), 2)
                store.put_session(f"demo-run-{ds}", "exercise", ds, utc(start), utc(start + timedelta(minutes=34)),
                                  {"exercise": {"displayName": "Run", "exerciseType": "RUNNING", "metricsSummary": {
                                      "caloriesKcal": round(km * 68), "distanceMillimeters": str(int(km * 1e6)),
                                      "averageHeartRateBeatsPerMinute": str(rnd.randint(146, 158)),
                                      "activeZoneMinutes": str(2 * vig)}}})

        # Today's heart rate in 5-minute buckets: asleep, a morning run, the working day, an evening walk.
        t = local(today, 0)
        while t < now - timedelta(minutes=5):
            h = t.hour + t.minute / 60
            base = (54 + 3 * math.sin(h)) if h < 6.9 else (148 if 7.2 <= h < 7.75 else
                    (98 if 18 <= h < 18.75 else 72 + 6 * math.sin(h * 1.7)))
            v = round(base + rnd.uniform(-3, 3), 1)
            store.put_series("hr_5m", utc(t), v, {"min": round(v - rnd.uniform(2, 6)), "max": round(v + rnd.uniform(2, 8))})
            t += timedelta(minutes=5)

    store.set_meta("device", {"deviceVersion": "Fitbit Air", "batteryLevel": 82, "batteryStatus": "High",
                              "lastSyncTime": utc(now - timedelta(minutes=6))})
    store.set_meta("settings", {"distanceUnit": "DISTANCE_UNIT_KILOMETERS", "temperatureUnit": "TEMPERATURE_UNIT_CELSIUS"})
    store.set_meta("last_ok_at", time.time())
    store.set_meta("last_run_at", time.time())
    store.set_meta("backfilled", True)
    print(f"Demo data in {OUT}\nRun: DASH_DATA=demo-data DASH_NO_SYNC=1 python3 server.py")


if __name__ == "__main__":
    main()
