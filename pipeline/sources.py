"""Every external file the dashboard depends on.

Each entry is downloaded on refresh. RBA statistical tables share one layout,
so they are parsed generically (see rba.py); anything else gets its own parser.
"""

RBA = "https://www.rba.gov.au"

SOURCES = {
    # Banknotes
    "a6": {
        "url": f"{RBA}/statistics/tables/xls/a06hist.xlsx",
        "kind": "rba_table",
        "title": "A6 Banknotes on Issue by Denomination",
        "page": f"{RBA}/statistics/tables/#banknotes",
    },
    "a7": {
        "url": f"{RBA}/statistics/tables/xls/a07hist.xlsx",
        "kind": "rba_table",
        "title": "A7 Detected Australian Counterfeits by Denomination",
        "page": f"{RBA}/statistics/tables/#banknotes",
    },
    # Cash access and withdrawals
    "c4": {
        "url": f"{RBA}/statistics/tables/xls/c04hist.xlsx",
        "kind": "rba_table",
        "title": "C4 ATMs: Seasonally Adjusted Series",
        "page": f"{RBA}/statistics/tables/#payments-system",
    },
    "c4_1": {
        "url": f"{RBA}/statistics/tables/xls/c04-1-hist.xlsx",
        "kind": "rba_table",
        "title": "C4.1 ATMs: Original Series",
        "page": f"{RBA}/statistics/tables/#payments-system",
    },
    # Discontinued long-history series (pre-2019 ATM withdrawals, points of access)
    "c4_disc": {
        "url": f"{RBA}/statistics/tables/xls-disc/c04hist.xls",
        "kind": "rba_table",
        "title": "C4 ATM Cash Withdrawals (discontinued)",
        "page": f"{RBA}/statistics/discontinued-data.html",
    },
    "c8_disc": {
        "url": f"{RBA}/statistics/tables/xls-disc/c08hist.xls",
        "kind": "rba_table",
        "title": "C8 Points of Access to the Australian Payments System (discontinued)",
        "page": f"{RBA}/statistics/discontinued-data.html",
    },
    # Card payments, for the cash-versus-electronic comparison
    "c2": {
        "url": f"{RBA}/statistics/tables/xls/c02hist.xlsx",
        "kind": "rba_table",
        "title": "C2 Debit Cards: Seasonally Adjusted Series",
        "page": f"{RBA}/statistics/tables/#payments-system",
    },
    # Money aggregates (currency held by the public)
    "d3": {
        "url": f"{RBA}/statistics/tables/xls/d03hist.xlsx",
        "kind": "rba_table",
        "title": "D3 Monetary Aggregates",
        "page": f"{RBA}/statistics/tables/#money-credit",
    },
    # Scale: nominal GDP
    "h1": {
        "url": f"{RBA}/statistics/tables/xls/h01hist.xlsx",
        "kind": "rba_table",
        "title": "H1 Gross Domestic Product and Income",
        "page": f"{RBA}/statistics/tables/#economic-activity",
    },
    # Scale: cash rate (opportunity cost of holding cash)
    "f1": {
        "url": f"{RBA}/statistics/tables/xls/f01hist.xlsx",
        "kind": "rba_table",
        "title": "F1 Interest Rates and Yields: Money Market",
        "page": f"{RBA}/statistics/tables/#interest-rates",
    },
    # Consumer Payments Survey 2025, chart data from the April 2026 Bulletin
    "cps_bulletin": {
        "url": f"{RBA}/publications/bulletin/2026/apr/xlsx/bulletin-2026-04--01.xlsx",
        "kind": "workbook",
        "title": "Cash Use in Australia: What the 2025 Consumer Payments Survey Tells Us (graph data)",
        "page": f"{RBA}/publications/bulletin/2026/apr/cash-use-in-australia-what-the-2025-consumer-payments-survey-tells-us.html",
    },
    "cps_2025_behaviour": {
        "url": f"{RBA}/publications/bulletin/2026/may/xlsx/bulletin-2026-05--03.xlsx",
        "kind": "workbook",
        "title": "Consumer Payment Behaviour in Australia, May 2026 Bulletin (graph data)",
        "page": f"{RBA}/publications/bulletin/2026/may/consumer-payment-behaviour-in-australia.html",
    },
    # Population, from the ABS Data API (quarterly estimated resident population)
    "abs_erp": {
        "url": "https://data.api.abs.gov.au/rest/data/ABS,ERP_Q,1.0.0/1.3.TOT.AUS.Q?format=csvfilewithlabels",
        "kind": "csv",
        "title": "ABS Estimated Resident Population, Australia (quarterly)",
        "page": "https://www.abs.gov.au/statistics/people/population/national-state-and-territory-population",
    },

    # ---------------------------------------------------------------- Regions tab
    # SA4 boundaries (2021 ASGS), simplified on the server to keep the map light
    "sa4_geo": {
        "url": "https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA4/MapServer/0/query"
               "?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326"
               "&maxAllowableOffset=0.01&geometryPrecision=3&f=geojson",
        "kind": "geojson",
        "ext": ".geojson",
        "title": "ABS ASGS 2021 Statistical Areas Level 4 (boundaries)",
        "page": "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026",
    },
    # 2021 Census General Community Profile for every SA4 (G01 person characteristics, G02 medians)
    "census_sa4": {
        "url": "https://www.abs.gov.au/census/find-census-data/datapacks/download/2021_GCP_SA4_for_AUS_short-header.zip",
        "find_link": {"page": "https://www.abs.gov.au/census/find-census-data/datapacks",
                      "pattern": r"[^\"']*2021_GCP_SA4_for_AUS_short-header\.zip"},
        "kind": "zip",
        "ext": ".zip",
        "title": "ABS 2021 Census General Community Profile, SA4 (DataPack)",
        "page": "https://www.abs.gov.au/census/find-census-data/datapacks",
    },
    # SEIFA 2021 by SA2 (aggregated to SA4, weighted by population)
    "seifa_sa2": {
        "url": "https://geo.abs.gov.au/arcgis/rest/services/Hosted/ABS_Socio_Economic_Indexes_for_Areas_SEIFA_by_2021_SA2/FeatureServer/0/query"
               "?where=1%3D1&outFields=sa2_code_2021,sa2_name_2021,urp,irsd_score,irsd_aus_decile,irsad_score&returnGeometry=false&f=json",
        "kind": "json",
        "ext": ".json",
        "title": "ABS Socio-Economic Indexes for Areas (SEIFA) 2021, by SA2",
        "page": "https://www.abs.gov.au/statistics/people/people-and-communities/socio-economic-indexes-areas-seifa-australia/2021",
    },
    # Every bank branch, ATM and other point of presence, with location (annual, published each October)
    "apra_pop": {
        "url": "https://www.apra.gov.au/system/files/2026-10/Authorised%20deposit-taking%20institutions%27%20points%20of%20presence%20June%202017%20to%20June%202026.xlsx",
        "find_link": {"page": "https://www.apra.gov.au/authorised-deposit-taking-institutions-points-of-presence-statistics",
                      "pattern": r"[^\"']*points(?:%20| )of(?:%20| )presence[^\"']*\.xlsx"},
        "kind": "workbook",
        "ext": ".xlsx",
        "title": "APRA Authorised deposit-taking institutions' points of presence (branches and ATMs)",
        "page": "https://www.apra.gov.au/authorised-deposit-taking-institutions-points-of-presence-statistics",
    },
}
