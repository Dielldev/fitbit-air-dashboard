"use strict";
// Small SVG chart kit for the pastel dashboard. Every chart has hover tooltips;
// missing days are gaps (never zeros); thin marks, rounded ends, quiet axes.

const SVGNS = "http://www.w3.org/2000/svg";
let _uid = 0;
const uid = p => `${p}${++_uid}`;

// DOM builders. Strings always become text nodes, never HTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
}

// ---- icons (stroke, 24x24) ----------------------------------------------------------
const ICONS = {
  arrow: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  steps: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4M4 13h4"/>',
  wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  sofa: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M5 18v2M19 18v2"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  watch: '<circle cx="12" cy="12" r="6"/><path d="M12 10v2l1 1"/><path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05"/><path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  up: '<path d="m7 17 10-10M7 7h10v10"/>',
  down: '<path d="m7 7 10 10M17 7v10H7"/>',
  dumbbell: '<path d="M6.5 6.5 17.5 17.5"/><path d="m21 21-1-1M3 3l1 1"/><path d="m18 22 4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
};
function icon(name, attrs) {
  const el = sv("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8,
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", ...(attrs || {}) });
  el.innerHTML = ICONS[name] || "";   // static strings from ICONS only
  return el;
}

// ---- tooltip -----------------------------------------------------------------------
const Tip = {
  get el() { return document.getElementById("tip"); },
  show(evt, title, rows) {
    const t = this.el;
    t.replaceChildren(h("div", { class: "t" }, title), ...rows.map(r => h("div", { class: "row-t" },
      r.color ? h("i", { class: "key line", style: `background:${r.color}` }) : null,
      h("b", null, r.value), r.label ? h("span", null, r.label) : null)));
    t.classList.add("on");
    this.move(evt);
  },
  move(evt) {
    const t = this.el;
    let x, y;
    if (evt && evt.clientX != null && evt.type !== "focus") { x = evt.clientX; y = evt.clientY; }
    else { const r = evt.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
    const w = t.offsetWidth, hh = t.offsetHeight, pad = 12;
    let left = x + 14, top = y - hh - 12;
    if (left + w > innerWidth - pad) left = x - w - 14;
    if (top < pad) top = y + 16;
    t.style.left = Math.max(pad, left) + "px";
    t.style.top = top + "px";
  },
  hide() { this.el.classList.remove("on"); },
};
function hover(el, get, onEnter, onLeave) {
  el.addEventListener("pointerenter", e => { const t = get(e); if (t) { onEnter && onEnter(); Tip.show(e, t.title, t.rows); } });
  el.addEventListener("pointermove", e => Tip.move(e));
  el.addEventListener("pointerleave", () => { onLeave && onLeave(); Tip.hide(); });
}

// ---- helpers -------------------------------------------------------------------------
function niceStep(range, count) {
  const raw = range / count, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function niceDomain(lo, hi, count = 4, zero = false) {
  if (zero) lo = Math.min(0, lo);
  if (!(hi > lo)) { hi = lo + (zero ? 1 : 2); if (!zero) lo -= 2; }
  const step = niceStep(hi - lo, count);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { lo: a, hi: b, ticks };
}
const compact = v => Math.abs(v) >= 10000 ? (v / 1000).toFixed(0) + "k"
  : Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k" : String(+v.toFixed(1));

function frame(host, height, m, minW = 120) {
  const W = Math.max(minW, Math.floor(host.clientWidth || host.getBoundingClientRect().width || 300));
  const svg = sv("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img" });
  host.replaceChildren(svg);
  return { svg, W, H: height, pw: W - m.l - m.r, ph: height - m.t - m.b };
}
function yAxis(svg, dom, y, m, W, fmt) {
  for (const t of dom.ticks) {
    svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: "var(--line)", "stroke-width": 1, "shape-rendering": "crispEdges" }));
    svg.append(sv("text", { x: m.l - 8, y: y(t), dy: "0.32em", "text-anchor": "end" }, (fmt || compact)(t)));
  }
}
function barPath(x, base, w, hgt, r) {
  if (hgt <= 0) return "";
  r = Math.min(r, w / 2, hgt);
  const top = base - hgt;
  return `M${x},${base}V${top + r}A${r},${r} 0 0 1 ${x + r},${top}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${top + r}V${base}Z`;
}
// Catmull-Rom through the points, as cubic Béziers
function smoothPath(pts) {
  if (pts.length < 3) return "M" + pts.map(p => `${p[0]},${p[1]}`).join(" L");
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, k = 1 / 6;
    d += ` C${p1[0] + (p2[0] - p0[0]) * k},${p1[1] + (p2[1] - p0[1]) * k} ${p2[0] - (p3[0] - p1[0]) * k},${p2[1] - (p3[1] - p1[1]) * k} ${p2[0]},${p2[1]}`;
  }
  return d;
}
function runsOf(pts, gap) {
  const runs = [];
  let cur = [];
  pts.forEach((p, i) => {
    if (i && gap && p.x - pts[i - 1].x > gap) { runs.push(cur); cur = []; }
    cur.push(p);
  });
  if (cur.length) runs.push(cur);
  return runs;
}
function hex2rgb(hx) {
  const m = hx.trim().replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map(c => c + c).join("") : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixStops(stops, t) {   // stops: hex[] evenly spaced; t in [0,1]
  const s = Math.min(stops.length - 1.0001, Math.max(0, t) * (stops.length - 1));
  const i = Math.floor(s), f = s - i, a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}
function areaGradient(svg, color, top = 0.28) {
  const id = uid("ag");
  svg.append(sv("defs", null, sv("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 },
    sv("stop", { offset: 0, "stop-color": color, "stop-opacity": top }),
    sv("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }))));
  return `url(#${id})`;
}

// ---- progress ring (positional gradient, rounded ends) -----------------------------------
function ring(host, o) {
  const S = 214, sw = o.stroke || 20, r = (S - sw) / 2 - 1, c = S / 2;
  const svg = sv("svg", { viewBox: `0 0 ${S} ${S}`, role: "img", "aria-label": o.label });
  svg.append(sv("circle", { cx: c, cy: c, r, fill: "none", stroke: "var(--track)", "stroke-width": sw }));
  const f = Math.max(0, Math.min(1, o.frac || 0));
  const pt = a => [c + r * Math.cos(a), c + r * Math.sin(a)];
  if (f > 0) {
    const a0 = -Math.PI / 2, total = f * 2 * Math.PI, N = Math.max(2, Math.ceil(f * 160));
    const g = sv("g");
    for (let i = 0; i < N; i++) {
      const s = a0 + total * i / N, e = a0 + total * (i + 1) / N + (i < N - 1 ? 0.012 : 0);
      const [x1, y1] = pt(s), [x2, y2] = pt(e);
      g.append(sv("path", { d: `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`, fill: "none", stroke: mixStops(o.colors, f * (i + 0.5) / N), "stroke-width": sw }));
    }
    const [sx, sy] = pt(a0), [ex, ey] = pt(a0 + total);
    g.append(sv("circle", { cx: sx, cy: sy, r: sw / 2, fill: mixStops(o.colors, 0) }));
    g.append(sv("circle", { cx: ex, cy: ey, r: sw / 2, fill: mixStops(o.colors, f) }));
    svg.append(g);
  }
  if (o.tip) { const hit = sv("circle", { cx: c, cy: c, r: r + sw / 2, class: "hit" }); hover(hit, o.tip); svg.append(hit); }
  host.replaceChildren(svg);
}

// stacked hairlines that fill from the bottom (a tiny vertical meter)
function stripes(frac, color, n = 11) {
  const el = h("div", { class: "stripes", "aria-hidden": "true" });
  const filled = Math.round(Math.max(0, Math.min(1, frac || 0)) * n);
  for (let i = 0; i < n; i++) el.append(h("i", n - 1 - i < filled ? { style: `background:${color}` } : null));
  return el;
}

// ---- mini bars (card footers) ---------------------------------------------------------------
function miniBars(host, vals, o) {
  const m = { l: 22, r: 22, t: 4, b: 0 };
  const { svg, pw, ph } = frame(host, host.clientHeight || 56, m);
  svg.setAttribute("aria-label", o.label || "");
  const have = vals.filter(v => v != null);
  if (!have.length) return;
  const lo = Math.min(...have), hi = Math.max(...have), span = Math.max(hi - lo, o.minSpan || 1);
  const base = lo - span * 0.9;              // sparkline scale: shows change; the tooltip has the value
  const band = pw / vals.length, bw = Math.max(3, Math.min(9, band * 0.42));
  vals.forEach((v, i) => {
    const x = m.l + i * band + (band - bw) / 2;
    if (v != null) {
      const hgt = Math.max(4, (v - base) / (Math.max(hi, base + span) - base) * ph);
      svg.append(sv("path", { d: barPath(x, m.t + ph, bw, hgt, 3), fill: o.color, opacity: i === vals.length - 1 ? 1 : 0.35 + 0.5 * i / vals.length, class: "bar" }));
    }
    const hit = sv("rect", { x: m.l + i * band, y: 0, width: band, height: m.t + ph, class: "hit" });
    hover(hit, () => o.tip && o.tip(i));
    svg.append(hit);
  });
}

// ---- smooth wave (card footers) ---------------------------------------------------------------
function wave(host, vals, o) {
  const m = { l: 22, r: 22, t: 8, b: 10 };
  const { svg, pw, ph } = frame(host, host.clientHeight || 56, m);
  svg.setAttribute("aria-label", o.label || "");
  const pts = vals.map((v, i) => ({ x: i, y: v })).filter(p => p.y != null);
  if (!pts.length) return;
  const lo = Math.min(...pts.map(p => p.y)), hi = Math.max(...pts.map(p => p.y)), pad = Math.max((hi - lo) * 0.15, o.minSpan || 1);
  const X = i => m.l + (vals.length === 1 ? pw : i / (vals.length - 1) * pw);
  const Y = v => m.t + ph - (v - (lo - pad)) / (hi - lo + 2 * pad) * ph;
  const fill = areaGradient(svg, o.color, 0.22);
  for (const run of runsOf(pts, 1)) {
    const xy = run.map(p => [X(p.x), Y(p.y)]);
    if (xy.length > 1) {
      svg.append(sv("path", { d: smoothPath(xy) + ` L${xy[xy.length - 1][0]},${m.t + ph + m.b} L${xy[0][0]},${m.t + ph + m.b}Z`, fill }));
      svg.append(sv("path", { d: smoothPath(xy), fill: "none", stroke: o.color, "stroke-width": 2.5, "stroke-linecap": "round" }));
    }
  }
  const last = pts[pts.length - 1];
  svg.append(sv("circle", { cx: X(last.x), cy: Y(last.y), r: 4.5, fill: o.color, stroke: "var(--card)", "stroke-width": 2 }));
  const band = pw / Math.max(1, vals.length - 1);
  vals.forEach((v, i) => {
    const hit = sv("rect", { x: X(i) - band / 2, y: 0, width: band, height: m.t + ph + m.b, class: "hit" });
    hover(hit, () => o.tip && o.tip(i));
    svg.append(hit);
  });
}

// ---- half-arc gauge (card footer) ---------------------------------------------------------------
function halfArc(host, o) {
  const H = host.clientHeight || 96;
  const { svg, W } = frame(host, H, { l: 0, r: 0, t: 0, b: 0 });
  svg.setAttribute("aria-label", o.label || "");
  const sw = 16, r = Math.min((W - 44) / 2, H + 10), cx = W / 2, cy = 14 + r;
  const id = uid("arc");
  svg.append(sv("defs", null, sv("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: cx - r, y1: 0, x2: cx + r, y2: 0 },
    sv("stop", { offset: 0, "stop-color": o.colors[0] }), sv("stop", { offset: 1, "stop-color": o.colors[1] }))));
  const arcD = `M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`;
  const len = Math.PI * r, f = Math.max(0, Math.min(1, o.frac || 0));
  svg.append(sv("path", { d: arcD, fill: "none", stroke: "var(--track)", "stroke-width": sw, "stroke-linecap": "round" }));
  if (f > 0) svg.append(sv("path", { d: arcD, fill: "none", stroke: `url(#${id})`, "stroke-width": sw, "stroke-linecap": "round", "stroke-dasharray": `${len * f} ${len}` }));
  if (o.tip) { const hit = sv("rect", { x: 0, y: 0, width: W, height: H, class: "hit" }); hover(hit, o.tip); svg.append(hit); }
}

// ---- column chart (hourly steps, trends) -----------------------------------------------------------
// o: { n, value(i), xLabel(i), color | colorAt(i), height, goal, goalLabel, ghost(i), tip(i), yFmt, label, radius, onPick(i) }
function columnChart(host, o) {
  const m = { l: 38, r: 6, t: 16, b: 24 };
  const { svg, W, H, pw, ph } = frame(host, o.height || 170, m);
  if (o.label) svg.setAttribute("aria-label", o.label);
  const vals = Array.from({ length: o.n }, (_, i) => o.value(i));
  const ghosts = o.ghost ? Array.from({ length: o.n }, (_, i) => o.ghost(i)) : [];
  const maxV = Math.max(1, ...vals.filter(v => v != null), ...ghosts.filter(v => v != null), o.goal || 0);
  const dom = niceDomain(0, maxV, 3, true);
  const y = v => m.t + ph - (v - dom.lo) / (dom.hi - dom.lo) * ph;
  if (o.goal) dom.ticks = dom.ticks.filter(t => Math.abs(y(t) - y(o.goal)) > 14 || t === 0);
  yAxis(svg, dom, y, m, W, o.yFmt);
  const band = pw / o.n;
  let bw = Math.min(o.maxBar || 22, band * 0.62);
  if (band - bw < 2) bw = Math.max(1, band - 2);
  const base = y(0), bars = [];
  vals.forEach((v, i) => {
    const x = m.l + i * band + (band - bw) / 2;
    if (v != null && v > 0) {
      const p = sv("path", { d: barPath(x, base, bw, Math.max(2, base - y(v)), o.radius ?? 6), fill: o.colorAt ? o.colorAt(i) : o.color, class: "bar" });
      svg.append(p);
      bars[i] = p;
    }
    if (ghosts[i] != null && ghosts[i] > 0) {
      svg.append(sv("line", { x1: x - 2, x2: x + bw + 2, y1: y(ghosts[i]), y2: y(ghosts[i]), stroke: "var(--ink-2)", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.45 }));
    }
    const lab = o.xLabel && o.xLabel(i);
    if (lab) svg.append(sv("text", { x: m.l + i * band + band / 2, y: H - 6, "text-anchor": "middle" }, lab));
  });
  if (o.goal) {
    // goal: dashed line plus a dark tick-pill on the axis, so it never sits on top of a bar
    const gy = y(o.goal), label = o.goalLabel || "Goal", tw = Math.max(26, label.length * 6.2 + 10);
    svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: gy, y2: gy, stroke: "var(--ink-2)", "stroke-width": 1, "stroke-dasharray": "3 4", opacity: 0.6 }));
    svg.append(sv("rect", { x: m.l - 4 - tw, y: gy - 9, width: tw, height: 18, rx: 9, fill: "var(--ink)" }));
    svg.append(sv("text", { x: m.l - 4 - tw / 2, y: gy, dy: "0.34em", "text-anchor": "middle", style: "fill:var(--card);font-size:10.5px" }, label));
  }
  vals.forEach((v, i) => {
    if (!o.tip) return;
    const r = sv("rect", { x: m.l + i * band, y: m.t, width: band, height: ph, class: "hit" + (o.onPick ? " pick" : "") });
    hover(r, () => o.tip(i), () => bars[i] && bars[i].classList.add("on"), () => bars[i] && bars[i].classList.remove("on"));
    if (o.onPick) r.addEventListener("click", () => o.onPick(i));
    svg.append(r);
  });
}

// ---- line chart (heart rate, trends) ---------------------------------------------------------------
// o: { pts:[{x,y,lo,hi}], xDomain, color, height, yDomain, yStep, xTicks, gap, dots, band, area, smooth, tip, yFmt, shade:{from,to}, label }
function lineChart(host, o) {
  const m = { l: 38, r: 8, t: 12, b: 24 };
  const { svg, W, H, pw, ph } = frame(host, o.height || 170, m);
  if (o.label) svg.setAttribute("aria-label", o.label);
  const pts = o.pts.filter(p => p.y != null);
  const ys = pts.flatMap(p => [p.y, p.lo, p.hi]).filter(v => v != null);
  const lo = ys.length ? Math.min(...ys) : 0, hi = ys.length ? Math.max(...ys) : 1;
  let dom;
  if (o.yDomain) {
    const st = o.yStep || 40;
    const a = Math.floor(Math.min(o.yDomain[0], lo) / st) * st, b = Math.ceil(Math.max(o.yDomain[1], hi) / st) * st;
    dom = { lo: a, hi: b, ticks: Array.from({ length: Math.round((b - a) / st) + 1 }, (_, i) => a + i * st) };
  } else {
    const pad = Math.max((hi - lo) * 0.15, o.minPad || 1);
    dom = niceDomain(lo - pad, hi + pad, 3, false);
  }
  const [xa, xb] = o.xDomain;
  const x = v => m.l + (v - xa) / (xb - xa) * pw;
  const y = v => m.t + ph - (v - dom.lo) / (dom.hi - dom.lo) * ph;
  yAxis(svg, dom, y, m, W, o.yFmt);
  for (const t of o.xTicks || []) svg.append(sv("text", { x: x(t.x), y: H - 6, "text-anchor": "middle" }, t.label));

  if (o.shade && o.shade.from < Math.min(xb, o.shade.to)) {
    // between the Air's last sync and now: recorded on the wrist, not in the cloud yet
    const sx = x(Math.max(xa, o.shade.from)), ex = x(Math.min(xb, o.shade.to));
    svg.append(sv("rect", { x: sx, y: m.t, width: Math.max(2, ex - sx), height: ph, rx: 4, fill: "var(--card)", opacity: 0.6 }));
    svg.append(sv("line", { x1: ex, x2: ex, y1: m.t, y2: m.t + ph, stroke: "var(--ink-2)", "stroke-width": 1, opacity: 0.5 }));
    svg.append(sv("text", { x: ex + 6, y: m.t + 10 }, "now"));
  }

  const runs = runsOf(pts, o.gap);
  const path = xy => o.smooth ? smoothPath(xy) : "M" + xy.map(p => `${p[0]},${p[1]}`).join(" L");
  if (o.band) {
    for (const r of runs) {
      if (r.length < 2 || r[0].lo == null) continue;
      const top = r.map(p => `${x(p.x)},${y(p.hi)}`).join(" L");
      const bot = r.slice().reverse().map(p => `${x(p.x)},${y(p.lo)}`).join(" L");
      svg.append(sv("path", { d: `M${top} L${bot}Z`, fill: o.color, opacity: 0.14 }));
    }
  }
  const fill = o.area ? areaGradient(svg, o.color, 0.25) : null;
  for (const r of runs) {
    if (r.length === 1) continue;
    const xy = r.map(p => [x(p.x), y(p.y)]);
    if (fill) svg.append(sv("path", { d: path(xy) + ` L${xy[xy.length - 1][0]},${m.t + ph} L${xy[0][0]},${m.t + ph}Z`, fill }));
    svg.append(sv("path", { d: path(xy), fill: "none", stroke: o.color, "stroke-width": 2.25, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }
  const showDots = o.dots || pts.length < 3;
  for (const r of runs) for (const p of r) {
    if (showDots || r.length === 1) svg.append(sv("circle", { cx: x(p.x), cy: y(p.y), r: 4, fill: o.color, stroke: "var(--card)", "stroke-width": 2 }));
  }
  if (!pts.length || !o.tip) return;
  const vline = sv("line", { y1: m.t, y2: m.t + ph, stroke: "var(--ink-2)", "stroke-width": 1, opacity: 0 });
  const dot = sv("circle", { r: 5.5, fill: o.color, stroke: "var(--card)", "stroke-width": 2.5, opacity: 0 });
  const hit = sv("rect", { x: m.l, y: m.t, width: pw, height: ph, class: "hit" });
  svg.append(vline, dot, hit);
  hit.addEventListener("pointermove", e => {
    const rect = svg.getBoundingClientRect();
    const xv = xa + (e.clientX - rect.left - m.l) / pw * (xb - xa);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p;
    vline.setAttribute("x1", x(best.x)); vline.setAttribute("x2", x(best.x)); vline.setAttribute("opacity", 0.35);
    dot.setAttribute("cx", x(best.x)); dot.setAttribute("cy", y(best.y)); dot.setAttribute("opacity", 1);
    const t = o.tip(best);
    Tip.show(e, t.title, t.rows);
  });
  hit.addEventListener("pointerleave", () => { vline.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); Tip.hide(); });
}

// ---- consistency bars: one highlighted day, average pill, day pills underneath -----------------------
// o: { items:[{label, value, selected, disabled}], avg, avgLabel, fmt, onPick(i), tip(i), height }
function weekBars(host, o) {
  const m = { l: 4, r: 4, t: 38, b: 40 };
  const { svg, W, H, pw, ph } = frame(host, o.height || 240, m, 260);
  svg.setAttribute("aria-label", o.label || "");
  const vals = o.items.map(it => it.value);
  const max = Math.max(1, ...vals.filter(v => v != null), o.avg || 0) * 1.04;
  const y = v => m.t + ph - v / max * ph;
  const n = o.items.length, band = pw / n, bw = Math.min(54, band * 0.74);
  o.items.forEach((it, i) => {
    const x = m.l + i * band + (band - bw) / 2;
    const v = it.value;
    if (v != null) {
      const top = Math.min(y(v), m.t + ph - 8);
      svg.append(sv("rect", { x, y: top, width: bw, height: m.t + ph - top, rx: 10, fill: it.selected ? "var(--teal)" : "var(--bar-soft)", class: "bar" }));
      if (it.selected) {
        const label = o.fmt(v), tw = Math.max(bw - 6, label.length * 7.2 + 14);
        svg.append(sv("rect", { x: x + bw / 2 - tw / 2, y: top - 30, width: tw, height: 22, rx: 8, fill: "var(--teal)" }));
        svg.append(sv("text", { x: x + bw / 2, y: top - 19, dy: "0.34em", "text-anchor": "middle", style: "fill:var(--teal-ink);font-size:12px;font-weight:600" }, label));
      }
    } else {
      svg.append(sv("rect", { x, y: m.t + ph - 8, width: bw, height: 8, rx: 4, fill: "var(--track)" }));
    }
    const py = H - 30;
    svg.append(sv("rect", { x: x + 1, y: py, width: bw - 2, height: 24, rx: 12, fill: it.selected ? "var(--teal-soft)" : "none", stroke: it.selected ? "none" : "var(--line)" }));
    svg.append(sv("text", { x: x + bw / 2, y: py + 12, dy: "0.34em", "text-anchor": "middle", style: `fill:${it.selected ? "var(--ink)" : "var(--ink-2)"};font-size:11.5px` }, it.label));
    const hit = sv("rect", { x: m.l + i * band, y: 0, width: band, height: H, class: "hit" + (it.disabled ? "" : " pick") });
    hover(hit, () => o.tip(i));
    if (!it.disabled) hit.addEventListener("click", () => o.onPick(i));
    svg.append(hit);
  });
  if (o.avg) {
    const ay = y(o.avg), label = o.avgLabel, tw = label.length * 6.2 + 16;
    svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: ay, y2: ay, stroke: "var(--ink)", "stroke-width": 1, "stroke-dasharray": "2 4", opacity: 0.55 }));
    svg.append(sv("rect", { x: m.l, y: ay - 10, width: tw, height: 20, rx: 10, fill: "var(--ink)" }));
    svg.append(sv("text", { x: m.l + tw / 2, y: ay, dy: "0.34em", "text-anchor": "middle", style: "fill:var(--card);font-size:11px;font-weight:500" }, label));
  }
}

// ---- sleep stages as a stepped line ------------------------------------------------------------------
// segs: [{type,start,end}] (ms); rows: [{type,label,color}] top->bottom
function hypnoStep(host, segs, rows, o) {
  const gapY = 30, m = { l: 58, r: 12, t: 12, b: 28 };
  const H = m.t + (rows.length - 1) * gapY + m.b + 8;
  const { svg, W, pw } = frame(host, H, m, 260);
  svg.setAttribute("aria-label", "Sleep stages through the night");
  const xa = Math.min(...segs.map(s => s.start)), xb = Math.max(...segs.map(s => s.end));
  const x = t => m.l + (t - xa) / (xb - xa) * pw;
  const rowY = {}, color = {};
  rows.forEach((r, i) => {
    rowY[r.type] = m.t + 4 + i * gapY; color[r.type] = r.color;
    svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: rowY[r.type], y2: rowY[r.type], stroke: "var(--line)", "stroke-width": 1 }));
    svg.append(sv("text", { x: m.l - 12, y: rowY[r.type], dy: "0.32em", "text-anchor": "end" }, r.label));
  });
  for (const t of o.ticks(xa, xb)) svg.append(sv("text", { x: x(t.x), y: H - 6, "text-anchor": "middle" }, t.label));
  const segsIn = segs.filter(s => rowY[s.type] != null);
  for (let i = 1; i < segsIn.length; i++) {   // stage transitions
    const a = segsIn[i - 1], b = segsIn[i], xx = x(b.start);
    svg.append(sv("line", { x1: xx, x2: xx, y1: rowY[a.type], y2: rowY[b.type], stroke: "var(--muted)", "stroke-width": 1.2, opacity: 0.45 }));
  }
  for (const s of segsIn) {
    const x1 = x(s.start), x2 = Math.max(x1 + 0.5, x(s.end));
    const seg = sv("line", { x1: x1 + 4, x2: Math.max(x1 + 4, x2 - 4), y1: rowY[s.type], y2: rowY[s.type], stroke: color[s.type], "stroke-width": 9, "stroke-linecap": "round", class: "bar" });
    const hit = sv("rect", { x: x1 - 2, y: rowY[s.type] - 12, width: x2 - x1 + 4, height: 24, class: "hit" });
    hover(hit, () => o.tip(s), () => seg.classList.add("on"), () => seg.classList.remove("on"));
    svg.append(seg, hit);
  }
}
