"""The proof must at least beat a shuffle on posts built to be rankable."""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manicule import Post, evaluate  # noqa: E402


def clustered_posts(feeds=4, per_feed=8, dim=16):
    rng = random.Random(1)
    posts = []
    for f in range(feeds):
        centre = [rng.gauss(0, 1) for _ in range(dim)]
        for i in range(per_feed):
            vector = [c + rng.gauss(0, 0.3) for c in centre]
            posts.append(Post(f"{f}-{i}", f"feed {f} post {i}", "", "words here", f"feed {f}",
                                 f"2026-01-{i + 1:02d}", "text", vector))
    return posts


def test_ranker_beats_a_shuffle():
    proof = evaluate(clustered_posts(), trials_per_feed=5)
    assert proof["posts"] == 32 and proof["feeds"] == 4
    for row in proof["median_rank"].values():
        assert row["ranker"] < row["shuffled"]
    assert proof["lambda"]["0.0"] <= proof["lambda"]["1.0"]


def test_too_small_to_evaluate():
    assert evaluate(clustered_posts(feeds=2, per_feed=3)) is None
