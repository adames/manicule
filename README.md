# manicule ☞

Rank what's new by what you've kept.

No database, no server, no account. One Python file for your own feeds, and a
static demo page. Your taste never leaves your browser.

## The whole method

```
score(entry) = cos(entry, kept) − λ · cos(entry, dismissed)
```

`kept` is the mean embedding of what you marked. `dismissed` is the mean
embedding of what you waved off. Two averages and a subtraction. No training.
The only knob is λ (default 0.25), which keeps a dismissal a nudge, not a veto.

Entries are embedded from headline plus a short blurb, locally, with
[fastembed](https://github.com/qdrant/fastembed) (`BAAI/bge-small-en-v1.5`,
384 dimensions). Nothing kept yet: the list stays newest first. No text: the
entry sinks to the bottom, never dropped. Every score is shown decomposed.

The idea comes from [Commonplace](https://github.com/adames/commonplace):
highlighting something was the signal, a rating you never had to give, and an
explicit dismissal could overrule it.

## Your own feeds

```bash
uv sync
uv run manicule.py rank feeds.opml --kept ~/notes/kept --dismissed ~/notes/nope -o today.md
```

`--kept` is any folder of `.md`/`.txt`. An Obsidian folder, saved articles,
whatever you have. Put it on a cron and read `today.md` with coffee.

## The demo

`site/` is a static page. A GitHub Action rebuilds `site/corpus.json` daily
(`manicule.py corpus feeds.opml`) from the mixed sample in `feeds.opml`: code,
science, essays, podcasts, sports, food, games. Mixed on purpose, so marking
two things visibly reorders everything. Vectors ship int8; the browser does the
math in `site/rank.js`. Marks live in the URL. Nothing is stored anywhere.

A demo, not a library. No accounts, ever.

## Make it yours: fork it

The hosted page ranks my feeds. For yours:

1. **Fork** this repo.
2. Replace **`feeds.opml`** with yours (any reader exports one; each
   `<outline xmlUrl="…">` is a feed).
3. In the fork's settings, **Pages → Source: GitHub Actions**.
4. Push, or run the `corpus` workflow by hand. Your site is at
   `https://<you>.github.io/manicule/`, refreshed daily at 06:17 UTC.

Your marks stay in your browser and your links. Nothing comes back here. If you
want the ranker without a website, skip this and use the CLI above.

## Tests

```bash
uv run pytest -q && node --test tests/rank.test.mjs
```

`tests/fixture.json` is hand computed. Python and JavaScript both check it, so
the two rankers can't drift.
