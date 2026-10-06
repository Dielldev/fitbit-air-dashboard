# Fitbit Air desktop widget (Übersicht)

A glass card on your desktop: today's steps as a ring toward your goal, plus heart rate and last night's
sleep. It reads from the running dashboard, never from Google, so it costs no API calls and never sees
your Google tokens. Click it to open the dashboard.

## Setup

1. **Restart the dashboard** (close its window, double-click `Start Dashboard.command`). On start it creates
   `data/widget_secret`, the key the widget uses.
2. **Install the widget and its key.** Open Übersicht once so its widgets folder exists, then run these from this repo:

   ```bash
   W="$HOME/Library/Application Support/Übersicht/widgets"
   cp -R widget/fitbit-air.widget "$W/"
   install -m 600 data/widget_secret "$W/fitbit-air.widget/secret"
   ```

   Keep the folder name `fitbit-air.widget`; the widget calls its fetch script by that path. If you've moved
   Übersicht's widgets folder in its preferences, use that folder instead.
3. The card appears top-right within a few seconds.

After changing `widget/` here, run the `cp` line again (your saved position and key are kept).

## Moving it, and choosing a screen

- **Move:** drag the card anywhere. It remembers the spot (saved in `fitbit-air.widget/position`); a plain click
  opens the dashboard. If it won't drag, turn on **Übersicht menu-bar icon → Preferences → Enable interaction**.
- **Back to top-right:** delete `fitbit-air.widget/position`, then Übersicht menu → **Refresh All Widgets**.
- **Which display:** Übersicht menu-bar icon → the widget's entry → **Show on all screens**, **Show on main display**,
  or **Show on selected screens**. The same position is used on every screen it shows on.
- **Hide it:** same menu → **Hide widget**.

## How it works

- Every 5 minutes `fetch.sh` calls `GET http://127.0.0.1:8787/api/widget` with `Authorization: Bearer <key>`.
  The key goes to curl on stdin, so it never shows in the process list.
- `/api/widget` returns a short allowlist of fields built from the same numbers as the dashboard (no tokens,
  no account details). Requests without the right key get `401`.
- Using another port? Change `DASHBOARD` at the top of `index.jsx`.
- To change the key: delete `data/widget_secret`, restart the dashboard, and repeat the `install` line.

## What you'll see when something's off

| Card says | Meaning |
|---|---|
| Dashboard isn't running | The server is closed. The card dims and keeps showing the last reading |
| Widget key missing / doesn't match | Repeat the `install` line from step 2 |
| Google login expired / expires within a day | Reconnect Google from the dashboard |
| Air last synced Xh ago | Open the Google Health app on your phone to sync |
| `—` | No data yet (e.g. sleep and resting HR appear after the first night) |

Test the endpoint by hand:

```bash
printf 'Authorization: Bearer %s\n' "$(cat data/widget_secret)" | curl -s -H @- http://127.0.0.1:8787/api/widget
```
