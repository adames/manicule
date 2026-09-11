"""manicule — a pointing hand for your feeds.

Rank what's new by what you've picked. No database, no server, no account.

The whole method:

    score(post) = cos(post, picked) - LAMBDA * cos(post, passed)

where `picked` is the average of the vectors you picked and `passed` is the
average of the ones you passed on. Two averages and a subtraction. No
training. `cos` is the cosine of the angle between two vectors: +1 the same
direction, 0 unrelated, below 0 opposite. With nothing picked there is no
average to measure against, so the list stays newest-first.

Three subcommands:

    manicule.py rank     feeds.opml --picked notes/ [--passed nope/]  # your daily page
    manicule.py posts    feeds.opml -o site/posts.json                # the demo's data (+ vectors.bin)
    manicule.py evaluate [site/posts.json]                            # the proof, printed

Every post becomes a vector of 384 numbers, computed on this machine by
fastembed (BAAI/bge-small-en-v1.5). Nothing leaves it but the feed fetches.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree

import feedparser

LAMBDA = 0.25          # how hard a resemblance to passed things pushes a post down
SNIPPET_CHARS = 400    # embed the headline plus a short blurb, never the whole post
NOTE_CHARS = 2000      # a note is embedded from its first ~2000 characters
MODEL = "BAAI/bge-small-en-v1.5"
DIM = 384

# Feeds the demo taste never picks from. No judgement on the writing: a demo
# built on one person's blog shows off that person, not the ranker.
DEMO_SKIP = {"Simon Willison's Weblog"}


# ---------------------------------------------------------------- the math

def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    length_a = sum(x * x for x in a) ** 0.5
    length_b = sum(x * x for x in b) ** 0.5
    if length_a == 0.0 or length_b == 0.0:
        return 0.0
    return dot / (length_a * length_b)


def mean_vector(vectors: list[list[float]]) -> list[float] | None:
    """The average of some vectors, or None when there is nothing to average."""
    if not vectors:
        return None
    dimensions = len(vectors[0])
    return [sum(v[i] for v in vectors) / len(vectors) for i in range(dimensions)]


@dataclass
class Post:
    id: str
    title: str
    link: str
    snippet: str
    feed: str
    published: str          # ISO 8601, or "" when the feed gave no date
    kind: str               # article | video | podcast
    vector: list[float] | None = None

    @property
    def text(self) -> str:
        """What gets embedded: the headline and the blurb, nothing else."""
        return " ".join(part for part in (self.title, self.snippet) if part).strip()


@dataclass
class Scored:
    post: Post
    score: float            # -inf when the post has no words to compare
    pos: float              # cos(post, picked)
    neg: float              # cos(post, passed), 0 when nothing is passed
    nearest: str | None     # id of the picked post it most resembles


def rank(
    posts: list[Post],
    picked: "Taste",
    passed: "Taste",
    lam: float = LAMBDA,
    picked_ids: dict[str, list[float]] | None = None,
) -> list[Scored] | None:
    """Order `posts` best-first by taste.

    `picked` and `passed` are tastes: each one several averages, scored by
    whichever is nearest. Returns None on a cold start, so the caller keeps its
    own order, which is recency. A post with no vector sinks to the bottom but
    is never dropped.
    """
    if not picked:
        return None

    scored: list[Scored] = []
    for post in posts:
        if post.vector is None:
            scored.append(Scored(post, float("-inf"), 0.0, 0.0, None))
            continue
        towards = nearness(picked, post.vector)
        away = nearness(passed, post.vector) if passed else 0.0
        nearest = None
        if picked_ids:
            nearest = max(picked_ids, key=lambda id: cosine(post.vector, picked_ids[id]))
        scored.append(Scored(post, towards - lam * away, towards, away, nearest))

    scored.sort(key=lambda s: s.score, reverse=True)
    return scored


# ---------------------------------------------------------------- embeddings

_model = None


def embed(texts: list[str]) -> list[list[float]]:
    """Local embeddings via fastembed. The ~130 MB model loads once per process."""
    global _model
    if not texts:
        return []
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name=MODEL, cache_dir=str(Path(".fastembed")))
    return [vector.tolist() for vector in _model.embed(texts)]


def embed_posts(posts: list[Post]) -> None:
    """Give every post that has words a vector, in one batch."""
    with_words = [post for post in posts if post.text]
    vectors = embed([post.text for post in with_words])
    for post, vector in zip(with_words, vectors, strict=True):
        post.vector = vector


# ---------------------------------------------------------------- feeds

def parse_opml(path: Path) -> list[tuple[str, str]]:
    """(title, url) for every outline that carries a feed, de-duplicated."""
    root = ElementTree.parse(path).getroot()
    seen: set[str] = set()
    feeds: list[tuple[str, str]] = []
    for node in root.iter("outline"):
        url = (node.get("xmlUrl") or node.get("xmlurl") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        feeds.append(((node.get("title") or node.get("text") or url).strip(), url))
    return feeds


BLOCK_TAGS = re.compile(r"</(?:p|div|li|h\d|tr|blockquote)>|<br\s*/?>", re.I)
ANY_TAG = re.compile(r"<[^>]+>")
WHITESPACE = re.compile(r"\s+")

# Hacker News summaries are nothing but this scaffolding. Stripping it leaves
# the post to embed from its headline instead of from urls and vote counts.
HN_SCAFFOLDING = re.compile(
    r"(?:Article URL|Comments URL):\s*\S+|(?:Points|#\s*Comments):\s*\d+", re.I
)

# Two tails that say nothing about the post: WordPress's "The post X first
# appeared on Y", and YouTube's closing run of hashtags and further reading.
FEED_TAILS = re.compile(
    r"\bThe post .+? first appeared on .+?(?:\.|$)"
    r"|\bSources\s*(?:&|and)\s*further reading:.*$"
    r"|(?:\s#\w+)+(?=\s|$)",
    re.I,
)


def snippet(raw: str | None, limit: int = SNIPPET_CHARS) -> str:
    """A plain-text blurb: no markup, no feed scaffolding, cut at a word."""
    if not raw:
        return ""
    # Block tags become spaces so paragraphs do not run together; inline tags
    # vanish, so "<b>world</b>," does not grow a space before its comma.
    text = BLOCK_TAGS.sub(" ", raw)
    text = ANY_TAG.sub("", text)
    text = html.unescape(text)
    text = HN_SCAFFOLDING.sub(" ", text)
    text = FEED_TAILS.sub(" ", text)
    text = WHITESPACE.sub(" ", text).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "…"


def kind_of(link: str, item) -> str:
    if "youtube.com" in link or "youtu.be" in link:
        return "video"
    for enclosure in getattr(item, "enclosures", []) or []:
        if str(enclosure.get("type", "")).startswith("audio/"):
            return "podcast"
    return "article"


# The web is younger than this, and nothing in a feed is from two years hence.
# Outside the window a feed has got it wrong, whatever it says.
OLDEST_YEAR = 1990


def published_at(item) -> str:
    """The post's date, or "" when the feed gave none worth believing.

    Feeds stamp posts with years like 1 and 50000. mktime raises on some of
    them and quietly accepts others depending on the machine, so the year is
    judged here instead: undated is the honest answer for both, and an undated
    post still ranks.
    """
    parsed = getattr(item, "published_parsed", None) or getattr(item, "updated_parsed", None)
    if not parsed:
        return ""
    if not OLDEST_YEAR <= parsed[0] <= datetime.now(UTC).year + 1:
        return ""
    try:
        return datetime.fromtimestamp(time.mktime(parsed), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (OverflowError, OSError, ValueError):
        return ""


def raw_summary(item) -> str:
    """Feeds keep the blurb in different places; YouTube uses media_description."""
    for key in ("summary", "description", "media_description"):
        value = getattr(item, key, None)
        if value:
            return value
    content = getattr(item, "content", None)
    return content[0].get("value", "") if content else ""


def fetch(feeds: list[tuple[str, str]], per_feed: int = 20, max_age_days: int | None = None,
          workers: int = 16, timeout: int = 20, tries: int = 2) -> list[Post]:
    """Fetch every feed at once, keep the newest few of each, drop the old.

    Feeds go out in parallel with a timeout each: at a few hundred feeds one
    slow host must not hold the build. A feed that fails is skipped and
    yesterday's file keeps serving.

    One host at a time, though. Twenty-nine of these feeds are YouTube, and
    firing them all at once got nine of them refused — a different nine on the
    next run, which is what rate limiting looks like from the outside. Requests
    to the same host queue behind each other with a pause between, and anything
    that still fails gets one more go. Hosts with a single feed, which is most
    of them, are unaffected.
    """
    import threading
    import urllib.request
    from concurrent.futures import ThreadPoolExecutor
    from urllib.parse import urlparse

    locks: dict[str, threading.Lock] = {}
    guard = threading.Lock()

    def lock_for(host):
        with guard:
            return locks.setdefault(host, threading.Lock())

    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "manicule/0.1 (+https://manicule.adames.cc)"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()

    def pull(feed):
        title, url = feed
        host = urlparse(url).netloc
        why = None
        for attempt in range(tries):
            try:
                with lock_for(host):
                    body = get(url)
                    time.sleep(0.4)   # inside the lock: the pause is the point
                return title, url, feedparser.parse(body), None
            except Exception as e:  # noqa: BLE001 — any failure is worth one more go
                why = e
                if attempt + 1 < tries:
                    time.sleep(2)
        return title, url, None, why

    oldest = None
    if max_age_days is not None:
        oldest = (datetime.now(UTC) - timedelta(days=max_age_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    posts: list[Post] = []
    seen: set[str] = set()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(pull, feeds))

    for title, url, parsed, why in results:
        if parsed is None or (parsed.bozo and not parsed.entries):
            why = why or getattr(parsed, "bozo_exception", "unreadable")
            print(f"  skip {title}: {why}", file=sys.stderr)
            continue

        feed_title = (parsed.feed.get("title") or title).strip()
        kept = 0
        for item in parsed.entries:
            if kept >= per_feed:
                break
            link = (item.get("link") or "").strip()
            if not link:
                continue
            when = published_at(item)
            # Undated posts stay: a feed that never dates anything is still a feed.
            if oldest and when and when < oldest:
                continue
            # The guid identifies a post; the link sometimes does not. Radiolab
            # gives every episode the same link, its homepage, so hashing the
            # link collapsed fourteen episodes into one id.
            uid = (item.get("id") or item.get("guid") or link).strip() or link
            if uid in seen:
                continue
            seen.add(uid)
            kept += 1
            posts.append(Post(
                id=hashlib.sha1(uid.encode()).hexdigest()[:8],
                title=snippet(item.get("title"), 200),
                link=link,
                snippet=snippet(raw_summary(item)),
                feed=feed_title,
                published=when,
                kind=kind_of(link, item),
            ))
        print(f"  {feed_title}: {kept}", file=sys.stderr)

    # Newest first is the cold-start order; undated posts sink.
    posts.sort(key=lambda post: post.published, reverse=True)
    return posts


# ---------------------------------------------------------------- taste from files

def read_notes(folder: Path | None) -> list[str]:
    """Every .md/.txt under `folder`, first NOTE_CHARS characters each."""
    if folder is None or not folder.exists():
        return []
    notes = []
    for path in sorted(folder.rglob("*")):
        if path.suffix.lower() in {".md", ".txt"} and path.is_file():
            body = path.read_text(errors="ignore").strip()
            if body:
                notes.append(body[:NOTE_CHARS])
    return notes


# ---------------------------------------------------------------- the proof

def evaluate(posts: list[Post], trials_per_feed: int = 30, seed: int = 7,
             feed_sample: int | None = 40) -> dict | None:
    """Does picking a few things surface more of what you want?

    The test needs a label the ranker cannot see. The feed a post came from
    is one: the embedding never sees it, and posts from one feed share a
    subject and a voice, the closest stand-in for "more like this" that does
    not come from the model itself. Pick a few posts from a feed, leave the
    rest in the pile, and ask where they land, against the orders a reader
    could otherwise have had.

    Same feed is a stand-in for same taste, not the thing itself: it shows the
    ranker finds coherent neighbourhoods, which is necessary, not sufficient.
    """
    import numpy as np

    rows = [e for e in posts if e.vector]
    n = len(rows)
    if n < 20:
        return None
    vectors = np.array([e.vector for e in rows])
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    feeds = np.array([e.feed for e in rows])
    kinds = np.array([e.kind for e in rows])
    newest_first = np.argsort(np.array([e.published for e in rows]))[::-1]
    rng = np.random.default_rng(seed)

    # A baseline with no model in it: shared uncommon words.
    words = [set(re.findall(r"[a-z]{4,}", e.text.lower())) for e in rows]
    in_how_many = {}
    for bag in words:
        for word in bag:
            in_how_many[word] = in_how_many.get(word, 0) + 1
    weight = {word: 1.0 / (1 + count) for word, count in in_how_many.items()}

    def shared_words(picks, candidates):
        wanted = set().union(*(words[i] for i in picks))
        return np.array([sum(weight[w] for w in words[c] & wanted) for c in candidates])

    def direction(ids):
        """The taste a set of picks makes, as unit rows: what press() would build."""
        taste = taste_of([list(vectors[i]) for i in ids])
        means = np.array([mean for mean, _ in taste])
        return means / np.linalg.norm(means, axis=1, keepdims=True)

    def towards(rows, ids):
        """How near each row sits to that taste: its closest average."""
        return (vectors[rows] @ direction(ids).T).max(axis=1)

    def places(order, held_out):
        place = {post: p + 1 for p, post in enumerate(order)}
        return [place[i] for i in held_out]

    def one_trial(picks, held_out):
        rest = np.array([i for i in range(n) if i not in picks])
        scores = towards(rest, picks)
        return {
            "ranker": places(rest[np.argsort(-scores)], held_out),
            "words": places(rest[np.argsort(-shared_words(picks, rest))], held_out),
            "newest": places([i for i in newest_first if i not in picks], held_out),
            "shuffled": places(rng.permutation(rest), held_out),
        }

    # A big pool has hundreds of feeds; testing every one at thirty trials
    # each would take the build hostage. A fixed sample, same seed every day,
    # is the same test on a comparable slice.
    tested = sorted(set(feeds))
    if feed_sample and len(tested) > feed_sample:
        tested = sorted(np.random.default_rng(seed).choice(tested, feed_sample, replace=False))

    def trials(picks_per_trial, only=None):
        got = {name: [] for name in ("ranker", "words", "newest", "shuffled")}
        count = 0
        for feed in tested:
            members = np.where(feeds == feed)[0]
            if only:
                members = np.array([i for i in members if kinds[i] in only])
            if len(members) < picks_per_trial + 2:
                continue
            for _ in range(trials_per_feed):
                picks = rng.choice(members, picks_per_trial, replace=False)
                held_out = [i for i in members if i not in picks]
                for name, where in one_trial(picks, held_out).items():
                    got[name].extend(where)
                count += 1
        return count, got

    def median(values):
        return int(round(float(np.median(values)))) if values else None

    def in_top_ten(values, count):
        return round(sum(1 for p in values if p <= 10) / count, 2) if count else None

    # Passing on something: where its feed-mates land, two picks from one feed
    # and two passes from the next, at each λ. This is what the ruler does.
    def lambda_sweep():
        big = [f for f in sorted(set(feeds)) if (feeds == f).sum() >= 5]
        if len(big) < 2:
            return {}
        sweep = {}
        for lam in (0.0, 0.25, 0.5, 1.0):
            landed = []
            for i, feed_a in enumerate(big):
                a = np.where(feeds == feed_a)[0]
                b = np.where(feeds == big[(i + 1) % len(big)])[0]
                for _ in range(10):
                    picks = rng.choice(a, 2, replace=False)
                    passes = rng.choice(b, 2, replace=False)
                    rest = np.array([x for x in range(n) if x not in picks])
                    scores = towards(rest, picks) - lam * towards(rest, passes)
                    landed.extend(places(rest[np.argsort(-scores)], [x for x in b if x not in passes]))
            sweep[str(lam)] = median(landed)
        return sweep

    by_picks = {}
    for k in (1, 2, 3, 5):
        count, got = trials(k)
        if count:
            by_picks[str(k)] = {name: median(where) for name, where in got.items()}
    count, got = trials(2)
    written_count, written = trials(2, only={"article"})
    return {
        "posts": n,
        "feeds": len(set(feeds)),
        "trials": count,
        "median_rank": by_picks,
        "top_ten": {name: in_top_ten(where, count) for name, where in got.items()},
        "lambda": lambda_sweep(),
        "written": {"trials": written_count, **{name: median(where) for name, where in written.items()}},
    }


def print_proof(proof: dict | None) -> None:
    if not proof:
        print("too few posts to evaluate", file=sys.stderr)
        return
    names = ("ranker", "words", "newest", "shuffled")
    print(f"{proof['posts']} posts · {proof['feeds']} feeds · {proof['trials']} trials at 2 picks\n")
    print(f"median rank of the posts you did not pick, out of {proof['posts']}")
    print(f"{'picks':>6} {'ranker':>8} {'words':>8} {'newest':>8} {'shuffled':>9}")
    for k, row in proof["median_rank"].items():
        print(f"{k:>6}" + "".join(f"{row[name]:>9}" for name in names))
    print("\nof the top ten, how many are from the feed you picked from (2 picks)")
    for name in names:
        print(f"  {name:9} {proof['top_ten'][name]:.2f}")
    print("\npassing on two from another feed: where the rest of that feed lands")
    for lam, place in proof["lambda"].items():
        print(f"  λ = {lam:<5} {place:>5}")
    w = proof["written"]
    print(f"\nwritten posts only ({w['trials']} trials)")
    for name in names:
        print(f"  {name:9} {w[name]:>5}")


# ---------------------------------------------------------------- the demo taste

def demo_taste(posts: list[Post], picks: int = 3) -> dict[str, list[str]] | None:
    """A deliberately plural taste, chosen fresh at every build.

    One average collapses a plural taste, so three things that sit far apart
    make the honest showcase: the list they produce mixes feeds instead of
    burrowing into one.

    Each feed nominates its most typical post, then the nominees furthest
    apart win. Typical-within-feed matters. Picking whatever was least like
    everything else kept reaching for the most unusual item of the day, and the
    most unusual item is often the one you would rather not meet on a
    stranger's front page.
    """
    pool = [e for e in posts if e.vector and e.snippet and e.feed not in DEMO_SKIP]
    if len(pool) < picks + 1:
        return None

    by_feed: dict[str, list[Post]] = {}
    for post in pool:
        by_feed.setdefault(post.feed, []).append(post)

    nominees = []
    for feed_posts in by_feed.values():
        middle = mean_vector([e.vector for e in feed_posts])
        nominees.append(max(feed_posts, key=lambda e: cosine(e.vector, middle)))
    if len(nominees) < picks:
        return None

    pairs = ((a, b) for i, a in enumerate(nominees) for b in nominees[i + 1:])
    chosen = list(min(pairs, key=lambda pair: cosine(pair[0].vector, pair[1].vector)))
    while len(chosen) < picks:
        rest = [e for e in nominees if e not in chosen]
        if not rest:
            break
        closest_to_chosen = lambda e: max(cosine(e.vector, c.vector) for c in chosen)  # noqa: E731
        chosen.append(min(rest, key=closest_to_chosen))

    # The one to pass on is whatever most resembles the first pick, so the
    # second term visibly bites.
    picked_ids = {e.id for e in chosen}
    rest = [e for e in pool if e.id not in picked_ids]
    passed = max(rest, key=lambda e: cosine(e.vector, chosen[0].vector)) if rest else None
    return {"m": [e.id for e in chosen], "d": [passed.id] if passed else []}


def spread(posts: list[Post], count: int = 30) -> list[str]:
    """Ids of `count` posts chosen to sit as far apart as possible.

    Cold start is the hard part of a big pool: a thousand posts and no reason
    to press any of them. Newest-first answers "what is new", which is not the
    question. This answers "what is here" — farthest-point sampling, so every
    corner of the pool gets one seat and whatever a reader is into, something
    on the first screen is near it.

    It is what categories would be for, done without asking anyone to read a
    label or make a choice.
    """
    import numpy as np

    rows = [p for p in posts if p.vector]
    if len(rows) <= count:
        return [p.id for p in rows]
    vectors = np.array([p.vector for p in rows])
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)

    # Start at the middle of the pool, so the run is the same every build and
    # the first seat is the most ordinary thing here, not the strangest.
    middle = vectors.mean(axis=0)
    chosen = [int(np.argmax(vectors @ middle))]
    nearest = vectors @ vectors[chosen[0]]
    for _ in range(count - 1):
        pick = int(np.argmin(nearest))
        chosen.append(pick)
        nearest = np.maximum(nearest, vectors @ vectors[pick])

    # Back into feed order, so the screen reads as a feed and not as a ranking.
    return [rows[i].id for i in sorted(chosen)]


def quantize(vector: list[float]) -> tuple[list[int], float]:
    """int8 with one scale per vector: four times smaller than float32 in JSON,
    and the cosine error is well below anything the ranking can feel."""
    scale = max(abs(x) for x in vector) or 1.0
    return [max(-127, min(127, round(x / scale * 127))) for x in vector], scale


# ---------------------------------------------------------------- a taste, written down

CAP = 20     # how many presses an average may claim against a new one
NEAR = 0.55  # a post this close to an average joins it
MOST = 3     # how many averages one taste may have


def one_blob(vector: list[float], count: int) -> str:
    """<base64 of 384 int8>~<scale>~<count>. Mirrors site/rank.js."""
    q, scale = quantize(vector)
    raw = bytes((x + 256) & 255 for x in q)
    body = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    # The scale is printed the way JavaScript prints a number, because the two
    # must write the same string from the same numbers. Python would say "1.0"
    # where JavaScript says "1", and the fixture catches exactly that.
    text = f"{scale:.6g}"
    if "e" in text:
        mantissa, exponent = text.split("e")
        text = f"{mantissa}e{int(exponent)}"
    return f"{body}~{text}~{count}"


def read_one(text: str, dim: int = DIM) -> tuple[list[float], int] | None:
    parts = (text or "").split("~")
    if len(parts) != 3:
        return None
    try:
        scale, count = float(parts[1]), int(parts[2])
    except ValueError:
        return None
    if scale <= 0 or count <= 0:
        return None
    pad = "=" * (-len(parts[0]) % 4)
    try:
        raw = base64.urlsafe_b64decode(parts[0] + pad)
    except Exception:  # noqa: BLE001 — a hand-edited link is not an error
        return None
    if len(raw) < dim:
        return None
    return dequantize([b - 256 if b > 127 else b for b in raw[:dim]], scale), count


def taste_blob(taste: Taste) -> str:
    """A taste is several averages, so a blob is several blobs.

    The whole taste fits in a link, which is why there is no account: the
    ranking only ever sees these averages, on any day and against any pool.
    Ids cannot do this — the pool turns over and they stop pointing at
    anything. "!" separates them because a fragment carries it as itself.
    """
    return "!".join(one_blob(mean, count) for mean, count in (taste or []))


def read_taste_blob(text: str, dim: int = DIM) -> Taste:
    out: Taste = []
    for part in (text or "").split("!"):
        one = read_one(part, dim)
        if one:
            out.append(one)
    return out


Taste = list[tuple[list[float], int]]   # several averages, each with its count


def fold_in(one: tuple[list[float], int], vector: list[float]) -> tuple[list[float], int]:
    mean, count = one
    w = min(count, CAP)
    return [(m * w + x) / (w + 1) for m, x in zip(mean, vector)], count + 1


def fold_out(one: tuple[list[float], int], vector: list[float]) -> tuple[list[float], int] | None:
    mean, count = one
    if count <= 1:
        return None
    w = min(count - 1, CAP)
    return [(m * (w + 1) - x) / w for m, x in zip(mean, vector)], count - 1


def which_one(taste: Taste, vector: list[float]) -> tuple[int, float]:
    """Which average a post belongs to: the one it is nearest."""
    if not taste:
        return -1, float("-inf")
    scores = [cosine(vector, mean) for mean, _ in taste]
    best = max(range(len(scores)), key=scores.__getitem__)
    return best, scores[best]


def press(taste: Taste | None, vector: list[float]) -> Taste:
    """Fold one post into the average it belongs to, or start a new one.

    A reader who likes two unrelated things is near one of them and never the
    midpoint, so a taste is several averages, up to MOST. Nothing is labelled
    and nothing is chosen by the reader.

    CAP bounds how much an established average may outweigh a new press. Below
    it every press counts the same, which is what a plain mean does. Above it
    the two-hundredth press still turns the average by a twentieth instead of a
    two-hundredth: a taste that cannot set.
    """
    out = list(taste or [])
    best, near = which_one(out, vector)
    if best >= 0 and (near >= NEAR or len(out) >= MOST):
        out[best] = fold_in(out[best], vector)
    else:
        out.append((list(vector), 1))
    return out


def unpress(taste: Taste | None, vector: list[float]) -> Taste:
    """The same post back out of the same average, so a box can be ticked and
    unticked all day and the taste lands where it started."""
    out = list(taste or [])
    best, _ = which_one(out, vector)
    if best < 0:
        return out
    left = fold_out(out[best], vector)
    if left:
        out[best] = left
    else:
        out.pop(best)
    return out


def taste_of(vectors: list[list[float]]) -> Taste:
    taste: Taste = []
    for vector in vectors:
        taste = press(taste, vector)
    return taste


def nearness(taste: Taste, vector: list[float]) -> float:
    """How near a post sits to a taste: the closest of its averages."""
    return max(cosine(vector, mean) for mean, _ in taste)


def write_vectors(posts: list[Post], out: Path) -> None:
    """The int8 vectors, packed, one after another in posts.json's order.

    A post with no vector writes 384 zeros; the JSON row has no scale, and
    that is how a reader knows. Binary is a fifth the size of the same numbers
    as JSON text, and the browser can read it straight into a typed array.
    """
    import numpy as np
    zeros = [0] * DIM
    block = np.array([quantize(p.vector)[0] if p.vector is not None else zeros for p in posts], dtype=np.int8)
    out.write_bytes(block.tobytes())


def read_vectors(rows: list[dict], path: Path) -> list[list[float] | None]:
    """Mirror of write_vectors: the same rows back, dequantized by the JSON scale."""
    import numpy as np
    block = np.frombuffer(path.read_bytes(), dtype=np.int8).reshape(len(rows), DIM)
    return [dequantize(block[i].tolist(), row["s"]) if "s" in row else None for i, row in enumerate(rows)]


def dequantize(q: list[int], scale: float) -> list[float]:
    """The reverse, as rank.js reads it."""
    return [x / 127 * scale for x in q]


# ---------------------------------------------------------------- commands

def cmd_rank(args: argparse.Namespace) -> int:
    """Your own feeds, ranked by your own notes, as a page of Markdown."""
    print("fetching…", file=sys.stderr)
    posts = fetch(parse_opml(Path(args.opml)), per_feed=args.per_feed)
    picked_notes = read_notes(Path(args.picked) if args.picked else None)
    passed_notes = read_notes(Path(args.passed) if args.passed else None)

    print(f"embedding {len(posts)} posts, {len(picked_notes)} picked, "
          f"{len(passed_notes)} passed…", file=sys.stderr)
    embed_posts(posts)
    ranked = rank(posts, taste_of(embed(picked_notes)), taste_of(embed(passed_notes)), lam=args.lam)

    if ranked is None:
        heading = "# newest first — nothing picked yet, so there is no taste to rank by\n"
        rows = [(post, None) for post in posts[:args.limit]]
    else:
        heading = (f"# ranked by taste — {len(picked_notes)} picked, "
                   f"{len(passed_notes)} passed, λ={args.lam}\n")
        rows = [(s.post, s) for s in ranked[:args.limit]]

    lines = [heading]
    for post, scored in rows:
        badge = {"video": "VID", "podcast": "POD"}.get(post.kind, "WEB")
        line = f"- [{badge}] [{post.title or post.link}]({post.link}) — {post.feed}"
        if scored is not None and scored.score != float("-inf"):
            line += f"  `{scored.score:+.3f} = {scored.pos:+.3f} − {args.lam}×{scored.neg:.3f}`"
        lines.append(line)
        if post.snippet:
            lines.append(f"  {post.snippet[:160]}")

    page = "\n".join(lines) + "\n"
    if args.out:
        Path(args.out).write_text(page)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(page)
    return 0


def cmd_posts(args: argparse.Namespace) -> int:
    """The same feeds, embedded once, as the static page's data."""
    feeds = parse_opml(Path(args.opml))
    print(f"fetching {len(feeds)} feeds…", file=sys.stderr)
    posts = fetch(feeds, per_feed=args.per_feed, max_age_days=args.max_age)
    print(f"embedding {len(posts)} posts…", file=sys.stderr)
    embed_posts(posts)

    rows = []
    for post in posts:
        row = {
            "id": post.id, "title": post.title, "link": post.link,
            "snippet": post.snippet, "feed": post.feed,
            "published": post.published, "kind": post.kind,
        }
        if post.vector is not None:
            row["s"] = quantize(post.vector)[1]
        rows.append(row)

    payload = {
        "generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": MODEL,
        "dim": DIM,
        "lambda": LAMBDA,
        "feeds": sorted({post.feed for post in posts}),
        "demo": demo_taste(posts),
        "spread": spread(posts),
        "proof": evaluate(posts),
        "posts": rows,
    }
    out = Path(args.out)
    out.write_text(json.dumps(payload, separators=(",", ":")))
    write_vectors(posts, out.with_name("vectors.bin"))
    print(f"wrote {out} and vectors.bin: {len(posts)} posts from {len(payload['feeds'])} feeds",
          file=sys.stderr)
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    """Rerun the proof on a posts.json, without fetching or embedding."""
    where = Path(args.posts)
    payload = json.loads(where.read_text())
    vectors = read_vectors(payload["posts"], where.with_name("vectors.bin"))
    posts = [
        Post(row["id"], row["title"], row["link"], row["snippet"], row["feed"],
              row["published"], row["kind"], vector)
        for row, vector in zip(payload["posts"], vectors)
    ]
    print_proof(evaluate(posts))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="manicule", description=__doc__.split("\n\n")[1])
    commands = parser.add_subparsers(dest="cmd", required=True)

    daily = commands.add_parser("rank", help="rank what's new in your feeds by what you've picked")
    daily.add_argument("opml")
    daily.add_argument("--picked", help="folder of .md/.txt you'd want more of (an Obsidian export works)")
    daily.add_argument("--passed", help="folder of .md/.txt you'd want less of")
    daily.add_argument("--lambda", dest="lam", type=float, default=LAMBDA)
    daily.add_argument("--per-feed", type=int, default=20)
    daily.add_argument("--limit", type=int, default=50)
    daily.add_argument("-o", "--out", help="write Markdown here instead of stdout")
    daily.set_defaults(fn=cmd_rank)

    demo = commands.add_parser("posts", help="fetch + embed feeds into a static JSON for the demo site")
    demo.add_argument("opml")
    demo.add_argument("-o", "--out", default="site/posts.json")
    # The browser downloads every post, so the demo keeps fewer per feed than
    # the CLI does: more feeds at fewer each is the same page weight and a much
    # wider sample.
    demo.add_argument("--per-feed", type=int, default=5)
    # Wide, not recent: a good blog that posts twice a year belongs in the
    # pool, and newest-first already sinks its older posts to the bottom. The
    # cutoff is only here to keep a feed that died last year out.
    demo.add_argument("--max-age", type=int, default=90, help="days; older posts are left out")
    demo.set_defaults(fn=cmd_posts)

    proof = commands.add_parser("evaluate", help="rerun the proof on a posts.json and print it")
    proof.add_argument("posts", nargs="?", default="site/posts.json")
    proof.set_defaults(fn=cmd_evaluate)

    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
