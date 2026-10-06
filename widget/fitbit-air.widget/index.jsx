// Fitbit Air — Übersicht desktop widget. Reads today's steps, heart and sleep from the local
// dashboard (server.py) through /api/widget. Setup: widget/README.md.
import { css, run } from "uebersicht";

const DASHBOARD = "http://127.0.0.1:8787";  // change if you run the dashboard with DASH_PORT
const AIR_STALE_HOURS = 3;                   // same nudge threshold as the dashboard header

const POS_FILE = "fitbit-air.widget/position";  // "x y" of the card's top-left, written when you drop it
const CARD_W = 340, MARGIN = 32;

export const command = `sh fitbit-air.widget/fetch.sh ${DASHBOARD}`;
export const refreshFrequency = 5 * 60 * 1000; // the server checks Google every 2 min; this just reads its store

export const className = `top: 0; left: 0;`;  // the card positions itself (see Card below)

// ---- state: keep the last good reading when a refresh fails --------------------------------
export const initialState = { data: null, problem: null, gotAt: null, pos: null };

// Read the saved position once at start. No file (or a bad one) means the default top-right spot.
export const init = (dispatch) => {
  run(`cat ${POS_FILE} 2>/dev/null || true`)
    .then((out) => {
      const [x, y] = String(out).trim().split(/\s+/).map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) dispatch({ type: "FITBIT/MOVED", pos: { x, y } });
    })
    .catch(() => {});
};

const parse = (output) => {
  const text = (output || "").trimEnd();
  const i = text.lastIndexOf("\n");
  return { code: text.slice(i + 1).trim(), body: i >= 0 ? text.slice(0, i) : "" };
};

export const updateState = (event, prev) => {
  if (event.type === "FITBIT/MOVED") return { ...prev, pos: event.pos };
  if (event.type !== "UB/COMMAND_RAN") return prev;
  if (event.error) return { ...prev, problem: "widget" };
  const { code, body } = parse(event.output);
  if (code === "200") {
    try {
      return { ...prev, data: JSON.parse(body), problem: null, gotAt: Date.now() };
    } catch (e) {
      return { ...prev, problem: "server" };
    }
  }
  const problem = { nosecret: "nosecret", "401": "badkey", "000": "offline" }[code] || "server";
  return { ...prev, problem };
};

// ---- formatting -------------------------------------------------------------------------
const nf = (v) => (v == null ? "—" : Math.round(v).toLocaleString());
const time = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ms = (t) => (t == null ? null : typeof t === "number" ? t * 1000 : Date.parse(t));
const dur = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const weekday = (iso, style = "long") => new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: style });
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago`;
};

// ---- ring: the dashboard's pink → peach → lavender gradient, drawn as short arcs --------------
const STOPS = ["#ee8bb0", "#f4ac68", "#a99df7"];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (t) => {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2);
  const a = hex(STOPS[i]), b = hex(STOPS[i + 1]), f = x - i;
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
};

const Ring = ({ frac, size = 132, stroke = 13 }) => {
  const c = size / 2, r = (size - stroke) / 2 - 1, f = Math.max(0, Math.min(1, frac || 0));
  const pt = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
  const a0 = -Math.PI / 2, total = f * 2 * Math.PI, n = Math.max(2, Math.ceil(f * 90));
  const arcs = f > 0 ? Array.from({ length: n }, (_, i) => {
    const [x1, y1] = pt(a0 + (total * i) / n);
    const [x2, y2] = pt(a0 + (total * (i + 1)) / n + (i < n - 1 ? 0.015 : 0));
    return <path key={i} d={`M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`} fill="none"
                 stroke={mix((f * (i + 0.5)) / n)} strokeWidth={stroke} />;
  }) : null;
  const [sx, sy] = pt(a0), [ex, ey] = pt(a0 + total);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth={stroke} />
      {arcs}
      {f > 0 && <circle cx={sx} cy={sy} r={stroke / 2} fill={mix(0)} />}
      {f > 0 && <circle cx={ex} cy={ey} r={stroke / 2} fill={mix(f)} />}
    </svg>
  );
};

// ---- styles (dashboard dark palette, on glass) ------------------------------------------------
const card = css`
  width: ${CARD_W}px;
  box-sizing: border-box;
  padding: 18px 20px 16px;
  border-radius: 28px;
  color: #f4f4f7;
  font: 400 13px/1.4 "Outfit", -apple-system, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(220px 160px at 100% 0%, rgba(35, 30, 68, .75), transparent 70%),
    radial-gradient(220px 180px at 0% 100%, rgba(15, 42, 38, .75), transparent 70%),
    rgba(21, 23, 28, .55);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, .08);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 18px 40px -16px rgba(0, 0, 0, .6);
  position: fixed;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity .3s ease;
`;
const head = css`
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 12px; color: #b7b9c5; font-size: 12px;
  b { font: 600 14px "Bricolage Grotesque", "Outfit", system-ui, sans-serif; color: #f4f4f7; letter-spacing: -.01em; }
`;
const body = css`display: grid; grid-template-columns: auto 1fr; gap: 20px; align-items: center;`;
const ringBox = css`position: relative; width: 132px; height: 132px;`;
const center = css`
  position: absolute; inset: 0; display: grid; place-content: center; text-align: center;
  .lbl { color: #b7b9c5; font-size: 11.5px; }
  .big { font-size: 27px; line-height: 1.15; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .of { color: #7e8191; font-size: 11.5px; }
  .met { color: #5fc795; }
`;
const stats = css`
  display: grid; gap: 14px;
  .k { display: flex; align-items: center; gap: 6px; color: #b7b9c5; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; }
  .k i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .v { font-size: 22px; line-height: 1.2; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
  .v small { font-size: 12px; color: #b7b9c5; margin-left: 3px; letter-spacing: 0; }
  .s { color: #7e8191; font-size: 11.5px; }
`;
const note = css`
  margin-top: 14px; padding: 8px 12px; border-radius: 14px; font-size: 12px; color: #f4f4f7;
  &.warn { background: rgba(238, 197, 90, .16); }
  &.bad { background: rgba(238, 139, 176, .18); }
`;

// ---- pieces -------------------------------------------------------------------------------------
const PROBLEMS = {
  nosecret: ["bad", "Widget key missing. Copy data/widget_secret to fitbit-air.widget/secret (see README)."],
  badkey: ["bad", "Widget key doesn't match the dashboard's. Copy data/widget_secret again."],
  offline: ["warn", "Dashboard isn't running. Double-click “Start Dashboard.command”."],
  server: ["warn", "The dashboard returned an error. It will retry in 5 minutes."],
  widget: ["warn", "The widget couldn't run its fetch script."],
};

function notices(data, problem, gotAt) {
  const out = [];
  if (problem) {
    const [kind, text] = PROBLEMS[problem];
    out.push([kind, data && gotAt ? `${text} Showing data from ${time(gotAt)}.` : text]);
  }
  if (!data) return out;
  const s = data.sync || {};
  if (!s.google_connected) {
    out.push(["bad", "Google login expired. Open the dashboard and click Reconnect Google."]);
  } else if (s.login_expires_at && s.login_expires_at * 1000 - Date.now() < 86400000) {
    out.push(["warn", "Google login expires within a day. Reconnect from the dashboard."]);
  }
  const air = ms(s.air_last_sync);
  if (air && Date.now() - air > AIR_STALE_HOURS * 3600000) {
    out.push(["warn", `Air last synced ${ago(air)}. Open Google Health on your phone.`]);
  }
  return out;
}

// Resting HR lands after the first night; until then the latest 5-min average leads.
function Heart({ h }) {
  const main = h.resting != null ? [h.resting, "bpm resting"] : h.latest != null ? [h.latest, `bpm · ${time(ms(h.latest_at))}`] : null;
  const range = h.min != null && h.max != null ? `today ${nf(h.min)}–${nf(h.max)}` : null;
  const sub = h.resting != null && h.latest != null ? `now ${nf(h.latest)} · ${time(ms(h.latest_at))}` : range || "no readings yet today";
  return (
    <div>
      <div className="k"><i style={{ background: "#ee8bb0" }} />Heart</div>
      <div className="v">{main ? nf(main[0]) : "—"}{main && <small>{main[1]}</small>}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

function Sleep({ s, today }) {
  if (!s || s.minutes == null) {
    return (
      <div>
        <div className="k"><i style={{ background: "#a99df7" }} />Sleep</div>
        <div className="v">—</div>
        <div className="s">no night recorded yet</div>
      </div>
    );
  }
  const when = s.date === today ? "last night" : weekday(s.date, "short");
  const range = s.start && s.end ? ` · ${time(ms(s.start))}–${time(ms(s.end))}` : "";
  return (
    <div>
      <div className="k"><i style={{ background: "#a99df7" }} />Sleep</div>
      <div className="v">{dur(s.minutes)}</div>
      <div className="s">{when}{range}</div>
    </div>
  );
}

// ---- moving: drag the card anywhere; a click without movement opens the dashboard ----------------
const clamp = (x, y, w, h) => ({
  x: Math.round(Math.max(0, Math.min(x, window.innerWidth - w))),
  y: Math.round(Math.max(0, Math.min(y, window.innerHeight - h))),
});

const startDrag = (e, dispatch) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const el = e.currentTarget, r = el.getBoundingClientRect();
  const x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  const at = (ev) => clamp(r.left + ev.clientX - x0, r.top + ev.clientY - y0, r.width, r.height);
  const move = (ev) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    moved = true;
    const p = at(ev);
    Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, right: "auto", cursor: "grabbing" });
  };
  const up = (ev) => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    el.style.cursor = "";
    if (!moved) return run(`open ${DASHBOARD}/`);
    const p = at(ev);
    dispatch({ type: "FITBIT/MOVED", pos: p });
    run(`printf '%d %d\\n' ${p.x} ${p.y} > ${POS_FILE}`).catch(() => {});
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
};

// Saved spot (pulled back on-screen if the display got smaller), else top-right.
const place = (pos) => pos
  ? { left: `${Math.max(0, Math.min(pos.x, window.innerWidth - CARD_W))}px`,
      top: `${Math.max(0, Math.min(pos.y, window.innerHeight - 120))}px` }
  : { top: `${MARGIN}px`, right: `${MARGIN}px` };

const Card = ({ pos, dispatch, dim, children }) => (
  <div className={card} style={{ ...place(pos), opacity: dim ? 0.75 : 1 }}
       onMouseDown={(e) => startDrag(e, dispatch)} title="Drag to move · click to open the dashboard">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600&family=Outfit:wght@400;500&display=swap" />
    {children}
  </div>
);

export const render = ({ data, problem, gotAt, pos }, dispatch) => {
  const today = localISO();
  const list = notices(data, problem, gotAt);

  if (!data) {
    return (
      <Card pos={pos} dispatch={dispatch}>
        <div className={head}><b>Fitbit Air</b><span>{problem ? "" : "loading…"}</span></div>
        {list.map(([k, t], i) => <div key={i} className={`${note} ${k}`}>{t}</div>)}
      </Card>
    );
  }

  const st = data.steps || {};
  const steps = st.value, goal = st.goal || 10000;
  const met = steps != null && steps >= goal;
  const isToday = data.date === today;
  const air = ms(data.sync && data.sync.air_last_sync);

  return (
    <Card pos={pos} dispatch={dispatch} dim={problem === "offline"}>
      <div className={head}>
        <b>Fitbit Air</b>
        <span>{air ? `synced ${time(air)}` : "not synced yet"}</span>
      </div>
      <div className={body}>
        <div className={ringBox}>
          <Ring frac={(steps || 0) / goal} />
          <div className={center}>
            <div className={met ? "lbl met" : "lbl"}>{met ? "Goal met" : isToday ? "Today" : weekday(data.date)}</div>
            <div className="big">{nf(steps)}</div>
            <div className="of">of {nf(goal)} steps</div>
          </div>
        </div>
        <div className={stats}>
          <Heart h={data.heart || {}} />
          <Sleep s={data.sleep} today={data.date} />
        </div>
      </div>
      {list.map(([k, t], i) => <div key={i} className={`${note} ${k}`}>{t}</div>)}
    </Card>
  );
};
