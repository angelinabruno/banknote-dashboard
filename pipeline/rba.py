"""Parser for the RBA's standard statistical table layout.

Every RBA table has metadata rows labelled in column A ("Title", "Description",
"Frequency", "Type", "Units", "Source", "Publication date", "Series ID"),
followed by one row per observation with the date in column A.
"""

import pathlib

import pandas as pd

META_LABELS = ["Title", "Description", "Frequency", "Type", "Units", "Source",
               "Publication date", "Series ID"]


def read_table(path, sheet=None):
    """Return (data, meta) for an RBA table.

    data: DataFrame indexed by date, one column per Series ID.
    meta: DataFrame indexed by Series ID with the metadata rows as columns.
    """
    path = pathlib.Path(path)
    engine = "xlrd" if path.suffix == ".xls" else "openpyxl"
    book = pd.read_excel(path, sheet_name=None, header=None, engine=engine)
    if sheet is None:
        sheet = "Data" if "Data" in book else next(iter(book))
    raw = book[sheet]
    labels = raw[0].astype(str).str.strip()
    rows = {lab: int(labels[labels == lab].index[0]) for lab in META_LABELS if (labels == lab).any()}
    if "Series ID" not in rows:
        raise ValueError(f"{path.name}: no 'Series ID' row; not a standard RBA table")
    sid_row = rows["Series ID"]
    ids = raw.iloc[sid_row, 1:]
    keep = ids.notna()
    ids = ids[keep].astype(str).str.strip()

    meta = pd.DataFrame(
        {lab: raw.iloc[r, 1:][keep].values for lab, r in rows.items() if lab != "Series ID"},
        index=ids.values,
    )
    meta.index.name = "series_id"

    body = raw.iloc[sid_row + 1:, :]
    dates = pd.to_datetime(body[0], errors="coerce")
    body = body[dates.notna()]
    data = body.loc[:, ids.index].apply(pd.to_numeric, errors="coerce")
    data.columns = ids.values
    data.index = pd.DatetimeIndex(dates[dates.notna()].values, name="date")
    data = data.dropna(how="all")
    return data, meta
