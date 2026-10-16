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


# ---------------------------------------------------------------- banknotes (A6)
print("A6 banknotes on issue")
d, m = table("a6")
if d is not None:
    for den in DENOMS:
        v = pick("a6", d, m, rf"\${den}\b", "value", units=r"\$")
        if v is None:
            v = pick("a6", d, m, rf"\${den}\b", units=r"\$")
        if v is not None:
            add(f"notes_value_{den}", to_millions(v, units_of(m, d, v)), f"${den} value on issue", "$m", "RBA A6")
        n = pick("a6", d, m, rf"\${den}\b", "number|volume", exclude=["value"])
        if n is not None:
            add(f"notes_count_{den}", to_millions(n, units_of(m, d, n) or "number"), f"${den} notes on issue", "million notes", "RBA A6")
    tot = first(pick("a6", d, m, "total", "value", units=r"\$"), pick("a6", d, m, "total", units=r"\$"))
    if tot is None and all(f"notes_value_{x}" in series for x in DENOMS):
        tot = sum(series[f"notes_value_{x}"]["points"] for x in DENOMS)
        tot_units = "$ million"
    else:
        tot_units = units_of(m, d, tot) if tot is not None else ""
    if tot is not None:
        tot = to_millions(tot, tot_units)
        add("notes_value_total", tot, "Value of banknotes on issue", "$m", "RBA A6")
        add("notes_value_yoy", yoy(tot), "Annual growth", "%", "RBA A6")

# ---------------------------------------------------------------- counterfeits (A7)
print("A7 counterfeits")
d, m = table("a7")
if d is not None:
    ppm = first(pick("a7", d, m, "per million|ppm|parts per", exclude=[r"\$\d"]), pick("a7", d, m, "per million|ppm|parts per"))
    add("counterfeit_ppm", ppm, "Counterfeits per million notes", "ppm", "RBA A7")
    for den in DENOMS:
        c = pick("a7", d, m, rf"\${den}\b", exclude=["per million", "ppm", "parts per"])
        add(f"counterfeit_count_{den}", c, f"${den} counterfeits detected", "number", "RBA A7")

# ---------------------------------------------------------------- ATMs (C4, C4.1, discontinued C4, C8)
print("C4 ATMs")
d, m = table("c4")
num = val = None
if d is not None:
    num = pick("c4", d, m, "withdrawal", "number|volume", exclude=["value"])
    val = pick("c4", d, m, "withdrawal", "value")
    if num is not None:
        num = to_millions(num, units_of(m, d, num))
    if val is not None:
        val = to_millions(val, units_of(m, d, val))
print("C4 discontinued")
dd, md = table("c4_disc")
if dd is not None:
    onum = pick("c4_disc", dd, md, "number|volume", exclude=["value", "machines", "terminals", "ATMs$"])
    oval = pick("c4_disc", dd, md, "value")
    if onum is not None:
        onum = to_millions(onum, units_of(md, dd, onum))
        num = onum if num is None else pd.concat([onum[onum.index < num.index.min()], num])
    if oval is not None:
        oval = to_millions(oval, units_of(md, dd, oval))
        val = oval if val is None else pd.concat([oval[oval.index < val.index.min()], val])
add("atm_withdrawals_number", num, "ATM withdrawals", "million per month", "RBA C4")
add("atm_withdrawals_value", val, "ATM withdrawals value", "$m per month", "RBA C4")
if num is not None and val is not None:
    add("atm_avg_withdrawal", (val / num).dropna(), "Average ATM withdrawal", "$", "RBA C4")

print("ATM counts")
count = None
for key in ("c4_1", "c4", "c8_disc"):
    d, m = table(key)
    if d is None:
        continue
    c = pick(key, d, m, "number of ATMs|ATM terminals|terminals|machines", exclude=["withdrawal", "value"])
    if c is not None and c.max() > 1000:
        count = c if count is None else pd.concat([c[c.index < count.index.min()], count])
add("atm_count", count, "Number of ATMs", "number", "RBA C4.1, C8")

print("C2 debit cards")
d, m = table("c2")
if d is not None:
    add("debit_purchases_number", pick("c2", d, m, "purchase", "number|volume", exclude=["value"]), "Debit card purchases", "number", "RBA C2")

# ---------------------------------------------------------------- scale: GDP, population, cash rate, currency
print("H1 GDP")
d, m = table("h1")
gdp_q = None
if d is not None:
    gdp_q = pick("h1", d, m, "gross domestic product|GDP", exclude=["chain", "real", "per capita", "growth", "change", "deflator"], units=r"\$")
    if gdp_q is not None:
        gdp_q = to_millions(gdp_q, units_of(m, d, gdp_q))

print("F1 cash rate")
d, m = table("f1")
if d is not None:
    cr = first(pick("f1", d, m, "cash rate target"), pick("f1", d, m, "cash rate"))
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
        p = pop.reindex(pop.index.union(tot.index)).interpolate(limit_area="inside").reindex(tot.index)
        add("notes_value_per_capita", (tot * 1e6 / p).dropna(), "Banknotes on issue per person", "$", "RBA A6, ABS")

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
}
OUT.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {OUT.relative_to(ROOT)}: {len(series)} series, {OUT.stat().st_size:,} bytes")
