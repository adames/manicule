"""manicule — a pointing hand for your feeds.

Rank what's new by what you've picked. No database, no server, no account.

The whole method:

    score(entry) = cos(entry, picked) - LAMBDA * cos(entry, passed)

where `picked` is the mean embedding of everything you picked and `passed` is
the mean embedding of everything you passed on. Two averages and a
subtraction. No training. If you have picked nothing yet, there is no taste to
rank by and the list stays newest-first.

Two subcommands:

    manicule.py rank   feeds.opml --picked notes/ [--passed nope/]   # your daily page
    manicule.py corpus feeds.opml -o site/corpus.json                # the static demo's data

Embeddings run locally (fastembed, BAAI/bge-small-en-v1.5, 384 dimensions);
nothing leaves the machine except the feed fetches themselves.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from xml.etree import ElementTree

import feedparser

LAMBDA = 0.25          # how hard a resemblance to passed things pushes an entry down
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


def centroid(vectors: list[list[float]]) -> list[float] | None:
    """The mean vector, or None when there is nothing to average."""
    if not vectors:
        return None
    dimensions = len(vectors[0])
    return [sum(v[i] for v in vectors) / len(vectors) for i in range(dimensions)]


@dataclass
class Entry:
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
    entry: Entry
    score: float            # -inf when the entry has no words to compare
    pos: float              # cos(entry, picked)
    neg: float              # cos(entry, passed), 0 when nothing is passed
    nearest: str | None     # id of the picked entry it most resembles


def rank(
    entries: list[Entry],
    picked: list[list[float]],
    passed: list[list[float]],
    lam: float = LAMBDA,
    picked_ids: dict[str, list[float]] | None = None,
) -> list[Scored] | None:
    """Order `entries` best-first by taste.

    Returns None on a cold start, so the caller keeps its own order, which is
    recency. An entry with no vector sinks to the bottom but is never dropped.
    """
    picked_mean = centroid(picked)
    if picked_mean is None:
        return None
    passed_mean = centroid(passed)

    scored: list[Scored] = []
    for entry in entries:
        if entry.vector is None:
            scored.append(Scored(entry, float("-inf"), 0.0, 0.0, None))
            continue
        towards = cosine(entry.vector, picked_mean)
        away = cosine(entry.vector, passed_mean) if passed_mean is not None else 0.0
        nearest = None
        if picked_ids:
            nearest = max(picked_ids, key=lambda id: cosine(entry.vector, picked_ids[id]))
        scored.append(Scored(entry, towards - lam * away, towards, away, nearest))

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


def embed_entries(entries: list[Entry]) -> None:
    """Give every entry that has words a vector, in one batch."""
    with_words = [entry for entry in entries if entry.text]
    vectors = embed([entry.text for entry in with_words])
    for entry, vector in zip(with_words, vectors, strict=True):
        entry.vector = vector


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
# the entry to embed from its headline instead of from urls and vote counts.
HN_SCAFFOLDING = re.compile(
    r"(?:Article URL|Comments URL):\s*\S+|(?:Points|#\s*Comments):\s*\d+", re.I
)

# Two tails that say nothing about the entry: WordPress's "The post X first
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


def published_at(item) -> str:
    parsed = getattr(item, "published_parsed", None) or getattr(item, "updated_parsed", None)
    if not parsed:
        return ""
    return datetime.fromtimestamp(time.mktime(parsed), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def raw_summary(item) -> str:
    """Feeds keep the blurb in different places; YouTube uses media_description."""
    for key in ("summary", "description", "media_description"):
        value = getattr(item, key, None)
        if value:
            return value
    content = getattr(item, "content", None)
    return content[0].get("value", "") if content else ""


def fetch(feeds: list[tuple[str, str]], per_feed: int = 20) -> list[Entry]:
    entries: list[Entry] = []
    seen: set[str] = set()

    for title, url in feeds:
        parsed = feedparser.parse(url)
        if parsed.bozo and not parsed.entries:
            why = getattr(parsed, "bozo_exception", "unreadable")
            print(f"  skip {title}: {why}", file=sys.stderr)
            continue

        feed_title = (parsed.feed.get("title") or title).strip()
        for item in parsed.entries[:per_feed]:
            link = (item.get("link") or "").strip()
            if not link:
                continue
            # The guid identifies an entry; the link sometimes does not. Radiolab
            # gives every episode the same link, its homepage, so hashing the
            # link collapsed fourteen episodes into one id.
            uid = (item.get("id") or item.get("guid") or link).strip() or link
            if uid in seen:
                continue
            seen.add(uid)
            entries.append(Entry(
                id=hashlib.sha1(uid.encode()).hexdigest()[:8],
                title=snippet(item.get("title"), 200),
                link=link,
                snippet=snippet(raw_summary(item)),
                feed=feed_title,
                published=published_at(item),
                kind=kind_of(link, item),
            ))
        print(f"  {feed_title}: {min(len(parsed.entries), per_feed)}", file=sys.stderr)

    # Newest first is the cold-start order; undated entries sink.
    entries.sort(key=lambda entry: entry.published, reverse=True)
    return entries


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


# ---------------------------------------------------------------- the demo taste

def demo_taste(entries: list[Entry], picks: int = 3) -> dict[str, list[str]] | None:
    """A deliberately plural taste, chosen fresh at every build.

    One centroid collapses a plural taste, so three things that sit far apart
    make the honest showcase: the list they produce mixes feeds instead of
    burrowing into one.

    Each feed nominates its most typical entry, then the nominees furthest
    apart win. Typical-within-feed matters. Picking whatever was least like
    everything else kept reaching for the most unusual item of the day, and the
    most unusual item is often the one you would rather not meet on a
    stranger's front page.
    """
    pool = [e for e in entries if e.vector and e.snippet and e.feed not in DEMO_SKIP]
    if len(pool) < picks + 1:
        return None

    by_feed: dict[str, list[Entry]] = {}
    for entry in pool:
        by_feed.setdefault(entry.feed, []).append(entry)

    nominees = []
    for feed_entries in by_feed.values():
        middle = centroid([e.vector for e in feed_entries])
        nominees.append(max(feed_entries, key=lambda e: cosine(e.vector, middle)))
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


def quantize(vector: list[float]) -> tuple[list[int], float]:
    """int8 with one scale per vector: four times smaller than float32 in JSON,
    and the cosine error is well below anything the ranking can feel."""
    scale = max(abs(x) for x in vector) or 1.0
    return [max(-127, min(127, round(x / scale * 127))) for x in vector], scale


# ---------------------------------------------------------------- commands

def cmd_rank(args: argparse.Namespace) -> int:
    """Your own feeds, ranked by your own notes, as a page of Markdown."""
    print("fetching…", file=sys.stderr)
    entries = fetch(parse_opml(Path(args.opml)), per_feed=args.per_feed)
    picked_notes = read_notes(Path(args.picked) if args.picked else None)
    passed_notes = read_notes(Path(args.passed) if args.passed else None)

    print(f"embedding {len(entries)} entries, {len(picked_notes)} picked, "
          f"{len(passed_notes)} passed…", file=sys.stderr)
    embed_entries(entries)
    ranked = rank(entries, embed(picked_notes), embed(passed_notes), lam=args.lam)

    if ranked is None:
        heading = "# newest first — nothing picked yet, so there is no taste to rank by\n"
        rows = [(entry, None) for entry in entries[:args.limit]]
    else:
        heading = (f"# ranked by taste — {len(picked_notes)} picked, "
                   f"{len(passed_notes)} passed, λ={args.lam}\n")
        rows = [(s.entry, s) for s in ranked[:args.limit]]

    lines = [heading]
    for entry, scored in rows:
        badge = {"video": "VID", "podcast": "POD"}.get(entry.kind, "WEB")
        line = f"- [{badge}] [{entry.title or entry.link}]({entry.link}) — {entry.feed}"
        if scored is not None and scored.score != float("-inf"):
            line += f"  `{scored.score:+.3f} = {scored.pos:+.3f} − {args.lam}×{scored.neg:.3f}`"
        lines.append(line)
        if entry.snippet:
            lines.append(f"  {entry.snippet[:160]}")

    page = "\n".join(lines) + "\n"
    if args.out:
        Path(args.out).write_text(page)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(page)
    return 0


def cmd_corpus(args: argparse.Namespace) -> int:
    """The same feeds, embedded once, as the static page's data."""
    feeds = parse_opml(Path(args.opml))
    print(f"fetching {len(feeds)} feeds…", file=sys.stderr)
    entries = fetch(feeds, per_feed=args.per_feed)
    print(f"embedding {len(entries)} entries…", file=sys.stderr)
    embed_entries(entries)

    rows = []
    for entry in entries:
        row = {
            "id": entry.id, "title": entry.title, "link": entry.link,
            "snippet": entry.snippet, "feed": entry.feed,
            "published": entry.published, "kind": entry.kind,
        }
        if entry.vector is not None:
            row["q"], row["s"] = quantize(entry.vector)
        rows.append(row)

    payload = {
        "generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": MODEL,
        "dim": DIM,
        "lambda": LAMBDA,
        "feeds": sorted({entry.feed for entry in entries}),
        "demo": demo_taste(entries),
        "entries": rows,
    }
    Path(args.out).write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {args.out}: {len(entries)} entries from {len(payload['feeds'])} feeds",
          file=sys.stderr)
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

    demo = commands.add_parser("corpus", help="fetch + embed feeds into a static JSON for the demo site")
    demo.add_argument("opml")
    demo.add_argument("-o", "--out", default="site/corpus.json")
    # The browser downloads every entry, so the demo keeps fewer per feed than
    # the CLI does: more feeds at fewer each is the same page weight and a much
    # wider sample.
    demo.add_argument("--per-feed", type=int, default=7)
    demo.set_defaults(fn=cmd_corpus)

    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
