"""Print the structure of every downloaded file, to map series when tables change.

Run after fetch.py:  python pipeline/discover.py > discovery.txt
"""

import json
import pathlib

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
            book = pd.read_excel(path, sheet_name=None, header=None)
            for name, df in book.items():
                print(f"--- sheet {name!r} shape {df.shape}")
                print(df.head(14).to_string())
        else:
            print(path.read_text()[:3000])
    except Exception as e:  # noqa: BLE001
        print("PARSE ERROR", repr(e))
