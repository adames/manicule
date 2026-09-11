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


def test_vectors_bin_round_trips(tmp_path):
    from manicule import DIM, quantize, read_vectors, write_vectors
    import random
    rng = random.Random(3)
    posts = [Post("a", "a", "", "", "", "", "article", [rng.gauss(0, 1) for _ in range(DIM)]),
             Post("b", "b", "", "", "", "", "article", None),
             Post("c", "c", "", "", "", "", "article", [rng.gauss(0, 1) for _ in range(DIM)])]
    rows = [{"s": quantize(p.vector)[1]} if p.vector else {} for p in posts]
    path = tmp_path / "vectors.bin"
    write_vectors(posts, path)
    assert path.stat().st_size == len(posts) * DIM
    back = read_vectors(rows, path)
    assert back[1] is None
    for p, v in zip((posts[0], posts[2]), (back[0], back[2])):
        assert cosine(p.vector, v) > 0.999


def test_spread_reaches_every_corner():
    """A spread sample must touch every cluster, or a cold reader sees one thing."""
    from manicule import spread
    import random
    rng = random.Random(1)
    posts = []
    for f in range(6):
        centre = [rng.gauss(0, 1) for _ in range(16)]
        for i in range(20):
            posts.append(Post(f"{f}-{i}", "t", "", "", f"feed {f}", "", "article",
                              [c + rng.gauss(0, 0.25) for c in centre]))
    got = spread(posts, 12)
    assert len(got) == 12
    assert len({g.split("-")[0] for g in got}) == 6
    assert got == sorted(got, key=lambda id: [p.id for p in posts].index(id))
    # Fewer posts than seats: everything with a vector, and nothing without.
    assert len(spread(posts[:5], 30)) == 5


def test_impossible_dates_read_as_undated():
    """One feed stamping year 50000 must not end the build."""
    import time
    from manicule import published_at

    class Item:
        def __init__(self, when): self.published_parsed = when

    assert published_at(Item(time.struct_time((50000, 1, 1, 0, 0, 0, 0, 1, 0)))) == ""
    assert published_at(Item(time.struct_time((1, 1, 1, 0, 0, 0, 0, 1, 0)))) == ""
    assert published_at(Item(time.struct_time((2026, 9, 1, 12, 0, 0, 0, 1, 0)))).startswith("2026-09-01")


def test_taste_blob_matches_the_fixture():
    """The blob is a shared format: JS writes the same string from the same numbers."""
    from manicule import press, read_taste_blob, taste_blob
    t = FIX["taste"]
    assert taste_blob(t["vector"], t["count"]) == t["blob"]
    vector, count = read_taste_blob(t["blob"], len(t["vector"]))
    assert count == t["count"]
    assert cosine(vector, t["vector"]) > 0.9999

    step = None
    for vector in t["presses"]:
        step = press(step, vector)
    assert step[1] == t["pressed_count"]
    assert all(abs(a - b) < 1e-9 for a, b in zip(step[0], t["pressed_vector"]))


def test_a_hand_edited_taste_reads_as_no_taste():
    from manicule import read_taste_blob, unpress
    for bad in ("", "garbage", "a~b~c", "AAAA~1~0", "AAAA~0~5"):
        assert read_taste_blob(bad, 8) is None, bad
    # Un-pressing the only press leaves no taste, not a taste of nothing.
    assert unpress(None, [1.0, 0.0]) is None
    assert unpress(([1.0, 0.0], 1), [1.0, 0.0]) is None


def test_a_settled_taste_cannot_set():
    """A press against two hundred must count as much as a press against twenty."""
    from manicule import CAP, press
    settled, count = press(([1.0, 0.0], 200), [0.0, 1.0])
    assert count == 201
    at_the_cap, _ = press(([1.0, 0.0], CAP), [0.0, 1.0])
    assert cosine(settled, at_the_cap) > 0.99999
    # And it is a real turn, not a rounding error.
    assert cosine(settled, [1.0, 0.0]) < 0.9995


def test_below_the_cap_a_taste_is_a_plain_mean():
    from manicule import mean_vector, press
    posts = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
    taste = None
    for vector in posts:
        taste = press(taste, vector)
    assert taste[1] == 3
    assert all(abs(a - b) < 1e-12 for a, b in zip(taste[0], mean_vector(posts)))


def test_unpressing_puts_the_average_back():
    """Tick and untick all day: the average must land where it started."""
    import math
    from manicule import press, unpress
    posts = [[math.sin(k * 3 + i) for i in range(8)] for k in range(30)]
    taste = None
    for vector in posts:
        taste = press(taste, vector)
    undone = taste
    for vector in reversed(posts[-5:]):
        undone = unpress(undone, vector)
    assert undone[1] == 25
    again = undone
    for vector in posts[-5:]:
        again = press(again, vector)
    assert again[1] == taste[1]
    assert all(abs(a - b) < 1e-9 for a, b in zip(again[0], taste[0]))
