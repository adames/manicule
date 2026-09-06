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

`tests/fixture.json` is hand computed. Python and JavaScript both check it, so
the two rankers can't drift.
