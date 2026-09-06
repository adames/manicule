import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manicule import Entry, centroid, cosine, quantize, rank, snippet  # noqa: E402

FIX = json.loads((Path(__file__).parent / "fixture.json").read_text())


def _entries():
    return [Entry(id=e["id"], title=e["id"], link="", snippet="", feed="", published="", kind="article", vector=e["vector"]) for e in FIX["entries"]]


def test_fixture_order_and_scores():
    entries = _entries()
    by_id = {e.id: e.vector for e in entries}
    kept = [by_id[i] for i in FIX["kept"]]
    dismissed = [by_id[i] for i in FIX["dismissed"]]
    ranked = rank(entries, kept, dismissed, lam=FIX["lambda"], kept_ids={i: by_id[i] for i in FIX["kept"]})
    assert [s.entry.id for s in ranked] == FIX["expected_order"]
    for s in ranked:
        if s.entry.id in FIX["expected_scores"]:
            assert abs(s.score - FIX["expected_scores"][s.entry.id]) < 1e-3, s.entry.id
    assert ranked[-1].score == float("-inf")  # no text: sinks, never dropped
    for s in ranked:
        if s.entry.id in FIX["expected_nearest"]:
            assert s.nearest == FIX["expected_nearest"][s.entry.id]


def test_cold_start_returns_none():
    assert rank(_entries(), [], [[0, 1, 0, 0]]) is None


def test_no_dismissed_means_no_penalty():
    entries = _entries()
    ranked = rank(entries, [[1, 0, 0, 0]], [])
    e4 = next(s for s in ranked if s.entry.id == "e4")
    assert e4.neg == 0.0 and abs(e4.score - e4.pos) < 1e-9


def test_centroid_and_cosine_edges():
    assert centroid([]) is None
    assert centroid([[1, 1], [3, 3]]) == [2.0, 2.0]
    assert cosine([0, 0], [1, 1]) == 0.0


def test_quantize_preserves_cosine():
    v = [0.31, -0.02, 0.77, -0.55, 0.1]
    q, s = quantize(v)
    back = [x / 127 * s for x in q]
    assert cosine(v, back) > 0.999


def test_snippet_strips_html_and_cuts_on_word():
    s = snippet("<p>Hello &amp; <b>world</b>, this is a long sentence about things</p>", limit=20)
    assert s.startswith("Hello & world,") and s.endswith("…") and "<" not in s


def test_snippet_drops_hacker_news_boilerplate():
    raw = "<p>Article URL: <a href=\"https://x.org/p\">https://x.org/p</a></p><p>Comments URL: <a href=\"https://news.ycombinator.com/item?id=1\">https://news.ycombinator.com/item?id=1</a></p><p>Points: 125</p><p># Comments: 41</p>"
    assert snippet(raw) == ""
    assert snippet("Real blurb here. Points: 3") == "Real blurb here."
