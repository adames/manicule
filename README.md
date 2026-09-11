# ☞ manicule

remember your tastes

a feed that reorders around what you point at. no database, no server, no
account. one Python file for your own feeds, and a static page for the demo.

full explanation, with today's numbers: <https://manicule.adames.cc/method.html>

## The whole method

```
score(post) = cos(post, picked) − λ · cos(post, passed)
```

`picked` is the average of the vectors you picked. `passed` is the average of
the ones you passed on. two averages and a subtraction (and a λ).

λ is how much a pass counts. at 0.25, the default, a pass takes away a quarter
of what the same closeness to a pick would add. at 1.0 the two cancel.

every post becomes a vector, 384 numbers from its headline plus a short blurb,
computed on your machine by
[fastembed](https://github.com/qdrant/fastembed) (`BAAI/bge-small-en-v1.5`).
`cos` is the cosine of the angle between two of those vectors: +1 the same
direction, 0 unrelated, below 0 opposite. nothing leaves your machine but the
feed fetches.

pick nothing and there's no taste to rank by, so it stays newest first. a post
with no words sinks to the bottom, but it never gets dropped.

the idea comes from [Commonplace](https://github.com/adames/commonplace), an
unreleased library I was developing.

## Does it work

the ranker gets tested against a label it can't see: the feed a post came
from. pick a few posts from one feed, leave the rest in the pile, see where
they land. median rank of the rest, out of 297, on a recent build:

| picks | the ranker | shared words | newest first | shuffled |
|---|---|---|---|---|
| 1 | 24 | 39 | 149 | 148 |
| 2 | 14 | 29 | 148 | 148 |
| 5 | 8 | 18 | 142 | 140 |

newest first is the same as shuffled. that's the argument for the whole thing.
same feed only stands in for same taste, so read it as necessary, not
sufficient. it runs at every build and the method page prints today's numbers.

```bash
uv run manicule.py evaluate site/posts.json
```

## Your own feeds

```bash
uv sync
uv run manicule.py rank feeds.opml --picked ~/notes -o today.md
```

`--picked` is any folder of `.md`/`.txt`. an Obsidian folder, saved articles,
whatever you have. point it at notes you already keep, not a folder you
maintain for this.

there's a `--passed` too, for a folder of things you passed on. most people
won't have one, and the ranker doesn't need it.

put it on a cron and read `today.md` with coffee.

## The demo

`site/` is a static page. a GitHub Action rebuilds `site/posts.json` and `site/vectors.bin` daily
(`manicule.py posts feeds.opml`) from the mixed sample in `feeds.opml`: code,
science, essays, podcasts, sports, food, games. mixed on purpose, so picking
two things visibly reorders everything.

a first visit lands newest first. pressing a post changes the scores and
leaves the order alone; `order by taste` sorts on them when you ask.

vectors ship as int8 with one scale each, packed in `vectors.bin` beside
`posts.json`, a fifth the size of the same numbers as text and too small a
rounding error for the ranking to feel. the browser does
the math in `site/rank.js`, the same math as the Python. your taste lives in
the URL, so a link is a taste.

## Make it yours: fork it

the hosted page ranks my feeds. for yours:

1. **fork** this repo.
2. replace **`feeds.opml`** with yours (any reader exports one; each
   `<outline xmlUrl="…">` is a feed). anything with an RSS or Atom feed works:
   blogs, YouTube channels, podcasts.
3. in the fork's settings, **Pages → Source: GitHub Actions**.
4. push, or run the `posts` workflow by hand. your site is at
   `https://<you>.github.io/manicule/`, rebuilt once a day (06:17 UTC).

your taste stays in your browser and your links. if you want the ranker without
a website, skip this and use the CLI above.

## Tests

```bash
uv run pytest -q && node --test tests/rank.test.mjs
```

`tests/fixture.json` is hand computed. Python and JavaScript both check it, so
the two rankers can't drift.
