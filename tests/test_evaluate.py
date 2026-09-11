"""The proof must at least beat a shuffle on posts built to be rankable."""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manicule import Post, evaluate  # noqa: E402


def clustered_posts(sources=4, per_source=8, dim=16):
    rng = random.Random(1)
    posts = []
    for f in range(sources):
        centre = [rng.gauss(0, 1) for _ in range(dim)]
        for i in range(per_source):
            vector = [c + rng.gauss(0, 0.3) for c in centre]
            posts.append(Post(f"{f}-{i}", f"source {f} post {i}", "", "words here", f"source {f}",
                                 f"2026-01-{i + 1:02d}", "text", vector))
    return posts


def test_ranker_beats_a_shuffle():
    proof = evaluate(clustered_posts(), trials_per_source=5)
    assert proof["posts"] == 32 and proof["sources"] == 4
    for row in proof["median_rank"].values():
        assert row["ranker"] < row["shuffled"]
    assert proof["lambda"]["0.0"] <= proof["lambda"]["1.0"]


def test_too_small_to_evaluate():
    assert evaluate(clustered_posts(sources=2, per_source=3)) is None
