# names

one vocabulary for manicule: the site, the code, and the two files that shape
the pool. four were chosen separately and in one day. this is what they are,
where they disagree, and what to do about each. everything in it is
applied and marked **done**.

## the shape

three layers, and each word belongs to exactly one.

| layer | who reads it | the words |
|---|---|---|
| shelves | the curator | `feeds.opml` categories. never printed, ignored by the code. |
| labels | the reader | `labels.txt`. what a taste is said to be about. |
| the page | the reader | pick · pass · press · taste · average · spread · order by taste · reset · λ · near your pick |
| the code | us | the page's words, in `snake_case` and `camelCase`, and nothing the page would not say |

shelves and labels do not share a spine and should not: a shelf is a decision
about what to fetch, a label is a claim about where an average points. "code +
ai" is a good shelf and a bad label. but the labels file should be *organised
by* the shelves, so a curator adding a shelf can see at once whether the page
has words for it. **done**: `labels.txt` is now sectioned by shelf name, every
label kept, three exact duplicates dropped (`running` beside `running and
marathons`; `television` beside `tv shows and streaming series`; `linux and
open source`, said twice already).

## the shelves

24 shelves for 462 feeds. two were wrong and are fixed; the rest hold.

- **done** `art + history` is gone. it was ten feeds, three of which were not
  art, and there was already a `history` shelf of nineteen. now `art`, with
  the paris review on `books + writing`, the public domain review on
  `history`, atlas obscura on `travel`.
- `photography` beside `art`: keep. twelve feeds with their own magazines is a
  shelf, not an overlap.
- `nature + outdoors` beside `science`: keep. one is climate, birds and the
  hills; the other is physics and maths. the overlap was only in the name.
- `craft` beside `making + engineering`: keep. wood and cloth against
  electronics and bridges.
- `podcasts` is the one shelf named for a medium rather than a subject. it
  holds, because it is how a curator finds them; the page never says the word.

## the labels

228 lines, and the header already says the one rule: name a field, not a
thing in it. two lines broke the rule the header itself gives as its example
and are gone (**done**):

- `the go programming language`. the header says a rust label of that shape
  "took the go blog". a go label of the same shape will take something else.
  suggest dropping it; `programming languages and compilers` catches the
  blog.
- `podcasts`. a medium, not a subject. an average of episodes is about what
  the episodes are about. a taste that lands here gets a non-answer.

## the page against the code

most of it agrees, and the agreement is worth stating so nobody "fixes" it:

- **press** is the act; **pick** and **pass** are the states it leaves. the
  README, the control's own label ("picked, press again to pass") and
  `press()/unpress()` all say it that way. keep.
- **spread** is a noun on the page ("a spread of what is here") and
  `spread()` in the build. same thing. keep.
- **about**: python `about()` returns the label; the javascript `describe()`
  returns the label as `.labels`, plus words, focus and happening. the CLI only
  prints the label. one name for the part and one for the whole is right.
  keep.
- **mirror**, **carry**, **borrowed**, **hand**: code-only words for things
  the page never names. fine as long as they stay there.

three places disagree.

1. **"taste" means two things.** the formula is two averages, a picked side
   and a passed side. the page numbers the picked side's averages
   "taste 1 · taste 2" and the status line says "in 2 tastes". the code's
   `Taste` is the whole list of averages on one side, and the header comment
   in `rank.js` said "a taste is two averages". so a reader has tastes,
   plural, each one average. **done**: the comment now says what the page
   says. the identifiers stay: `Taste` is a side, and `one` inside it is what
   the page calls a taste, which the comment spells out. the README already
   agrees ("one line an average").
2. **one thing, three names.** the map of picked ids to vectors is
   `picked_ids` in python, `pickedById` in `rank.js`, `pickedVectors` in
   `feed.js`. **done**: `feed.js` says `pickedById`.
3. **"feed" is the page and the source.** `method.html` says, in one
   paragraph, that "the feed stays newest first" and that the test hides
   "the feed a post came from". the tab, the title and `feed.js` are the page;
   the column in every row and "462 feeds" are sources. the source meaning
   cannot move, readers know what an rss feed is. the page can: everything
   under it is already called **posts** (the tab count, the skip link, the
   workflow, `posts.json`, the `posts` subcommand), but they are not posts, they are
   feed items, and the set of them already has a name in the copy and the
   code: the pool. **done**: the tab reads `pool 1626 · method · fork`, the
   title is `manicule · pool`, the script is `pool.js`, and copy that meant
   the page says "the pool". the pitch line, "a feed that reorders around what you point at", stays: there
   it is the product, not the tab.

## the kinds

`article | video | podcast` in the data, `web · vid · pod` on the row,
`WEB VID POD` in the CLI. the cut is right: it answers "can I do this on a
train", read, watch or listen, and nothing else about a post is worth a
badge. the names are not: "article" is a genre and "web" a place, while the
other two are media. the detector decides by medium (a youtube link, an audio
enclosure), so the honest names are the media. **done**: `text | video |
audio` in the data, and the row and the CLI print the word as it is, so
there is no table at all.

## the product and the pages

**manicule** is the product and the repo; the hand is its mark; the pitch is
"remember your tastes". holds. of the three tabs, **method** and **fork**
hold: one is how, the other is yours. `fork` also covers the CLI, which is not
a fork, but its h1 is "make it yours" and that covers both. the tab word is
the github verb because that is what most readers will do. the third tab is
question 3 above.

## dead

`demo_taste()` and `DEMO_SKIP` still write a `demo` key into `posts.json`
that nothing read: the cold page is the spread now. **done**: both gone,
and the key with them.
