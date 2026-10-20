// Small dependency-free SVG chart helpers: line charts with a crosshair tooltip,
// grouped column charts with per-bar tooltips, and sparklines.
// Colours come from CSS custom properties so light and dark mode both work.

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceTicks(min, max, count = 5) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

function timeTicks(t0, t1, width) {
  const years = (t1 - t0) / (365.25 * 864e5);
  const maxTicks = Math.max(2, Math.floor(width / 70));
  const stepYears = [1, 2, 5, 10, 20, 25, 50].find((s) => years / s <= maxTicks) || 50;
  const startYear = Math.ceil(new Date(t0).getFullYear() / stepYears) * stepYears;
  const out = [];
  for (let y = startYear; ; y += stepYears) {
    const t = Date.UTC(y, 0, 1);
    if (t > t1) break;
    if (t >= t0) out.push(t);
  }
  return out;
}

const color = (name) => `var(--${name})`;

function tooltipFor(container) {
  let tip = container.querySelector(".tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("role", "status");
    container.appendChild(tip);
  }
  return tip;
}

function fillTooltip(tip, head, rows, keyShape = "line") {
  tip.replaceChildren();
  const h = document.createElement("div");
  h.className = "t-head";
  h.textContent = head;
  tip.appendChild(h);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "t-row";
    const key = document.createElement("i");
    key.style.background = color(r.color);
    if (keyShape === "box") { key.style.height = "8px"; key.style.width = "8px"; key.style.borderRadius = "2px"; }
    const b = document.createElement("b");
    b.textContent = r.value;
    const s = document.createElement("span");
    s.textContent = r.label;
    row.append(key, b, s);
    tip.appendChild(row);
  }
}

function placeTooltip(tip, container, x, y) {
  tip.style.display = "block";
  const cw = container.clientWidth;
  const tw = tip.offsetWidth;
  let left = x + 14;
  if (left + tw > cw) left = x - tw - 14;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, y - 10)}px`;
}

function observe(container, draw) {
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(container.clientWidth);
    if (w && w !== lastW) { lastW = w; draw(w); }
  });
  ro.observe(container);
  return { redraw: () => { lastW = 0; draw(Math.round(container.clientWidth)); } };
}

export function lineChart(container, opts) {
  const {
    series, format = (v) => v.toLocaleString(), height = 260, yZero = true,
    range = null, annotations = [], area = false, dateFormat = (t) => new Date(t).toLocaleDateString("en-AU", { month: "short", year: "numeric" }),
    endLabels = true, yMax = null, bands = [],
  } = opts;
  container.classList.add("chart");

  const draw = (W) => {
    container.querySelector("svg")?.remove();
    const tip = tooltipFor(container);
    tip.style.display = "none";

    const visible = series.map((s) => ({
      ...s,
      pts: s.points.filter(([t]) => !range || (t >= range[0] && t <= range[1])),
    })).filter((s) => s.pts.length);
    if (!visible.length) return;

    // Shaded bands, e.g. forecast intervals: { color, opacity, points: [[t, lo, hi]] }
    const vb = bands.map((b) => ({ ...b, pts: b.points.filter(([t]) => !range || (t >= range[0] && t <= range[1])) })).filter((b) => b.pts.length);
    const allT = visible.flatMap((s) => s.pts.map((p) => p[0])).concat(vb.flatMap((b) => b.pts.map((p) => p[0])));
    const allV = visible.flatMap((s) => s.pts.map((p) => p[1])).concat(vb.flatMap((b) => b.pts.flatMap((p) => [p[1], p[2]])))
      .filter((v) => v != null && isFinite(v));
    const t0 = Math.min(...allT), t1 = Math.max(...allT);
    let vMin = Math.min(...allV), vMax = yMax ?? Math.max(...allV);
    if (yZero) vMin = Math.min(0, vMin);
    const yt = niceTicks(vMin, vMax, height < 200 ? 3 : 5);

    const labelW = endLabels && visible.length > 1 ? Math.min(90, W * 0.18) : 8;
    const tickW = Math.max(...yt.map((v) => format(v).length)) * 6.5 + 8;
    const m = { top: 10, right: labelW, bottom: 24, left: tickW };
    const iw = Math.max(50, W - m.left - m.right), ih = height - m.top - m.bottom;
    const x = (t) => m.left + ((t - t0) / (t1 - t0 || 1)) * iw;
    const y = (v) => m.top + ih - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * ih;

    const svg = el("svg", { viewBox: `0 0 ${W} ${height}`, role: "img", "aria-label": opts.ariaLabel || "" });
    container.prepend(svg);

    for (const v of yt) {
      el("line", { class: v === 0 ? "baseline" : "gridline", x1: m.left, x2: m.left + iw, y1: y(v), y2: y(v) }, svg);
      el("text", { class: "tick", x: m.left - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = format(v);
    }
    for (const t of timeTicks(t0, t1, iw)) {
      el("text", { class: "tick", x: x(t), y: height - 6, "text-anchor": "middle" }, svg).textContent = new Date(t).getUTCFullYear();
    }

    for (const a of annotations) {
      if (a.date < t0 || a.date > t1) continue;
      el("line", { class: "annot-line", x1: x(a.date), x2: x(a.date), y1: m.top, y2: m.top + ih }, svg);
      el("text", { class: "annot", x: x(a.date) + 4, y: m.top + 10 }, svg).textContent = a.label;
    }

    const pathFor = (pts) => {
      let d = "", pen = false;
      for (const [t, v] of pts) {
        if (v == null || !isFinite(v)) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    };

    for (const b of vb) {
      const top = b.pts.map(([t, , hi], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(hi).toFixed(1)}`).join("");
      const bottom = [...b.pts].reverse().map(([t, lo]) => `L${x(t).toFixed(1)},${y(lo).toFixed(1)}`).join("");
      el("path", { d: `${top}${bottom}Z`, fill: color(b.color), "fill-opacity": b.opacity ?? 0.15, stroke: "none" }, svg);
    }

    if (area && visible.length === 1) {
      const s = visible[0];
      const d = pathFor(s.pts) + `L${x(s.pts.at(-1)[0])},${y(Math.max(0, yt[0]))}L${x(s.pts[0][0])},${y(Math.max(0, yt[0]))}Z`;
      el("path", { d, fill: color(s.color), "fill-opacity": 0.1, stroke: "none" }, svg);
    }

    const ends = [];
    for (const s of visible) {
      el("path", {
        class: "series", d: pathFor(s.pts), fill: "none", stroke: color(s.color),
        "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
        ...(s.dashed ? { "stroke-dasharray": "5 4" } : {}),
      }, svg);
      const last = [...s.pts].reverse().find((p) => p[1] != null && isFinite(p[1]));
      if (last) {
        el("circle", { cx: x(last[0]), cy: y(last[1]), r: 4, fill: color(s.color), stroke: "var(--surface-1)", "stroke-width": 2 }, svg);
        ends.push({ s, y: y(last[1]), x: x(last[0]) });
      }
    }

    // End labels, nudged apart only slightly; if they would collide badly we drop them (legend carries identity).
    if (endLabels && visible.length > 1) {
      ends.sort((a, b) => a.y - b.y);
      let ok = true;
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) { ok = false; }
      if (ok) for (const e of ends) {
        el("text", { class: "endlabel", x: m.left + iw + 8, y: e.y + 4 }, svg).textContent = e.s.short || e.s.label;
      }
    }

    // Crosshair + tooltip
    const cross = el("line", { class: "crosshair", y1: m.top, y2: m.top + ih, visibility: "hidden" }, svg);
    const dots = visible.map((s) => el("circle", { r: 4, fill: color(s.color), stroke: "var(--surface-1)", "stroke-width": 2, visibility: "hidden" }, svg));
    const hit = el("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent", tabindex: 0 }, svg);
    const times = [...new Set(allT)].sort((a, b) => a - b);
    let focusIdx = times.length - 1;

    const show = (t) => {
      const px = x(t);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      const rows = [];
      visible.forEach((s, i) => {
        let best = null;
        for (const p of s.pts) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
        const close = best && Math.abs(best[0] - t) < 200 * 864e5 && best[1] != null;
        if (close) {
          dots[i].setAttribute("cx", x(best[0])); dots[i].setAttribute("cy", y(best[1])); dots[i].setAttribute("visibility", "visible");
          rows.push({ color: s.color, label: s.label, value: format(best[1], true), v: best[1] });
        } else dots[i].setAttribute("visibility", "hidden");
      });
      rows.sort((a, b) => b.v - a.v);
      fillTooltip(tip, dateFormat(t), rows);
      const scale = container.clientWidth / W;
      placeTooltip(tip, container, px * scale, m.top * scale);
    };
    const hide = () => {
      tip.style.display = "none"; cross.setAttribute("visibility", "hidden");
      dots.forEach((d) => d.setAttribute("visibility", "hidden"));
    };
    const nearest = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - m.left) / iw) * (t1 - t0);
      let lo = 0, hi = times.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid; else hi = mid; }
      return Math.abs(times[lo] - t) < Math.abs(times[hi] - t) ? lo : hi;
    };
    hit.addEventListener("pointermove", (e) => { focusIdx = nearest(e); show(times[focusIdx]); });
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(times[focusIdx]));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") focusIdx = Math.max(0, focusIdx - 1);
      else if (e.key === "ArrowRight") focusIdx = Math.min(times.length - 1, focusIdx + 1);
      else return;
      e.preventDefault(); show(times[focusIdx]);
    });
  };
  return observe(container, draw);
}

export function columnChart(container, opts) {
  const { categories, series, format = (v) => v.toLocaleString(), height = 240, labelValues = true } = opts;
  container.classList.add("chart");
  const draw = (W) => {
    container.querySelector("svg")?.remove();
    const tip = tooltipFor(container);
    tip.style.display = "none";
    const vals = series.flatMap((s) => s.values).filter((v) => v != null);
    if (!vals.length) return;
    const yt = niceTicks(0, Math.max(...vals), 4);
    const tickW = Math.max(...yt.map((v) => format(v).length)) * 6.5 + 8;
    const m = { top: 18, right: 4, bottom: 24, left: tickW };
    const iw = W - m.left - m.right, ih = height - m.top - m.bottom;
    const y = (v) => m.top + ih - (v / yt.at(-1)) * ih;
    const svg = el("svg", { viewBox: `0 0 ${W} ${height}`, role: "img", "aria-label": opts.ariaLabel || "" });
    container.prepend(svg);
    for (const v of yt) {
      el("line", { class: v === 0 ? "baseline" : "gridline", x1: m.left, x2: m.left + iw, y1: y(v), y2: y(v) }, svg);
      el("text", { class: "tick", x: m.left - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = format(v);
    }
    const band = iw / categories.length;
    const n = series.length;
    const barW = Math.min(24, (band * 0.7 - 2 * (n - 1)) / n);
    const groupW = n * barW + 2 * (n - 1);
    categories.forEach((c, ci) => {
      const gx = m.left + ci * band + (band - groupW) / 2;
      el("text", { class: "tick", x: m.left + ci * band + band / 2, y: height - 6, "text-anchor": "middle" }, svg).textContent = c;
      series.forEach((s, si) => {
        const v = s.values[ci];
        if (v == null) return;
        const bx = gx + si * (barW + 2), by = y(v), bh = y(0) - by;
        const r = Math.min(4, bh, barW / 2);
        const d = `M${bx},${y(0)}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + barW - r}Q${bx + barW},${by} ${bx + barW},${by + r}V${y(0)}Z`;
        const bar = el("path", { d, fill: color(s.color), tabindex: 0 }, svg);
        if (labelValues && n === 1) {
          el("text", { class: "endlabel", x: bx + barW / 2, y: by - 5, "text-anchor": "middle" }, svg).textContent = format(v);
        }
        const hitR = el("rect", { x: gx + si * (barW + 2) - 2, y: m.top, width: barW + 4, height: ih, fill: "transparent" }, svg);
        const show = () => {
          bar.setAttribute("opacity", 0.8);
          fillTooltip(tip, c, series.map((ss) => ({ color: ss.color, label: ss.label, value: ss.values[ci] == null ? "n/a" : format(ss.values[ci], true) })), "box");
          const scale = container.clientWidth / W;
          placeTooltip(tip, container, (bx + barW) * scale, by * scale);
        };
        const hide = () => { bar.removeAttribute("opacity"); tip.style.display = "none"; };
        for (const t of [bar, hitR]) { t.addEventListener("pointermove", show); t.addEventListener("pointerleave", hide); }
        bar.addEventListener("focus", show); bar.addEventListener("blur", hide);
      });
    });
  };
  return observe(container, draw);
}

export function sparkline(container, points, colorName = "s1") {
  container.classList.add("chart");
  const draw = (W) => {
    container.querySelector("svg")?.remove();
    const H = 36;
    const pts = points.filter((p) => p[1] != null);
    if (pts.length < 2) return;
    const t0 = pts[0][0], t1 = pts.at(-1)[0];
    const vs = pts.map((p) => p[1]);
    const lo = Math.min(...vs), hi = Math.max(...vs);
    const x = (t) => 2 + ((t - t0) / (t1 - t0)) * (W - 8);
    const y = (v) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 8);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
    container.prepend(svg);
    el("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(""), fill: "none", stroke: "var(--text-muted)", "stroke-width": 1.5 }, svg);
    const last = pts.at(-1);
    el("circle", { cx: x(last[0]), cy: y(last[1]), r: 3.5, fill: color(colorName), stroke: "var(--surface-1)", "stroke-width": 2 }, svg);
  };
  return observe(container, draw);
}
