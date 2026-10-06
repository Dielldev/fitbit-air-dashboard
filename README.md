# Fitbit Air dashboard

A personal dashboard for a Google Fitbit Air that runs on your own computer. It reads from the
**Google Health API v4** (`health.googleapis.com/v4`) with read-only scopes and keeps every number
it fetches in a local SQLite file. Your history survives expired logins and API outages.

```bash
python3 server.py            # opens http://127.0.0.1:8787
```

No packages to install. It uses only the Python standard library and a browser.

## What it shows

| Section | What | Why |
|---|---|---|
| **Step streak** | The last 14 days as chips: 🔥 when you hit your step goal. **Click any day to open it.** The whole page switches to that day | History at a glance, and a way back into it |
| **Activity** | Steps ring vs goal, mini-meters for zone minutes (7 days), active minutes and sleep, distance / calories / sitting / light activity, steps per hour against your 14-day typical hour | The few numbers worth checking during the day |
| **Suggestion card** | One plain-language takeaway: ahead/behind your usual pace, goal reached, "easier day" when resting HR is up and HRV down, or a nudge to sync your phone | What the numbers mean, in one sentence |
| **Heart rate** | 5-minute averages with min–max band; resting / lowest / highest; the stretch between the Air's last sync and now is shaded | Shows what's in and what's still on your wrist |
| **Steps this week** | 7 bars with your average, the selected day highlighted, best day, total, days at goal | Consistency over the week |
| **Last night** | Time asleep, bed→wake, efficiency, vs 7-night average, stage timeline and minutes per stage | The official app's sleep view, on one card |
| **Recovery** | Resting HR and HRV cards, plus an overnight-vitals list (breathing rate, SpO₂, skin temperature, VO₂ max). Each is marked Normal / High / Low against **your own 30-day normal** (after 3 nights) | "Is today normal for me?" at a glance |
| **Trends** | 7 / 30 / 90 days of steps, sleep, resting HR, HRV, AZM, sitting. Every chart has a table view, plus CSV export of all history | Long-term direction |

Days without data show as gaps, never as zeros, and they're excluded from averages.

## How syncing works (and why it's never real time)

The Air syncs to your phone, and the phone uploads to Google about every 15 minutes. The dashboard:

1. Every **5 minutes** makes one cheap call (`pairedDevices`) to see whether the Air has synced since the last pull.
2. If it has, or an hour has passed, it does a **full pull** (~20 calls). This re-reads the last 2–3 days, because Google
   fills in and revises overnight metrics after you wake up.
3. After any outage or expired login, the next pull automatically covers the whole gap.

The header always shows *when the Air last synced*. If that's more than 3 hours ago, you get a nudge to open
the Google Health app on your phone. **Sync now** forces a pull.

## The weekly re-login

The Google Cloud project is in **Testing** mode (personal use, one test user). Google expires refresh tokens for
Testing-mode apps after **7 days**. The header shows how many days are left. When the login expires, a
banner appears with **Reconnect Google**: click it, approve, and syncing resumes and backfills the gap. Nothing
stored locally is lost.

## Files

```
server.py     web server, JSON API, background scheduler
sync.py       Google Health API → SQLite (what to fetch, how to parse it)
healthapi.py  OAuth (desktop loopback + PKCE) and REST client
store.py      SQLite schema and access
macwidget/    native macOS widget (Xcode project: App/, Widget/, install.sh)
widget/       Übersicht desktop widget (index.jsx + fetch.sh) and its setup README
web/          the page: index.html, app.js, charts.js (plain SVG), style.css
              fonts: Bricolage Grotesque + Outfit from Google Fonts (falls back to system fonts offline)
data/         YOUR DATA (folder is owner-only, mode 700; ignored by git)
  health.db           all history: daily metrics, hourly steps, 5-min heart rate, full sleep/exercise payloads
  auth.json           Google tokens (mode 600)
  client_secret.json  your OAuth client (mode 600)
  widget_secret       key for /api/widget (mode 600; delete + restart to rotate)
  goals.json          your name and goals: {"name": "", "steps": 10000, "sleep_hours": 8, "azm_week": 150, "active_minutes": 30}
```

The server listens on `127.0.0.1` only and rejects requests for any other host name.

## Desktop widget

Two versions read `GET /api/widget`, a trimmed summary that requires the key in `data/widget_secret`
(created on first start, mode 600):

- **Native macOS widgets** (in use): `macwidget/`, a WidgetKit app with Steps, Stat and Overview widgets that sit in
  the desktop widget grid next to Apple's. Install with `sh macwidget/install.sh` (needs Xcode).
  Details: [macwidget/README.md](macwidget/README.md).
- **Übersicht widget** (kept for reference, not installed): `widget/fitbit-air.widget`. Setup: [widget/README.md](widget/README.md).

Environment knobs: `DASH_PORT` (default 8787), `DASH_DATA` (data folder), `DASH_NO_SYNC=1` (serve stored data
without calling Google).

## Google Cloud setup

- A Google Cloud project with the **Google Health API** enabled
- OAuth consent screen: External, **Testing**, your account as the only test user
- Read-only scopes: `googlehealth.activity_and_fitness.readonly`, `googlehealth.health_metrics_and_measurements.readonly`,
  `googlehealth.sleep.readonly`, `googlehealth.profile.readonly`, `googlehealth.settings.readonly`
- OAuth client type **Desktop app**: download its JSON to `data/client_secret.json`

The official CLI `ghealth` (`~/.local/bin/ghealth`) is handy for poking the API directly, e.g.
`ghealth data steps daily-rollup --from 2026-10-01 --to today`. If you've run `ghealth setup`, the dashboard reuses
that login and OAuth client on first start.
