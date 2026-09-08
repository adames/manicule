import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manicule import Post, cosine, mean_vector, quantize, rank, snippet  # noqa: E402

FIX = json.loads((Path(__file__).parent / "fixture.json").read_text())


def _posts():
    return [Post(id=e["id"], title=e["id"], link="", snippet="", feed="", published="", kind="article", vector=e["vector"]) for e in FIX["posts"]]


def test_fixture_order_and_scores():
    posts = _posts()
    by_id = {e.id: e.vector for e in posts}
    picked = [by_id[i] for i in FIX["picked"]]
    passed = [by_id[i] for i in FIX["passed"]]
    ranked = rank(posts, picked, passed, lam=FIX["lambda"], picked_ids={i: by_id[i] for i in FIX["picked"]})
    assert [s.post.id for s in ranked] == FIX["expected_order"]
    for s in ranked:
        if s.post.id in FIX["expected_scores"]:
            assert abs(s.score - FIX["expected_scores"][s.post.id]) < 1e-3, s.post.id
    assert ranked[-1].score == float("-inf")  # no text: sinks, never dropped
    for s in ranked:
        if s.post.id in FIX["expected_nearest"]:
            assert s.nearest == FIX["expected_nearest"][s.post.id]


def test_cold_start_returns_none():
    assert rank(_posts(), [], [[0, 1, 0, 0]]) is None


def test_no_dismissed_means_no_penalty():
    posts = _posts()
    ranked = rank(posts, [[1, 0, 0, 0]], [])
    e4 = next(s for s in ranked if s.post.id == "e4")
    assert e4.neg == 0.0 and abs(e4.score - e4.pos) < 1e-9


def test_mean_vector_and_cosine_edges():
    assert mean_vector([]) is None
    assert mean_vector([[1, 1], [3, 3]]) == [2.0, 2.0]
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


def test_snippet_drops_feed_tails():
    wp = "Deep thought. The post Live from ICM 2026: What Is Math For? first appeared on Quanta Magazine."
    assert snippet(wp) == "Deep thought."
    yt = "ADHD meds change signalling. #kurzgesagt #science #adhd Sources & further reading: https://example.org/x"
    assert snippet(yt) == "ADHD meds change signalling."
    assert snippet("C# and F# are languages") == "C# and F# are languages"
