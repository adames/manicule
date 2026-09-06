# ☞ manicule

remember your tastes

no database, no server, no account needed. One Python file for your own feeds, and a
static demo page

## The whole method

```
score(entry) = cos(entry, kept) − λ · cos(entry, dismissed)
```

`kept` is the mean embedding of what you pointed at. `dismissed` is the mean
embedding of what you passed on. Two averages and a subtraction (and a λ)

λ is how much a pass counts. 0.25 by default, so it's a nudge. push it to 1.0
and a pass weighs as much as a point.

entries are embedded from headline plus a short blurb, locally, with
[fastembed](https://github.com/qdrant/fastembed) (`BAAI/bge-small-en-v1.5`,
384 dimensions). nothing leaves your machine but the feed fetches.

point at nothing and there's no taste to rank by, so it stays newest first. an
entry with no words sinks to the bottom, but it never gets dropped.

the idea comes from [Commonplace](https://github.com/adames/commonplace), an
unreleased library I was developing

## Your own feeds

```bash
uv sync
uv run manicule.py rank feeds.opml --kept ~/notes -o today.md
```

`--kept` is any folder of `.md`/`.txt`. An Obsidian folder, saved articles,
whatever you have. point it at notes you already keep, not a folder you
maintain for this.

there's a `--dismissed` too, for a folder of things you passed on. most
people won't have one, and the ranker doesn't need it.

Put it on a cron and read `today.md` with coffee.

## The demo

`site/` is a static page. A GitHub Action rebuilds `site/corpus.json` daily
(`manicule.py corpus feeds.opml`) from the mixed sample in `feeds.opml`: code,
science, essays, podcasts, sports, food, games. mixed on purpose, so marking two
things visibly reorders everything. Vectors ship int8; the browser does the
math in `site/rank.js`, same math as the Python. Marks live in the URL, so a
link is a taste.

## Make it yours: fork it

The hosted page ranks my feeds. For yours:

1. **Fork** this repo.
2. Replace **`feeds.opml`** with yours (any reader exports one; each
   `<outline xmlUrl="…">` is a feed).
3. In the fork's settings, **Pages → Source: GitHub Actions**.
4. Push, or run the `corpus` workflow by hand. Your site is at
   `https://<you>.github.io/manicule/`, refreshed daily at 06:17 UTC.

Your marks stay in your browser and your links. If you
want the ranker without a website, skip this and use the CLI above.

## Tests

```bash
uv run pytest -q && node --test tests/rank.test.mjs
```

`tests/fixture.json` is hand computed. Python and JavaScript both check it, so
the two rankers can't drift.
