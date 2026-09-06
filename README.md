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

It is a demo, not a library. There are no accounts and there never will be.

## Make it yours: fork it

The hosted page ranks *my* sample. To rank *your* feeds, with your marks
persisting on your own Pages site:

1. **Fork** this repo.
2. Replace **`feeds.opml`** with yours (any reader exports one; each
   `<outline xmlUrl="…">` is a feed).
3. In the fork's settings, **Pages → Source: GitHub Actions**.
4. Push, or run the `corpus` workflow by hand. Your site is at
   `https://<you>.github.io/manicule/`, refreshed daily at 06:17 UTC.

Your marks stay in your browser and your links; the corpus is committed to
your repo by the workflow. Nothing comes back here. If you want the ranker
without a website at all, skip all of this and use the CLI above.

## What this taught me about taste

Notes for anyone building a "for you" of their own. Each one is visible in
the code.

- **Use the signal people already produce.** Ratings are sparse and noisy;
  a highlight, a keep, a re-read is honest and free. In Commonplace the
  positive signal was inferred from *annotating* something — a rating the
  reader never had to give. Here it's the `--kept` folder: whatever you
  already save.
- **Explicit beats implicit; a dismissal beats a highlight.** Write the
  precedence down so the system never contradicts the person. And never
  *infer* a negative — a dismissal is always a deliberate act.
- **Two averages beat a model at this scale.** A centroid is explainable,
  needs no training, updates the instant you mark something, and holds no
  model of you that can go stale or leak. Reach for learning only once
  averages demonstrably fail.
- **A dismissal is a nudge, not a veto.** That's what λ = 0.25 encodes.
  Drag the slider on the demo to 1.0 and watch dismissals start bullying
  the list; that feeling is why the default is low.
- **Show the score.** `+0.71 = +0.81 − 0.25×0.41, near "…"` is the
  difference between a feed you trust and one you fight. If you can't
  decompose a score, you can't debug taste — yours or the system's.
- **Cold start is a state, not an error.** With nothing kept there is no
  taste to rank by. Say "newest first" and mean it.
- **Embed the headline and a short blurb, not the post.** A whole post buries
  its subject under boilerplate every item shares (YouTube descriptions are
  mostly sponsor and patron text). `SNIPPET_CHARS = 400`.
- **Embed once, rank from storage.** An item's vector never changes; only
  the centroids do. So embedding happens at fetch time, ranking is pure
  arithmetic, and int8 quantization costs nothing you can feel
  (`test_quantize_preserves_cosine`).
- **Sink, never drop.** An entry with no text scores `-inf` and goes to the
  bottom. Silently removing things is how feeds lose trust.
- **A mixed corpus makes ranking visible.** Seventeen feeds that agree with
  each other would hide the effect entirely. Put sports next to set theory.
- **Where the state lives decides what you are.** State in the URL is a
  demo. State in a fork is theirs. State in an account is a product, with
  every obligation that implies. Pick on purpose.

**Known limit.** One centroid collapses a *plural* taste: like math and
baking and the mean lands between them, scoring both mildly. `rank()`
already computes each entry's nearest kept item for the explanation line;
scoring by that max-similarity instead of the centroid is a one-line change
and the first experiment worth running. It's why the explanation exists.

## Tests

```bash
uv run pytest -q && node --test tests/rank.test.mjs
```

`tests/fixture.json` is hand-computed and checked by both the Python and the
JavaScript ranker, so the two can never drift.
