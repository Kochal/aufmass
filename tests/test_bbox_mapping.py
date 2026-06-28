"""Unit tests for vision_client bbox mapping helpers.

These exercise pure Python logic — no Mistral API call or API key needed.
Run from the repo root:
    cd api && python -m pytest ../tests/test_bbox_mapping.py -v
"""
import sys
import os
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))

import pytest

from app.aufmass.vision_client import _best_row, _numeric_tokens, _assign_bboxes
from app.aufmass.schema import AufmassEntry, AufmassExtractionResult


# ---------------------------------------------------------------------------
# _numeric_tokens
# ---------------------------------------------------------------------------

class TestNumericTokens:
    def test_german_decimal(self):
        assert _numeric_tokens("3,86 x 0,74") == ["3,86", "0,74"]

    def test_dot_decimal_treated_as_two_tokens(self):
        # German sheets never use '.' as decimal; '3.86' → tokens ['3', '86']
        assert _numeric_tokens("3.86") == ["3", "86"]

    def test_whole_numbers(self):
        assert _numeric_tokens("2 x 3") == ["2", "3"]

    def test_no_numbers(self):
        assert _numeric_tokens("dito") == []
        assert _numeric_tokens("Winkel zu Deppen") == []

    def test_mixed_text(self):
        assert _numeric_tokens("D 3,86 x 0,74") == ["3,86", "0,74"]

    def test_nested_expression(self):
        assert _numeric_tokens("(0,86 + 2,56 + 0,86) x 2,81") == [
            "0,86", "2,56", "0,86", "2,81"
        ]

    def test_unreadable_stub(self):
        assert _numeric_tokens("(cath") == []


# ---------------------------------------------------------------------------
# _best_row
# ---------------------------------------------------------------------------

SAMPLE_ROWS = [
    "|  OBJEKT |   | RAUM-NR: |   | AUFTRAGGEBER |",
    "|  BAUTEIL | LÄNGE | BREITE | HÖHE |",
    "|  Baum rechts | D 3,86 x 0,74 |  |  |",
    "|  W. Fächel | 0,74 x 2,84 |  |  | + (2,84 + 0,86) / 2 x |",
    "|  Schrög Licks | 3,86 x 2,80 |  |  | km/h | 3,86 x 0,86 |",
    "|  rechts | 3,02 x 2,90 |  |  | km/h | 3,02 x 0,86 |",
    "|  Bad | D 2,44 x 0,42 |  |  |",
]


class TestBestRow:
    def test_single_distinctive_token(self):
        # "2,44" only appears in row 6
        assert _best_row(["2,44", "0,42"], SAMPLE_ROWS) == 6

    def test_two_tokens_disambiguate(self):
        # "3,86" appears in rows 2 and 4; "0,74" only in rows 2 and 3
        # → row 2 wins (score 2 for both "3,86" and "0,74")
        assert _best_row(["3,86", "0,74"], SAMPLE_ROWS) == 2

    def test_no_match_returns_none(self):
        assert _best_row(["9,99"], SAMPLE_ROWS) is None

    def test_shared_tokens_pick_higher_score(self):
        # "3,86" in rows 2 and 4; "2,80" only in row 4 → row 4 wins
        assert _best_row(["3,86", "2,80"], SAMPLE_ROWS) == 4

    def test_empty_tokens_returns_none(self):
        assert _best_row([], SAMPLE_ROWS) is None

    def test_empty_rows_returns_none(self):
        assert _best_row(["3,86"], []) is None


# ---------------------------------------------------------------------------
# _assign_bboxes (integration of both helpers + bbox construction)
# ---------------------------------------------------------------------------

def _make_response(md: str, *, width=1191, height=1684,
                   tbl_x1=166, tbl_y1=164, tbl_x2=1066, tbl_y2=1576):
    """Minimal mock of a Mistral OCR response page."""

    class Dims:
        pass

    class Block:
        type = "table"

    class Page:
        pass

    class Response:
        pass

    dims = Dims()
    dims.width = width
    dims.height = height

    block = Block()
    block.top_left_x = tbl_x1
    block.top_left_y = tbl_y1
    block.bottom_right_x = tbl_x2
    block.bottom_right_y = tbl_y2
    block.content = md

    page = Page()
    page.dimensions = dims
    page.blocks = [block]
    page.markdown = md
    page.confidence_scores = None

    resp = Response()
    resp.pages = [page]
    return resp


class TestAssignBboxes:
    def _entry(self, raw_text: str) -> AufmassEntry:
        return AufmassEntry(raw_text=raw_text)

    def test_bbox_assigned_for_numeric_entry(self):
        md = (
            "|  BAUTEIL | LÄNGE |\n"
            "| --- | --- |\n"
            "|  Baum rechts | 3,86 x 0,74 |\n"
            "|  Bad | 2,44 x 0,42 |\n"
        )
        # Table rows after stripping '---': 2 rows (BAUTEIL header + 2 data) → 3 rows total
        # Normalized table: x1=166/1191≈0.139, y1=164/1684≈0.097,
        #                   x2=1066/1191≈0.895, y2=1576/1684≈0.936
        entry = self._entry("3,86 x 0,74")
        _assign_bboxes([entry], _make_response(md))

        assert entry.bbox is not None
        assert entry.bbox.x1 == pytest.approx(166 / 1191, abs=1e-3)
        assert entry.bbox.x2 == pytest.approx(1066 / 1191, abs=1e-3)
        # y1 and y2 must be within [0, 1] and y2 > y1
        assert 0 <= entry.bbox.y1 < entry.bbox.y2 <= 1

    def test_no_bbox_for_non_numeric_entry(self):
        md = "|  Thirwand | dito |\n"
        entry = self._entry("dito")
        _assign_bboxes([entry], _make_response(md))
        assert entry.bbox is None

    def test_no_bbox_when_no_table_block(self):
        class Page:
            pass

        class Response:
            pass

        page = Page()
        page.dimensions = types.SimpleNamespace(width=1191, height=1684)
        page.blocks = []
        page.markdown = "|  Baum | 3,86 x 0,74 |\n"
        page.confidence_scores = None

        resp = Response()
        resp.pages = [page]

        entry = self._entry("3,86 x 0,74")
        _assign_bboxes([entry], resp)
        assert entry.bbox is None

    def test_no_bbox_when_no_pages(self):
        entry = self._entry("3,86 x 0,74")
        resp = types.SimpleNamespace(pages=[])
        _assign_bboxes([entry], resp)
        assert entry.bbox is None

    def test_bbox_within_unit_square(self):
        md = (
            "|  BAUTEIL | LÄNGE |\n"
            "|  A | 1,00 x 2,00 |\n"
            "|  B | 3,00 x 4,00 |\n"
            "|  C | 5,00 x 6,00 |\n"
        )
        entries = [
            self._entry("1,00 x 2,00"),
            self._entry("3,00 x 4,00"),
            self._entry("5,00 x 6,00"),
        ]
        _assign_bboxes(entries, _make_response(md))

        for e in entries:
            assert e.bbox is not None
            assert 0 <= e.bbox.x1 < e.bbox.x2 <= 1
            assert 0 <= e.bbox.y1 < e.bbox.y2 <= 1

    def test_different_entries_get_different_row_bboxes(self):
        md = (
            "|  A | 1,00 x 2,00 |\n"
            "|  B | 3,00 x 4,00 |\n"
        )
        e1 = self._entry("1,00 x 2,00")
        e2 = self._entry("3,00 x 4,00")
        _assign_bboxes([e1, e2], _make_response(md))

        assert e1.bbox is not None
        assert e2.bbox is not None
        assert e1.bbox.y1 < e2.bbox.y1, "rows should be ordered top-to-bottom"
