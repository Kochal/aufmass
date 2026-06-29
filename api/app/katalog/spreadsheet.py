"""Spreadsheet (xlsx/csv) parser for Leistungskatalog import.

Column detection is flexible: headers are matched case-insensitively against
known German and abbreviated column names. Auto-generates codes from kurztext
when a code column is absent.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Optional


# Map internal field → accepted header variants (all lowercase)
_COLS: dict[str, list[str]] = {
    "code": ["code", "pos", "pos.", "positionsnummer", "nr", "nummer", "artikel"],
    "kurztext": ["kurztext", "bezeichnung", "beschreibung", "kurzbeschreibung",
                 "leistung", "titel", "text", "name", "position"],
    "langtext": ["langtext", "langbeschreibung", "langtexte"],
    "einheit": ["einheit", "me", "mengeneinheit", "eh", "unit", "einh."],
    "einheitspreis": ["einheitspreis", "ep", "preis", "up", "netto", "nettopreis",
                      "vk-netto", "vk netto", "eur/einheit", "price"],
}


@dataclass
class ParsedLeistung:
    code: Optional[str]
    kurztext: str
    langtext: Optional[str]
    einheit: str
    einheitspreis: Optional[Decimal]


@dataclass
class SpreadsheetResult:
    rows: list[ParsedLeistung]
    skipped: int       # rows that had missing required fields
    parse_errors: list[str]


def parse_spreadsheet(content: bytes, filename: str) -> SpreadsheetResult:
    """Parse xlsx or csv bytes → SpreadsheetResult.

    Raises ValueError if the file type is unsupported or unreadable.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("xlsx", "xls", "xlsm"):
        return _parse_xlsx(content)
    elif ext in ("csv", "txt"):
        return _parse_csv(content)
    else:
        # Try CSV first, then xlsx
        try:
            return _parse_csv(content)
        except Exception:
            return _parse_xlsx(content)


def _parse_csv(content: bytes) -> SpreadsheetResult:
    # Try UTF-8, fall back to latin-1 (common for German exports)
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("could not decode CSV content")

    # Detect delimiter by trying each and scoring on header-column matches.
    # (csv.Sniffer misidentifies ';' when German decimals like '12,50' appear.)
    best_delim = ","
    best_score = -1
    best_col_map: dict[str, str] = {}

    for delim in (";", "\t", ",", "|"):
        try:
            reader = csv.DictReader(io.StringIO(text), delimiter=delim)
            headers = list(reader.fieldnames or [])
            if len(headers) < 2:
                continue
            col_map = _map_columns(headers)
            score = len(col_map)
            if score > best_score:
                best_score = score
                best_delim = delim
                best_col_map = col_map
        except Exception:
            continue

    if not best_col_map:
        raise ValueError("could not detect columns — missing kurztext/einheit headers")

    reader = csv.DictReader(io.StringIO(text), delimiter=best_delim)
    return _extract_rows(reader, best_col_map)


def _parse_xlsx(content: bytes) -> SpreadsheetResult:
    try:
        import openpyxl
    except ImportError:
        raise ValueError("openpyxl is required for xlsx import")

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active

    rows_raw = list(ws.iter_rows(values_only=True))
    if not rows_raw:
        raise ValueError("xlsx sheet is empty")

    # Find the header row in the first 10 rows (pick the one with most matches)
    header_idx = _find_header_row(rows_raw[:10])
    if header_idx is None:
        raise ValueError("could not detect a header row in the first 10 rows")

    headers = [str(c).strip() if c is not None else "" for c in rows_raw[header_idx]]
    col_map = _map_columns(headers)
    data_rows = rows_raw[header_idx + 1:]

    rows: list[ParsedLeistung] = []
    skipped = 0
    errors: list[str] = []

    for i, raw_row in enumerate(data_rows, start=header_idx + 2):
        row_dict = {headers[j]: (str(v).strip() if v is not None else "")
                    for j, v in enumerate(raw_row) if j < len(headers)}
        result = _parse_row(row_dict, col_map, i)
        if result is None:
            skipped += 1
        elif isinstance(result, str):
            errors.append(result)
        else:
            rows.append(result)

    return SpreadsheetResult(rows=rows, skipped=skipped, parse_errors=errors)


def _find_header_row(rows: list) -> int | None:
    """Return the index of the row that matches the most column names."""
    all_known = {v for vals in _COLS.values() for v in vals}
    best_idx, best_score = None, 0
    for i, row in enumerate(rows):
        cells = [str(c).strip().lower() for c in row if c is not None]
        score = sum(1 for c in cells if c in all_known)
        if score > best_score:
            best_score, best_idx = score, i
    return best_idx if best_score > 0 else (0 if rows else None)


def _map_columns(headers: list[str]) -> dict[str, str]:
    """Return {field_name: actual_header_name} for detected columns."""
    lower_headers = {h.lower().strip(): h for h in headers}
    result: dict[str, str] = {}
    for field, variants in _COLS.items():
        for v in variants:
            if v in lower_headers:
                result[field] = lower_headers[v]
                break
    return result


def _extract_rows(reader, col_map: dict[str, str]) -> SpreadsheetResult:
    rows: list[ParsedLeistung] = []
    skipped = 0
    errors: list[str] = []

    for i, row_dict in enumerate(reader, start=2):
        result = _parse_row(row_dict, col_map, i)
        if result is None:
            skipped += 1
        elif isinstance(result, str):
            errors.append(result)
        else:
            rows.append(result)

    return SpreadsheetResult(rows=rows, skipped=skipped, parse_errors=errors)


def _parse_row(row: dict, col_map: dict[str, str], row_num: int):
    """Return ParsedLeistung, None (skip), or error string."""
    def get(field: str) -> str:
        key = col_map.get(field)
        return str(row.get(key, "")).strip() if key else ""

    kurztext = get("kurztext")
    einheit = get("einheit")
    if not kurztext or not einheit:
        return None  # skip empty / spacer rows silently

    ep_raw = get("einheitspreis")
    einheitspreis = _parse_decimal(ep_raw)

    return ParsedLeistung(
        code=get("code") or None,
        kurztext=kurztext,
        langtext=get("langtext") or None,
        einheit=einheit,
        einheitspreis=einheitspreis,
    )


def _parse_decimal(s: str) -> Decimal | None:
    if not s:
        return None
    # Handle both "1.234,56" (German) and "1,234.56" (English)
    s = s.replace("€", "").replace(" ", "").strip()
    if "," in s and "." in s:
        # Determine which is the decimal separator by position
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def auto_code(kurztext: str, existing: set[str]) -> str:
    """Generate a short mnemonic code from kurztext, avoiding duplicates."""
    base = re.sub(r"[^A-Z0-9]", "", kurztext.upper())[:6] or "LEI"
    code, n = base, 1
    while code in existing:
        code = f"{base}{n:02d}"
        n += 1
    existing.add(code)
    return code
