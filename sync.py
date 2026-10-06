"""Pull data from the Google Health API into the local store.

The Air syncs through the phone every ~15 minutes, and the cloud computes overnight
metrics (resting HR, HRV, SpO2...) some time after you wake up. So each sync re-pulls
a rolling window instead of only "new" points, and covers any gap since the last
successful sync (e.g. after a week with an expired login).
"""
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import partial
from zoneinfo import ZoneInfo

from healthapi import ApiError

ROLLUP_CHUNK_DAYS = 14        # API caps some types (heart rate, calories) at 14-day ranges
SERIES_DAYS = 30              # how far back to keep intraday buckets on first backfill
MAX_BACKFILL_DAYS = 730

# dailyRollUp types -> function(point value dict) -> {metric: value}
def _steps(v):
    return {"steps": float(v["countSum"])} if "countSum" in v else {}

def _distance(v):
    return {"distance_km": float(v["millimetersSum"]) / 1e6} if "millimetersSum" in v else {}

def _calories(v):
    return {"calories": float(v["kcalSum"])} if "kcalSum" in v else {}

def _heart(v):
    out = {}
    for k, m in (("beatsPerMinuteAvg", "hr_avg"), ("beatsPerMinuteMin", "hr_min"), ("beatsPerMinuteMax", "hr_max")):
        if k in v:
            out[m] = float(v[k])
    return out

def _active(v):
    out = {"active_light": 0.0, "active_moderate": 0.0, "active_vigorous": 0.0}
    for row in v.get("activeMinutesRollupByActivityLevel", []):
        level = row.get("activityLevel", "").lower()
        if f"active_{level}" in out:
            out[f"active_{level}"] = float(row.get("activeMinutesSum", 0))
    return out

def _azm(v):
    """Active Zone Minutes. Shape isn't documented in detail, so sum per-zone rows defensively."""
    zones, total = {}, None
    def walk(o):
        nonlocal total
        if isinstance(o, dict):
            zone = o.get("heartRateZone")
            for k, val in o.items():
                if k.endswith("Sum") and isinstance(val, (str, int, float)):
                    if zone:
                        zones[zone] = zones.get(zone, 0) + float(val)
                    elif total is None:
                        total = float(val)
                else:
                    walk(val)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(v)
    if total is None and zones:
        total = sum(zones.values())
    out = {"azm": total} if total is not None else {}
    for z, m in zones.items():
        out[f"azm_{z.lower()}"] = m
    return out

DAILY_ROLLUPS = {
    "steps": ("steps", _steps),
    "distance": ("distance", _distance),
    "total-calories": ("totalCalories", _calories),
    "heart-rate": ("heartRate", _heart),
    "active-minutes": ("activeMinutes", _active),
    "active-zone-minutes": ("activeZoneMinutes", _azm),
}

# One-per-day types computed by Google after a night of sleep.
def _f(v, k):
    return float(v[k]) if v.get(k) not in (None, "") else None

DAILY_LISTS = {
    "daily-resting-heart-rate": lambda v: {"rhr": _f(v, "beatsPerMinute")},
    "daily-heart-rate-variability": lambda v: {
        "hrv": _f(v, "averageHeartRateVariabilityMilliseconds"),
        "hrv_deep": _f(v, "deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds")},
    "daily-oxygen-saturation": lambda v: {"spo2": _f(v, "averagePercentage")},
    "daily-respiratory-rate": lambda v: {"resp_rate": _f(v, "averageRespiratoryRateBreathsPerMinute")},
    "daily-sleep-temperature-derivations": lambda v: {
        "temp_delta": (_f(v, "nightlyTemperatureCelsius") - _f(v, "baselineTemperatureCelsius"))
        if _f(v, "nightlyTemperatureCelsius") is not None and _f(v, "baselineTemperatureCelsius") is not None
        else None},
    "daily-vo2-max": lambda v: {"vo2max": _f(v, "vo2MaxMillilitersPerMinutePerKilogram")},
}


# Intraday buckets: (data type, window seconds, stored metric, parser -> (value, extra))
SERIES = (
    ("steps", 3600, "steps_h", lambda v: (float(v.get("countSum", 0)), None)),
    ("heart-rate", 300, "hr_5m", lambda v: (
        float(v["beatsPerMinuteAvg"]) if "beatsPerMinuteAvg" in v else None,
        {"min": v.get("beatsPerMinuteMin"), "max": v.get("beatsPerMinuteMax")})),
)


def camel(dtype):
    head, *rest = dtype.split("-")
    return head + "".join(p.capitalize() for p in rest)

def civil(d):
    return f"{int(d['year']):04d}-{int(d['month']):02d}-{int(d['day']):02d}"

def utc_iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class Syncer:
    def __init__(self, client, store):
        self.api = client
        self.db = store
        self.running = False

    def tz(self):
        name = (self.db.meta("settings") or {}).get("timeZone")
        try:
            return ZoneInfo(name) if name else datetime.now().astimezone().tzinfo
        except Exception:
            return datetime.now().astimezone().tzinfo

    # ---- cheap probe: is there anything new since the last pull? -------------
    def has_new_data(self):
        """Two calls. The device's lastSyncTime alone isn't reliable (Google keeps receiving
        minutes without bumping it), so also compare today's step total with what's stored."""
        dev = self.device() or {}
        if dev.get("lastSyncTime") != self.db.meta("last_device_sync_pulled"):
            return True
        today = datetime.now(self.tz()).date()
        pts = self.api.daily_rollup("steps", today, today + timedelta(days=1))
        live = next((_steps(p.get("steps") or {}).get("steps") for p in pts), None)
        stored = next((r["value"] for r in self.db.daily(today.isoformat(), today.isoformat(), ["steps"])), None)
        return live is not None and live != stored

    def device(self):
        devs = self.api.get("pairedDevices").get("pairedDevices") or []
        dev = next((d for d in devs if "air" in (d.get("deviceVersion") or "").lower()), devs[0] if devs else None)
        if dev:
            self.db.set_meta("device", {k: v for k, v in dev.items() if k not in ("features", "macAddress")})
        return dev

    # ---- full pull ---------------------------------------------------------
    def run(self, reason="scheduled"):
        if self.running:
            return {"ok": False, "message": "sync already running"}
        self.running = True
        self.api.calls = 0
        started = time.time()
        try:
            self.db.set_meta("settings", self.api.get("settings"))
            if not self.db.meta("profile") or reason == "startup":
                self.db.set_meta("profile", self.api.get("profile"))
            tz = self.tz()
            today = datetime.now(tz).date()
            start = self._window_start(today)
            recent = max(start, today - timedelta(days=SERIES_DAYS))
            # Each data type is independent, so fetch them side by side (~5 s instead of ~25 s).
            tasks = [self.device]
            tasks += [partial(self._daily_rollup, dtype, start, today) for dtype in DAILY_ROLLUPS]
            tasks += [partial(self._daily_list, dtype, start - timedelta(days=5), today) for dtype in DAILY_LISTS]
            tasks += [partial(self._sleep, start - timedelta(days=1), today),
                      partial(self._exercise, start - timedelta(days=1), today),
                      partial(self._sedentary, recent, today, tz)]
            tasks += [partial(self._series, spec, recent, today, tz) for spec in SERIES]
            with ThreadPoolExecutor(max_workers=8) as pool:
                for f in [pool.submit(t) for t in tasks]:
                    f.result()  # re-raises the first failure

            now = time.time()
            self.db.set_meta("last_ok_at", now)
            self.db.set_meta("last_ok_date", today.isoformat())
            self.db.set_meta("backfilled", True)
            self.db.set_meta("last_device_sync_pulled", (self.db.meta("device") or {}).get("lastSyncTime"))
            self.db.set_meta("last_error", None)
            msg = f"{reason}: {start}..{today} in {now - started:.1f}s"
            self.db.log(reason, True, self.api.calls, msg)
            return {"ok": True, "message": msg, "calls": self.api.calls}
        except Exception as e:
            self.db.set_meta("last_error", {"at": time.time(), "type": type(e).__name__, "message": str(e)[:500]})
            self.db.log(reason, False, self.api.calls, f"{type(e).__name__}: {str(e)[:300]}")
            raise
        finally:
            self.db.set_meta("last_run_at", time.time())
            self.running = False

    def _window_start(self, today):
        if not self.db.meta("backfilled"):
            joined = (self.db.meta("profile") or {}).get("membershipStartDate")
            earliest = today - timedelta(days=MAX_BACKFILL_DAYS)
            if joined:
                return max(date.fromisoformat(civil(joined)), earliest)
            return today - timedelta(days=90)
        start = today - timedelta(days=2)
        last_ok = self.db.meta("last_ok_date")
        if last_ok:  # close any gap left by an outage or expired login
            start = min(start, date.fromisoformat(last_ok) - timedelta(days=1))
        return start

    def _chunks(self, start, end_inclusive, days=ROLLUP_CHUNK_DAYS):
        s = start
        while s <= end_inclusive:
            e = min(s + timedelta(days=days), end_inclusive + timedelta(days=1))
            yield s, e  # e is exclusive
            s = e

    def _daily_rollup(self, dtype, start, today):
        key, parse = DAILY_ROLLUPS[dtype]
        for s, e in self._chunks(start, today):
            try:
                points = self.api.daily_rollup(dtype, s, e)
            except ApiError as err:
                if err.status == 400:  # type not available for this account/device
                    return
                raise
            with self.db.tx():
                for p in points:
                    day = civil(p["civilStartTime"]["date"])
                    val = p.get(key) or {}
                    for metric, x in parse(val).items():
                        if x is not None:
                            self.db.put_daily(day, metric, x, val)

    def _daily_list(self, dtype, start, today):
        parse, field = DAILY_LISTS[dtype], camel(dtype)
        flt = f'{dtype.replace("-", "_")}.date >= "{start.isoformat()}"'
        try:
            points = self.api.list(dtype, flt)
        except ApiError as err:
            if err.status == 400:
                return
            raise
        with self.db.tx():
            for p in points:
                v = p.get(field) or next((x for k, x in p.items() if isinstance(x, dict) and "date" in x), None)
                if not v or "date" not in v:
                    continue
                day = civil(v["date"])
                for metric, x in parse(v).items():
                    if x is not None:
                        self.db.put_daily(day, metric, x, v)

    def _sleep(self, start, today):
        points = self.api.list("sleep", f'sleep.interval.civil_end_time >= "{start.isoformat()}T00:00:00"')
        touched = set()
        with self.db.tx():
            for p in points:
                s = p.get("sleep") or {}
                iv = s.get("interval") or {}
                if not iv.get("startTime") or not iv.get("endTime"):
                    continue
                day = civil(iv["civilEndTime"]["date"]) if iv.get("civilEndTime") else iv["endTime"][:10]
                self.db.put_session(p["name"], "sleep", day, iv["startTime"], iv["endTime"], p)
                touched.add(day)
        for day in touched:
            self._derive_sleep(day)

    def _derive_sleep(self, day):
        sessions = self.db.sessions("sleep", day, day)
        def mins(sess, k):
            return float((sess["payload"]["sleep"].get("summary") or {}).get(k) or 0)
        naps = [x for x in sessions if (x["payload"]["sleep"].get("metadata") or {}).get("nap")]
        mains = [x for x in sessions if x not in naps]
        with self.db.tx():
            if naps:
                self.db.put_daily(day, "nap", sum(mins(x, "minutesAsleep") for x in naps))
            if not mains:
                return
            main = max(mains, key=lambda x: mins(x, "minutesInSleepPeriod"))
            sl = main["payload"]["sleep"]
            summ = sl.get("summary") or {}
            stages = {r.get("type"): float(r.get("minutes") or 0) for r in summ.get("stagesSummary") or []}
            iv = sl["interval"]
            asleep = mins(main, "minutesAsleep") + sum(mins(x, "minutesAsleep") for x in mains if x is not main)
            in_bed = mins(main, "minutesInSleepPeriod")
            extra = {
                "id": main["id"], "type": sl.get("type"),
                "start": iv["startTime"], "end": iv["endTime"],
                "startOffset": iv.get("startUtcOffset"), "endOffset": iv.get("endUtcOffset"),
                "stages": stages, "inBed": in_bed,
                "toFallAsleep": mins(main, "minutesToFallAsleep"),
            }
            self.db.put_daily(day, "sleep", asleep, extra)
            if in_bed:
                self.db.put_daily(day, "sleep_eff", round(100 * mins(main, "minutesAsleep") / in_bed, 1))
            for st in ("DEEP", "REM", "LIGHT", "AWAKE"):
                if st in stages:
                    self.db.put_daily(day, f"sleep_{st.lower()}", stages[st])
            # Bed/wake as minutes from local midnight (bedtime before midnight is negative).
            off_s = _offset_seconds(iv.get("startUtcOffset"))
            off_e = _offset_seconds(iv.get("endUtcOffset"))
            st_local = parse_ts(iv["startTime"]) + timedelta(seconds=off_s)
            en_local = parse_ts(iv["endTime"]) + timedelta(seconds=off_e)
            bed = st_local.hour * 60 + st_local.minute
            self.db.put_daily(day, "bedtime", bed - 1440 if bed >= 12 * 60 else bed)
            self.db.put_daily(day, "waketime", en_local.hour * 60 + en_local.minute)

    def _exercise(self, start, today):
        points = self.api.list("exercise", f'exercise.interval.civil_start_time >= "{start.isoformat()}T00:00:00"')
        with self.db.tx():
            for p in points:
                ex = p.get("exercise") or {}
                iv = ex.get("interval") or {}
                if not iv.get("startTime"):
                    continue
                day = civil(iv["civilStartTime"]["date"]) if iv.get("civilStartTime") else iv["startTime"][:10]
                self.db.put_session(p["name"], "exercise", day, iv["startTime"], iv.get("endTime", iv["startTime"]), p)

    def _sedentary(self, start, today, tz):
        """Minutes sitting still per day, and the longest unbroken stretch."""
        try:
            points = self.api.list("sedentary-period",
                                   f'sedentary_period.interval.civil_start_time >= "{start.isoformat()}T00:00:00"')
        except ApiError as err:
            if err.status == 400:
                return
            raise
        per_day = {}
        for p in points:
            iv = (p.get("sedentaryPeriod") or {}).get("interval") or {}
            if not iv.get("startTime") or not iv.get("endTime"):
                continue
            st, en = parse_ts(iv["startTime"]), parse_ts(iv["endTime"])
            day = st.astimezone(tz).date().isoformat()
            m = (en - st).total_seconds() / 60
            tot, longest = per_day.get(day, (0, 0))
            per_day[day] = (tot + m, max(longest, m))
        with self.db.tx():
            for day, (tot, longest) in per_day.items():
                self.db.put_daily(day, "sedentary", round(tot))
                self.db.put_daily(day, "sit_longest", round(longest))

    def _series(self, spec, start, today, tz):
        dtype, win, metric, parse = spec
        key = camel(dtype)
        s = datetime.combine(start, datetime.min.time(), tz)
        t1 = datetime.combine(today + timedelta(days=1), datetime.min.time(), tz)
        while s < t1:
            e = min(s + timedelta(days=7), t1)
            points = self.api.rollup(dtype, s, e, win)
            with self.db.tx():
                for p in points:
                    val, extra = parse(p.get(key) or {})
                    if val is not None:
                        self.db.put_series(metric, utc_iso(parse_ts(p["startTime"])), val, extra)
            s = e


def _offset_seconds(s):
    try:
        return int(float(str(s).rstrip("s")))
    except (TypeError, ValueError):
        return 0
