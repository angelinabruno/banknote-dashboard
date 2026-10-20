"""Build the Regions tab data: one row per SA4 region plus a simplified map.

Outputs
  docs/data/regions.json        metrics for every SA4 and for Australia
  docs/data/sa4.geojson         simplified SA4 boundaries
  docs/data/access_points.json  latest bank branches and ATMs as [lon, lat, type, sa4]
  data/clean/regions.csv        the same metrics as a spreadsheet-friendly table
"""

import json
import pathlib
import re
import zipfile

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DOCS = ROOT / "docs" / "data"
CLEAN = ROOT / "data" / "clean"

# Published national figures from 2021 Census QuickStats (Australia), used where
# a national value can't be summed from the regions.
NATIONAL_CENSUS = {"median_age": 38, "median_hh_income": 1746, "median_rent": 375}

METRICS = [
    # id, label, unit, format, short description, cash relevance
    ("cvi", "Cash vulnerability index", "0 to 100", "int", "How exposed residents would be to a loss of cash services: the average of the cash reliance and access gap scores below. Higher means more vulnerable", "Combines who relies on cash with how hard it is to get."),
    ("reliance", "Cash reliance score", "0 to 100", "int", "Average score on four drivers of cash use: share aged 65 and over, disadvantage (IRSD), share First Nations, and low household income. Each is scaled 0 to 100 across regions", "Older, lower-income and remote First Nations communities rely on cash most."),
    ("access_gap", "Cash access gap score", "0 to 100", "int", "Average score on distance to the nearest cash access point, share of residents more than 10 km away, and branch closures since 2017. Each is scaled 0 to 100 across regions", "Distance and closures raise the cost of using cash."),
    ("km_to_cash", "Distance to nearest cash access point", "km", "dec1", "Population-weighted average straight-line distance from each SA2's centre to the nearest bank branch, Bank@Post outlet, bank ATM or other face-to-face point", "The further away cash is, the harder it is to use."),
    ("pct_far_cash", "Residents more than 10 km from cash", "%", "pct", "Share of residents whose SA2 centre is more than 10 km in a straight line from the nearest cash access point", "The further away cash is, the harder it is to use."),
    ("population", "Population", "people", "int", "Usual residents, 2021 Census", None),
    ("density", "Population density", "people per km²", "dec1", "Residents per square kilometre", None),
    ("median_age", "Median age", "years", "int", "Median age of residents", "Older Australians use cash more than younger ones."),
    ("pct_65plus", "Aged 65 and over", "%", "pct", "Share of residents aged 65 and over", "Older Australians use cash more than younger ones."),
    ("median_hh_income", "Median household income", "$ a week", "dollars", "Median total household income, weekly", "Lower-income households are more likely to rely on cash."),
    ("irsd", "Socio-economic index (IRSD)", "score", "int", "Population-weighted IRSD score. Lower means more disadvantaged; Australia is about 1000", "Disadvantaged areas tend to rely more on cash."),
    ("pct_disadvantaged", "Living in the most disadvantaged areas", "%", "pct", "Share of residents in areas in the bottom 20% nationally on IRSD", "Disadvantaged areas tend to rely more on cash."),
    ("pct_first_nations", "Aboriginal and Torres Strait Islander", "%", "pct", "Share of residents identifying as Aboriginal and/or Torres Strait Islander", "Relevant to cash access in remote communities and to engagement on the $5 redesign."),
    ("pct_born_overseas", "Born overseas", "%", "pct", "Share of residents born outside Australia", None),
    ("pct_other_language", "Speak another language at home", "%", "pct", "Share of residents using a language other than English at home", "Relevant to public education on banknote security features."),
    ("median_rent", "Median rent", "$ a week", "dollars", "Median weekly rent", None),
    ("atms_per_10k", "Bank-operated ATMs per 10,000 people", "per 10,000", "dec1", "ATM machines run by banks and other ADIs (APRA), per 10,000 residents. Excludes independent ATM operators", "Fewer ATMs means harder access to cash."),
    ("branches_per_10k", "Bank branches per 10,000 people", "per 10,000", "dec1", "Branches of banks and other ADIs (APRA), per 10,000 residents", "Branches are a key way to deposit and withdraw cash."),
    ("atm_change", "Change in bank-operated ATMs since 2017", "%", "pct_signed", "Percentage change in bank-operated ATMs since June 2017. Partly reflects banks selling ATMs to independent operators", "Shrinking networks raise the cost and effort of using cash."),
    ("posts_per_10k", "Bank@Post outlets per 10,000 people", "per 10,000", "dec1", "Australia Post outlets offering Bank@Post banking (APRA), per 10,000 residents", "Bank@Post is often the last face-to-face banking service in small towns."),
    ("branch_change", "Change in branches since 2017", "%", "pct_signed", "Percentage change in branches since June 2017", "Shrinking networks raise the cost and effort of using cash."),
]

# Components of the cash vulnerability index: (metric, +1 if a higher value means more vulnerable)
RELIANCE = [("pct_65plus", 1), ("irsd", -1), ("pct_first_nations", 1), ("median_hh_income", -1)]
ACCESS_GAP = [("km_to_cash", 1), ("pct_far_cash", 1), ("branch_change", -1)]
FAR_KM = 10


def manifest():
    return json.loads((RAW / "manifest.json").read_text())


def raw_path(key):
    f = RAW / manifest().get(key, {}).get("file", "_missing_")
    return f if f.is_file() else None


def col(df, *patterns, required=True):
    for p in patterns:
        for c in df.columns:
            if re.fullmatch(p, str(c), flags=re.I):
                return c
    for p in patterns:
        for c in df.columns:
            if re.search(p, str(c), flags=re.I):
                return c
    if required:
        raise KeyError(f"none of {patterns} in columns: {list(df.columns)[:40]}")
    return None


# ------------------------------------------------------------------ boundaries
def load_geo():
    p = raw_path("sa4_geo")
    if not p:
        print("  no SA4 boundaries")
        return None, None
    g = json.loads(p.read_text())
    feats = []
    meta = {}
    for f in g["features"]:
        pr = {k.lower(): v for k, v in f["properties"].items()}
        code = str(pr.get("sa4_code_2021") or pr.get("sa4_code21") or "")
        name = pr.get("sa4_name_2021") or pr.get("sa4_name21") or code
        state = pr.get("state_name_2021") or pr.get("ste_name21") or ""
        area = pr.get("area_albers_sqkm") or pr.get("areasqkm21")
        if not code or not f.get("geometry") or re.search(r"migratory|no usual address", str(name), re.I):
            continue
        feats.append({"type": "Feature", "properties": {"code": code}, "geometry": f["geometry"]})
        meta[code] = {"name": name, "state": state, "area_sqkm": area}
    print(f"  {len(feats)} SA4 boundaries")
    return {"type": "FeatureCollection", "features": feats}, meta


def round_coords(geom, nd=3):
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


# ------------------------------------------------------------------ census
def load_census():
    p = raw_path("census_sa4")
    if not p:
        print("  no Census DataPack")
        return None
    z = zipfile.ZipFile(p)

    def table(tab):
        name = next(n for n in z.namelist() if re.search(rf"_{tab}_AUST?_SA4\.csv$", n, re.I)
                    or (re.search(rf"{tab}[^0-9]", n) and "SA4" in n and n.endswith(".csv")))
        print(f"  reading {name}")
        return pd.read_csv(z.open(name))

    g01, g02 = table("G01"), table("G02")
    code = col(g01, r"SA4_CODE_2021", r"SA4_CODE.*")
    g01 = g01.set_index(g01[code].astype(str))
    g02 = g02.set_index(g02[col(g02, r"SA4_CODE_2021", r"SA4_CODE.*")].astype(str))
    tot = g01[col(g01, r"Tot_P_P")]
    age65 = sum(g01[col(g01, p)] for p in (r"Age_65_74_yr_P", r"Age_75_84_yr_P", r"Age_85ov_P"))
    out = pd.DataFrame({
        "population": tot,
        "pct_65plus": age65 / tot * 100,
        "pct_first_nations": g01[col(g01, r"Indigenous_P_Tot_P", r"Indig.*Tot.*P")] / tot * 100,
        "pct_born_overseas": g01[col(g01, r"Birthplace_Elsewhere_P", r"Birthplace_Elsewhere.*P")] / tot * 100,
        "pct_other_language": g01[col(g01, r"Lang_used_home_Oth_Lang_P", r"Lang.*Oth.*P")] / tot * 100,
        "median_age": g02[col(g02, r"Median_age_persons", r"Median_age.*")],
        "median_hh_income": g02[col(g02, r"Median_tot_hhd_inc_weekly", r"Median_tot_hhd_inc.*")],
        "median_rent": g02[col(g02, r"Median_rent_weekly", r"Median_rent.*")],
    })
    out.index.name = "code"
    return out


# ------------------------------------------------------------------ SEIFA
def load_seifa():
    p = raw_path("seifa_sa2")
    if not p:
        print("  no SEIFA")
        return None, None
    j = json.loads(p.read_text())
    df = pd.DataFrame([{**f["attributes"], "lon": (f.get("centroid") or {}).get("x"), "lat": (f.get("centroid") or {}).get("y")}
                       for f in j.get("features", [])])
    if df.empty:
        print("  SEIFA empty")
        return None, None
    df["sa2"] = df["sa2_code_2021"].astype(str)
    df["urp"] = pd.to_numeric(df["urp"], errors="coerce")
    df["code"] = df["sa2"].str[:3]
    df = df.dropna(subset=["irsd_score", "urp"])
    g = df.groupby("code")
    irsd = g.apply(lambda x: (x["irsd_score"] * x["urp"]).sum() / x["urp"].sum(), include_groups=False)
    dis = g.apply(lambda x: x.loc[x["irsd_aus_decile"] <= 2, "urp"].sum() / x["urp"].sum() * 100, include_groups=False)
    nat = {"irsd": (df["irsd_score"] * df["urp"]).sum() / df["urp"].sum(),
           "pct_disadvantaged": df.loc[df["irsd_aus_decile"] <= 2, "urp"].sum() / df["urp"].sum() * 100}
    print(f"  SEIFA: {len(df)} SA2s -> {len(irsd)} SA4s")
    sa2_names = dict(zip(df["sa2_name_2021"].str.lower(), df["sa2"]))
    pop = df.groupby("code")["urp"].sum()
    sa2 = df[["sa2", "code", "urp", "lon", "lat"]].dropna()
    print(f"  SEIFA: {len(sa2)} SA2 centres")
    return pd.DataFrame({"irsd": irsd, "pct_disadvantaged": dis, "_pop_seifa": pop}), (nat, sa2_names, sa2)


# ------------------------------------------------------------------ APRA points of presence
def load_apra(sa4_names):
    """Branches and ATMs per SA4 from APRA's raw listing (sheet 'Table 1').

    Each row is one point of presence with its period, service channel type,
    SA4 name and latitude/longitude.
    """
    p = raw_path("apra_pop")
    if not p:
        print("  no APRA points of presence")
        return None, None, None, None
    book = pd.read_excel(p, sheet_name=None, header=None)
    listing = None
    for name, raw in book.items():
        for i in range(min(40, len(raw))):
            cells = raw.iloc[i].astype(str).str.strip().str.lower()
            if cells.eq("latitude").any():
                df = raw.iloc[i + 1:].copy()
                df.columns = [str(c).strip() for c in raw.iloc[i]]
                if listing is None or len(df) > len(listing):
                    listing = df
                    print(f"  APRA listing in sheet {name!r}: {len(df):,} rows")
                break
    if listing is None:
        print("  APRA: no sheet with locations found")
        return None, None, None, None

    lat, lon = col(listing, r"latitude"), col(listing, r"longitude")
    typ = col(listing, r"service channel type", r".*type.*")
    period = col(listing, r"period", r".*date.*")
    sa4n = col(listing, r"SA4 name", r".*SA4.*")
    df = listing.dropna(subset=[lat, lon, period]).copy()
    norm = lambda x: re.sub(r"[^a-z0-9]", "", str(x).lower())
    lookup = {norm(n): c for n, c in sa4_names.items()}
    df["code"] = df[sa4n].map(lambda x: lookup.get(norm(x)))
    unmatched = df.loc[df["code"].isna(), sa4n].unique()
    if len(unmatched):
        print(f"  APRA: {len(unmatched)} SA4 names not matched, e.g. {list(unmatched)[:5]}")
    t = df[typ].astype(str).str.strip().str.lower()
    df["kind"] = None
    df.loc[t.str.contains("atm"), "kind"] = "atm"
    df.loc[t.eq("branch") | t.eq("branches"), "kind"] = "branch"
    df.loc[t.str.contains("post"), "kind"] = "post"
    df.loc[t.str.contains("other face"), "kind"] = "other"
    print("  APRA service types:", df[typ].value_counts().to_dict())
    # Each row is a site; "Number" is how many (e.g. ATM machines) are at it.
    num = col(df, r"number", required=False)
    df["n"] = pd.to_numeric(df[num], errors="coerce").fillna(1) if num else 1
    df["_p"] = pd.to_datetime(df[period], errors="coerce")
    latest, first = df["_p"].max(), df["_p"].min()
    print(f"  APRA periods {first:%Y-%m} .. {latest:%Y-%m}")
    now, then = df[df["_p"] == latest], df[df["_p"] == first]
    counts = now.groupby(["code", "kind"])["n"].sum().unstack(fill_value=0)
    base = then.groupby(["code", "kind"])["n"].sum().unstack(fill_value=0)
    national = df.groupby(["_p", "kind"])["n"].sum().unstack(fill_value=0)
    national.index.name = "date"
    pts = [[round(float(a), 4), round(float(b), 4), k, c]
           for a, b, k, c in now.loc[now["kind"].notna(), [lon, lat, "kind", "code"]].itertuples(index=False)]
    return counts, base, pts, national


# ------------------------------------------------------------------ distance to cash
def nearest_km(src, dst):
    """Straight-line km from each (lon, lat) in src to the nearest point in dst."""
    if not len(src) or not len(dst):
        return np.full(len(src), np.nan)
    lon1, lat1 = np.radians(src[:, 0])[:, None], np.radians(src[:, 1])[:, None]
    lon2, lat2 = np.radians(dst[:, 0])[None, :], np.radians(dst[:, 1])[None, :]
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return (2 * 6371 * np.arcsin(np.sqrt(a))).min(axis=1)


def access_distances(sa2, pts):
    """Population-weighted distance from SA2 centres to cash, summarised by SA4."""
    if sa2 is None or sa2.empty or not pts:
        print("  no SA2 centres or access points; skipping distances")
        return None, {}
    p = np.array([[x[0], x[1]] for x in pts])
    kinds = np.array([x[2] for x in pts])
    xy = sa2[["lon", "lat"]].to_numpy(float)
    d = sa2.copy()
    d["cash"] = nearest_km(xy, p[np.isin(kinds, ["atm", "branch", "post", "other"])])
    d["deposit"] = nearest_km(xy, p[np.isin(kinds, ["branch", "post"])])
    d["far"] = (d["cash"] > FAR_KM).astype(float)
    w = d["urp"]
    def wavg(x, c):
        return (x[c] * x["urp"]).sum() / x["urp"].sum() if x["urp"].sum() else np.nan
    g = d.groupby("code")
    out = pd.DataFrame({
        "km_to_cash": g.apply(lambda x: wavg(x, "cash"), include_groups=False),
        "pct_far_cash": g.apply(lambda x: wavg(x, "far") * 100, include_groups=False),
        "km_to_deposit": g.apply(lambda x: wavg(x, "deposit"), include_groups=False),
    })
    nat = {"km_to_cash": (d["cash"] * w).sum() / w.sum(), "pct_far_cash": (d["far"] * w).sum() / w.sum() * 100,
           "km_to_deposit": (d["deposit"] * w).sum() / w.sum()}
    print(f"  distances: {nat['pct_far_cash']:.1f}% of residents more than {FAR_KM} km from cash")
    return out, nat


def score(s, sign, log=False):
    """0 (least vulnerable) to 100 (most), scaled between the 5th and 95th
    percentile of regions so extreme values still stand out but can't dominate."""
    x = (np.log1p(s) if log else s) * sign
    lo, hi = x.quantile(0.05), x.quantile(0.95)
    return ((x - lo) / (hi - lo)).clip(0, 1) * 100


# ------------------------------------------------------------------ assemble
def main():
    print("Regions")
    geo, meta = load_geo()
    census = load_census()
    seifa, extra = load_seifa()
    nat_seifa = extra[0] if extra else {}
    sa2 = extra[2] if extra else None
    counts, base, pts, apra_national = load_apra({v["name"]: k for k, v in (meta or {}).items()})
    if apra_national is not None:
        CLEAN.mkdir(parents=True, exist_ok=True)
        apra_national.to_csv(CLEAN / "apra_points_of_presence_national.csv")

    codes = sorted(set(meta or {}) | set(census.index if census is not None else []))
    df = pd.DataFrame(index=pd.Index(codes, name="code"))
    if meta:
        m = pd.DataFrame.from_dict(meta, orient="index")
        df = df.join(m)
    if census is not None:
        df = df.join(census)
    if seifa is not None:
        df = df.join(seifa)
        if "population" not in df:
            print("  using SEIFA usual resident population (Census DataPack unavailable)")
            df["population"] = df["_pop_seifa"]
        df = df.drop(columns="_pop_seifa")
    if "area_sqkm" in df and "population" in df:
        df["density"] = df["population"] / pd.to_numeric(df["area_sqkm"], errors="coerce")
    nat = dict(NATIONAL_CENSUS)
    nat.update(nat_seifa or {})
    if counts is not None and "population" in df:
        for kind, label in (("atm", "atms"), ("branch", "branches"), ("post", "posts")):
            if kind in counts:
                c = counts[kind].reindex(df.index).fillna(0)
                df[f"{label}_count"] = c
                df[f"{label}_per_10k"] = c / df["population"] * 1e4
                nat[f"{label}_per_10k"] = c.sum() / df["population"].sum() * 1e4
                if base is not None and kind in base:
                    b = base[kind].reindex(df.index)
                    df[f"{kind}_change"] = (c / b - 1) * 100
                    nat[f"{kind}_change"] = (c.sum() / b.sum() - 1) * 100
    if "population" in df:
        P = df["population"].sum()
        nat["population"] = P
        for k in ("pct_65plus", "pct_first_nations", "pct_born_overseas", "pct_other_language"):
            if k in df:
                nat[k] = (df[k] * df["population"]).sum() / P
        if "area_sqkm" in df:
            nat["density"] = P / pd.to_numeric(df["area_sqkm"], errors="coerce").sum()
    dist, nat_dist = access_distances(sa2, pts)
    if dist is not None:
        df = df.join(dist)
        nat.update(nat_dist)
    df = df[~df.get("name", pd.Series(dtype=str)).astype(str).str.contains("Migratory|No usual address", case=False, na=False)]
    if "population" in df:
        df = df[df["population"].fillna(0) > 0]
    if meta:
        # Census also has "migratory" and "no usual address" pseudo-regions with no boundary.
        df = df[df["name"].notna()]
    # Cash vulnerability index: percentile ranks across regions, averaged
    for name, parts in (("reliance", RELIANCE), ("access_gap", ACCESS_GAP)):
        have = [(m, sign) for m, sign in parts if m in df and df[m].notna().sum() > 10]
        if len(have) >= 2:
            df[name] = pd.concat([score(df[m], sign, log=m.startswith("km_")) for m, sign in have], axis=1).mean(axis=1)
            print(f"  {name} from {[m for m, _ in have]}")
    if "reliance" in df and "access_gap" in df:
        df["cvi"] = (df["reliance"] + df["access_gap"]) / 2
        w = df["population"] / df["population"].sum()
        nat.update({k: float((df[k] * w).sum()) for k in ("cvi", "reliance", "access_gap")})

    metrics = [{"id": i, "label": l, "unit": u, "format": f, "description": d, "cash": c}
               for i, l, u, f, d, c in METRICS if i in df.columns and df[i].notna().any()]
    rows = []
    for code, r in df.iterrows():
        row = {"code": code, "name": r.get("name", code), "state": r.get("state", "")}
        for m in metrics:
            v = r.get(m["id"])
            row[m["id"]] = None if pd.isna(v) else round(float(v), 2)
        rows.append(row)

    DOCS.mkdir(parents=True, exist_ok=True)
    CLEAN.mkdir(parents=True, exist_ok=True)
    out = {"metrics": metrics, "regions": rows,
           "national": {k: round(float(v), 2) for k, v in nat.items() if v is not None and not pd.isna(v)},
           "notes": {"census_year": 2021, "apra": "Latest June figures from APRA's points of presence publication.",
                     "far_km": FAR_KM, "cvi_components": {"reliance": [m for m, _ in RELIANCE], "access_gap": [m for m, _ in ACCESS_GAP]}}}
    (DOCS / "regions.json").write_text(json.dumps(out, separators=(",", ":")))
    pd.DataFrame(rows).to_csv(CLEAN / "regions.csv", index=False)
    if geo:
        keep = {r["code"] for r in rows}
        geo["features"] = [{"type": "Feature", "properties": f["properties"], "geometry": round_coords(f["geometry"])}
                           for f in geo["features"] if f["properties"]["code"] in keep]
        (DOCS / "sa4.geojson").write_text(json.dumps(geo, separators=(",", ":")))
    if pts:
        (DOCS / "access_points.json").write_text(json.dumps(pts, separators=(",", ":")))
    print(f"  wrote {len(rows)} regions, {len(metrics)} metrics, {len(pts or [])} access points")


if __name__ == "__main__":
    main()
