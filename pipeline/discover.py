"""Print the structure of every downloaded file, to map series when tables change.

Run after fetch.py:  python pipeline/discover.py > discovery.txt
"""

import json
import pathlib
import re

import pandas as pd

import rba
from sources import SOURCES

RAW = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
pd.set_option("display.width", 250, "display.max_colwidth", 90, "display.max_rows", 400)

manifest = json.loads((RAW / "manifest.json").read_text())
for key, src in SOURCES.items():
    entry = manifest.get(key, {})
    print("=" * 100)
    print(key, src["title"], "| ok:", entry.get("ok"), entry.get("error") or "")
    path = RAW / entry.get("file", "")
    if not path.is_file():
        continue
    try:
        if src["kind"] == "rba_table":
            data, meta = rba.read_table(path)
            print(f"rows {len(data)}  {data.index.min():%Y-%m} .. {data.index.max():%Y-%m}")
            print(meta[[c for c in ["Title", "Units", "Frequency"] if c in meta]].to_string())
        elif src["kind"] == "workbook":
            book = pd.read_excel(path, sheet_name=None, header=None, nrows=14)
            for name, df in book.items():
                print(f"--- sheet {name!r} (first rows)")
                print(df.to_string())
        elif src["kind"] == "zip":
            import zipfile
            z = zipfile.ZipFile(path)
            names = z.namelist()
            print(f"{len(names)} files, e.g.", [n for n in names if n.endswith(".csv")][:6])
            for n in names:
                if re.search(r"G0[12][^0-9]", n) and n.endswith(".csv"):
                    df = pd.read_csv(z.open(n), nrows=3)
                    print(f"--- {n} {df.shape[1]} columns")
                    print(", ".join(df.columns))
        elif src["kind"] == "geojson":
            g = json.loads(path.read_text())
            feats = g.get("features", [])
            print(f"{len(feats)} features; properties:", feats[0]["properties"] if feats else g)
        elif src["kind"] == "json":
            j = json.loads(path.read_text())
            feats = j.get("features", [])
            print(f"{len(feats)} records; exceededTransferLimit={j.get('exceededTransferLimit')}; first:", feats[:2] if feats else str(j)[:500])
        else:
            print(path.read_text()[:3000])
    except Exception as e:  # noqa: BLE001
        print("PARSE ERROR", repr(e))
