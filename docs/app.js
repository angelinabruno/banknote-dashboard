import { lineChart, columnChart, sparkline } from "./charts.js";
import { regionsPanel } from "./regions.js";

// ---------- formatting ----------
const DENOMS = ["5", "10", "20", "50", "100"];
const DCOLOR = { 5: "d5", 10: "d10", 20: "d20", 50: "d50", 100: "d100" };
const nf = (d = 0) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: d, minimumFractionDigits: d });
const fmt = {
  bn: (v) => `$${nf(v >= 100 ? 0 : 1).format(v / 1000)}b`,           // input $m
  bnTick: (v) => `$${nf(0).format(v / 1000)}b`,
  m: (v) => `$${nf(0).format(v)}m`,
  pct: (v, precise) => `${nf(precise ? 1 : 0).format(v)}%`,
  pct1: (v) => `${nf(1).format(v)}%`,
  num: (v) => nf(0).format(v),
  dollars: (v) => `$${nf(0).format(v)}`,
  mil: (v, precise) => `${nf(precise ? 1 : 0).format(v)}m`,
  idx: (v, precise) => nf(precise ? 1 : 0).format(v),
  compact: (v) => new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 1 }).format(v),
};
const monthYear = (t) => new Date(t).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
const quarterName = (t) => { const d = new Date(t); return `${["March", "June", "September", "December"][Math.floor(d.getUTCMonth() / 3)]} quarter ${d.getUTCFullYear()}`; };
const parseDate = (s) => Date.parse(`${s}T00:00:00Z`);

// ---------- data ----------
let D;
const S = (id) => {
  const s = D.series[id];
  if (!s || !s.points?.length) return null;
  if (!s._pts) s._pts = s.points.map(([d, v]) => [parseDate(d), v]).filter(([, v]) => v != null);
  return s;
};
const pts = (id) => S(id)?._pts ?? [];
const last = (id) => pts(id).at(-1);
const valueAt = (id, t, tolDays = 45) => {
  let best = null;
  for (const p of pts(id)) if (Math.abs(p[0] - t) <= tolDays * 864e5 && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
  return best?.[1] ?? null;
};
const yearsAgo = (t, n) => { const d = new Date(t); d.setUTCFullYear(d.getUTCFullYear() - n); return d.getTime(); };
const change = (id, years = 1) => {
  const l = last(id); if (!l) return null;
  const p = valueAt(id, yearsAgo(l[0], years), 70);
  return p ? (l[1] / p - 1) * 100 : null;
};
const cagr = (id, years) => {
  const l = last(id); if (!l) return null;
  const p = valueAt(id, yearsAgo(l[0], years), 70);
  return p ? (Math.pow(l[1] / p, 1 / years) - 1) * 100 : null;
};
const indexTo = (points, t0) => {
  const base = points.find((p) => p[0] >= t0);
  return base ? points.filter((p) => p[0] >= base[0]).map(([t, v]) => [t, (v / base[1]) * 100]) : [];
};
const annualise = (points) => { // sum monthly values into calendar years (complete years only)
  const by = new Map();
  for (const [t, v] of points) { const y = new Date(t).getUTCFullYear(); const e = by.get(y) || { n: 0, s: 0 }; e.n++; e.s += v; by.set(y, e); }
  return [...by].filter(([, e]) => e.n === 12).map(([y, e]) => [Date.UTC(y, 6, 1), e.s]);
};

// ---------- range filter ----------
const RANGES = { all: null, 20: 20, 10: 10, 5: 5 };
let rangeKey = "all";
try { rangeKey = localStorage.getItem("bn-range") || "all"; } catch { /* storage unavailable */ }
const charts = [];
const currentRange = () => {
  const yrs = RANGES[rangeKey];
  if (!yrs) return null;
  const end = Date.now();
  return [yearsAgo(end, yrs), end];
};

// ---------- DOM helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(k));
  return n;
};

function legend(items, box = false) {
  if (items.length < 2) return null;
  return h("div", { class: "legend" }, items.map((i) => {
    const sw = h("i", { class: box ? "box" : "" }); sw.style.background = `var(--${i.color})`;
    return h("span", {}, sw, i.label);
  }));
}

function tableFor(headers, rows) {
  const t = h("table", { class: "data" },
    h("thead", {}, h("tr", {}, headers.map((x) => h("th", { scope: "col", text: x })))),
    h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", { text: c }))))));
  return h("div", { class: "table-wrap" }, t);
}

function seriesTable(series, format) {
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => b - a);
  const maps = series.map((s) => new Map(s.points));
  return tableFor(["Date", ...series.map((s) => s.label)],
    times.map((t) => [monthYear(t), ...maps.map((m) => (m.has(t) && m.get(t) != null ? format(m.get(t), true) : ""))]));
}

// A card with a title, optional legend, a chart, and a table-view toggle.
function card({ title, sub, span = 6, source, build, legendItems, legendBox, table }) {
  const body = h("div");
  const c = h("div", { class: `card span-${span}` }, h("h3", { text: title }), sub ? h("p", { class: "card-sub", text: sub }) : null);
  const lg = legendItems ? legend(legendItems, legendBox) : null;
  if (lg) c.append(lg);
  c.append(body);
  const toggle = h("button", { type: "button", "aria-expanded": "false", text: "Show table" });
  const foot = h("div", { class: "foot" }, h("span", { text: source ? `Source: ${source}` : "" }), table ? toggle : null);
  c.append(foot);
  let tableEl = null;
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    if (open) { tableEl?.remove(); tableEl = null; } else { tableEl = table(); c.insertBefore(tableEl, foot); }
    toggle.setAttribute("aria-expanded", String(!open));
    toggle.textContent = open ? "Show table" : "Hide table";
  });
  const ok = build(body);
  if (ok === false) body.replaceChildren(h("p", { class: "empty", text: "This data wasn't available in the latest refresh." }));
  return c;
}

function lineCard(opts) {
  const series = opts.series.filter((s) => s.points?.length);
  return card({
    ...opts,
    legendItems: series.map((s) => ({ label: s.label, color: s.color })),
    table: series.length ? () => seriesTable(series, opts.format) : null,
    build: (body) => {
      if (!series.length) return false;
      const chartOpts = { ...opts, series };
      const draw = () => lineChart(body, { ...chartOpts, range: opts.fixedRange ?? currentRange() });
      let inst = draw();
      if (!opts.fixedRange) charts.push(() => { inst = draw(); inst.redraw(); });
      return true;
    },
  });
}

function tile({ label, value, delta, spark, hero = false, span = 3, note }) {
  const t = h("div", { class: `card tile span-${span}${hero ? " hero" : ""}` },
    h("div", { class: "label", text: label }),
    h("div", { class: "value", text: value ?? "n/a" }));
  if (delta) t.append(h("div", { class: "delta" }, delta));
  if (note) t.append(h("div", { class: "delta", text: note }));
  if (spark?.length) { const s = h("div", { class: "spark" }); t.append(s); sparkline(s, spark); }
  return t;
}

function deltaNode(pct, period, upIsGood = null) {
  if (pct == null) return null;
  const up = pct >= 0;
  const cls = upIsGood == null ? "" : up === upIsGood ? "up" : "down";
  return h("span", {}, h("span", { class: cls, text: `${up ? "▲" : "▼"} ${nf(1).format(Math.abs(pct))}%` }), ` ${period}`);
}

function takeaways(items) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return h("div", { class: "takeaways" }, h("h3", { text: "Key takeaways" }), h("ul", {}, list.map((x) => h("li", { text: x }))));
}

// ---------- panels ----------
const denomSeries = (prefix) => DENOMS.map((d) => ({ label: `$${d}`, short: `$${d}`, color: DCOLOR[d], points: pts(`${prefix}_${d}`) }));

function overview(p) {
  const tot = last("notes_value_total");
  const yoy = change("notes_value_total", 1);
  const pc = last("notes_value_per_capita");
  const gdp = last("notes_value_pct_gdp");
  const ppm = last("counterfeit_ppm");
  const atm = last("atm_withdrawals_value");
  const atmYoy = change("atm_withdrawals_value", 1);
  const cps = D.cps?.at(-1);
  const g = h("div", { class: "grid" });
  g.append(
    tile({ hero: true, span: 6, label: `Value of banknotes on issue, ${tot ? monthYear(tot[0]) : ""}`, value: tot ? fmt.bn(tot[1]) : null, delta: deltaNode(yoy, "over the year"), spark: pts("notes_value_total").slice(-120) }),
    tile({ label: "Banknotes per person", value: pc ? fmt.dollars(pc[1]) : null, note: pc ? `As at ${monthYear(pc[0])}` : null }),
    tile({ label: "Banknotes on issue as share of GDP", value: gdp ? fmt.pct1(gdp[1]) : null, note: gdp ? `As at ${monthYear(gdp[0])}` : null }),
    tile({ label: "Cash share of consumer payments", value: cps ? `${cps.cash_share_number_pct}%` : null, note: cps ? `By number, ${cps.year} Consumer Payments Survey` : null }),
    tile({ label: "ATM cash withdrawals, monthly value", value: atm ? fmt.bn(atm[1]) : null, delta: deltaNode(atmYoy, "over the year") }),
    tile({ label: "Counterfeits detected", value: ppm ? `${nf(0).format(ppm[1])} ppm` : null, note: ppm ? `Per million genuine notes, ${quarterName(ppm[0])}` : null }),
    tile({ label: "Next banknote milestone", value: "$5 redesign", note: "Theme: Connection to Country. See Outlook." }),
  );
  p.append(takeaways(overviewTakeaways()), g);

  // The paradox chart: notes on issue vs ATM withdrawals, indexed
  const base = Date.UTC(2008, 0, 1);
  const g2 = h("div", { class: "grid" });
  g2.style.marginTop = "16px";
  g2.append(lineCard({
    span: 12, title: "More banknotes on issue, fewer used for payments",
    sub: "Index, January 2008 = 100. Value of banknotes on issue vs value of ATM cash withdrawals",
    source: "RBA A6, C4", format: fmt.idx, yZero: true, fixedRange: [base, Date.now()],
    series: [
      { label: "Banknotes on issue", short: "On issue", color: "s1", points: indexTo(pts("notes_value_total"), base) },
      { label: "ATM withdrawals (12-month total)", short: "ATM withdrawals", color: "s2", points: indexTo(rolling12(pts("atm_withdrawals_value")), base) },
    ],
  }));
  p.append(g2);
}

function rolling12(points) {
  const out = [];
  for (let i = 11; i < points.length; i++) out.push([points[i][0], points.slice(i - 11, i + 1).reduce((a, p) => a + p[1], 0)]);
  return out;
}

function overviewTakeaways() {
  const tot = last("notes_value_total");
  const c10 = cagr("notes_value_total", 10);
  const atm10 = change("atm_withdrawals_value", 10);
  const cps = D.cps ?? [];
  const first = cps[0], latest = cps.at(-1);
  return [
    tot && c10 != null && `Banknotes on issue reached ${fmt.bn(tot[1])} in ${monthYear(tot[0])}, growing ${nf(1).format(c10)}% a year over the past decade.`,
    first && latest && `Cash fell from ${first.cash_share_number_pct}% of consumer payments in ${first.year} to ${latest.cash_share_number_pct}% in ${latest.year}, although the latest survey suggests the decline has levelled off.`,
    atm10 != null && `The value of ATM withdrawals has changed by ${atm10 >= 0 ? "+" : ""}${nf(0).format(atm10)}% over ten years, while note holdings kept growing, which suggests banknotes are increasingly held as a store of value rather than spent.`,
    "Strategy therefore has two jobs at once: keep a large and growing stock of notes secure and trusted, and keep cash usable for the people who still rely on it.",
  ];
}

function demand(p) {
  const shareSeries = DENOMS.map((d) => {
    const tot = new Map(pts("notes_value_total"));
    return { label: `$${d}`, short: `$${d}`, color: DCOLOR[d], points: pts(`notes_value_${d}`).map(([t, v]) => [t, tot.get(t) ? (v / tot.get(t)) * 100 : null]).filter((x) => x[1] != null) };
  });
  const latestShare = (d) => shareSeries.find((s) => s.label === `$${d}`)?.points.at(-1)?.[1];
  const big = (latestShare(50) ?? 0) + (latestShare(100) ?? 0);
  const top = DENOMS.map((d) => [d, latestShare(d) ?? 0]).sort((a, b) => b[1] - a[1])[0];
  const yoy = S("notes_value_yoy") ? pts("notes_value_yoy") : null;
  const lastYoy = yoy?.at(-1);
  const covidPeak = (yoy ?? []).filter(([t]) => t >= Date.UTC(2020, 0, 1) && t < Date.UTC(2022, 0, 1)).reduce((a, b) => (b[1] > (a?.[1] ?? -Infinity) ? b : a), null);
  const m1 = last("currency_pct_m1"), m1Start = pts("currency_pct_m1")[0];
  p.append(takeaways([
    big && top && `$50 and $100 notes make up ${nf(0).format(big)}% of the value on issue, and the $${top[0]} is now the largest single denomination by value (${nf(0).format(top[1])}%). High-value notes dominating the stock is consistent with notes being held as a store of value rather than spent.`,
    lastYoy && covidPeak && `Annual growth in the value on issue is ${nf(1).format(lastYoy[1])}% (${monthYear(lastYoy[0])}), down from a pandemic peak of ${nf(1).format(covidPeak[1])}% in ${monthYear(covidPeak[0])}.`,
    m1 && m1Start && `Physical currency has shrunk from ${nf(0).format(m1Start[1])}% of narrow money (M1) in ${new Date(m1Start[0]).getUTCFullYear()} to ${nf(1).format(m1[1])}% today, as everyday money has moved into bank deposits.`,
    "Spikes in demand coincide with periods of stress (the 2008 financial crisis, the 2020 pandemic and bushfires), so supply planning has to cover sudden precautionary demand as well as the long-run trend.",
  ]));
  const g = h("div", { class: "grid" });
  const covid = { date: Date.UTC(2020, 2, 1), label: "COVID-19" };
  const gfc = { date: Date.UTC(2008, 8, 15), label: "GFC" };
  g.append(
    lineCard({ span: 12, title: "Value of banknotes on issue", sub: "$ billion, end of month", source: "RBA A6", format: fmt.bnTick, area: true, annotations: [gfc, covid], series: [{ label: "All denominations", color: "s1", points: pts("notes_value_total") }] }),
    lineCard({ span: 6, title: "Value on issue by denomination", sub: "$ billion", source: "RBA A6", format: fmt.bnTick, series: denomSeries("notes_value") }),
    lineCard({ span: 6, title: "Share of value by denomination", sub: "Per cent of total value on issue", source: "RBA A6", format: fmt.pct, series: shareSeries }),
    lineCard({ span: 6, title: "Currency as a share of narrow money", sub: "Currency held by the public as a per cent of M1", source: "RBA D3", format: fmt.pct, series: [{ label: "Currency share of M1", color: "s1", points: pts("currency_pct_m1") }] }),
    lineCard({ span: 6, title: "Annual growth in value on issue", sub: "Year-ended percentage change", source: "RBA A6", format: fmt.pct, yZero: true, annotations: [gfc, covid], series: [{ label: "Growth", color: "s1", points: pts("notes_value_yoy") }] }),
    lineCard({ span: 6, title: "Banknotes on issue relative to the economy", sub: "Per cent of annual nominal GDP", source: "RBA A6, H1", format: fmt.pct, series: [{ label: "Share of GDP", color: "s1", points: pts("notes_value_pct_gdp") }] }),
    lineCard({ span: 6, title: "Banknotes on issue per person", sub: "Dollars per resident", source: "RBA A6, ABS", format: fmt.dollars, series: [{ label: "Per person", color: "s1", points: pts("notes_value_per_capita") }] }),
    lineCard({ span: 6, title: "Opportunity cost of holding cash", sub: "Cash rate target, per cent. Lower rates make holding notes cheaper.", source: "RBA F1", format: fmt.pct, series: [{ label: "Cash rate", color: "s3", points: pts("cash_rate") }] }),
  );
  p.append(g);
}

function use(p) {
  const cps = D.cps ?? [];
  const latest = cps.at(-1), prev = cps.at(-2);
  p.append(takeaways([
    latest && prev && `Cash was used for ${latest.cash_share_number_pct}% of consumer payments in ${latest.year}, compared with ${prev.cash_share_number_pct}% in ${prev.year}, the first survey since 2007 without a fall.`,
    latest && `By value cash is just ${latest.cash_share_value_pct}% of payments: it is used mostly for small, everyday purchases.`,
    "The 2025 survey found about 1.5 million adults still rely mainly on cash, and a third of people said they would face hardship if they couldn't withdraw it. These are the groups an access and inclusion strategy must protect.",
  ]));
  const g = h("div", { class: "grid" });
  const years = cps.map((r) => String(r.year));
  g.append(
    card({
      span: 6, title: "Cash share of consumer payments", sub: "Per cent of payments, by number and value", source: "RBA Consumer Payments Survey",
      legendItems: [{ label: "By number", color: "s1" }, { label: "By value", color: "s2" }], legendBox: true,
      table: () => tableFor(["Survey year", "By number (%)", "By value (%)"], cps.map((r) => [r.year, r.cash_share_number_pct, r.cash_share_value_pct])),
      build: (b) => { if (!cps.length) return false; columnChart(b, { categories: years, format: fmt.pct, series: [{ label: "By number", color: "s1", values: cps.map((r) => r.cash_share_number_pct) }, { label: "By value", color: "s2", values: cps.map((r) => r.cash_share_value_pct) }] }); },
    }),
    card({
      span: 6, title: "Cash versus cards", sub: "Per cent of consumer payments by number", source: "RBA Consumer Payments Survey",
      legendItems: [{ label: "Cash", color: "s1" }, { label: "Cards", color: "s2" }],
      table: () => tableFor(["Survey year", "Cash (%)", "Cards (%)"], cps.map((r) => [r.year, r.cash_share_number_pct, r.card_share_number_pct])),
      build: (b) => {
        if (!cps.length) return false;
        lineChart(b, { format: fmt.pct, dateFormat: (t) => `${new Date(t).getUTCFullYear()} survey`, series: [
          { label: "Cash", short: "Cash", color: "s1", points: cps.map((r) => [Date.UTC(r.year, 6, 1), r.cash_share_number_pct]) },
          { label: "Cards", short: "Cards", color: "s2", points: cps.map((r) => [Date.UTC(r.year, 6, 1), r.card_share_number_pct]) }] });
      },
    }),
  );
  const base = Date.UTC(2012, 0, 1);
  g.append(lineCard({
    span: 12, title: "ATM withdrawals against debit card purchases", sub: "Index, 12-month total, January 2012 = 100. Number of transactions",
    source: "RBA C2, C4", format: fmt.idx, fixedRange: [base, Date.now()],
    series: [
      { label: "ATM withdrawals", short: "ATM", color: "s1", points: indexTo(rolling12(pts("atm_withdrawals_number")), base) },
      { label: "Debit card purchases", short: "Debit cards", color: "s2", points: indexTo(rolling12(pts("debit_purchases_number")), base) },
    ],
  }));
  p.append(g);
}

function access(p) {
  const n10 = change("atm_withdrawals_number", 10);
  const avg = last("atm_avg_withdrawal");
  const br = pts("branch_count_adi"), atmA = pts("atm_count_adi");
  p.append(takeaways([
    n10 != null && `The number of ATM withdrawals has fallen ${nf(0).format(Math.abs(n10))}% over the past decade.`,
    avg && `People withdraw less often but in larger amounts: the average withdrawal is now ${fmt.dollars(avg[1])}.`,
    br.length > 1 && `Bank and other ADI branches fell from ${fmt.num(br[0][1])} in ${new Date(br[0][0]).getUTCFullYear()} to ${fmt.num(br.at(-1)[1])} in ${new Date(br.at(-1)[0]).getUTCFullYear()}, a ${nf(0).format((1 - br.at(-1)[1] / br[0][1]) * 100)}% drop. Branches are where many people deposit cash, so this matters most outside the cities.`,
    atmA.length > 1 && `Bank-operated ATMs fell from ${fmt.num(atmA[0][1])} to ${fmt.num(atmA.at(-1)[1])} over the same period. Part of this reflects banks selling ATM fleets to independent operators rather than machines disappearing, so it overstates the loss of access.`,
  ]));
  const g = h("div", { class: "grid" });
  g.append(
    lineCard({ span: 6, title: "ATM cash withdrawals, number", sub: "Million per month, seasonally adjusted", source: "RBA C4", format: fmt.mil, series: [{ label: "Withdrawals", color: "s1", points: pts("atm_withdrawals_number") }] }),
    lineCard({ span: 6, title: "ATM cash withdrawals, value", sub: "$ billion per month, seasonally adjusted", source: "RBA C4", format: (v) => `$${nf(1).format(v / 1000)}b`, series: [{ label: "Value", color: "s1", points: pts("atm_withdrawals_value") }] }),
    lineCard({ span: 6, title: "Average ATM withdrawal", sub: "Dollars", source: "RBA C4", format: fmt.dollars, yZero: false, series: [{ label: "Average", color: "s1", points: pts("atm_avg_withdrawal") }] }),
    lineCard({ span: 6, title: "Number of ATMs", sub: "All operators to 2018 (RBA); bank-operated from 2017 (APRA). The two are defined differently.", source: "RBA C8, APRA", format: (v) => fmt.compact(v), series: [{ label: "All ATMs (RBA)", short: "All ATMs", color: "s1", points: pts("atm_count") }, { label: "Bank-operated ATMs (APRA)", short: "Bank ATMs", color: "s2", points: pts("atm_count_adi") }] }),
    lineCard({ span: 6, title: "Number of bank branches", sub: "Bank branches to 2018 (RBA); branches of banks and other ADIs from 2017 (APRA)", source: "RBA C8, APRA", format: (v) => fmt.compact(v), series: [{ label: "Bank branches (RBA)", short: "RBA", color: "s1", points: pts("branch_count") }, { label: "ADI branches (APRA)", short: "APRA", color: "s2", points: pts("branch_count_adi") }] }),
  );
  p.append(g);
}

function integrity(p) {
  const ppm = pts("counterfeit_ppm");
  const latest = ppm.at(-1);
  const peak = ppm.reduce((a, b) => (b[1] > (a?.[1] ?? -1) ? b : a), null);
  const yearAgo = latest ? valueAt("counterfeit_ppm", yearsAgo(latest[0], 1), 50) : null;
  const topRate = DENOMS.map((d) => [d, last(`counterfeit_ppm_${d}`)?.[1] ?? -1]).sort((x, y) => y[1] - x[1])[0];
  const counts = DENOMS.map((d) => last(`counterfeit_count_${d}`));
  const anyCounts = counts.some(Boolean);
  const mostIdx = anyCounts ? counts.reduce((bi, c, i, arr) => ((c?.[1] ?? -1) > (arr[bi]?.[1] ?? -1) ? i : bi), 0) : -1;
  p.append(takeaways([
    latest && `The RBA recorded ${nf(0).format(latest[1])} counterfeits per million genuine banknotes in the ${quarterName(latest[0])}.`,
    yearAgo && latest && Math.abs(latest[1] - yearAgo) >= 3 && `That is ${latest[1] > yearAgo ? "up" : "down"} from ${nf(0).format(yearAgo)} ppm a year earlier${latest[1] > yearAgo * 1.5 ? ", a sharp rise that warrants close monitoring" : ""}. The highest rate in the series was ${nf(0).format(peak[1])} ppm in ${new Date(peak[0]).getUTCFullYear()}.`,
    topRate && `By rate, the $${topRate[0]} is the most targeted note (${nf(0).format(topRate[1])} counterfeits per million genuine $${topRate[0]} notes).`,
    mostIdx >= 0 && `By number, the $${DENOMS[mostIdx]} is the most counterfeited note in the latest data, so it is where public education and retailer checks matter most.`,
    "Keeping counterfeiting low underpins public confidence, and it is the main argument for upgrading security features through programs like Next Generation Banknotes.",
  ]));
  const g = h("div", { class: "grid" });
  g.append(
    lineCard({ span: 12, title: "Counterfeits detected per million notes in circulation", sub: "Parts per million (ppm)", source: "RBA A7", format: fmt.num, series: [{ label: "All denominations", color: "s1", points: ppm }] }),
    lineCard({ span: 12, title: "Counterfeits by denomination", sub: "Per million genuine banknotes of that denomination", source: "RBA A7", format: fmt.num, series: denomSeries("counterfeit_ppm") }),
    lineCard({ span: 12, title: "Counterfeits detected by denomination", sub: "Number of counterfeits, as published in RBA table A7", source: "RBA A7", format: fmt.num, series: denomSeries("counterfeit_count") }),
  );
  p.append(g);
}

function outlook(p) {
  const tot = last("notes_value_total");
  const c5 = cagr("notes_value_total", 5), c10 = cagr("notes_value_total", 10), c20 = cagr("notes_value_total", 20);
  p.append(takeaways([
    c5 != null && c10 != null && `Growth in the value on issue averaged ${nf(1).format(c10)}% a year over ten years and ${nf(1).format(c5)}% over five. Use the scenario below to test how sensitive the stock of notes is to that assumption.`,
    "The $5 redesign is the next major change to the note series. It is a chance to lift public engagement with cash, and it needs careful coordination with industry so machines and processes are ready on issue.",
  ]));
  const g = h("div", { class: "grid" });

  // Scenario explorer
  const ctrl = h("div", { class: "scenario-controls" });
  const mk = (id, label, min, max, step, value, suffix) => {
    const out = h("output", { for: id, text: `${value}${suffix}` });
    const input = h("input", { type: "range", id, min, max, step, value: String(value) });
    input.addEventListener("input", () => { out.textContent = `${input.value}${suffix}`; redraw(); });
    ctrl.append(h("label", { for: id }, `${label}: `, out, input));
    return input;
  };
  const r = (x) => (x == null ? 3 : Math.round(x * 2) / 2);
  const gHigh = mk("sc-high", "Higher-demand growth", -5, 12, 0.5, r(c10), "% a year");
  const gLow = mk("sc-low", "Lower-demand growth", -10, 8, 0.5, Math.max(-5, r(c5) - 4), "% a year");
  const horizon = mk("sc-h", "Years ahead", 3, 15, 1, 10, "");
  const chartBox = h("div");
  let inst;
  const project = (rate, years) => {
    if (!tot) return [];
    const out = [[tot[0], tot[1]]];
    for (let m = 1; m <= years * 12; m++) out.push([tot[0] + m * 30.44 * 864e5, tot[1] * Math.pow(1 + rate / 100, m / 12)]);
    return out;
  };
  function redraw() {
    const yrs = +horizon.value;
    const hist = pts("notes_value_total").filter((x) => x[0] >= yearsAgo(tot[0], 15));
    const hi = project(+gHigh.value, yrs), lo = project(+gLow.value, yrs);
    chartBox.replaceChildren();
    inst = lineChart(chartBox, {
      format: fmt.bnTick, height: 300, endLabels: true, yZero: true,
      series: [
        { label: "Actual", short: "Actual", color: "s1", points: hist },
        { label: `Higher demand (${gHigh.value}% a year)`, short: "Higher", color: "s2", points: hi, dashed: true },
        { label: `Lower demand (${gLow.value}% a year)`, short: "Lower", color: "s3", points: lo, dashed: true },
      ],
    });
    const endHi = hi.at(-1), endLo = lo.at(-1);
    summary.textContent = endHi && endLo ? `In ${new Date(endHi[0]).getUTCFullYear()}, the value on issue would be ${fmt.bn(endHi[1])} under higher demand and ${fmt.bn(endLo[1])} under lower demand, against ${fmt.bn(tot[1])} today.` : "";
  }
  const summary = h("p", { class: "card-sub" });
  g.append(card({
    span: 12, title: "Scenario: value of banknotes on issue", sub: `Simple compound-growth paths from the latest actual value. Historical growth: ${[c5, c10, c20].map((c, i) => (c == null ? null : `${[5, 10, 20][i]}-year ${nf(1).format(c)}%`)).filter(Boolean).join(", ")} a year.`,
    source: "RBA A6; projections are illustrative only",
    legendItems: [{ label: "Actual", color: "s1" }, { label: "Higher demand", color: "s2" }, { label: "Lower demand", color: "s3" }],
    build: (b) => { if (!tot) return false; b.append(ctrl, summary, chartBox); redraw(); },
  }));

  // Timeline
  const ms = D.milestones ?? [];
  const today = Date.now();
  g.append(card({
    span: 12, title: "Banknote programs: milestones", sub: "Next Generation Banknotes and the $5 redesign", source: "RBA media releases",
    build: (b) => {
      if (!ms.length) return false;
      b.append(h("ol", { class: "timeline" }, ms.map((m) => {
        const t = m.date ? parseDate(m.date) : null;
        const li = h("li", { class: !t || t > today ? "future" : "" },
          h("div", { class: "when", text: t ? new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "To come" }),
          h("div", { class: "what" }, h("b", { text: `${m.title}` }), m.detail ? h("span", { text: m.detail }) : null, " ",
            m.source_url ? h("a", { href: m.source_url, target: "_blank", rel: "noopener", text: "Source" }) : null));
        return li;
      })));
    },
  }));

  g.append(card({
    span: 12, title: "Strategic questions this data raises", build: (b) => {
      b.append(h("ul", {}, [
        "How much of the note stock is used for transactions versus held as a store of value, and how does that change production and quality planning?",
        "At what point does falling transactional use threaten the economics of cash distribution, and which communities feel it first?",
        "How should the $5 redesign rollout be sequenced with industry so that machines, retailers and accessibility groups are ready?",
        "What early-warning indicators should trigger action on cash access, such as ATM numbers, cash-in-transit volumes or merchant acceptance?",
        "How do counterfeit trends and security features need to evolve as the stock of high-denomination notes grows?",
      ].map((q) => h("li", { text: q }))));
    },
  }));
  p.append(g);
}

function sources(p) {
  const rows = (D.sources ?? []).map((s) => [s]);
  const t = h("table", { class: "data" },
    h("thead", {}, h("tr", {}, ["Source", "Status", "Last successful download"].map((x) => h("th", { scope: "col", text: x })))),
    h("tbody", {}, rows.map(([s]) => h("tr", {},
      h("td", {}, h("a", { href: s.page || s.url, target: "_blank", rel: "noopener", text: s.title })),
      h("td", { class: s.ok ? "status-ok" : "status-bad", text: s.ok ? "✓ Updated" : `✕ Failed: ${s.error ?? "unknown"}` }),
      h("td", { text: s.last_success ? new Date(s.last_success).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Never" })))));
  p.append(h("div", { class: "card sources" }, h("div", { class: "table-wrap" }, t)));
  p.append(h("div", { class: "methods" },
    h("h3", { text: "How the data is refreshed" }),
    h("p", { text: "A GitHub Actions workflow downloads every source above, rebuilds the figures and republishes this page. It runs automatically every Monday and can be run at any time with one click (Actions tab, \"Refresh data and publish\", Run workflow). If a source is unavailable, the previous copy is kept and the failure is shown above." }),
    h("h3", { text: "Definitions and calculations" }),
    h("ul", {}, [
      "Banknotes on issue: the value and number of Australian banknotes the RBA has issued that have not been returned, at the end of each month (RBA table A6). It includes notes held overseas and by banks.",
      "Share of GDP: value on issue divided by the sum of the latest four quarters of nominal GDP (RBA table H1).",
      "Per person: value on issue divided by the ABS estimated resident population for the nearest quarter.",
      "Counterfeits: counterfeits detected per million genuine banknotes, as published quarterly by the RBA (table A7). Detection depends on notes being found and reported.",
      "ATMs and branches: RBA table C8 (discontinued in 2018) counts all ATMs, including independent operators. APRA's points of presence data, from 2017, covers only ATMs and branches run by banks and other authorised deposit-taking institutions, so the two series are not directly comparable.",
      "ATM data: seasonally adjusted monthly withdrawals from RBA table C4, extended back with the discontinued C4 series where available. Average withdrawal is value divided by number.",
      "Consumer payments: shares of payments by number and value from the RBA Consumer Payments Survey, held every three years. These figures are entered by hand from RBA publications and listed in data/manual/consumer_payments_survey.csv.",
      "Scenarios: simple compound growth from the latest actual value. They show sensitivity to assumptions, not a forecast.",
    ].map((x) => h("li", { text: x }))),
    h("h3", { text: "Caveats" }),
    h("p", { text: "Some RBA series are revised or re-based. Discontinued series are joined to current ones only where they overlap closely. This dashboard is an independent analysis of public data and is not produced by the Reserve Bank of Australia." }),
  ));
}

// ---------- shell ----------
const PANELS = [
  ["overview", "Overview", "The big picture: how much cash is out there, how it is used, and how trust in it holds up.", overview],
  ["demand", "Demand", "How many banknotes Australians hold, in which denominations, and how that compares with the size of the economy.", demand],
  ["use", "Use", "How often Australians pay with cash, and how that has changed against cards.", use],
  ["access", "Access", "Whether people can still get cash easily: ATM withdrawals and the network that supports them.", access],
  ["integrity", "Integrity", "Counterfeiting rates, a key measure of trust in the currency.", integrity],
  ["outlook", "Outlook", "Where demand for banknotes could go, and the programs shaping the future of the note series.", outlook],
  ["regions", "Regions", "Census and banking statistics for each of Australia's 88 SA4 regions, with a printable brief for any region you're visiting.", regionsPanel],
  ["sources", "Sources and methods", "Where every number comes from, when it was last refreshed, and how it was calculated.", sources],
];

function setTab(id, push = true) {
  for (const [pid] of PANELS) {
    $(`#tab-${pid}`).setAttribute("aria-selected", String(pid === id));
    $(`#tab-${pid}`).tabIndex = pid === id ? 0 : -1;
    $(`#panel-${pid}`).classList.toggle("active", pid === id);
  }
  $(".filters").hidden = ["sources", "outlook", "overview", "regions"].includes(id);
  if (push && !location.hash.startsWith(`#${id}/`)) history.replaceState(null, "", `#${id}`);
}

async function main() {
  const res = await fetch("data/dashboard.json", { cache: "no-cache" });
  D = await res.json();

  const gen = D.generated ? new Date(D.generated) : null;
  $("#updated").textContent = gen ? `Data refreshed ${gen.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}` : "";
  const failed = (D.sources ?? []).filter((s) => !s.ok);
  const status = $("#status");
  status.classList.toggle("warn", failed.length > 0);
  status.lastChild.textContent = failed.length ? `${failed.length} source${failed.length > 1 ? "s" : ""} not updated` : "All sources up to date";

  const nav = $("nav.tabs .wrap");
  const main = $("main");
  for (const [id, label, lede, fn] of PANELS) {
    const b = h("button", { role: "tab", id: `tab-${id}`, "aria-controls": `panel-${id}`, type: "button", text: label });
    b.addEventListener("click", () => setTab(id));
    nav.append(b);
    const p = h("section", { class: "panel", id: `panel-${id}`, role: "tabpanel", "aria-labelledby": `tab-${id}` },
      h("h2", { text: label }), h("p", { class: "lede", text: lede }));
    main.append(p);
    const fail = (e) => { console.error(e); p.append(h("p", { class: "empty", text: "This section couldn't be built from the latest data." })); };
    try { Promise.resolve(fn(p)).catch(fail); } catch (e) { fail(e); }
  }
  nav.addEventListener("keydown", (e) => {
    const ids = PANELS.map((x) => x[0]);
    const cur = ids.indexOf(document.activeElement?.id?.replace("tab-", ""));
    if (cur < 0 || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const next = ids[(cur + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    setTab(next); $(`#tab-${next}`).focus();
  });

  for (const b of document.querySelectorAll(".filters .seg button")) {
    b.setAttribute("aria-pressed", String(b.dataset.range === rangeKey));
    b.addEventListener("click", () => {
      rangeKey = b.dataset.range;
      try { localStorage.setItem("bn-range", rangeKey); } catch { /* ignore */ }
      for (const x of document.querySelectorAll(".filters .seg button")) x.setAttribute("aria-pressed", String(x === b));
      charts.forEach((redraw) => redraw());
    });
  }

  const initial = location.hash.slice(1).split("/")[0];
  setTab(PANELS.some((x) => x[0] === initial) ? initial : "overview", false);
}

// Theme toggle (light / dark / follow system)
(function theme() {
  const root = document.documentElement;
  let t = null;
  try { t = localStorage.getItem("bn-theme"); } catch { /* ignore */ }
  if (t) root.dataset.theme = t;
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-btn")) return;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("bn-theme", root.dataset.theme); } catch { /* ignore */ }
    charts.forEach((redraw) => redraw());
  });
})();

main().catch((e) => {
  console.error(e);
  $("main").append(h("p", { class: "empty", text: "The dashboard data couldn't be loaded." }));
});
