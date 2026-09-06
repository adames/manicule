# manicule ☞

A pointing hand for your feeds. Rank what's new by what you've kept.

No database, no server, no account. One Python file for your own feeds, and a
static demo page where anyone can play — their taste never leaves their browser.

## The whole method

```
score(entry) = cos(entry, kept) − λ · cos(entry, dismissed)
```

`kept` is the mean embedding of everything you marked *more like this*.
`dismissed` is the mean embedding of everything you waved off. Two averages
and a subtraction — no training, nothing to tune except λ (default 0.25),
which keeps a dismissal a nudge rather than a veto.

Entries are embedded from their headline plus a short blurb, locally, with
[fastembed](https://github.com/qdrant/fastembed) (`BAAI/bge-small-en-v1.5`,
384 dimensions). If you have kept nothing yet, there is no taste to rank by
and the list stays newest-first. An entry with no text sinks to the bottom
but is never dropped. Every score is shown decomposed, so you can see why a
thing ranks where it does.

The idea comes from [Commonplace](https://github.com/adames/commonplace),
where the signal was inferred from *highlighting* something — a rating you
never had to give — and an explicit dismissal could overrule it.

## Your own feeds

```bash
uv sync
uv run manicule.py rank feeds.opml --kept ~/notes/kept --dismissed ~/notes/nope -o today.md
```

`--kept` is any folder of `.md`/`.txt` — an Obsidian folder, a directory of
saved articles, whatever you already have. Put it on a cron and read `today.md`
with coffee.

## The demo

`site/` is a static page. A GitHub Action refreshes `site/corpus.json` daily
(`manicule.py corpus feeds.opml`) from the deliberately mixed sample in
`feeds.opml` — code, science, essays, podcasts, sports, food, games — so
marking two things visibly reorders everything. Vectors ship int8-quantized;
the browser does the math in `site/rank.js`. Marks live in the URL, which
makes a taste shareable and means nothing is stored anywhere.

## Tests

```bash
uv run pytest -q && node --test tests/
```

`tests/fixture.json` is hand-computed and checked by both the Python and the
JavaScript ranker, so the two can never drift.
