"""Download every source in sources.py into data/raw/.

A failed download keeps the previous copy, so one site being down never
breaks the dashboard; the failure is recorded in data/raw/manifest.json and
shown on the dashboard's sources page.
"""

import datetime as dt
import json
import pathlib
import re
import urllib.parse
import sys
import time
import urllib.request

from sources import SOURCES

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (banknote-dashboard refresh; +https://github.com/)",
    "Accept": "*/*",
}


def download(url, dest, attempts=3):
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            if len(body) < 200:
                raise ValueError(f"suspiciously small response ({len(body)} bytes)")
            dest.write_bytes(body)
            return len(body)
        except Exception as e:  # noqa: BLE001 - report any failure and retry
            last = e
            time.sleep(2 ** (i + 1))
    raise last


def resolve_url(src):
    """Use the newest matching link on a landing page when one is configured.

    Some publishers (APRA, the ABS DataPacks page) put a date in the file name,
    so the link is looked up on each refresh and the configured URL is the fallback.
    """
    finder = src.get("find_link")
    if not finder:
        return src["url"]
    try:
        req = urllib.request.Request(finder["page"], headers=HEADERS)
        with urllib.request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
        links = re.findall(finder["pattern"], html, flags=re.I)
        if links:
            # Newest first: file names carry dates, so sort descending.
            link = sorted(set(links), reverse=True)[0].replace("&amp;", "&")
            return urllib.parse.urljoin(finder["page"], link)
        print(f"      no link matching {finder['pattern']!r} on {finder['page']}; using configured URL")
    except Exception as e:  # noqa: BLE001
        print(f"      link lookup failed ({e}); using configured URL")
    return src["url"]


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    manifest_path = RAW / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    failures = 0
    for key, src in SOURCES.items():
        ext = src.get("ext") or pathlib.Path(src["url"].split("?")[0]).suffix or ".csv"
        dest = RAW / f"{key}{ext}"
        url = resolve_url(src)
        entry = manifest.get(key, {})
        entry.update({"url": url, "file": dest.name, "last_attempt": now})
        try:
            size = download(url, dest)
            entry.update({"ok": True, "last_success": now, "bytes": size, "error": None})
            print(f"ok    {key:14} {size:>9,} bytes")
        except Exception as e:  # noqa: BLE001
            failures += 1
            entry.update({"ok": False, "error": str(e)[:300]})
            kept = "kept previous copy" if dest.exists() else "no copy available"
            print(f"FAIL  {key:14} {e} ({kept})")
        manifest[key] = entry
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"{len(SOURCES) - failures}/{len(SOURCES)} sources downloaded")
    # Only fail the run if nothing at all could be fetched.
    sys.exit(1 if failures == len(SOURCES) else 0)


if __name__ == "__main__":
    main()
