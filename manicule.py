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
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree

import feedparser

LAMBDA = 0.25          # how hard a resemblance to passed things pushes an entry down
SNIPPET_CHARS = 400    # embed the headline plus a short blurb, never the whole post
NOTE_CHARS = 2000      # a note is embedded from its first ~2000 characters
# Feeds the demo taste never picks from. No judgement on the writing: a demo
# built on one person's blog shows off that person, not the ranker.
DEMO_SKIP = {"Simon Willison's Weblog"}
MODEL = "BAAI/bge-small-en-v1.5"
DIM = 384


# ---------------------------------------------------------------- the math

def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def centroid(vectors: list[list[float]]) -> list[float] | None:
    """Mean vector, or None when there is nothing to average (cold start)."""
    if not vectors:
        return None
    dim = len(vectors[0])
    return [sum(v[i] for v in vectors) / len(vectors) for i in range(dim)]


@dataclass
class Entry:
    id: str
    title: str
    link: str
    snippet: str
    feed: str
    published: str          # ISO 8601 or ""
    kind: str               # article | video | podcast
    vector: list[float] | None = None

    @property
    def text(self) -> str:
        return " ".join(p for p in (self.title, self.snippet) if p).strip()


@dataclass
class Scored:
    entry: Entry
    score: float            # -inf when the entry has no text to compare
    pos: float              # cos(entry, picked)
    neg: float              # cos(entry, passed), 0 when nothing is passed
    nearest: str | None     # id of the picked entry it most resembles, if any


def rank(
    entries: list[Entry],
    picked: list[list[float]],
    passed: list[list[float]],
    lam: float = LAMBDA,
    picked_ids: dict[str, list[float]] | None = None,
) -> list[Scored] | None:
    """Order `entries` best-first by taste. Returns None on cold start (nothing
    picked) so the caller keeps its own order — recency, usually. An entry with
    no vector sinks to the bottom but is never dropped."""
    pos = centroid(picked)
    if pos is None:
        return None
    neg = centroid(passed)
    out: list[Scored] = []
    for e in entries:
        if e.vector is None:
            out.append(Scored(e, float("-inf"), 0.0, 0.0, None))
            continue
        p = cosine(e.vector, pos)
        n = cosine(e.vector, neg) if neg is not None else 0.0
        nearest = None
        if picked_ids:
            nearest = max(picked_ids, key=lambda k: cosine(e.vector, picked_ids[k]))
        out.append(Scored(e, p - lam * n, p, n, nearest))
    out.sort(key=lambda s: s.score, reverse=True)
    return out


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
    return [v.tolist() for v in _model.embed(texts)]


# ---------------------------------------------------------------- feeds

def parse_opml(path: Path) -> list[tuple[str, str]]:
    """(title, xmlUrl) for every outline that carries a feed URL, de-duplicated."""
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


_BLOCK = re.compile(r"</(?:p|div|li|h\d|tr|blockquote)>|<br\s*/?>", re.I)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
# Hacker News summaries are nothing but this scaffolding; strip it so the
# entry embeds from its headline alone instead of from URLs and counts.
_HN = re.compile(r"(?:Article URL|Comments URL):\s*\S+|(?:Points|#\s*Comments):\s*\d+", re.I)
# Two more tails that say nothing about the entry: WordPress's "The post X first
# appeared on Y", and YouTube's closing run of hashtags and "Sources & further
# reading: <link>".
_TAILS = re.compile(
    r"\bThe post .+? first appeared on .+?(?:\.|$)"
    r"|\bSources\s*(?:&|and)\s*further reading:.*$"
    r"|(?:\s#\w+)+(?=\s|$)",
    re.I,
)


def snippet(raw: str | None, limit: int = SNIPPET_CHARS) -> str:
    """Plain-text blurb: strip tags, collapse whitespace, cut at a word boundary."""
    if not raw:
        return ""
    # Block boundaries become spaces so paragraphs don't run together; inline
    # tags vanish so "<b>world</b>," doesn't grow a space before the comma.
    text = _WS.sub(" ", _TAILS.sub(" ", _HN.sub(" ", html.unescape(_TAG.sub("", _BLOCK.sub(" ", raw)))))).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def _kind(link: str, item) -> str:
    if "youtube.com" in link or "youtu.be" in link:
        return "video"
    for enc in getattr(item, "enclosures", []) or []:
        if str(enc.get("type", "")).startswith("audio/"):
            return "podcast"
    return "article"


def _published(item) -> str:
    st = getattr(item, "published_parsed", None) or getattr(item, "updated_parsed", None)
    if not st:
        return ""
    return datetime.fromtimestamp(time.mktime(st), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _summary(item) -> str:
    # Feeds put the blurb in different places; YouTube keeps it under media_description.
    for key in ("summary", "description", "media_description"):
        val = getattr(item, key, None)
        if val:
            return val
    content = getattr(item, "content", None)
    if content:
        return content[0].get("value", "")
    return ""


def fetch(feeds: list[tuple[str, str]], per_feed: int = 20) -> list[Entry]:
    entries: list[Entry] = []
    seen_uids: set[str] = set()
    for title, url in feeds:
        parsed = feedparser.parse(url)
        if parsed.bozo and not parsed.entries:
            print(f"  skip {title}: {getattr(parsed, 'bozo_exception', 'unreadable')}", file=sys.stderr)
            continue
        feed_title = (parsed.feed.get("title") or title).strip()
        for item in parsed.entries[:per_feed]:
            link = (item.get("link") or "").strip()
            if not link:
                continue
            # The guid identifies an entry; the link sometimes does not. Radiolab
            # gives every episode the same link (its homepage), so hashing the
            # link collapsed fourteen episodes into one id.
            uid = (item.get("id") or item.get("guid") or link).strip() or link
            if uid in seen_uids:
                continue
            seen_uids.add(uid)
            entries.append(Entry(
                id=hashlib.sha1(uid.encode()).hexdigest()[:8],
                title=snippet(item.get("title"), 200),
                link=link,
                snippet=snippet(_summary(item)),
                feed=feed_title,
                published=_published(item),
                kind=_kind(link, item),
            ))
        print(f"  {feed_title}: {min(len(parsed.entries), per_feed)}", file=sys.stderr)
    # Newest first is the cold-start order; undated entries sink.
    entries.sort(key=lambda e: e.published, reverse=True)
    return entries


def embed_entries(entries: list[Entry]) -> None:
    targets = [e for e in entries if e.text]
    for e, v in zip(targets, embed([e.text for e in targets]), strict=True):
        e.vector = v


# ---------------------------------------------------------------- taste from files

def read_notes(folder: Path | None) -> list[str]:
    """Every .md/.txt under `folder`, first NOTE_CHARS characters each."""
    if folder is None or not folder.exists():
        return []
    texts = []
    for p in sorted(folder.rglob("*")):
        if p.suffix.lower() in {".md", ".txt"} and p.is_file():
            body = p.read_text(errors="ignore").strip()
            if body:
                texts.append(body[:NOTE_CHARS])
    return texts


# ---------------------------------------------------------------- commands

def cmd_rank(args: argparse.Namespace) -> int:
    print("fetching…", file=sys.stderr)
    entries = fetch(parse_opml(Path(args.opml)), per_feed=args.per_feed)
    picked_texts = read_notes(Path(args.picked) if args.picked else None)
    passed_texts = read_notes(Path(args.passed) if args.passed else None)
    print(f"embedding {len(entries)} entries, {len(picked_texts)} picked, {len(passed_texts)} passed…", file=sys.stderr)
    embed_entries(entries)
    picked = embed(picked_texts)
    passed = embed(passed_texts)
    ranked = rank(entries, picked, passed, lam=args.lam)

    lines: list[str] = []
    if ranked is None:
        lines.append("# newest first — nothing picked yet, so there is no taste to rank by\n")
        rows = [(e, None) for e in entries[: args.limit]]
    else:
        lines.append(f"# ranked by taste — {len(picked)} picked, {len(passed)} passed, λ={args.lam}\n")
        rows = [(s.entry, s) for s in ranked[: args.limit]]
    for e, s in rows:
        badge = {"video": "VID", "podcast": "POD"}.get(e.kind, "WEB")
        head = f"- [{badge}] [{e.title or e.link}]({e.link}) — {e.feed}"
        if s is not None and s.score != float("-inf"):
            head += f"  `{s.score:+.3f} = {s.pos:+.3f} − {args.lam}×{s.neg:.3f}`"
        lines.append(head)
        if e.snippet:
            lines.append(f"  {e.snippet[:160]}")
    out = "\n".join(lines) + "\n"
    if args.out:
        Path(args.out).write_text(out)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(out)
    return 0


def quantize(v: list[float]) -> tuple[list[int], float]:
    """int8 with one scale per vector: ~4x smaller than float32 in JSON, and the
    cosine error is well below anything the ranking can feel."""
    scale = max(abs(x) for x in v) or 1.0
    return [max(-127, min(127, round(x / scale * 127))) for x in v], scale


def demo_taste(entries: list[Entry], picks: int = 3) -> dict[str, list[str]] | None:
    """A deliberately plural taste for the demo link.

    One centroid collapses a plural taste, so a demo built from three things
    that sit far apart is the honest showcase: the list it produces mixes
    feeds instead of burrowing into one.

    Each feed nominates the entry closest to its own mean, which is the most
    typical thing that feed published, then the three nominees furthest apart
    win. Typical-within-feed matters: picking the entry least like everything
    else would keep reaching for whatever is most unusual that day, and the
    most unusual thing in a feed is often the one somebody would rather not
    meet on a stranger's front page. The one to pass on is whatever most
    resembles the first pick, so the second term visibly bites.
    """
    pool = [e for e in entries if e.vector and e.snippet and e.feed not in DEMO_SKIP]
    if len(pool) < picks + 1:
        return None
    by_feed: dict[str, list[Entry]] = {}
    for e in pool:
        by_feed.setdefault(e.feed, []).append(e)
    nominees = []
    for feed, es in by_feed.items():
        mid = centroid([e.vector for e in es])
        nominees.append(max(es, key=lambda e: cosine(e.vector, mid)))
    if len(nominees) < picks:
        return None
    # start from the pair furthest apart, then keep adding the nominee whose
    # closest neighbour among the chosen is still the most distant
    chosen = list(min(
        ((a, b) for i, a in enumerate(nominees) for b in nominees[i + 1:]),
        key=lambda ab: cosine(ab[0].vector, ab[1].vector),
    ))
    while len(chosen) < picks:
        rest = [e for e in nominees if e not in chosen]
        if not rest:
            break
        chosen.append(min(rest, key=lambda e: max(cosine(e.vector, c.vector) for c in chosen)))
    ids = {e.id for e in chosen}
    rest = [e for e in pool if e.id not in ids]
    passed = max(rest, key=lambda e: cosine(e.vector, chosen[0].vector)) if rest else None
    return {"m": [e.id for e in chosen], "d": [passed.id] if passed else []}


def cmd_corpus(args: argparse.Namespace) -> int:
    feeds = parse_opml(Path(args.opml))
    print(f"fetching {len(feeds)} feeds…", file=sys.stderr)
    entries = fetch(feeds, per_feed=args.per_feed)
    print(f"embedding {len(entries)} entries…", file=sys.stderr)
    embed_entries(entries)
    payload = {
        "generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": MODEL,
        "dim": DIM,
        "lambda": LAMBDA,
        "feeds": sorted({e.feed for e in entries}),
        "demo": demo_taste(entries),
        "entries": [],
    }
    for e in entries:
        row = {
            "id": e.id, "title": e.title, "link": e.link, "snippet": e.snippet,
            "feed": e.feed, "published": e.published, "kind": e.kind,
        }
        if e.vector is not None:
            row["q"], row["s"] = quantize(e.vector)
        payload["entries"].append(row)
    Path(args.out).write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {args.out}: {len(entries)} entries from {len(payload['feeds'])} feeds", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="manicule", description=__doc__.split("\n\n")[1])
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("rank", help="rank what's new in your feeds by what you've picked")
    r.add_argument("opml")
    r.add_argument("--picked", help="folder of .md/.txt you'd want more of (an Obsidian export works)")
    r.add_argument("--passed", help="folder of .md/.txt you'd want less of")
    r.add_argument("--lambda", dest="lam", type=float, default=LAMBDA)
    r.add_argument("--per-feed", type=int, default=20)
    r.add_argument("--limit", type=int, default=50)
    r.add_argument("-o", "--out", help="write Markdown here instead of stdout")
    r.set_defaults(fn=cmd_rank)

    c = sub.add_parser("corpus", help="fetch + embed feeds into a static JSON for the demo site")
    c.add_argument("opml")
    c.add_argument("-o", "--out", default="site/corpus.json")
    c.add_argument("--per-feed", type=int, default=20)
    c.set_defaults(fn=cmd_corpus)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
