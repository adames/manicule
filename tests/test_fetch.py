"""The fetcher's manners: one host at a time, and one more go before giving up."""
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manicule import fetch  # noqa: E402

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>a post</title><link>%s</link><guid>%s</guid></item></channel></rss>"""


class Fake:
    """Stands in for a response, and notes when two calls to one host overlap."""

    def __init__(self, url, inside, most, lock):
        self.url = url
        with lock:
            inside[0] += 1
            most[0] = max(most[0], inside[0])
        self.inside, self.lock = inside, lock

    def read(self):
        time.sleep(0.05)
        return RSS % (self.url.encode(), self.url.encode())

    def __enter__(self): return self
    def __exit__(self, *_):
        with self.lock:
            self.inside[0] -= 1


def test_one_host_at_a_time(monkeypatch):
    """Firing every source at one host at once is what got nine of them refused."""
    inside, most, lock = [0], [0], threading.Lock()
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda req, timeout=None: Fake(req.full_url, inside, most, lock))
    sources = [(f"f{i}", f"https://one.example/{i}") for i in range(6)]
    posts = fetch(sources, per_source=1, workers=6)
    assert len(posts) == 6
    assert most[0] == 1, f"{most[0]} at once on one host"


def test_two_hosts_still_go_at_once(monkeypatch):
    """The queue is per host: a slow one must not hold up the rest of the build."""
    seen = {}
    lock = threading.Lock()

    class Timed(Fake):
        def read(self):
            time.sleep(0.2)
            with lock:
                seen[self.url] = time.monotonic()
            return RSS % (self.url.encode(), self.url.encode())

    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda req, timeout=None: Timed(req.full_url, [0], [0], lock))
    # One host costs the read plus the pause held inside its lock. Two hosts
    # in parallel cost about the same; two hosts in a queue cost twice.
    sources = [("a", "https://a.example/f"), ("b", "https://b.example/f")]
    started = time.monotonic()
    fetch(sources, per_source=1, workers=2)
    took = time.monotonic() - started
    assert took < 1.0, f"two hosts were queued against each other: {took:.2f}s"


def test_one_more_go_before_giving_up(monkeypatch):
    """Rate limiting refuses the first request and allows the next."""
    tries = {"n": 0}

    def flaky(req, timeout=None):
        tries["n"] += 1
        if tries["n"] == 1:
            raise OSError("429")
        return Fake(req.full_url, [0], [0], threading.Lock())

    monkeypatch.setattr(urllib.request, "urlopen", flaky)
    posts = fetch([("a", "https://a.example/f")], per_source=1, workers=1)
    assert len(posts) == 1 and tries["n"] == 2


def test_a_source_that_never_answers_is_skipped_not_fatal(monkeypatch):
    """One dead host must not take the build with it."""
    def dead(req, timeout=None):
        if "dead" in req.full_url:
            raise OSError("nope")
        return Fake(req.full_url, [0], [0], threading.Lock())

    monkeypatch.setattr(urllib.request, "urlopen", dead)
    posts = fetch([("d", "https://dead.example/f"), ("a", "https://a.example/f")],
                  per_source=1, workers=2)
    assert len(posts) == 1


def test_a_lone_host_waits_for_nothing(monkeypatch):
    """The pause is for hosts carrying many sources, not for the other three hundred."""
    lock = threading.Lock()
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda req, timeout=None: Fake(req.full_url, [0], [0], lock))
    sources = [(f"f{i}", f"https://h{i}.example/f") for i in range(8)]
    started = time.monotonic()
    posts = fetch(sources, per_source=1, workers=8, per_host_pause=1.0)
    took = time.monotonic() - started
    assert len(posts) == 8
    assert took < 0.5, f"eight different hosts paused for each other: {took:.2f}s"


def test_a_crowded_host_waits_longer(monkeypatch):
    """Eight sources on one host queue, and the wait between them is real."""
    lock = threading.Lock()
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda req, timeout=None: Fake(req.full_url, [0], [0], lock))
    sources = [(f"f{i}", f"https://one.example/{i}") for i in range(8)]
    started = time.monotonic()
    fetch(sources, per_source=1, workers=8, per_host_pause=0.1)
    took = time.monotonic() - started
    # Seven gaps of 0.7s each, give or take, on top of the reads.
    assert took > 4.0, f"the crowded host was not paced: {took:.2f}s"
