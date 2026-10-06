"use strict";

const $ = q => document.querySelector(q);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let D = null;                 // last dashboard payload
let range = pref("range", 30);
let sel = null;               // selected day (null = today)
let syncWaitSince = null;     // set while a manual sync is in flight
let firstRender = true;

function pref(k, d) { try { const v = localStorage.getItem("airdash." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function setPref(k, v) { try { localStorage.setItem("airdash." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

// ---- formatting ----------------------------------------------------------------
const nf = (v, dp = 0) => v == null ? "—" : new Intl.NumberFormat(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
function hm(min) { min = Math.round(min); return [Math.floor(min / 60), min % 60]; }
function dur(min) {
  if (min == null) return "—";
  const [hh, mm] = hm(min);
  return hh ? `${hh}h ${String(mm).padStart(2, "0")}m` : `${mm}m`;
}
const tz = () => (D && D.tz) || undefined;
const fmtTime = ms => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz() }).format(new Date(ms));
const fmtHour = ms => new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: tz() }).format(new Date(ms));
const civil = s => new Date(s + "T12:00:00");
const fmtDay = s => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(civil(s));
const fmtDayLong = s => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(civil(s));
const fmtDayFull = s => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(civil(s));
const wkd = s => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(civil(s));
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) { const hh = Math.floor(s / 3600), mm = Math.round((s % 3600) / 60); return mm ? `${hh} h ${mm} min ago` : `${hh} h ago`; }
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const signed = (v, dp = 0) => (v > 0 ? "+" : v < 0 ? "−" : "±") + nf(Math.abs(v), dp);
const isMiles = () => D.units && /MILES/.test(D.units.distance || "");
const dist = km => km == null ? null : isMiles() ? km * 0.621371 : km;
const distUnit = () => isMiles() ? "mi" : "km";
const fahrenheit = () => D.units && /FAHRENHEIT/.test(D.units.temperature || "");
const lastSyncMs = () => D.status.device && D.status.device.last_sync ? Date.parse(D.status.device.last_sync) : null;
const rec = key => D.recovery.find(r => r.key === key);
const ink = color => `color-mix(in oklab, ${color} 62%, var(--ink))`;   // readable text tint of a pastel

// ---- data ----------------------------------------------------------------------
async function load() {
  const app = $("#app");
  if (D) app.classList.add("loading");
  try {
    const r = await fetch(`/api/dashboard?days=${range}${sel ? `&date=${sel}` : ""}`);
    if (!r.ok) throw new Error(`Server returned ${r.status}`);
    const data = await r.json();
    // first paint waits briefly for the web fonts so charts measure the final layout
    if (firstRender && document.fonts) await Promise.race([document.fonts.ready, new Promise(ok => setTimeout(ok, 1200))]);
    D = data;
    render();
  } catch (e) {
    if (!D) app.replaceChildren(h("div", { class: "card empty" }, h("b", null, "Can't reach the dashboard server."), `Is server.py still running? (${e.message})`));
  } finally {
    app.classList.remove("loading");
  }
}

async function poll() {
  try {
    const s = await (await fetch("/api/status")).json();
    if (!D) return;
    const fresh = s.last_ok_at !== D.status.last_ok_at;
    D.status = s;
    if (syncWaitSince && !s.running && (s.last_run_at || 0) >= syncWaitSince) syncWaitSince = null;
    if (fresh) load(); else renderHeader();
  } catch (e) { /* server restarting; next tick */ }
}

async function syncNow() {
  syncWaitSince = Date.now() / 1000;
  renderHeader();
  const r = await fetch("/api/sync", { method: "POST" }).catch(() => null);
  if (!r || !r.ok) { syncWaitSince = null; renderHeader(); }
}

function selectDay(date) {
  sel = !date || date === D.today ? null : date;
  load();
}

// ---- header ----------------------------------------------------------------------
function renderHeader() {
  if (!D) return;
  const st = D.status, dev = st.device || {}, a = st.auth || {}, day = D.day, name = (D.goals.name || "").trim();
  const now = Date.now();

  $("#avatar").replaceChildren(name ? name[0].toUpperCase() : icon("watch"));
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz() }).format(new Date()));
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  if (day.is_today) {
    $("#greet").replaceChildren(fmtDayFull(day.date));
    $("#title").replaceChildren(`${hello}${name ? ", " + name : ""} `, h("span", { "aria-hidden": "true" }, "👋"));
  } else {
    $("#greet").replaceChildren("Looking back", h("button", { class: "back", type: "button", onclick: () => selectDay(null) }, "Back to today →"));
    $("#title").replaceChildren(fmtDayFull(day.date));
  }

  const ls = lastSyncMs();
  const ageMin = ls ? (now - ls) / 60000 : null;
  const tone = ageMin == null ? "var(--muted)" : ageMin <= 30 ? "var(--good)" : ageMin <= 180 ? "var(--warn)" : "var(--pink)";
  const fresh = [h("i", { class: "dot", style: `background:${tone}` }),
    h("span", { title: ls ? `Your Air last synced through your phone at ${fmtTime(ls)}` : "" }, ls ? `Air synced ${ago(ls)}` : "Waiting for first sync")];
  if (dev.battery != null) fresh.push(h("span", { class: "sep" }), icon("battery"), `${dev.battery}%`);
  $("#fresh").replaceChildren(...fresh);

  const busy = !!syncWaitSince || st.running;
  const sync = $("#sync");
  sync.disabled = busy || !a.connected;
  sync.classList.toggle("spin", busy);
  const expSoon = a.connected && a.refresh_expires_at && a.refresh_expires_at * 1000 - now < 36 * 3600000;
  const attention = !a.connected || expSoon || (ageMin != null && ageMin > 180);
  sync.replaceChildren(...[icon("sync"), attention && h("i", { class: "badge", style: "background:var(--pink)" })].filter(Boolean));
  sync.title = busy ? "Syncing…" : st.last_ok_at ? `Dashboard updated ${fmtTime(st.last_ok_at * 1000)}. Click to sync now.` : "Sync now";
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#theme").replaceChildren(icon(dark ? "sun" : "moon"));

  const banners = [];
  const reconnect = label => h("a", { class: "cta", href: "/auth/login" }, icon("sync"), label);
  if (!a.connected) {
    banners.push(h("div", { class: "banner bad", role: "alert" },
      h("p", null, h("b", null, a.reason === "not_signed_in" ? "Not connected to Google. " : "Google login expired. "),
        "Testing-mode logins last 7 days. Everything already synced is saved here, and the gap fills in once you reconnect."),
      reconnect("Reconnect Google")));
  } else if (expSoon) {
    banners.push(h("div", { class: "banner warn", role: "status" },
      h("p", null, h("b", null, "Google login expires soon. "),
        `It runs out ${new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz() }).format(new Date(a.refresh_expires_at * 1000))}. Reconnect now to avoid a pause.`),
      reconnect("Reconnect now")));
  }
  const err = st.last_error;
  if (a.connected && err && err.at > (st.last_ok_at || 0)) {
    banners.push(h("div", { class: "banner warn", role: "status" }, h("p", null, h("b", null, "Last update from Google failed. "), `${err.message} Retrying automatically.`)));
  }
  $("#banners").replaceChildren(...banners);
}

// ---- streak strip -------------------------------------------------------------------
function renderStrip() {
  const s = D.strip;
  const chips = h("div", { class: "chips" }, s.days.map(d => {
    const selected = d.date === D.day.date, isToday = d.date === D.today;
    return h("div", { class: "chip-day" },
      h("button", {
        type: "button", class: [d.met ? "met" : "", selected ? "sel" : ""].join(" ").trim() || null,
        disabled: !d.has_data && !isToday,
        "aria-pressed": String(selected),
        "aria-label": `${fmtDayLong(d.date)}: ${d.steps != null ? nf(d.steps) + " steps" : "no data"}${d.met ? ", goal reached" : ""}`,
        title: d.steps != null ? `${nf(d.steps)} steps` : "No data",
        onclick: () => selectDay(d.date),
      }, d.met ? "🔥" : String(civil(d.date).getDate())),
      h("small", { class: isToday ? "today" : null }, isToday ? "Today" : wkd(d.date)));
  }));
  $("#strip").replaceChildren(
    h("div", { class: "strip-head" }, h("h2", null, "Step streak"),
      h("span", null, s.streak ? `🔥 ${s.streak} day${s.streak > 1 ? "s" : ""} in a row` : `Reach ${nf(D.goals.steps)} steps to light a flame`)),
    chips);
  requestAnimationFrame(() => { chips.scrollLeft = chips.scrollWidth; });
}

// ---- layout -------------------------------------------------------------------------
const later = [];   // charts need real widths, so they draw after the DOM is placed
const draw = (host, fn) => later.push(() => fn(host));
const chartHost = (cls, style) => h("div", { class: cls || "chart", style });
const arrowTo = (href, label) => h("a", { class: "arrow", href, "aria-label": label }, icon("arrow"));

function render() {
  later.length = 0;
  renderHeader();
  renderStrip();
  const top = h("div", { class: "bento" + (firstRender ? " enter" : "") },
    ringCard(), insightCard(),
    ...miniCards(),
    heartCard(), vitalsList(),
    sleepCard(), weekCard());
  [...top.children].forEach((c, i) => c.style.setProperty("--i", i));
  $("#app").replaceChildren(top, ...trendsSection(), ...workoutsSection());
  later.forEach(fn => fn());
  firstRender = false;
  $("#foot").replaceChildren(
    h("span", null, "Read-only from the Google Health API"),
    h("span", null, "History lives on this computer (data/health.db)"),
    h("span", null, `Time zone ${D.tz}`));
}

// ---- ring card ------------------------------------------------------------------------
function ringCard() {
  const d = D.day, g = D.goals;
  const steps = d.steps;
  const ringHost = h("div", { style: "width:100%;height:100%" });
  draw(ringHost, el => ring(el, {
    frac: (steps || 0) / g.steps, colors: [css("--pink"), css("--peach"), css("--lav")], label: `${nf(steps || 0)} of ${nf(g.steps)} steps`,
    tip: () => ({ title: d.is_today ? "Steps so far today" : fmtDayLong(d.date), rows: [{ value: nf(steps || 0), label: `${Math.round((steps || 0) / g.steps * 100)}% of goal` }] }),
  }));

  const mv = d.active.moderate == null && d.active.vigorous == null ? null : (d.active.moderate || 0) + (d.active.vigorous || 0);
  const sleepMin = D.sleep && (D.sleep.on_selected || d.is_today) ? D.sleep.minutes : null;
  const macro = (frac, color, value, of, label) => h("div", { class: "macro" },
    stripes(frac, color),
    h("div", null, h("div", { class: "v" }, value, h("span", null, of)), h("div", { class: "l", style: `color:${ink(color)}` }, label)));

  const ls = lastSyncMs();
  const hours = Math.round((d.day_end - d.day_start) / 3600000);
  const hourly = new Array(hours).fill(null);
  for (const p of d.steps_hourly) {
    const i = Math.floor((Date.parse(p.ts) - d.day_start) / 3600000);
    if (i >= 0 && i < hours) hourly[i] = p.v;
  }
  const typical = d.steps_typical_by_hour || [];
  const nowIdx = d.is_today ? Math.floor((Date.now() - d.day_start) / 3600000) : hours;
  const hourlyHost = chartHost();
  draw(hourlyHost, el => columnChart(el, {
    n: hours, height: 116, color: css("--lav"), radius: 4, maxBar: 14,
    colorAt: i => i === nowIdx && d.is_today ? css("--violet") : css("--lav"),
    value: i => i <= nowIdx ? hourly[i] : null,
    ghost: typical.length ? i => typical[i] : null,
    xLabel: i => i % 6 === 0 ? fmtHour(d.day_start + i * 3600000) : null,
    label: "Steps per hour",
    tip: i => ({
      title: `${fmtTime(d.day_start + i * 3600000)} – ${fmtTime(d.day_start + (i + 1) * 3600000)}`,
      rows: [{ color: css("--lav"), value: hourly[i] == null ? (i > nowIdx ? "—" : "0") : nf(hourly[i]), label: "steps" },
             ...(typical[i] != null ? [{ color: css("--ink-2"), value: nf(typical[i]), label: "your usual" }] : [])],
    }),
  }));

  return h("div", { class: "card s8" },
    h("div", { class: "card-head" },
      h("div", null, h("h3", null, "Activity"),
        h("div", { class: "sub" }, d.is_today ? (ls ? `So far today · through ${fmtTime(ls)}` : "So far today") : fmtDayFull(d.date))),
      arrowTo("#trend-steps", "Step trends")),
    h("div", { class: "ring-wrap" },
      h("div", { class: "ring" }, ringHost, h("div", { class: "ring-center" },
        h("div", { class: "lbl" }, d.is_today ? "Today" : wkd(d.date)),
        h("div", { class: "big" }, icon("steps"), nf(steps ?? 0)),
        h("div", { class: "of" }, `of ${nf(g.steps)} steps`))),
      h("div", { class: "macros" },
        macro((D.day.azm_week || 0) / g.azm_week, css("--lav"), nf(D.day.azm_week ?? 0), `/${g.azm_week}`, "Zone minutes · 7 days"),
        macro((mv || 0) / g.active_minutes, css("--peach"), nf(mv ?? 0), `/${g.active_minutes} min`, "Active minutes"),
        macro((sleepMin || 0) / (g.sleep_hours * 60), css("--pink"), sleepMin != null ? nf(sleepMin / 60, 1) : "—", `/${g.sleep_hours} h`, "Sleep last night")),
      h("div", { class: "stat-grid" },
        statTile("route", "--sky", nf(dist(d.distance_km), 2), distUnit()),
        statTile("flame", "--peach", nf(d.calories), "kcal burned"),
        statTile("sofa", "--butter", dur(d.sedentary), "sitting"),
        statTile("pulse", "--mint", dur(d.active.light), "light activity"))),
    h("div", { class: "hourly" },
      h("div", { class: "mini-title" }, h("span", null, "Steps by hour"),
        typical.length ? h("span", null, h("i", { class: "key line", style: "background:var(--ink-2);opacity:.5;vertical-align:middle;margin-right:6px" }), "your usual, last 14 days") : null),
      hourlyHost));
}

function statTile(ic, color, value, label) {
  return h("div", { class: "stat-tile" },
    h("span", { class: "ico", style: `background:var(${color}-soft);color:${ink(css(color))}` }, icon(ic)),
    h("div", null, h("b", null, value), h("span", null, label)));
}

// ---- insight card -----------------------------------------------------------------------
function insight() {
  const st = D.status, a = st.auth || {}, d = D.day, g = D.goals;
  const ls = lastSyncMs();
  const sync = { label: "Sync now", icon: "sync", onclick: syncNow };
  if (!a.connected) {
    return { mood: "alert", kicker: "Connection", title: "Reconnect Google to keep syncing.", text: "Testing-mode logins last 7 days. Your history is safe on this computer and the gap fills in automatically.", btn: { label: "Reconnect Google", icon: "sync", href: "/auth/login" } };
  }
  const r = rec("rhr"), v = rec("hrv");
  const off = x => x && x.value != null && x.baseline && x.baseline.mean != null && Math.abs(x.value - x.baseline.mean) > Math.max(x.baseline.sd || 0, x.key === "rhr" ? 2 : 4);
  const rhrHigh = off(r) && r.value > r.baseline.mean, hrvLow = off(v) && v.value < v.baseline.mean;

  if (!d.is_today) {
    const parts = [];
    if (d.steps != null) parts.push(`${nf(d.steps)} steps`);
    if (D.sleep && D.sleep.on_selected) parts.push(`${dur(D.sleep.minutes)} of sleep`);
    return {
      mood: d.steps != null && d.steps >= g.steps ? "happy" : "calm", kicker: fmtDayLong(d.date),
      title: parts.length ? parts.join(" and ") + "." : "No data for this day.",
      text: d.steps == null ? "Your Air wasn't worn or didn't sync that day." : d.steps >= g.steps ? "Step goal reached that day. 🔥" : `${nf(g.steps - d.steps)} steps short of your goal.`,
      btn: { label: "Back to today", icon: "arrow", onclick: () => selectDay(null) },
    };
  }
  if (ls && Date.now() - ls > 3 * 3600000) {
    return { mood: "alert", kicker: "Sync", title: `Your Air last synced ${ago(ls)}.`, text: "Open the Google Health app on your phone, with Bluetooth on, to bring today up to date.", btn: sync };
  }
  if (rhrHigh || hrvLow) {
    const what = rhrHigh && hrvLow ? "Resting heart rate is above and HRV below your normal range"
      : rhrHigh ? "Resting heart rate is above your normal range" : "Heart rate variability is below your normal range";
    return { mood: "sleepy", kicker: "Recovery", title: "Your body may want an easier day.", text: `${what}. Rest, fluids and lighter activity help it bounce back.`, btn: sync };
  }
  const steps = d.steps || 0;
  if (steps >= g.steps) {
    return { mood: "happy", kicker: "Steps", title: "Step goal done. Nice work!", text: `${nf(steps - g.steps)} steps over${D.strip.streak > 1 ? `, and that's ${D.strip.streak} days in a row 🔥` : ""}.`, btn: sync };
  }
  if (d.steps_usual_by_now != null) {
    const diff = steps - d.steps_usual_by_now;
    return diff >= 0
      ? { mood: "happy", kicker: "Pace", title: `${nf(diff)} steps ahead of your usual pace.`, text: `${nf(g.steps - steps)} to go for your goal. Keep it rolling.`, btn: sync }
      : { mood: "calm", kicker: "Pace", title: `${nf(-diff)} steps behind your usual pace.`, text: `You usually have ${nf(d.steps_usual_by_now)} by now. A 10-minute walk is about 1,000 steps.`, btn: sync };
  }
  return { mood: "calm", kicker: "Today", title: `${nf(g.steps - steps)} steps to your goal.`, text: "After 3 days of wear, this card compares you with your usual pace for the time of day.", btn: sync };
}

function insightCard() {
  const x = insight(), ls = lastSyncMs();
  const btn = x.btn.href
    ? h("a", { class: "cta", href: x.btn.href }, icon(x.btn.icon), x.btn.label)
    : h("button", { class: "cta", type: "button", onclick: x.btn.onclick, disabled: x.btn.onclick === syncNow && (!!syncWaitSince || D.status.running) }, icon(x.btn.icon), x.btn.label);
  return h("div", { class: "card insight s4" },
    h("div", null,
      h("div", { class: "kicker" }, icon("sparkle", { width: 15, height: 15 }), x.kicker),
      h("h2", null, x.title),
      h("p", null, x.text)),
    h("div", { class: "foot" }, btn, h("span", { class: "small" }, ls ? `Data through ${fmtTime(ls)}` : "")),
    moodBlob(x.mood));
}

// A soft blob with a face; its expression follows the insight.
function moodBlob(mood) {
  const pts = [1, .93, 1.05, .96, 1.04, .94, 1.03].map((k, i, a) => {
    const t = i / a.length * Math.PI * 2 - Math.PI / 2;
    return [60 + 48 * k * Math.cos(t), 62 + 46 * k * Math.sin(t)];
  });
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length; i++) {
    const n = pts.length, p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n], k = 1 / 6;
    d += ` C${p1[0] + (p2[0] - p0[0]) * k},${p1[1] + (p2[1] - p0[1]) * k} ${p2[0] - (p3[0] - p1[0]) * k},${p2[1] - (p3[1] - p1[1]) * k} ${p2[0]},${p2[1]}`;
  }
  const g = uid("bg"), pat = uid("bp"), stroke = { fill: "none", stroke: "#1d1b33", "stroke-width": 3, "stroke-linecap": "round" };
  const eyes = {
    happy: [sv("path", { d: "M40 58q6-7 12 0", ...stroke }), sv("path", { d: "M68 58q6-7 12 0", ...stroke })],
    calm: [sv("circle", { cx: 46, cy: 57, r: 3.5, fill: "#1d1b33" }), sv("circle", { cx: 74, cy: 57, r: 3.5, fill: "#1d1b33" })],
    sleepy: [sv("path", { d: "M40 57q6 5 12 0", ...stroke }), sv("path", { d: "M68 57q6 5 12 0", ...stroke })],
    alert: [sv("circle", { cx: 46, cy: 56, r: 4.5, fill: "#1d1b33" }), sv("circle", { cx: 74, cy: 56, r: 4.5, fill: "#1d1b33" })],
  }[mood];
  const mouth = {
    happy: sv("path", { d: "M47 70q13 13 26 0", ...stroke }),
    calm: sv("path", { d: "M52 72q8 6 16 0", ...stroke }),
    sleepy: sv("path", { d: "M54 74h12", ...stroke }),
    alert: sv("ellipse", { cx: 60, cy: 74, rx: 4.5, ry: 5.5, fill: "#1d1b33" }),
  }[mood];
  return sv("svg", { class: "blob", viewBox: "0 0 120 120", "aria-hidden": "true" },
    sv("defs", null,
      sv("radialGradient", { id: g, cx: "35%", cy: "30%", r: "75%" },
        sv("stop", { offset: 0, "stop-color": "#d8ecff" }), sv("stop", { offset: ".55", "stop-color": "#a9c8f7" }), sv("stop", { offset: 1, "stop-color": "#a99df7" })),
      sv("pattern", { id: pat, width: 9, height: 9, patternUnits: "userSpaceOnUse" }, sv("circle", { cx: 2, cy: 2, r: 1, fill: "#1d1b33", opacity: .16 }))),
    sv("path", { d, fill: `url(#${g})` }), sv("path", { d, fill: `url(#${pat})` }),
    sv("ellipse", { cx: 36, cy: 70, rx: 6, ry: 3.5, fill: "#f6a5c3", opacity: .8 }), sv("ellipse", { cx: 84, cy: 70, rx: 6, ry: 3.5, fill: "#f6a5c3", opacity: .8 }),
    eyes, mouth,
    mood === "sleepy" ? sv("text", { x: 92, y: 26, style: "font:600 14px var(--display);fill:#6f5ff0" }, "z") : null);
}

// ---- mini cards --------------------------------------------------------------------------
function miniCards() {
  const d = D.day, g = D.goals, R = D.recent;
  const tipDay = (i, value, label) => ({ title: fmtDayLong(R.dates[i]), rows: [{ value, label }] });

  function mini({ title, href, value, unit, delta, deltaIcon, viz, vizHeight }) {
    const host = viz ? chartHost(null, `height:${vizHeight || 66}px`) : null;
    if (viz) draw(host, viz);
    return h("div", { class: "card mini s3" + (viz ? "" : " no-viz") },
      h("div", { class: "card-head" }, h("h3", null, title), arrowTo(href, `${title} trend`)),
      h("div", { class: "body" },
        h("div", { class: "num" }, value, unit ? h("small", null, unit) : null),
        h("div", { class: "delta" }, deltaIcon ? icon(deltaIcon) : null, delta)),
      viz ? h("div", { class: "viz" }, host) : null);
  }
  function vital(key, color, title) {
    const r = rec(key);
    if (r.value == null) return mini({ title, href: `#trend-${key}`, value: "—", delta: d.is_today ? "Appears after a night of sleep" : "No reading this day" });
    const b = r.baseline;
    let delta = `Learning your normal (${b.n || 0} of 3 nights)`, di = null;
    if (b.mean != null) {
      const diff = r.value - b.mean;
      delta = Math.abs(diff) < 0.5 ? "Right at your normal" : `${signed(diff)} ${r.unit} vs your normal`;
      di = diff >= 0.5 ? "up" : diff <= -0.5 ? "down" : null;
    }
    return mini({
      title, href: `#trend-${key}`, value: nf(r.value), unit: r.unit, delta, deltaIcon: di,
      viz: el => miniBars(el, R[key], { color, label: `${title}, last 14 days`, minSpan: key === "rhr" ? 4 : 8,
        tip: i => tipDay(i, R[key][i] == null ? "no data" : `${nf(R[key][i])} ${r.unit}`, title.toLowerCase()) }),
    });
  }

  const azmPct = d.azm_week != null ? Math.round(d.azm_week / g.azm_week * 100) : null;
  return [
    mini({
      title: "Weekly activity", href: "#trend-azm", value: azmPct != null ? nf(azmPct) : "0", unit: "%",
      delta: `${nf(d.azm_week || 0)} of ${g.azm_week} zone minutes · last 7 days`,
      vizHeight: 92,
      viz: el => halfArc(el, { frac: (d.azm_week || 0) / g.azm_week, colors: [css("--sky"), css("--lav")], label: "Weekly Active Zone Minutes",
        tip: () => ({ title: "Last 7 days", rows: [{ value: `${nf(d.azm_week || 0)} / ${g.azm_week}`, label: "zone minutes" }] }) }),
    }),
    vital("rhr", css("--lav"), "Resting heart"),
    vital("hrv", css("--pink"), "Heart rate variability"),
    mini({
      title: "Time sitting", href: "#trend-sedentary", value: d.sedentary != null ? hm(d.sedentary)[0] : "—",
      unit: d.sedentary != null ? `h ${hm(d.sedentary)[1]}m` : null,
      delta: d.sit_longest ? `Longest stretch ${dur(d.sit_longest)}` : "Counted while you're awake",
      viz: R.sedentary.filter(v => v != null).length >= 2 ? el => wave(el, R.sedentary, { color: css("--peach"), label: "Sitting time, last 14 days", minSpan: 30,
        tip: i => tipDay(i, R.sedentary[i] == null ? "no data" : dur(R.sedentary[i]), "sitting") }) : null,
    }),
  ];
}

// ---- heart rate card ------------------------------------------------------------------------
function heartCard() {
  const d = D.day, r = rec("rhr");
  const pts = d.hr.map(p => ({ x: Date.parse(p.ts) + 150000, y: p.v, lo: p.min ?? p.v, hi: p.max ?? p.v, ts: p.ts }));
  const host = chartHost();
  const ls = lastSyncMs();
  if (pts.length) draw(host, el => lineChart(el, {
    pts, xDomain: [d.day_start, d.day_end], color: css("--violet"), height: 190, band: true, area: true, smooth: true,
    gap: 16 * 60000, yDomain: [40, 160], label: "Heart rate, 5-minute averages",
    xTicks: (el.clientWidth < 560 ? [0, 6, 12, 18] : [0, 3, 6, 9, 12, 15, 18, 21]).map(hh => ({ x: d.day_start + hh * 3600000, label: fmtHour(d.day_start + hh * 3600000) })),
    shade: d.is_today && ls ? { from: ls, to: Date.now() } : null,
    tip: p => ({ title: `${fmtTime(Date.parse(p.ts))} – ${fmtTime(Date.parse(p.ts) + 300000)}`,
      rows: [{ color: css("--violet"), value: `${nf(p.y)} bpm`, label: "average" }, { value: `${nf(p.lo)}–${nf(p.hi)}`, label: "range" }] }),
  }));
  return h("div", { class: "card s7" },
    h("div", { class: "card-head" },
      h("div", null, h("h3", null, "Heart rate"), h("div", { class: "sub" }, d.is_today ? "Today, in 5-minute averages" : fmtDayFull(d.date))),
      arrowTo("#trend-rhr", "Resting heart rate trend")),
    h("div", { class: "num xl", style: "margin-top:14px" }, d.hr_avg != null ? nf(d.hr_avg) : "—", h("small", null, "bpm average")),
    h("div", { class: "panel" },
      h("div", { class: "pills" },
        h("span", null, "Resting", h("b", null, r && r.value != null ? nf(r.value) : "—")),
        h("span", null, "Lowest", h("b", null, nf(d.hr_min))),
        h("span", null, "Highest", h("b", null, nf(d.hr_max)))),
      pts.length ? host : h("div", { class: "empty", style: "padding:30px 4px 22px" }, d.is_today ? "No heart rate yet today. It appears after your Air syncs." : "No heart rate recorded this day.")));
}

// ---- overnight vitals list -----------------------------------------------------------------
function vitalsList() {
  const rows = [
    ["resp_rate", "wind", "--sky", "--sky-soft"],
    ["spo2", "drop", "--pink", "--pink-soft"],
    ["temp_delta", "thermo", "--peach", "--peach-soft"],
  ].map(([key, ic, c, soft]) => {
    const r = rec(key);
    let value = r.value, unit = r.unit, b = r.baseline || {};
    const isTemp = key === "temp_delta";
    if (isTemp && fahrenheit()) {
      const f = x => x == null ? null : x * 1.8;
      value = f(value); unit = "°F"; b = { ...b, mean: f(b.mean), sd: b.sd == null ? null : b.sd * 1.8 };
    }
    const show = x => isTemp ? signed(x, r.dp) : nf(x, r.dp);
    let status, rng;
    if (value == null) {
      status = h("span", { class: "status learning" }, "No data");
      rng = d0() ? "Appears after a night of sleep" : "No reading this day";
    } else if (b.mean != null) {
      const band = Math.max(b.sd || 0, { resp_rate: 0.6, spo2: 1, temp_delta: fahrenheit() ? 0.5 : 0.3 }[key]);
      const diff = value - b.mean;
      status = Math.abs(diff) <= band ? h("span", { class: "status good" }, icon("check"), "Normal")
        : h("span", { class: "status flag" }, icon(diff > 0 ? "up" : "down"), diff > 0 ? "High" : "Low");
      rng = `Your normal ${show(b.mean - band)} to ${show(b.mean + band)}`;
    } else {
      status = h("span", { class: "status learning" }, `Learning ${b.n || 0}/3`);
      rng = "Normal range after 3 nights";
    }
    return h("div", { class: "row" },
      h("div", { class: "tile", style: `background:var(${soft});color:${ink(css(c))}` }, icon(ic)),
      h("div", null, h("div", { class: "name" }, r.label + (isTemp ? " vs baseline" : "")),
        h("div", { class: "val" }, value == null ? "—" : show(value), value == null ? null : h("small", null, " " + unit)),
        h("div", { class: "rng" }, rng)),
      status);
  });
  const v = D.vo2max;
  rows.push(h("div", { class: "row" },
    h("div", { class: "tile", style: `background:var(--lav-soft);color:${ink(css("--lav"))}` }, icon("zap")),
    h("div", null, h("div", { class: "name" }, "Cardio fitness (VO₂ max)"),
      h("div", { class: "val" }, v.value != null ? nf(v.value) : "—", v.value != null ? h("small", null, " ml/kg/min") : null),
      h("div", { class: "rng" }, v.value != null ? `Estimated ${fmtDay(v.date)}` : "Estimated after a few days of wear")),
    h("span", { class: "status learning" }, v.value != null ? "Estimate" : "Soon")));
  return h("div", { class: "s5" },
    h("div", { class: "list-head" }, h("h3", null, "Overnight vitals"), h("span", null, "vs your 30-day normal")),
    h("div", { class: "rows" }, rows));
}
const d0 = () => D.day.is_today;

// ---- sleep card ------------------------------------------------------------------------------
const STAGES = [
  { type: "AWAKE", label: "Awake", color: "var(--st-awake)" },
  { type: "RESTLESS", label: "Restless", color: "var(--st-restless)" },
  { type: "REM", label: "REM", color: "var(--st-rem)" },
  { type: "LIGHT", label: "Light", color: "var(--st-light)" },
  { type: "ASLEEP", label: "Asleep", color: "var(--st-deep)" },
  { type: "DEEP", label: "Deep", color: "var(--st-deep)" },
];
function moonArt() {
  const id = uid("mm");
  const star = (x, y, s, c) => sv("path", { d: `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`, fill: c });
  return sv("svg", { class: "art", viewBox: "0 0 100 100", "aria-hidden": "true" },
    sv("defs", null, sv("mask", { id }, sv("rect", { width: 100, height: 100, fill: "#fff" }), sv("circle", { cx: 66, cy: 36, r: 25, fill: "#000" }))),
    sv("circle", { cx: 50, cy: 50, r: 30, fill: "var(--lav-soft)" }),
    sv("circle", { cx: 52, cy: 50, r: 26, fill: "var(--lav)", mask: `url(#${id})` }),
    star(80, 66, 7, "var(--butter)"), star(24, 22, 5, "var(--peach)"), star(86, 24, 4, "var(--butter)"));
}
function sleepCard() {
  const s = D.sleep, d = D.day;
  const head = (sub) => h("div", { class: "card-head" }, h("div", null, h("h3", null, "Sleep"), h("div", { class: "sub" }, sub)));
  if (!s || (!d.is_today && !s.on_selected)) {
    return h("div", { class: "card s6" }, moonArt(), head(d.is_today ? "Last night" : `Night ending ${fmtDayLong(d.date)}`),
      h("div", { class: "empty", style: "margin-top:26px;max-width:40ch" },
        h("b", null, d.is_today ? "No sleep recorded yet." : "No sleep recorded for this night."),
        d.is_today ? "Wear your Air to bed. Last night's sleep shows up here after your phone syncs in the morning." : "The Air wasn't worn overnight, or the night didn't sync."));
  }
  const summ = s.stages_summary || {};
  const present = STAGES.filter(st => summ[st.type] != null || s.timeline.some(x => x.type === st.type));
  const asleep = present.filter(st => st.type !== "AWAKE").reduce((a, st) => a + (summ[st.type] || 0), 0);
  const [hh, mm] = hm(s.minutes);
  const host = chartHost();
  if (s.timeline.length) {
    const segs = s.timeline.map(x => ({ type: x.type, start: Date.parse(x.start), end: Date.parse(x.end) }));
    draw(host, el => hypnoStep(el, segs, present, {
      ticks: (a, b) => { const out = [], st = 3600000; for (let t = Math.ceil(a / st) * st; t <= b; t += st) out.push({ x: t, label: (t / st) % 2 === 0 ? fmtHour(t) : "" }); return out; },
      tip: sg => { const meta = STAGES.find(x => x.type === sg.type); return { title: `${fmtTime(sg.start)} – ${fmtTime(sg.end)}`, rows: [{ color: meta.color, value: dur((sg.end - sg.start) / 60000), label: meta.label }] }; },
    }));
  }
  const facts = [];
  if (s.start && s.end) facts.push(h("span", { class: "soft-pill" }, icon("moon"), h("b", null, `${fmtTime(Date.parse(s.start))} → ${fmtTime(Date.parse(s.end))}`)));
  if (s.efficiency != null) facts.push(h("span", { class: "soft-pill" }, h("b", null, `${nf(s.efficiency)}%`), "asleep while in bed"));
  if (s.avg7 != null) facts.push(h("span", { class: "soft-pill" }, h("b", null, `${signed(s.minutes - s.avg7)} min`), "vs 7-night average"));
  if (s.nap) facts.push(h("span", { class: "soft-pill" }, h("b", null, dur(s.nap)), "naps"));
  return h("div", { class: "card s6", id: "sleep" }, moonArt(),
    head(s.date === D.today ? "Night ending this morning" : `Night ending ${fmtDayLong(s.date)}`),
    h("div", { class: "sleep-num" }, hh, h("small", null, "h"), String(mm).padStart(2, "0"), h("small", null, "m")),
    h("div", { class: "facts" }, facts),
    host,
    h("div", { class: "stage-tiles" }, present.map(st => h("div", { class: "stage-tile", style: `background:color-mix(in oklab, ${st.color} 13%, var(--card))` },
      h("span", null, h("i", { class: "key", style: `background:${st.color}` }), st.label),
      h("b", null, dur(summ[st.type] || 0)),
      h("small", null, st.type !== "AWAKE" && asleep ? `${Math.round((summ[st.type] || 0) / asleep * 100)}% of sleep` : "in bed, awake")))));
}

// ---- steps this week (consistency) -------------------------------------------------------------
function weekCard() {
  const wk = D.week, g = D.goals;
  const have = wk.filter(x => x.steps != null);
  const avg = have.length ? have.reduce((a, x) => a + x.steps, 0) / have.length : null;
  const host = chartHost();
  draw(host, el => weekBars(el, {
    height: 250, label: "Steps on each of the last 7 days",
    items: wk.map(x => ({ label: wkd(x.date), value: x.steps, selected: x.date === D.day.date, disabled: x.date < (D.range.first_date || x.date) })),
    avg, avgLabel: avg != null ? `Avg ${compact(Math.round(avg))}` : "", fmt: v => compact(Math.round(v)),
    onPick: i => selectDay(wk[i].date),
    tip: i => ({ title: fmtDayLong(wk[i].date), rows: [{ value: wk[i].steps == null ? "no data" : nf(wk[i].steps), label: wk[i].steps == null ? "" : wk[i].steps >= g.steps ? "steps · goal 🔥" : "steps" }] }),
  }));
  return h("div", { class: "card s6" },
    h("div", { class: "card-head" },
      h("div", null, h("h3", { class: "week-title" }, "Steps this week"),
        h("div", { class: "sub" }, avg != null ? `${have.filter(x => x.steps >= g.steps).length} of ${have.length} day${have.length === 1 ? "" : "s"} at goal · tap a day to open it` : "Fills in as you wear your Air")),
      arrowTo("#trend-steps", "Step trends")),
    host,
    have.length ? h("div", { class: "week-tiles" },
      weekTile("--mint", "Best day", compact(Math.max(...have.map(x => x.steps))), wkd(have.reduce((a, x) => x.steps > a.steps ? x : a).date)),
      weekTile("--sky", "Total", compact(have.reduce((a, x) => a + x.steps, 0)), "steps in 7 days"),
      weekTile("--peach", "At goal", `${have.filter(x => x.steps >= g.steps).length}/${have.length}`, have.length === 1 ? "day worn" : "days worn")) : null);
}
function weekTile(color, label, value, sub) {
  return h("div", { class: "week-tile", style: `background:var(${color}-soft)` },
    h("span", null, label), h("b", null, value), h("small", null, sub));
}

// ---- trends -------------------------------------------------------------------------------------
function trendsSection() {
  const R = D.range, n = R.dates.length, S = R.series, g = D.goals;
  const tabs = h("div", { class: "tabs", role: "radiogroup", "aria-label": "Trend range" },
    [7, 30, 90].map(dd => h("button", { type: "button", role: "radio", "aria-checked": String(dd === range),
      onclick: () => { if (dd !== range) { range = dd; setPref("range", dd); load(); } } }, `${dd} days`)));
  const step = n <= 7 ? 1 : n <= 31 ? 7 : 14;
  const xLabel = i => (n - 1 - i) % step === 0 ? (n <= 7 ? wkd(R.dates[i]) : fmtDay(R.dates[i])) : null;
  const xTicks = R.dates.map((d, i) => ({ x: i, label: xLabel(i) })).filter(t => t.label);
  const have = arr => arr.filter(v => v != null);
  const avg = arr => { const a = have(arr); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };

  function card(id, title, color, summary, drawFn) {
    const host = chartHost();
    draw(host, drawFn);
    return h("div", { class: "card s4", id: `trend-${id}` },
      h("div", { class: "card-head", style: "margin-bottom:6px" },
        h("h3", null, h("i", { class: "key", style: `background:${color};margin-right:8px` }), title),
        h("span", { class: "trend-sum" }, summary)),
      host);
  }
  const cols = (key, color, o = {}) => el => !have(S[key]).length
    ? el.replaceChildren(h("div", { class: "empty", style: "padding:38px 0" }, o.empty || "No data in this range yet."))
    : columnChart(el, {
      n, height: 160, color: css(color), value: i => o.map ? o.map(S[key][i]) : S[key][i], xLabel,
      goal: o.goal, goalLabel: o.goalLabel, yFmt: o.yFmt, label: o.label, onPick: i => selectDay(R.dates[i]),
      tip: i => ({ title: fmtDayLong(R.dates[i]), rows: [{ color: css(color), value: S[key][i] == null ? "no data" : o.fmt(S[key][i]), label: S[key][i] == null ? "" : o.unit || "" }] }),
    });
  const line = (key, color, o = {}) => el => {
    const pts = S[key].map((v, i) => ({ x: i, y: v, i })).filter(p => p.y != null);
    if (!pts.length) { el.replaceChildren(h("div", { class: "empty", style: "padding:38px 0" }, o.empty)); return; }
    lineChart(el, { pts, xDomain: [-0.5, n - 0.5], color: css(color), height: 160, gap: 1.5, dots: n <= 31, xTicks, smooth: true, area: true,
      minPad: o.minPad || 1, label: o.label,
      tip: p => ({ title: fmtDayLong(R.dates[p.i]), rows: [{ color: css(color), value: o.fmt(p.y), label: o.unit }] }) });
  };
  const days = arr => `${have(arr).length}/${n} days`;
  const night = "Appears after your first night wearing the Air.";

  const cards = [
    card("steps", "Steps", "var(--sky)", h("span", null, "avg ", h("b", null, nf(avg(S.steps))), ` · goal ${compact(g.steps)}`),
      cols("steps", "--sky", { goal: g.steps, goalLabel: compact(g.steps), fmt: v => nf(v), unit: "steps", label: "Daily steps" })),
    card("sleep", "Sleep", "var(--lav)", h("span", null, "avg ", h("b", null, dur(avg(S.sleep))), ` · goal ${g.sleep_hours}h`),
      cols("sleep", "--lav", { empty: night, map: v => v == null ? null : v / 60, goal: g.sleep_hours, goalLabel: `${g.sleep_hours}h`, yFmt: v => v + "h", fmt: v => dur(v), unit: "asleep", label: "Hours asleep per night" })),
    card("rhr", "Resting heart rate", "var(--violet)", h("span", null, "avg ", h("b", null, nf(avg(S.rhr))), " bpm"),
      line("rhr", "--violet", { fmt: v => `${nf(v)} bpm`, unit: "resting", empty: night, label: "Resting heart rate per day" })),
    card("hrv", "Heart rate variability", "var(--pink)", h("span", null, "avg ", h("b", null, nf(avg(S.hrv))), " ms"),
      line("hrv", "--pink", { fmt: v => `${nf(v)} ms`, unit: "HRV", empty: night, minPad: 3, label: "Nightly heart rate variability" })),
    card("azm", "Active Zone Minutes", "var(--mint)", h("span", null, "total ", h("b", null, nf(have(S.azm).reduce((a, b) => a + b, 0)))),
      cols("azm", "--mint", { empty: "None yet. Brisk walks and workouts earn these.", fmt: v => nf(v), unit: "minutes", label: "Active Zone Minutes per day" })),
    card("sedentary", "Time sitting", "var(--peach)", h("span", null, "avg ", h("b", null, dur(avg(S.sedentary))), " / day"),
      cols("sedentary", "--peach", { map: v => v == null ? null : v / 60, yFmt: v => v + "h", fmt: v => dur(v), unit: "sitting", label: "Hours sitting per day" })),
  ];

  const tcols = [
    ["Steps", "steps", v => nf(v)], ["Sleep", "sleep", dur], ["Resting HR", "rhr", v => nf(v)], ["HRV", "hrv", v => nf(v)],
    ["AZM", "azm", v => nf(v)], ["Calories", "calories", v => nf(v)], [`Distance (${distUnit()})`, "distance_km", v => nf(dist(v), 2)],
    ["Sitting", "sedentary", dur], ["SpO₂", "spo2", v => nf(v, 1)], ["Breathing", "resp_rate", v => nf(v, 1)],
  ];
  const rows = R.dates.map((d, i) => ({ d, i })).reverse().filter(({ i }) => tcols.some(([, k]) => S[k][i] != null));
  const table = h("details", { class: "table" },
    h("summary", null, `Daily numbers as a table (${rows.length} days with data)`),
    h("div", { class: "tbl-wrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Date"), tcols.map(([l]) => h("th", null, l)))),
      h("tbody", null, rows.map(({ d, i }) => h("tr", null, h("td", null, fmtDayLong(d)),
        tcols.map(([, k, f]) => h("td", null, S[k][i] == null ? "" : f(S[k][i])))))))));

  return [
    h("div", { class: "sec-head", id: "trends" }, h("h2", null, "Trends"), tabs),
    h("div", { class: "bento" }, cards),
    table,
    h("a", { class: "csv", href: "/api/export.csv" }, icon("download"), "Download all history as CSV"),
  ];
}

// ---- workouts -------------------------------------------------------------------------------------
function workoutsSection() {
  const w = D.workouts;
  const head = h("div", { class: "sec-head" }, h("h2", null, "Workouts"), h("span", { class: "trend-sum" }, `last ${range} days`));
  if (!w.length) {
    return [head, h("div", { class: "card empty", style: "margin-top:16px" }, `No workouts in the last ${range} days. Workouts you start on the Air or log in the app show up here.`)];
  }
  return [head, h("div", { class: "rows", style: "margin-top:16px" }, w.map(x => h("div", { class: "row w-row" },
    h("div", { class: "tile", style: `background:var(--mint-soft);color:${ink(css("--mint"))}` }, icon(/run|walk|hik/i.test(x.type) ? "steps" : "dumbbell")),
    h("div", null, h("div", { class: "val", style: "font-size:17px" }, x.type), h("div", { class: "rng" }, `${fmtDayLong(x.date)} · ${fmtTime(Date.parse(x.start))}`)),
    h("div", { class: "w-meta" },
      h("span", { class: "soft-pill" }, h("b", null, dur(x.minutes))),
      x.distance_km != null ? h("span", { class: "soft-pill" }, h("b", null, nf(dist(x.distance_km), 2)), distUnit()) : null,
      x.avg_hr != null ? h("span", { class: "soft-pill" }, icon("heart"), h("b", null, nf(x.avg_hr)), "bpm") : null,
      x.calories != null ? h("span", { class: "soft-pill" }, h("b", null, nf(x.calories)), "kcal") : null))))];
}

// ---- wiring ----------------------------------------------------------------------------------------
$("#sync").addEventListener("click", syncNow);
$("#theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  setPref("theme", root.dataset.theme);
  if (D) render();
});
let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => D && render(), 150); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => D && render());
setInterval(poll, 15000);
setInterval(() => { if (syncWaitSince) poll(); }, 2000);
setInterval(renderHeader, 30000);
load();
