// Regions tab: SA4 choropleth with metric toggle, state zoom, bank access points,
// a ranking table and a printable "trip brief" for any region.

const NS = "http://www.w3.org/2000/svg";
const LAT0 = Math.cos((-27 * Math.PI) / 180);
const proj = ([lon, lat]) => [(lon - 112) * LAT0 * 20, (-9.5 - lat) * 20];
const FULL = (() => { const [x0, y0] = proj([112.5, -9.5]); const [x1, y1] = proj([154.2, -44]); return [x0, y0, x1 - x0, y1 - y0]; })();
const STATES = [
  ["Australia", null], ["NSW", "New South Wales"], ["Vic", "Victoria"], ["Qld", "Queensland"], ["SA", "South Australia"],
  ["WA", "Western Australia"], ["Tas", "Tasmania"], ["NT", "Northern Territory"], ["ACT", "Australian Capital Territory"],
];

const nf = (d) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: d, minimumFractionDigits: d });
const FORMAT = {
  int: (v) => nf(0).format(v),
  dec1: (v) => nf(1).format(v),
  pct: (v) => `${nf(1).format(v)}%`,
  pct_signed: (v) => `${v > 0 ? "+" : ""}${nf(0).format(v)}%`,
  dollars: (v) => `$${nf(0).format(v)}`,
};
const fmtM = (m, v) => (v == null ? "n/a" : (FORMAT[m.format] || FORMAT.dec1)(v));
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(k));
  return n;
};
const s = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  return [];
}
function pathOf(geom) {
  let d = "";
  for (const ring of ringsOf(geom)) {
    ring.forEach((c, i) => { const [x, y] = proj(c); d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; });
    d += "Z";
  }
  return d;
}
function bboxOf(geoms) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of geoms) for (const ring of ringsOf(g)) for (const c of ring) {
    const [x, y] = proj(c);
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// Quantile class breaks (5 classes) for the sequential ramp.
function breaks(values) {
  const v = values.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
}
const classOf = (v, br) => (v == null ? -1 : br.filter((b) => v >= b).length);

// What a region's profile implies for cash, compared with Australia.
function implications(r, nat, metrics) {
  const has = (id) => metrics.some((m) => m.id === id) && r[id] != null && nat[id] != null;
  const out = [];
  if (has("pct_65plus") && r.pct_65plus > nat.pct_65plus * 1.15)
    out.push(`An older population (${FORMAT.pct(r.pct_65plus)} aged 65 and over, against ${FORMAT.pct(nat.pct_65plus)} nationally) points to above-average reliance on cash.`);
  if (has("median_hh_income") && r.median_hh_income < nat.median_hh_income * 0.9)
    out.push(`Household incomes are below the national median (${FORMAT.dollars(r.median_hh_income)} against ${FORMAT.dollars(nat.median_hh_income)} a week), a group more likely to budget with cash.`);
  if (has("irsd") && r.irsd < 970)
    out.push(`The area is relatively disadvantaged (IRSD ${FORMAT.int(r.irsd)}), so loss of cash services would be felt more here.`);
  if (has("pct_first_nations") && r.pct_first_nations > Math.max(8, nat.pct_first_nations * 2))
    out.push(`${FORMAT.pct(r.pct_first_nations)} of residents are Aboriginal and/or Torres Strait Islander, making the region relevant to $5 redesign engagement and to cash access in remote communities.`);
  if (has("atms_per_10k") && r.atms_per_10k < nat.atms_per_10k * 0.8)
    out.push(`There are fewer ATMs per person than nationally (${FORMAT.dec1(r.atms_per_10k)} against ${FORMAT.dec1(nat.atms_per_10k)} per 10,000 people).`);
  if (has("branch_change") && r.branch_change < nat.branch_change - 5)
    out.push(`Bank branches have fallen faster than nationally since 2017 (${FORMAT.pct_signed(r.branch_change)} against ${FORMAT.pct_signed(nat.branch_change)}).`);
  if (has("pct_other_language") && r.pct_other_language > nat.pct_other_language * 1.3)
    out.push(`Many residents speak a language other than English at home (${FORMAT.pct(r.pct_other_language)}), relevant to multilingual information on security features.`);
  if (!out.length) out.push("This region's profile is close to the national average on the indicators linked to cash use.");
  return out;
}

export async function regionsPanel(p) {
  let R, geo, points = null;
  try {
    [R, geo] = await Promise.all([
      fetch("data/regions.json", { cache: "no-cache" }).then((r) => r.json()),
      fetch("data/sa4.geojson", { cache: "no-cache" }).then((r) => r.json()),
    ]);
  } catch (e) {
    p.append(h("p", { class: "empty", text: "Regional data hasn't been built yet. It appears after the next refresh." }));
    return;
  }
  const metrics = R.metrics;
  const nat = R.national || {};
  const byCode = new Map(R.regions.map((r) => [r.code, r]));
  const feats = geo.features.filter((f) => byCode.has(f.properties.code));
  let metric = metrics.find((m) => m.id === "pct_65plus") || metrics[0];
  let selected = null;
  try { const saved = localStorage.getItem("bn-region-metric"); if (saved) metric = metrics.find((m) => m.id === saved) || metric; } catch { /* ignore */ }

  // ---- controls
  const select = h("select", { id: "rg-metric", "aria-label": "Statistic shown on the map" },
    metrics.map((m) => h("option", { value: m.id, text: m.label })));
  select.value = metric.id;
  const list = h("datalist", { id: "rg-names" }, R.regions.map((r) => h("option", { value: r.name })));
  const search = h("input", { type: "search", id: "rg-search", list: "rg-names", placeholder: "Find a region, e.g. Cairns", "aria-label": "Find a region" });
  const stateSeg = h("div", { class: "seg", role: "group", "aria-label": "Zoom to state" },
    STATES.map(([abbr, name]) => h("button", { type: "button", "data-state": name ?? "", "aria-pressed": String(!name), text: abbr })));
  const sw = (cls) => { const i = h("i", { class: `rg-dot ${cls}` }); return i; };
  const pointsToggle = h("label", { class: "rg-toggle" }, h("input", { type: "checkbox", id: "rg-points" }), " Show ",
    sw("pt-branch"), " bank branches and ", sw("pt-atm"), " ATMs");
  p.append(h("div", { class: "rg-controls" },
    h("label", { for: "rg-metric", class: "rg-label" }, "Statistic ", select),
    h("span", { class: "rg-search" }, search, list),
    stateSeg, pointsToggle));

  // ---- layout
  const mapCard = h("div", { class: "card rg-map-card" });
  const desc = h("p", { class: "card-sub" });
  const legendEl = h("div", { class: "rg-legend" });
  const mapBox = h("div", { class: "rg-map chart" });
  const tip = h("div", { class: "tooltip", role: "status" });
  mapBox.append(tip);
  mapCard.append(h("h3", { id: "rg-title" }), desc, legendEl, mapBox,
    h("div", { class: "foot" }, h("span", { text: "Source: ABS 2021 Census, SEIFA 2021, ASGS 2021; APRA points of presence. Drag to pan, scroll or use the state buttons to zoom." })));
  const brief = h("aside", { class: "card brief", "aria-live": "polite" });
  p.append(h("div", { class: "rg-layout" }, mapCard, brief));
  const rankCard = h("div", { class: "card rg-rank" });
  p.append(rankCard);

  // ---- map
  const svg = s("svg", { viewBox: FULL.join(" "), role: "img", "aria-label": "Map of Australia by SA4 region" });
  mapBox.prepend(svg);
  const gRegions = s("g", {}, svg);
  const gSel = s("g", {}, svg);
  const gPts = s("g", { class: "rg-points" }, svg);
  const paths = new Map();
  const bboxes = new Map();
  for (const f of feats) {
    const code = f.properties.code;
    const el = s("path", { d: pathOf(f.geometry), class: "rg-region", tabindex: "-1", "data-code": code }, gRegions);
    paths.set(code, el);
    bboxes.set(code, bboxOf([f.geometry]));
  }
  let view = [...FULL];
  const setView = (v) => {
    view = v;
    svg.setAttribute("viewBox", v.map((x) => x.toFixed(2)).join(" "));
    const k = FULL[2] / v[2];
    svg.style.setProperty("--k", k);
    drawPoints();
  };
  const zoomTo = ([x0, y0, x1, y1], pad = 0.15) => {
    const w = (x1 - x0) * (1 + pad * 2), hgt = (y1 - y0) * (1 + pad * 2);
    const aspect = FULL[2] / FULL[3];
    let W = Math.max(w, hgt * aspect, 8), H = W / aspect;
    setView([(x0 + x1) / 2 - W / 2, (y0 + y1) / 2 - H / 2, W, H]);
  };

  function paint() {
    const vals = R.regions.map((r) => r[metric.id]);
    const br = breaks(vals);
    for (const [code, el] of paths) {
      const c = classOf(byCode.get(code)[metric.id], br);
      el.setAttribute("class", `rg-region q${c < 0 ? "na" : c}`);
    }
    $("#rg-title").textContent = metric.label;
    desc.textContent = `${metric.description}. Darker regions have higher values. Australia: ${fmtM(metric, nat[metric.id])}.`;
    legendEl.replaceChildren(...[0, 1, 2, 3, 4].map((i) => {
      const lo = i === 0 ? Math.min(...vals.filter((v) => v != null)) : br[i - 1];
      const hi = i === 4 ? Math.max(...vals.filter((v) => v != null)) : br[i];
      return h("span", {}, h("i", { class: `q${i}` }), `${fmtM(metric, lo)} to ${fmtM(metric, hi)}`);
    }));
    renderRank();
    if (selected) renderBrief(selected);
  }
  const $ = (sel) => p.querySelector(sel);

  // ---- access points (only drawn when zoomed in, so the map stays readable)
  async function drawPoints() {
    gPts.replaceChildren();
    if (!$("#rg-points")?.checked) return;
    if (!points) {
      try { points = await fetch("data/access_points.json", { cache: "no-cache" }).then((r) => r.json()); }
      catch { points = []; }
    }
    const k = FULL[2] / view[2];
    if (k < 2.5) {
      gPts.append(Object.assign(s("text", { x: view[0] + view[2] / 2, y: view[1] + 30 / k, "text-anchor": "middle", class: "rg-hint" }), { textContent: "Zoom in to a state or region to see branches and ATMs" }));
      return;
    }
    const [vx, vy, vw, vh] = view;
    let n = 0;
    for (const [lon, lat, kind] of points) {
      const [x, y] = proj([lon, lat]);
      if (x < vx || x > vx + vw || y < vy || y > vy + vh) continue;
      s("circle", { cx: x, cy: y, r: (kind === "branch" ? 4 : 3) / k, class: `pt-${kind}` }, gPts);
      if (++n > 6000) break;
    }
  }

  // ---- interaction: hover, click, pan, wheel zoom
  const showTip = (code, evt) => {
    const r = byCode.get(code);
    const vals = R.regions.map((x) => x[metric.id]).filter((v) => v != null).sort((a, b) => b - a);
    const rank = r[metric.id] == null ? null : vals.indexOf(r[metric.id]) + 1;
    tip.replaceChildren(h("div", { class: "t-head", text: `${r.name}, ${r.state}` }),
      h("div", { class: "t-row" }, h("b", { text: fmtM(metric, r[metric.id]) }), h("span", { text: rank ? `${ordinal(rank)} highest of ${vals.length}` : "" })));
    const box = mapBox.getBoundingClientRect();
    tip.style.display = "block";
    let left = evt.clientX - box.left + 14;
    if (left + tip.offsetWidth > box.width) left = evt.clientX - box.left - tip.offsetWidth - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, evt.clientY - box.top - 10)}px`;
  };
  let drag = null;
  svg.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, v: [...view], moved: false }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => {
    if (drag) {
      const r = svg.getBoundingClientRect();
      const dx = ((e.clientX - drag.x) / r.width) * drag.v[2], dy = ((e.clientY - drag.y) / r.height) * drag.v[3];
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved) { setView([drag.v[0] - dx, drag.v[1] - dy, drag.v[2], drag.v[3]]); tip.style.display = "none"; return; }
    }
    const code = e.target?.dataset?.code;
    if (code) showTip(code, e); else tip.style.display = "none";
  });
  svg.addEventListener("pointerup", (e) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const code = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.dataset?.code)?.dataset.code;
    if (code) select_(code, false);
  });
  svg.addEventListener("pointerleave", () => { tip.style.display = "none"; });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const f = e.deltaY > 0 ? 1.25 : 0.8;
    const W = Math.min(FULL[2] * 1.2, Math.max(4, view[2] * f)), H = (W * FULL[3]) / FULL[2];
    setView([view[0] + fx * (view[2] - W), view[1] + fy * (view[3] - H), W, H]);
  }, { passive: false });

  function select_(code, zoom = true) {
    selected = code;
    gSel.replaceChildren();
    const f = feats.find((x) => x.properties.code === code);
    if (f) s("path", { d: pathOf(f.geometry), class: "rg-selected" }, gSel);
    if (zoom && bboxes.has(code)) zoomTo(bboxes.get(code), 0.6);
    renderBrief(code);
    try { history.replaceState(null, "", `#regions/${code}`); } catch { /* ignore */ }
  }

  // ---- brief
  function renderBrief(code) {
    const r = byCode.get(code);
    if (!r) return;
    const rows = metrics.map((m) => {
      const vals = R.regions.map((x) => x[m.id]).filter((v) => v != null).sort((a, b) => b - a);
      const rank = r[m.id] == null ? null : vals.indexOf(r[m.id]) + 1;
      return h("tr", {},
        h("th", { scope: "row", text: m.label }),
        h("td", { text: fmtM(m, r[m.id]) }),
        h("td", { text: nat[m.id] != null ? fmtM(m, nat[m.id]) : "" }),
        h("td", { text: rank ? `${ordinal(rank)} of ${vals.length}` : "" }));
    });
    const printBtn = h("button", { type: "button", class: "theme-btn", text: "Print brief" });
    printBtn.addEventListener("click", () => { document.body.classList.add("print-brief"); window.print(); });
    brief.replaceChildren(
      h("div", { class: "brief-head" }, h("div", {}, h("p", { class: "brief-kicker", text: "Regional brief" }), h("h3", { text: r.name }), h("p", { class: "card-sub", text: `${r.state}. ABS Statistical Area Level 4.` })), printBtn),
      h("h4", { text: "What it means for cash" }),
      h("ul", { class: "brief-points" }, implications(r, nat, metrics).map((t) => h("li", { text: t }))),
      h("h4", { text: "Profile" }),
      h("div", { class: "table-wrap brief-table" }, h("table", { class: "data" },
        h("thead", {}, h("tr", {}, ["", "Region", "Australia", "Rank (highest = 1st)"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, rows))),
      h("p", { class: "brief-foot", text: "Sources: ABS 2021 Census, SEIFA 2021; APRA points of presence. Rankings are among all SA4 regions." }));
  }
  function renderEmptyBrief() {
    brief.replaceChildren(h("p", { class: "brief-kicker", text: "Regional brief" }), h("h3", { text: "Pick a region" }),
      h("p", { class: "card-sub", text: "Click the map or search for a place, such as Cairns, to see how it compares with Australia and what that means for cash use and access. You can print the brief to take on a visit." }));
  }

  // ---- ranking table (the map's table view)
  function renderRank() {
    const sorted = [...R.regions].filter((r) => r[metric.id] != null).sort((a, b) => b[metric.id] - a[metric.id]);
    const rows = sorted.map((r, i) => {
      const tr = h("tr", { tabindex: "0" }, h("td", { text: String(i + 1) }), h("td", { text: r.name }), h("td", { text: r.state }), h("td", { text: fmtM(metric, r[metric.id]) }));
      const go = () => { select_(r.code); mapCard.scrollIntoView({ behavior: "smooth", block: "start" }); };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      return tr;
    });
    rankCard.replaceChildren(h("h3", { text: `All regions ranked by ${metric.label.toLowerCase()}` }),
      h("p", { class: "card-sub", text: "Select a row to open its brief." }),
      h("div", { class: "table-wrap" }, h("table", { class: "data rg-table" },
        h("thead", {}, h("tr", {}, ["Rank", "Region", "State", metric.label].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, rows))));
  }

  // ---- wire controls
  select.addEventListener("change", () => {
    metric = metrics.find((m) => m.id === select.value);
    try { localStorage.setItem("bn-region-metric", metric.id); } catch { /* ignore */ }
    paint();
  });
  const pick = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const r = R.regions.find((x) => x.name.toLowerCase() === q) || R.regions.find((x) => x.name.toLowerCase().includes(q));
    if (r) select_(r.code);
  };
  search.addEventListener("change", pick);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
  for (const b of stateSeg.querySelectorAll("button")) {
    b.addEventListener("click", () => {
      for (const x of stateSeg.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      const st = b.dataset.state;
      if (!st) return setView([...FULL]);
      const geoms = feats.filter((f) => byCode.get(f.properties.code).state === st).map((f) => f.geometry);
      if (geoms.length) zoomTo(bboxOf(geoms), 0.05);
    });
  }
  $("#rg-points").addEventListener("change", drawPoints);
  window.addEventListener("afterprint", () => document.body.classList.remove("print-brief"));

  paint();
  renderEmptyBrief();
  const fromHash = location.hash.match(/^#regions\/(\w+)/)?.[1];
  if (fromHash && byCode.has(fromHash)) select_(fromHash);
}
