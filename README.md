# ☞ manicule

remember your tastes

a feed that reorders around what you point at. no database, no server, no
account. one Python file for your own feeds, and a static page for the demo.

## The whole method

```
score(entry) = cos(entry, picked) − λ · cos(entry, passed)
```

`picked` is the mean embedding of what you picked. `passed` is the mean
embedding of what you passed on. two averages and a subtraction (and a λ).

λ is how much a pass counts. 0.25 by default, so it's a nudge. push it to 1.0
and a pass weighs as much as a pick.

entries are embedded from the headline plus a short blurb, locally, with
[fastembed](https://github.com/qdrant/fastembed) (`BAAI/bge-small-en-v1.5`,
384 dimensions). nothing leaves your machine but the feed fetches.

pick nothing and there's no taste to rank by, so it stays newest first. an
entry with no words sinks to the bottom, but it never gets dropped.

the idea comes from [Commonplace](https://github.com/adames/commonplace), an
unreleased library I was developing.

## Does it work

the ranker gets tested against a label it can't see: the feed an entry came
from. pick a few entries from one feed, leave the rest in the pile, see where
they land. median rank of the rest, out of 297, on a recent build:

| picks | the ranker | shared words | newest first | shuffled |
|---|---|---|---|---|
| 1 | 22 | 43 | 149 | 149 |
| 2 | 15 | 30 | 146 | 149 |
| 5 | 9 | 19 | 142 | 144 |

newest first is the same as shuffled. that's the argument for the whole thing.
same feed only stands in for same taste, so read it as necessary, not
sufficient. it runs at every build and the method page prints today's numbers.

```bash
uv run manicule.py evaluate site/entries.json
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

`site/` is a static page. a GitHub Action rebuilds `site/entries.json` daily
(`manicule.py entries feeds.opml`) from the mixed sample in `feeds.opml`: code,
science, essays, podcasts, sports, food, games. mixed on purpose, so marking
two things visibly reorders everything.

a first visit lands newest first. press anything and it reorders.

vectors ship int8; the browser does the math in `site/rank.js`, same math as
the Python. marks live in the URL, so a link is a taste.

## Make it yours: fork it

the hosted page ranks my feeds. for yours:

1. **fork** this repo.
2. replace **`feeds.opml`** with yours (any reader exports one; each
   `<outline xmlUrl="…">` is a feed). anything with an RSS or Atom feed works:
   blogs, YouTube channels, podcasts.
3. in the fork's settings, **Pages → Source: GitHub Actions**.
4. push, or run the `entries` workflow by hand. your site is at
   `https://<you>.github.io/manicule/`, refreshed daily at 06:17 UTC.

your marks stay in your browser and your links. if you want the ranker without
a website, skip this and use the CLI above.

## Tests

```bash
uv run pytest -q && node --test tests/rank.test.mjs
```

`tests/fixture.json` is hand computed. Python and JavaScript both check it, so
the two rankers can't drift.
