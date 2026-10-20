# Australian Banknote Dashboard

An interactive dashboard covering the demand for, use of, access to and integrity of Australia's banknotes. It is built from Reserve Bank of Australia (RBA) statistical tables, the RBA Consumer Payments Survey and ABS population data.

**Tabs:** Overview (with the cash paradox) · Demand · Use · Access · Integrity · Outlook (forecast to 2030, scenarios and the $5 redesign) · World (international comparison) · Regions (cash vulnerability map and printable regional briefs) · Sources and methods

## Refreshing the data (one click)

1. Open the **Actions** tab of this repository.
2. Choose **Refresh data and publish**.
3. Click **Run workflow**.

The workflow downloads every source, rebuilds the figures, commits the refreshed data and republishes the site. It also runs automatically every Monday morning (Sydney time) and after any code change. If a source is unavailable, the last good copy is kept and the dashboard's Sources page flags it.

### First-time setup

In **Settings → Pages**, set **Source** to **GitHub Actions**. You only need to do this once.

## How it works

```
pipeline/sources.py   every external file the dashboard uses (URLs in one place)
pipeline/fetch.py     downloads them to data/raw/ and records status in data/raw/manifest.json
pipeline/rba.py       parser for the RBA's standard statistical-table layout
pipeline/build.py     finds the right series, derives measures, writes docs/data/dashboard.json
pipeline/regions.py   builds the Regions tab: Census, SEIFA and APRA data by SA4, distance to cash, the cash vulnerability index and the map
pipeline/discover.py  lists every series in every table (written to data/discovery.txt)
data/manual/          hand-entered figures: Consumer Payments Survey results and program milestones
data/clean/           one tidy CSV per series, for use in Excel or elsewhere
docs/                 the static site (HTML, CSS, JavaScript, no build step)
```

`build.py` finds series by matching words in each RBA series title rather than fixed IDs, so small relabelling by the RBA doesn't break the refresh. The Actions log prints every match it made.

### Updating hand-entered data

The Consumer Payments Survey runs every three years. When a new one is published, add a row to `data/manual/consumer_payments_survey.csv`. Add new banknote program milestones, such as the $5 redesign reveal, to `data/manual/milestones.csv`. Commit the change and the site rebuilds itself.

### Running locally

```bash
pip install -r requirements.txt
python pipeline/fetch.py && python pipeline/build.py
python -m http.server -d docs 8000   # then open http://localhost:8000
```

## Sources

- RBA statistical tables A6 (Banknotes on Issue by Denomination), A7 (Detected Australian Counterfeits), C2 (Debit Cards), C4 and C4.1 (ATMs), D3 (Monetary Aggregates), F1 (Money Market Rates) and H1 (GDP), plus the discontinued tables C4 and C8
- RBA Consumer Payments Survey (Research Discussion Paper 2023-08; Bulletin, April and May 2026)
- RBA media releases on the Next Generation Banknote program and the $5 redesign
- ABS Estimated Resident Population (Data API)
- ABS 2021 Census General Community Profile (SA4 DataPack), SEIFA 2021 (by SA2) and ASGS 2021 SA4 boundaries
- APRA Authorised deposit-taking institutions' points of presence (every bank branch, ATM and Bank@Post outlet, by location)
- BIS CPMI comparative tables (banknotes and coins in circulation by country, for the World tab)

This is an independent analysis of public data, not an official RBA publication.
