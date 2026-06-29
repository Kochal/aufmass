"""Unit tests for voice_client segment-ref assignment (directive 07b).

No API key, no audio file, no faster-whisper needed — tests the pure
token-matching logic only.
"""
import pytest
from app.aufmass.voice_client import _assign_segment_refs


def _entry(raw_text: str) -> dict:
    return {"raw_text": raw_text, "bbox": None}


def _seg(start: float, end: float, text: str) -> dict:
    return {"start": start, "end": end, "text": text}


class TestAssignSegmentRefs:
    def test_exact_token_match(self):
        entries = [_entry("drei achtzig")]
        segs = [_seg(0.0, 2.0, "drei achtzig mal zwei")]
        _assign_segment_refs(entries, segs)
        assert entries[0]["bbox"] == {"start_s": 0.0, "end_s": 2.0}

    def test_no_match_gives_none(self):
        entries = [_entry("xyz zzz")]
        segs = [_seg(0.0, 1.0, "drei achtzig")]
        _assign_segment_refs(entries, segs)
        assert entries[0]["bbox"] is None

    def test_best_match_wins(self):
        entries = [_entry("wand drei achtzig")]
        segs = [
            _seg(0.0, 1.0, "boden zwei"),
            _seg(1.0, 3.0, "wand drei achtzig mal zwei"),
        ]
        _assign_segment_refs(entries, segs)
        assert entries[0]["bbox"] == {"start_s": 1.0, "end_s": 3.0}

    def test_empty_segments(self):
        entries = [_entry("drei achtzig")]
        _assign_segment_refs(entries, [])
        assert entries[0]["bbox"] is None

    def test_empty_raw_text(self):
        entries = [_entry("")]
        segs = [_seg(0.0, 1.0, "irgendwas")]
        _assign_segment_refs(entries, segs)
        assert entries[0]["bbox"] is None

    def test_multiple_entries_different_segs(self):
        entries = [_entry("wand drei"), _entry("boden zwei")]
        segs = [
            _seg(0.0, 2.0, "wand drei achtzig"),
            _seg(2.0, 4.0, "boden zwei fünfzig"),
        ]
        _assign_segment_refs(entries, segs)
        assert entries[0]["bbox"] == {"start_s": 0.0, "end_s": 2.0}
        assert entries[1]["bbox"] == {"start_s": 2.0, "end_s": 4.0}

    def test_single_char_tokens_ignored(self):
        # Single-char tokens (stopwords, punctuation) are skipped.
        entries = [_entry("a b")]
        segs = [_seg(0.0, 1.0, "a b c")]
        _assign_segment_refs(entries, segs)
        assert entries[0]["bbox"] is None

    def test_timestamps_rounded(self):
        entries = [_entry("wand")]
        segs = [_seg(1.23456, 3.78901, "wand achtzig")]
        _assign_segment_refs(entries, segs)
        assert entries[0]["bbox"] == {"start_s": 1.235, "end_s": 3.789}

    def test_multiple_entries_same_seg(self):
        entries = [_entry("wand drei"), _entry("wand achtzig")]
        segs = [_seg(0.0, 5.0, "wand drei mal achtzig")]
        _assign_segment_refs(entries, segs)
        # Both should map to the only matching segment.
        assert entries[0]["bbox"] == {"start_s": 0.0, "end_s": 5.0}
        assert entries[1]["bbox"] == {"start_s": 0.0, "end_s": 5.0}
