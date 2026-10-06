# Fitbit Air — native macOS widget

Real WidgetKit widgets: they sit in the desktop widget grid next to Apple's own and read `GET /api/widget` from
the running dashboard, never Google, using almost no resources between refreshes.

| Widget | Sizes | Shows |
|---|---|---|
| **Steps** | small, medium | Steps ring toward your goal; on medium, two stats you pick (default heart rate + sleep) |
| **Stat** | small, medium | One stat you pick, big (default blood oxygen); medium shows a second (default skin temperature) |
| **Overview** | large | Steps ring, distance, calories, active and zone minutes, plus heart, sleep, sitting, blood oxygen, skin temperature and HRV |

Stats to pick from: heart rate, resting heart rate, HRV, sleep, time sitting, blood oxygen, skin temperature,
breathing rate, Active Zone Minutes, active minutes, distance, calories and VO₂ max. To choose, right-click the
widget → **Edit Widget**. Overnight readings get a **Normal / High / Low** label against your own 30-day normal,
exactly as on the dashboard (after 3 nights; until then they say "Learning").

## Install / update

Needs Xcode. No Apple ID needed: the app is signed to run on this Mac only.

```bash
sh macwidget/install.sh
```

This builds the app, copies it to `~/Applications/Fitbit Air.app`, and registers the widgets. Then add them:
right-click the desktop → **Edit Widgets…** → search **Fitbit Air** → drag the ones you want onto the desktop.
Add the same widget more than once with different stats. Move, resize or remove them like any other widget.

Run `install.sh` again after changing the code or rotating `data/widget_secret` (the key is copied into the
widget at build time).

## How it works

- `Widget/FitbitAirWidget.swift`: fetches `/api/widget` with the key in an `Authorization` header, caches the
  last good reading inside the widget's sandbox, and asks macOS for a refresh every 15 minutes (macOS may
  stretch that to save power).
- `Widget/Metrics.swift`: the stats you can pick, the Edit Widget options, and how each stat is labelled.
- `Widget/Views.swift`: the layouts and the ring (the dashboard's pink → peach → lavender).
- `App/main.swift`: the app that carries the widget. Opened from Finder it explains how to add the widget;
  clicking the widget opens the dashboard in your browser.
- The widget is sandboxed with only outgoing network access, and may only use plain http to 127.0.0.1.
- Dashboard on another port? Change `dashboardURL` in `FitbitAirWidget.swift` and `dashboard` in `App/main.swift`.

## When something's off

| Widget says | Meaning |
|---|---|
| Dashboard offline · as of 18:26 | The server is closed; showing the last reading |
| Widget key changed / missing | Run `install.sh` again |
| Google login expired / expires today | Reconnect Google from the dashboard |
| Air last synced 5h ago | Open the Google Health app on your phone to sync |
| `—` | No data yet (sleep and resting HR appear after the first night) |

To remove it: take it off the desktop, then delete `~/Applications/Fitbit Air.app`.
