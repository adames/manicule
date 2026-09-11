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

with one exception, and it is the useful one. a pick that sits near none of
your averages starts another instead of dragging one off its subject, up to
three, and a post is scored against the average it is nearest. cooking and
compilers would otherwise average into a direction pointing at neither. pick
from one subject and it behaves exactly as one average always did.

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

## What a taste is about

the feed says, above the rows, one line an average:

```
☞ taste 1 · 3 picks · about cooking · sourdough, starter, hydration
☞ taste 2 · 1 pick · about tv shows and streaming series · lanterns
```

nobody chose those words and nothing is stored. `labels.txt` is a vocabulary
of things a taste can be about, from "news" down to "nintendo and consoles";
the build embeds every line with the same model as the posts, and a taste is
about whichever label its average sits nearest. the specific words are the
uncommon ones in the headlines nearest the average, and they have to be in at
least two of them. the method page shows the cosines.

it is read off today's pool, so it is as true of a taste carried in by a link
as of one pressed just now. the cli prints the same labels in its heading.

## Does it work

the ranker gets tested against a label it can't see: the feed a post came
from. pick a few posts from one feed, leave the rest in the pile, see where
they land. median rank of the rest, out of 1626, on a recent build:

| picks | the ranker | shared words | newest first | shuffled |
|---|---|---|---|---|
| 1 | 72 | 219 | 687 | 808 |
| 2 | 45 | 92 | 670 | 812 |
| 3 | 38 | 60 | 666 | 813 |

newest first is the same as shuffled. that's the argument for the whole thing.
same feed only stands in for same taste, so read it as necessary, not
sufficient. it runs at every build and the method page prints today's numbers.

the several-averages part is tested against a reader with two unrelated
tastes: pick two posts from each of two feeds that sit apart, and 23 of every
100 held-out posts land in the top ten, against 13 with a single average. a
reader picking from one feed loses nothing.

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

a first visit lands on a spread: thirty posts chosen at build time to sit as
far apart as possible, so whatever you are into, something up there is near it.
pressing a post changes the scores and leaves the order alone; `order by taste`
sorts on them when you ask. λ lives on the method page, next to the paragraph
that explains it.

it installs, too: a manifest and a small service worker, so yesterday's pool
reads on a train.

vectors ship as int8 with one scale each, packed in `vectors.bin` beside
`posts.json`, a fifth the size of the same numbers as text and too small a
rounding error for the ranking to feel. the browser does
the math in `site/rank.js`, the same math as the Python. your taste lives in
the URL, so a link is a taste.

## Your taste is the link

there is no account because there is nothing to keep one for. the ranking only
ever sees your averages, so a link carrying them carries the whole taste — on
any day, against any pool, on anyone's fork. about 1.1KB with one average a
side, 2.1KB with the most it will ever hold.

```
#v=<384 int8, base64>~<scale>~<count>[!another]&w=<the same, passed>&k=<model>&l=<λ>
```

a press folds a post into the average; pressing again takes exactly the same
post back out. the ids in `m=` only tick the boxes, and stop meaning anything
when those posts leave the pool. the averages do not.

an average is worth at most twenty presses against a new one, so a taste cannot
set: come back with two hundred presses behind you and the next one still turns
it by a twentieth.

`k=` is the model that wrote the numbers. a link from a different one is not
wrong, it is unreadable, and the page says so rather than ranking by noise.

keep the link and the taste is yours. bookmark it and your browser syncs it for
you. lose it and it is gone: that is the whole of it, and it is why nothing
here has to hold anything about you.

**a link is a pointer, not a diary.** an average is not anonymous — anyone with
the pool can rank it and see what you would pick — but it does not name a
single thing you read.

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
