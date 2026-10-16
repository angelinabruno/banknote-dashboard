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
}
