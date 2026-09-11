"""Which entries in a feed become posts, and which are dropped.

The rules are small and every one of them is a bug that happened: an episode
with no link, fourteen episodes sharing one, a feed that dates nothing.
"""
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from manicule import fetch  # noqa: E402

HEAD = b'<?xml version="1.0"?><rss version="2.0"><channel><title>the feed says this</title>'
TAIL = b"</channel></rss>"


def serve(body, monkeypatch):
    """One feed, whose body is `body`, fetched with no retries and no waiting."""
    class Fake:
        def read(self): return HEAD + body + TAIL
        def __enter__(self): return self
        def __exit__(self, *_): pass

    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: Fake())

    def go(title="the opml says this", **kw):
        return fetch([(title, "https://one.example/f")], workers=1, per_host_pause=0, **kw)
    return go


def item(title="t", link="https://x.example/1", guid=None, when=None, extra=b""):
    parts = [b"<title>" + title.encode() + b"</title>"]
    if link:
        parts.append(b"<link>" + link.encode() + b"</link>")
    if guid:
        parts.append(b"<guid>" + guid.encode() + b"</guid>")
    if when:
        parts.append(b"<pubDate>" + when.encode() + b"</pubDate>")
    return b"<item>" + b"".join(parts) + extra + b"</item>"


def test_an_episode_with_no_link_is_its_audio(monkeypatch):
    """megaphone and buzzsprout give some episodes only the enclosure."""
    # feedparser normalises an enclosure's url= into href, which is what fetch reads.
    enclosure = b'<enclosure url="https://cdn.example/ep.mp3" length="1" type="audio/mpeg"/>'
    posts = serve(item(link=None, extra=enclosure), monkeypatch)()
    assert [p.link for p in posts] == ["https://cdn.example/ep.mp3"]


def test_an_entry_with_no_link_and_no_audio_is_dropped(monkeypatch):
    posts = serve(item(link=None) + item(link="https://x.example/2"), monkeypatch)()
    assert [p.link for p in posts] == ["https://x.example/2"]


def test_the_guid_identifies_a_post_not_the_link(monkeypatch):
    """Radiolab gives every episode the same link, its homepage."""
    same = "https://radiolab.example/"
    body = item(title="one", link=same, guid="a") + item(title="two", link=same, guid="b")
    posts = serve(body, monkeypatch)()
    assert sorted(p.title for p in posts) == ["one", "two"]


def test_the_same_guid_twice_is_one_post(monkeypatch):
    body = item(title="one", link="https://x.example/1", guid="a") + \
           item(title="again", link="https://x.example/2", guid="a")
    posts = serve(body, monkeypatch)()
    assert [p.title for p in posts] == ["one"]


def test_an_undated_post_stays_however_old_the_cutoff(monkeypatch):
    """A feed that never dates anything is still a feed."""
    posts = serve(item(when=None), monkeypatch)(max_age_days=1)
    assert len(posts) == 1
    assert posts[0].published == ""


def test_a_post_older_than_the_cutoff_is_dropped(monkeypatch):
    body = item(title="old", link="https://x.example/1", when="Tue, 01 Jan 2019 00:00:00 GMT") + \
           item(title="undated", link="https://x.example/2")
    posts = serve(body, monkeypatch)(max_age_days=30)
    assert [p.title for p in posts] == ["undated"]


def test_per_feed_keeps_the_first_few_in_the_feeds_own_order(monkeypatch):
    body = b"".join(item(title=str(i), link=f"https://x.example/{i}") for i in range(5))
    posts = serve(body, monkeypatch)(per_feed=2)
    assert sorted(p.title for p in posts) == ["0", "1"]


def test_the_name_in_the_opml_wins_over_the_feeds_own(monkeypatch):
    """One was written by a person to be read; the other says 'Al Jazeera – ...'."""
    assert serve(item(), monkeypatch)()[0].feed == "the opml says this"
    assert serve(item(), monkeypatch)(title="")[0].feed == "the feed says this"
