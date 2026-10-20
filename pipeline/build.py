"""Turn the raw downloads into docs/data/dashboard.json and tidy CSVs in data/clean/.

Series are located by matching words in each RBA series' Title/Description/Units
rather than hard-coded Series IDs, so small RBA relabelling doesn't break the
build. Every match is printed so the Actions log shows exactly what was used.
"""

import csv
import datetime as dt
import io
import json
import pathlib
import re
import zipfile

import numpy as np
import pandas as pd

import rba
from sources import SOURCES

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CLEAN = ROOT / "data" / "clean"
MANUAL = ROOT / "data" / "manual"
OUT = ROOT / "docs" / "data" / "dashboard.json"
DENOMS = ["5", "10", "20", "50", "100"]

series = {}   # id -> dict(label, unit, source, points: pd.Series)
log = []


def table(key):
    manifest = json.loads((RAW / "manifest.json").read_text())
    f = RAW / manifest.get(key, {}).get("file", "_missing_")
    if not f.is_file():
        print(f"  [{key}] no file")
        return None, None
    try:
        return rba.read_table(f)
    except Exception as e:  # noqa: BLE001
        print(f"  [{key}] parse error: {e}")
        return None, None


def pick(key, data, meta, *patterns, exclude=(), units=None):
    """First series whose text matches every regex in patterns (case-insensitive)."""
    if meta is None:
        return None
    text = (meta.get("Title", "").astype(str) + " | " + meta.get("Description", "").astype(str)).str.replace("–", "-")
    mask = pd.Series(True, index=meta.index)
    for p in patterns:
        mask &= text.str.contains(p, case=False, regex=True)
    for p in exclude:
        mask &= ~text.str.contains(p, case=False, regex=True)
    if units is not None and "Units" in meta:
        mask &= meta["Units"].astype(str).str.contains(units, case=False, regex=True)
    hits = meta.index[mask]
    if not len(hits):
        print(f"  [{key}] no match for {patterns} units={units}")
        return None
    sid = hits[0]
    print(f"  [{key}] {patterns} -> {sid}: {meta.loc[sid, 'Title']} ({meta.loc[sid].get('Units', '')})"
          + (f"  [+{len(hits) - 1} other matches]" if len(hits) > 1 else ""))
    return data[sid].dropna()


def first(*candidates):
    """First candidate that is not None (pandas Series can't be used with `or`)."""
    return next((c for c in candidates if c is not None), None)


def yoy(s):
    """Year-ended percentage change for a monthly series."""
    s = s.resample("ME").last().dropna()
    return (s / s.shift(12) - 1).dropna() * 100


def add(sid, s, label, unit, source):
    if s is None or s.empty:
        print(f"  (skipped {sid})")
        return
    s = s.dropna().sort_index()
    series[sid] = {"label": label, "unit": unit, "source": source, "points": s}


def units_of(meta, data, s):
    sid = next((c for c in data.columns if data[c] is s or data[c].equals(s)), None)
    return str(meta.loc[sid, "Units"]) if sid is not None and "Units" in meta else ""


def to_millions(s, units):
    u = units.lower()
    if "billion" in u:
        return s * 1000
    if "thousand" in u or "'000" in u or "000s" in u:
        return s / 1000
    if "million" in u:
        return s
    return s / 1e6


def get(key, data, meta, series_id, *fallback, **kw):
    """A series by its RBA Series ID, falling back to a title match if the ID changes."""
    if data is not None and series_id in data:
        print(f"  [{key}] {series_id}: {meta.loc[series_id, 'Title']} ({meta.loc[series_id].get('Units', '')})")
        return data[series_id].dropna()
    print(f"  [{key}] {series_id} not found, matching by title")
    return pick(key, data, meta, *fallback, **kw) if fallback else None


def splice(old, new):
    """Join an older series onto a newer one, keeping the newer values where they overlap."""
    if old is None:
        return new
    if new is None:
        return old
    return pd.concat([old[old.index < new.index.min()], new])


# ---------------------------------------------------------------- banknotes (A6)
print("A6 banknotes on issue")
d, m = table("a6")
if d is not None:
    for den in DENOMS:
        v = get("a6", d, m, f"ARBAB{den}M", rf"\${den} notes")
        add(f"notes_value_{den}", v, f"${den} value on issue", "$m", "RBA A6")
    tot = get("a6", d, m, "ARBABTM", "all banknotes")
    if tot is not None:
        add("notes_value_total", tot, "Value of banknotes on issue", "$m", "RBA A6")
        add("notes_value_yoy", yoy(tot), "Annual growth", "%", "RBA A6")

# ---------------------------------------------------------------- counterfeits (A7, quarterly)
print("A7 counterfeits")
d, m = table("a7")
if d is not None:
    add("counterfeit_ppm", get("a7", d, m, "CRBACTPPMB", "all counterfeits per million"), "Counterfeits per million genuine notes", "ppm", "RBA A7")
    add("counterfeit_count_total", get("a7", d, m, "CRBACTB", "all counterfeits$"), "Counterfeits detected", "number", "RBA A7")
    for den in DENOMS:
        code = den.zfill(3)
        add(f"counterfeit_count_{den}", get("a7", d, m, f"CRBAC{code}B", rf"^\${den} counterfeits$"), f"${den} counterfeits detected", "number", "RBA A7")
        add(f"counterfeit_ppm_{den}", get("a7", d, m, f"CRBAC{code}PPMB", rf"\${den} counterfeits per million"), f"${den} counterfeits per million", "ppm", "RBA A7")

# ---------------------------------------------------------------- cash withdrawals (C4 seasonally adjusted, spliced to discontinued C4)
print("C4 cash withdrawals")
d, m = table("c4")
num = get("c4", d, m, "CACWTAWNSA", "total number of cash withdrawals in australia")
val = get("c4", d, m, "CACWTAWVSA", "total value of cash withdrawals in australia")
dd, md = table("c4_disc")
onum = get("c4_disc", dd, md, "CACWTN", "total number of atm cash withdrawals")
oval = get("c4_disc", dd, md, "CACWTV", "total value of atm cash withdrawals")
num = splice(None if onum is None else onum / 1000, None if num is None else num / 1000)   # '000 -> million
val = splice(oval, val)
add("atm_withdrawals_number", num, "Cash withdrawals", "million per month", "RBA C4")
add("atm_withdrawals_value", val, "Cash withdrawals value", "$m per month", "RBA C4")
if num is not None and val is not None:
    add("atm_avg_withdrawal", (val / num).dropna(), "Average cash withdrawal", "$", "RBA C4")

# ---------------------------------------------------------------- ATMs and branches (C8 to 2018; APRA from 2017)
print("ATMs and branches")
d, m = table("c8_disc")
add("atm_count", get("c8_disc", d, m, "CPAAPSATM", "^ATMs$"), "ATMs, all operators", "number", "RBA C8")
add("branch_count", get("c8_disc", d, m, "CPAAPSBB", "^bank branches$"), "Bank branches", "number", "RBA C8")
apra_csv = CLEAN / "apra_points_of_presence_national.csv"
if apra_csv.exists():
    ap = pd.read_csv(apra_csv, index_col=0, parse_dates=True)
    if "atm" in ap:
        add("atm_count_adi", ap["atm"], "ATMs operated by banks and other ADIs", "number", "APRA")
    if "branch" in ap:
        add("branch_count_adi", ap["branch"], "Branches of banks and other ADIs", "number", "APRA")
    if "post" in ap:
        add("bankpost_count", ap["post"], "Bank@Post outlets", "number", "APRA")
else:
    print("  no APRA national counts (run regions.py first)")

# ---------------------------------------------------------------- debit cards (C2)
print("C2 debit cards")
d, m = table("c2")
add("debit_purchases_number", get("c2", d, m, "CDCPTTNSA", "number of purchases"), "Debit card purchases", "million per month", "RBA C2")

# ---------------------------------------------------------------- currency vs deposits (D3)
print("D3 money")
d, m = table("d3")
cur, m1 = get("d3", d, m, "DMACN", "^currency$"), get("d3", d, m, "DMAM1N", "^M1$")
if cur is not None and m1 is not None:
    add("currency_pct_m1", (cur / m1 * 100).dropna(), "Currency as a share of M1", "%", "RBA D3")

# ---------------------------------------------------------------- scale: GDP, population, cash rate, currency
print("H1 GDP")
d, m = table("h1")
gdp_q = None
if d is not None:
    gdp_q = get("h1", d, m, "GGDPECCPGDP", "^nominal gdp$")

print("F1 cash rate")
d, m = table("f1")
if d is not None:
    cr = get("f1", d, m, "FIRMMCRT", "cash rate target")
    if cr is not None:
        cr = cr.resample("ME").last().dropna()
    add("cash_rate", cr, "Cash rate target", "%", "RBA F1")

print("ABS population")
pop = None
try:
    manifest = json.loads((RAW / "manifest.json").read_text())
    f = RAW / manifest["abs_erp"]["file"]
    df = pd.read_csv(f)
    tcol = next(c for c in df.columns if c.upper().startswith("TIME_PERIOD"))
    vcol = next(c for c in df.columns if c.upper().startswith("OBS_VALUE"))
    pop = pd.Series(df[vcol].values, index=pd.PeriodIndex(df[tcol], freq="Q").to_timestamp(how="end").normalize()).sort_index()
    print(f"  population {len(pop)} quarters, latest {pop.index[-1]:%Y-%m} = {pop.iloc[-1]:,.0f}")
except Exception as e:  # noqa: BLE001
    print("  population unavailable:", e)

if "notes_value_total" in series:
    tot = series["notes_value_total"]["points"]
    if gdp_q is not None and len(gdp_q) > 4:
        gdp_annual = gdp_q.rolling(4).sum().dropna()
        g = gdp_annual.reindex(tot.index, method="ffill", limit=6)
        add("notes_value_pct_gdp", (tot / g * 100).dropna(), "Banknotes on issue, % of GDP", "%", "RBA A6, H1")
    if pop is not None:
        p = pop.reindex(pop.index.union(tot.index)).interpolate(limit_area="inside").ffill(limit=8).reindex(tot.index)
        add("notes_value_per_capita", (tot * 1e6 / p).dropna(), "Banknotes on issue per person", "$", "RBA A6, ABS")

# ---------------------------------------------------------------- forecasts
# A random walk with drift in log terms. The central path continues the past
# five years' average growth; the bands combine year-to-year volatility with
# uncertainty about that average, so they widen with the horizon. Tested by
# re-running the model from every September since 2008 and checking how often
# the outcome five years later fell inside the 80% band.
FORECAST_END = pd.Timestamp("2030-12-31")
DRIFT_YEARS, VOL_YEARS, TEST_YEARS = 5, 20, 5
Z = {"p50": 0, "lo80": -1.2816, "hi80": 1.2816, "lo95": -1.96, "hi95": 1.96}


def fit(s):
    logs = np.log(s)
    last_t = s.index[-1]
    mu = (logs.iloc[-1] - logs[logs.index <= last_t - pd.DateOffset(years=DRIFT_YEARS)].iloc[-1]) / DRIFT_YEARS
    g = (logs - logs.shift(12)).dropna()
    g = g[(g.index > last_t - pd.DateOffset(years=VOL_YEARS)) & (g.index.month == last_t.month)]   # non-overlapping years
    return logs.iloc[-1], mu, float(g.std())


def band(level, mu, sigma, years):
    sd = sigma * np.sqrt(years + years ** 2 / DRIFT_YEARS)
    return {k: float(np.exp(level + mu * years + z * sd)) for k, z in Z.items()}


def forecast(s):
    s = s.resample("ME").last().dropna()
    s = s[s > 0]
    if len(s) < 12 * (DRIFT_YEARS + 3):
        return None
    level, mu, sigma = fit(s)
    last_t = s.index[-1]
    pts = []
    for t in pd.date_range(last_t, FORECAST_END, freq="ME"):
        b = band(level, mu, sigma, (t - last_t).days / 365.25)
        pts.append([t.strftime("%Y-%m-%d")] + [round(b[k], 1) for k in Z])
    tests = []
    for year in range(2008, last_t.year - TEST_YEARS + 1):
        origin = pd.Timestamp(year=year, month=last_t.month, day=1) + pd.offsets.MonthEnd(0)
        past = s[s.index <= origin]
        target = s[s.index <= origin + pd.DateOffset(years=TEST_YEARS)]
        if len(past) < 12 * (DRIFT_YEARS + 3) or target.index[-1] < origin + pd.DateOffset(years=TEST_YEARS) - pd.DateOffset(days=40):
            continue
        b = band(*fit(past), TEST_YEARS)
        actual = float(target.iloc[-1])
        tests.append({"origin": origin.strftime("%Y-%m-%d"), "predicted": round(b["p50"], 1), "actual": round(actual, 1),
                      "error_pct": round((b["p50"] / actual - 1) * 100, 1), "within80": bool(b["lo80"] <= actual <= b["hi80"])})
    return {"drift_pct": round(float(np.expm1(mu) * 100), 2), "sigma_pct": round(sigma * 100, 2),
            "origin": last_t.strftime("%Y-%m-%d"), "columns": ["date"] + list(Z), "points": pts,
            "backtest": {"years_ahead": TEST_YEARS, "tests": tests,
                         "coverage80": round(sum(t["within80"] for t in tests) / len(tests) * 100) if tests else None,
                         "median_abs_error_pct": round(float(np.median([abs(t["error_pct"]) for t in tests])), 1) if tests else None}}


forecasts = {}
for sid in ["notes_value_total"] + [f"notes_value_{d}" for d in DENOMS]:
    if sid in series:
        f = forecast(series[sid]["points"])
        if f:
            forecasts[sid] = f
            bt = f["backtest"]
            print(f"  forecast {sid}: drift {f['drift_pct']}%/yr, sigma {f['sigma_pct']}%, 2030 {f['points'][-1][1:]}, "
                  f"backtest coverage {bt['coverage80']}% of {len(bt['tests'])}, median error {bt['median_abs_error_pct']}%")

# ---------------------------------------------------------------- international comparison (BIS CPMI)
print("BIS international")
international = None
try:
    manifest = json.loads((RAW / "manifest.json").read_text())
    z = zipfile.ZipFile(RAW / manifest["bis_ct1"]["file"])
    bis = pd.read_csv(z.open(next(n for n in z.namelist() if n.endswith(".csv"))), low_memory=False)
    title = next(c for c in bis.columns if c.startswith("TITLE_TS"))
    unit = next(c for c in bis.columns if c.startswith("UNIT_MEASURE"))
    cty = next(c for c in bis.columns if c.startswith("REP_CTY"))
    per = next(c for c in bis.columns if c.startswith("TIME_PERIOD"))
    val = next(c for c in bis.columns if c.startswith("OBS_VALUE"))
    cash = bis[bis[title].str.contains("Banknotes and coins", case=False, na=False)]
    international = {}
    for key, pattern in (("pct_gdp", "% of GDP"), ("per_capita_usd", "Per inhabitant")):
        sub = cash[cash[unit].str.contains(pattern, regex=False, na=False)].dropna(subset=[val])
        for c, grp in sub.groupby(cty):
            code, name = [x.strip() for x in str(c).split(":", 1)]
            e = international.setdefault(code, {"name": name})
            e[key] = [[int(y), round(float(v), 2)] for y, v in grp.sort_values(per)[[per, val]].itertuples(index=False)]
    print(f"  {len(international)} countries, latest year {max(p[-1][0] for e in international.values() for k, p in e.items() if k != 'name')}")
except Exception as e:  # noqa: BLE001
    print("  BIS data unavailable:", e)

# ---------------------------------------------------------------- manual data
with open(MANUAL / "consumer_payments_survey.csv", newline="") as fh:
    cps = [{k: (int(v) if k != "source" and v.strip().isdigit() else v) for k, v in r.items()} for r in csv.DictReader(fh)]
with open(MANUAL / "milestones.csv", newline="") as fh:
    milestones = list(csv.DictReader(fh))

# ---------------------------------------------------------------- write outputs
CLEAN.mkdir(parents=True, exist_ok=True)
OUT.parent.mkdir(parents=True, exist_ok=True)
for sid, s in series.items():
    s["points"].rename("value").to_frame().rename_axis("date").to_csv(CLEAN / f"{sid}.csv")

manifest = json.loads((RAW / "manifest.json").read_text())
out = {
    "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    "sources": [
        {"key": k, "title": v["title"], "url": v["url"], "page": v.get("page"),
         "ok": manifest.get(k, {}).get("ok", False), "last_success": manifest.get(k, {}).get("last_success"),
         "error": manifest.get(k, {}).get("error")}
        for k, v in SOURCES.items()
    ],
    "series": {
        sid: {"label": s["label"], "unit": s["unit"], "source": s["source"],
              "points": [[t.strftime("%Y-%m-%d"), None if pd.isna(v) else round(float(v), 4)] for t, v in s["points"].items()]}
        for sid, s in series.items()
    },
    "cps": cps,
    "milestones": milestones,
    "forecasts": forecasts,
    "international": international,
}
OUT.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {OUT.relative_to(ROOT)}: {len(series)} series, {OUT.stat().st_size:,} bytes")
