# Groundwork

Running and hiking analytics. Data arrives as a table transcribed from a Garmin
screenshot and pasted in. Everything else is computed.

## The eight files that serve the site

```
index.html   app.css   sw.js   manifest.json
calc.js      store.js  parse.js  ui.js
icon-192.png  icon-512.png
icon-maskable-192.png  icon-maskable-512.png
```

**Runs only.** Hiking and Body were stripped out in September — the scope had
got ahead of the use. Both are in the repo history if either needs to come
back; nothing about the data model prevents it.

No folders. GitHub mobile drops subfolders silently.

`backfill.json` and `Code.gs` sit alongside them but aren't loaded by the page.

```
calc.js       all maths and the activity model. Pure functions, no DOM.
store.js      storage behind an adapter — local now, Sheets later
parse.js      paste parser, validation, and merging for replace
ui.js         rendering and interaction
app.css       design tokens; colour means heart-rate zone and nothing else
sw.js         service worker — BUMP `CACHE` ON EVERY JS OR CSS CHANGE
Code.gs       Apps Script backend, for when you move to Sheets
backfill.json 16 runs from Oct 2025 – Aug 2026 plus both field tests
```

## Aerobic pace

Aerobic cost is heart rate × pace: a real measurement in an unreadable unit.
Divide it by a fixed heart rate — the top of Z2 — and it becomes **the pace you
would hold at that heart rate**.

```
8:14  8 Oct 2025      6:51  17 Nov 2025      7:10  13 Aug 2026
```

**The reference is pinned at 145, not derived from your zones.** It used to
follow the top of Z2 — which meant that dropping your resting heart rate, the
thing getting fitter does, rescaled every pace you had ever recorded and made
them all look slower. The metric would have punished the adaptation it exists
to detect.

Pinned, it is simply a unit: cost expressed in min/km, comparable forever. The
zones still move freely for the work they actually do. `suggestedPaceRef` will
offer a re-pin if the anchors drift far enough, but never applies one silently.

On charts, **faster is plotted higher**, so a rising line always means progress.

## Drift

Cardiac drift is heart rate creeping up while pace holds. **The opening
kilometre is excluded** — heart rate climbing from rest at the start of a run is
not drift, and counting it makes every run look like it drifted.

Your 11 Aug laps were 122 · 141 · 146 · 143 · 144. Including the first gave
+12. Excluding it gives **0** — the run was flat.

The cost: three laps are needed after dropping the opening one, so drift wants a
four-kilometre run. Shorter runs say how many more they need.

Laps tagged with explicit warm-up / main / cool-down roles are trusted as
tagged, and nothing extra is dropped.

**Anything within 3 bpm reads as "flat" rather than as a number.** A hill in
the first or last third of a run moves drift about that much on its own, so a
figure inside that range is terrain, not physiology. Only ±4 and beyond is
reported as a value.

## What the session was meant to be

Every run can be tagged: easy, long, recovery, steady, tempo, intervals, race.
Chips in the preview and on the edit screen, and the name defaults from the tag
("Recovery · 12 Oct") so there is nothing to type. A name you type yourself
wins, and a paste never overwrites either.

The tag is worth more than a place name, because it lets a run be judged
against **its own intent** rather than a general rule:

- a recovery run spent in Z2 → *"A recovery run, run like one — 100% in Z2."*
- a recovery run spent above it → *"You called this a recovery run, and 73% of
  it was above Z2."*
- a tempo run spent above it → nothing. That was the point.

No verdict at all without a tag or without lap heart rate. The app doesn't
guess what you meant.

## The rolling window

At two runs a week a calendar week holds two sessions. One tempo run drops the
Z2 share from 95% to 30% on no change in behaviour, and every Monday the sample
resets to nothing.

So on the **current** period the Z2 hero rolls over **28 days** — eight or nine
sessions, and always "now". It says `In Z2 · last 28 days`, and under four runs
it says `only 3 runs so far` instead of presenting itself as a verdict.

On an **older** period it describes that period and says so. A rolling window
anchored to today would be meaningless on a month you are scrolling back to.

The weekly figure stays in Time in Zone, because that one is supposed to be
sensitive.

## What belongs to the period, and what doesn't

Scoping the hero to the period on screen fixed one bug and introduced three,
all of the same shape: things that are facts about **your history** were being
recomputed inside the selected period.

- **Comparable runs** are runs of a similar length across everything you have
  logged. Scoped to the week, the same run said "3 other runs around 5.8 km"
  in Year view and "nothing to compare it to yet" in Week view.
- **The previous run** is the run before this one, full stop — not the previous
  run inside the week.
- **Which run the hero shows** *is* a property of the period, and stays scoped.

The rule: a period selects **which run you are looking at**, never **what it is
measured against**.

## Looking back

The ribbon starts no earlier than your first run, so the Year view no longer
draws a decade of empty bars, and it always ends at **now**, whatever period is
selected. Selecting
September used to make October vanish, which read as lost data rather than as
scrolling back. If the selection is older than the twelve periods shown, the
window extends to reach it.

The hero takes its run from **the period on screen**. Built from every run, it
showed October's pace and October's session note under a title that said
September.

## The period selector means one thing

Selecting a period used to change the title, the ribbon, the heroes, the zone
bar and the list — while **Form and the trend chart stayed in the present**.
Two thirds of the screen ignored the selector, so a 2025 view showed today's
form and plotted 2026 runs under an x-axis labelled "19 OCT".

Now every section answers the same question. `readRows` takes the period's own
start and end, so Form reads that period and names itself *Form · 2025*. The
trend ends at the period, showing history as it stood then. And a period with
no runs shows nothing rather than borrowing the most recent run from outside
it — the empty path had the same cross-period leak as the full one.

The totals agree with each other too: either all three rows carry a comparison
or none does, with one line saying why.

## Markers live outside the stretched space

The plot's viewBox is 100×100 stretched to the container's width, so an SVG
`<circle>` inside it renders as a wide ellipse — single-run blocks read as grey
smudges. Markers are HTML elements positioned by percentage instead, where a
circle is a circle.

And one point is not a trend: a chart with a single run on it used to draw an
axis with one dot, which says nothing the hero has not already said.

## The whole split is always readable

A zone segment under 7% is too narrow to carry a label, so the visible numbers
stopped short of 100 — which reads exactly like the rounding bug that was
already fixed. Each zone's share now sits in the key beneath the bar, so the
split always adds up in plain sight even where a sliver cannot be labelled.

## The chart does not spend width on months before you ran

The 2026 view ran 1 January to 21 October with nothing logged before August, so
three quarters of the chart was blank. It starts at the first run in range
instead — 71 days rather than 293. Gaps *between* runs are kept, because those
are the part worth seeing.

## Best efforts

Fastest 1, 2, 3, 5, 10, 15, 21.1 and 42.2 km, taken from per-kilometre laps.
Shown on each run with the laps they came from, and marked **PB** where the
run holds the all-time best.

Three things worth knowing about the method:

- **Laps, not a rolling window.** Strava reads a GPS stream, so its best 5 km
  can start mid-kilometre. This is the fastest five *consecutive laps*, which
  is a shade slower. The app says so on screen rather than claiming a number it
  does not have.
- **Only whole laps count.** A 0.43 km final lap is not a kilometre, and
  counting partials would make nearly every run look like a personal best.
- **Races count here**, unlike aerobic pace. The fastest you have run 10 km is
  the fastest you have run it, however you came by it.

## Bounds: impossible blocks, unusual warns

A range was doing two incompatible jobs — catching a mistyped 1400 for 140, and
describing what a normal run looks like. An 8.37 km climb with 414 m of ascent
at 12:48/km has a cadence of 89, which is real, and the app refused to record
it with no override.

- **POSSIBLE** is physics. Outside it the reading is wrong and the record is
  refused.
- **PLAUSIBLE** is typical. Outside it the app says so and **saves anyway**.

`checkBounds` is the only place a value meets its bounds. The edit screen used
to carry its own copy with different numbers — 30–220 for heart rate where the
parser said 20–250 — so the same value could be accepted by a paste and refused
by an edit.

## A change reads in its own units

A percentage of a percentage is nonsense, and a percentage of a near-zero
baseline is worse: drift improving from +15 to 0 showed as **100%** when the
story is fifteen beats. `deltaAs` is declared on the metric — seconds for pace,
bpm for drift, points for Z2, days for consistency — so no render site chooses,
which is how the wrong default got applied in the first place.

## Parts of a whole sum to the whole

Rounding each zone share on its own gave **95%** on real data and 99% on any
even three-way split. `sharesOf` uses largest remainder, so the segments always
total 100.

## The chart is placed in time

Points were spaced by index with a minimum width per block, which inverted the
moment there were several blocks: three single-run blocks took 12% of the width
each while a fourteen-run block took 5%, and the gutters between them took 35%.
The chart described how the data was grouped rather than the running.

**x is now the date.** A gap is blank because nothing happened then, which is
the honest picture and needs no gutter at all. A block of one run is drawn as a
point. The range follows the period, with a 120-day floor so a single week
still has enough history to be a trend.

## A race is not a measurement of aerobic pace

Aerobic pace claims to be what you would hold at 145 bpm, and a five-hour
marathon at 156 bpm is not that. It was setting the 2024 headline, sitting in
the trend, and holding the all-time best.

Races are excluded from the hero, the trend, the best, the Form row and the
length-band comparison. They are kept in the list (marked **RACE**), the
totals, the load and the zone split — and in **drift**, deliberately, because
how much you faded over a race is exactly when drift is worth knowing.

## Every period with data is reachable

The ribbon ran a fixed twelve bars, so backfilling 2024 put ten of its months
beyond reach from Month scope. It now spans from your first run to now and
scrolls past thirteen bars, with the selected period scrolled to the centre.
Week is capped at 52 on purpose — scrolling back two years week by week is not
navigation.

## One denominator

Three places worked out a zone share, and two of them counted time whose zone
was **unknown** into the total. The same 24:59 therefore appeared as:

- **12%** in the zone bar — divided by known + unknown
- **71%** in the caption underneath — divided by known only
- **0%** in Form — divided by known + unknown again, in `zoneShareSeries`

All three were "correct". None of them agreed.

Unknown time is not a zone. `z2Of` counts only time whose zone is known, and
the bar and the weekly series now both go through it. How much of a period
lacks lap heart rate is reported **in words**, where it can be explained —
*"From 35:08 of 12:43:37 with lap heart rate"* — rather than drawn as a grey
slab competing with the real zones.

`tests/architecture.js` fails on any `reduce(...) + tz.unknown`, and checks
that `z2Of`, the weekly series and the model return the same number for a
period containing both kinds of time.

### And a window that ran past the data

Form for a past period ended at the calendar edge, so the last three weeks of
2025 were empty and a year with fourteen runs reported **0 days / week**. It
ends at the last run in the period instead.

## A component exists once

The clipboard button was built on the import screen and not on Replace. Same
mistake, different corner: a thing made at one call site instead of made once.

`pasteBoxHTML` and `bindPasteBox` are now the only paste box in the app, and
`tests/architecture.js` checks that no screen draws its own, that every box
drawn is also wired, and that `navigator.clipboard` is touched in exactly one
function.

## Impossible values are derived, not listed

Garmin writes **0 spm** for a run with no cadence sensor. Stored as a value
rather than an absence, it failed its own range check and made the record
impossible to save: *"cadence_spm would become 0"*, with no way to clear it.

`impossibleZero(key, value)` asks whether zero falls outside that field's own
range in `RANGES`. Nothing new to maintain, and no way for a field to be in one
list and not the other. Zero ascent and zero degrees stay, because zero is a
real reading for both.

And a change where both sides are empty is not a change — `null` and
`undefined` are one absence now, so the diff stopped listing `resting_hr — → —`.

## One model

Ten rounds of coherence fixes all had the same cause, and it was architectural
rather than any particular mistake.

Values were computed in `calc.js` but **scoped in `ui.js`**, at twenty-one
separate sites. Each render function decided for itself which activities to
look at, over what window, and whether there was anything worth showing — and
they disagreed. That is the whole explanation for three Z2 figures on one
screen, for Form showing today under a title that said 2025, for a zone bar
above a caption denying it existed, and for a comparison that existed in Year
view and not in Week view.

Fixing them one at a time never finished, because each fix touched one site
while the same mistake sat untouched at the others.

`Calc.homeModel(all, cfg, scope, key, today)` now makes every one of those
decisions **once**, and returns everything the home screen needs:

- which runs are in the period, and which run the heroes describe
- what that run is measured against — always the whole history, never the
  period
- Z2 rolling over 28 days on the current period, the period itself otherwise
- the zone split, the trend, Form, the ribbon, the week strip
- each value wrapped in `stat()`, which carries its own **window label** and is
  either present with a value or absent with a reason, never both

`renderHome` builds the model and passes it down. Below that, nothing can see
raw activities — so nothing can invent a window, because it is never given the
data to scope.

`tests/architecture.js` enforces this by reading the source: every renderer is
checked for `Store.all()`, `real()`, `inPeriod`, `readRows`, `paceSeries` and
the rest. It fails the moment anyone reaches past the model, and it found a
modelling flaw the hour it was written — `stat()` was keeping an absence reason
alongside a present value.

## Invariants

Every bug in the last few rounds was the same bug: **the app failing to notice
it had nothing to say.** A zone bar made entirely of unknown time. A unit with
no number in front of it. A gap counter running to its cap. Each was found by
eye, one screenshot at a time, and each fix was applied at one call site while
the same mistake sat untouched at two others.

`tests/invariants.js` is the answer to that. Thirteen deliberately awkward
datasets — nothing at all, one run, laps without heart rate, no heart rate
anywhere, a year-long gap, everything on one day, a 400-metre run, a 62 km run,
sessions tagged but not matched — rendered at **every scope, every reachable
period, every detail screen and Setup**, and checked against rules that hold
whatever the data:

- no `NaN`, `null`, `undefined` or `Infinity` reaches the screen
- no unit appears without a value
- no plot renders without a line
- no zone bar is made entirely of unknown time
- no percentage falls outside a sane range
- no period count runs into the hundreds
- nothing says "1 days"
- no two statements on one screen contradict each other
- the error boundary never fires

That is roughly 3,400 checks, and it found two live bugs the moment it was
written — both of them repeats of ones already fixed elsewhere.

The fixes were made in the shared renderers rather than at the call sites:
`zoneBarHTML` now decides for itself whether it has anything to show, and a
single `heroHTML` renders a value and its unit together or not at all. "— %"
and "—/km" were the same mistake written twice.

## Nothing is drawn that cannot be read

A period can contain runs and still contain no zone information, and that case
produced four separate absurdities at once in the 2025 view:

- a zone bar **100% grey**, directly above a caption saying there was no zone
  split — because unknown-zone laps were counted into the total that decided
  whether to draw the bar at all
- a Z2 hero reading **"— %"**, a unit with nothing in front of it
- **"nothing for 400 years before this"**, the gap counter running to its cap
  because there was no history to stop it
- selecting 2025 **redrawing a decade of empty years**, because reaching back
  to the selection overrode the trim meant to prevent exactly that

The rules now: only laps with a known zone decide whether a split exists, a
hero with no value carries no unit, a gap is counted only back to your first
run, and reaching for an older selection never widens the chart past the trim.

Where lap coverage is partial the caption says so with both figures — *"45% in
Z2 this year. From 1:02:13 of 1:44:01 with lap heart rate."*

## One number, one window

The same screen once showed 29%, 33% and 29% for what any reader would take to
be a single figure. They were three correct answers over three different
windows — the period, the last three runs, the period again — computed in five
separate places, none of them labelled.

The fix was structural rather than cosmetic:

- **`z2Of(laps, cfg)` is the only place Z2 share is worked out.** `z2Share`,
  `z2Typical`, `intentCheck`, `sessionNote` and the zone caption all call it.
  There is no second implementation to drift.
- **Every figure names its window** — "In Z2 · this week", "last 3 runs · 29".
  A number without a window is a number that will eventually contradict
  another one.
- **Tone is a property of the metric, not of the render site.** `neverBad` is
  declared once on the Z2 row and `delta()` honours it everywhere. Z2 falling
  is a choice, not a failure — it used to go red in Form while the hero
  correctly stayed amber.
- **`sessionNote()` is shared by the home screen and the detail screen**, so
  they cannot disagree. The home note used to call a run tagged *Tempo* "a
  tempo run, not base work" — telling you off for following your own plan.

`tests/coherence.js` asserts this at the level the bug lived at: it renders the
whole screen, extracts every Z2 figure, and fails if any lacks a window or
contradicts another.

## Two heroes

Aerobic pace alone rewards speed. Worse, it is measured at a fixed 145 bpm, so
it improves fastest when you train **above** Z2 — the opposite of base work.
An app with that as its single largest number quietly coaches against the
thing it is meant to support.

So the top of the screen is a pair at equal size: **aerobic pace** on the left,
**share of time in Z2** on the right. The share is the method; the pace is the
evidence the method is working. Neither is useful alone — Z2 share is a choice
you could satisfy by walking, and pace with no zone context is just effort.

The share carries the colour, and it genuinely inverts: a slow run with a high
Z2 share reads green and says so (*"slower than your usual at this length —
which is what base work is"*), while a personal best spent above Z2 reads amber
and is named a tempo run. Never red; sometimes a tempo session is the point.

The target lives in Setup and defaults to 70%. That is a base-building
convention, not a law.

## A count, not a streak

Under the weekly chart: *"7 of your last 10 weeks cleared 70% in Z2."*

Deliberately not a streak. A chain that resets on one disrupted week is a
punishment, and a week broken by work is not a training failure. A count dents;
it doesn't collapse.

## Time in zone

The bar shows **share**, with the exact duration beneath it. "23:18 in Z2"
means nothing until you know what it was 23:18 out of, and base work is judged
as a proportion of the session.

Z2 is set larger than the others, because that's the zone being trained for.
Underneath, the Z2 share is compared against the median of the last eight
periods that carried lap heart rate — so a session reads against your own
habit, not against a number someone else picked. Fewer than three such periods
and it says nothing.

## The type scale

Seven steps, declared once in `:root`, and nothing off them:

```
--t-display 48   the one number that matters
--t-title   24   page title
--t-lead    19   detail title, large metric values
--t-strong  16   row values
--t-body    13   prose, rows, section heads
--t-label   11   secondary labels, deltas, chips, captions
--t-micro    9   mono axis, meta, lap figures
```

There were eighteen sizes before, ten of them between 9 and 13px. That is not a
scale, it is accumulated decisions. Where two things sit at the same step they
differ by weight, colour or case — never by a fractional point size. A test
fails if a literal `font-size` in px appears anywhere in the stylesheet.

No italics. At these sizes on a dark ground they cost legibility and buy
nothing; emphasis is colour and weight.

## The weekly chart

One chart, not two. Bar height is **load**, the fill is **time in zone**, and
tapping a bar selects that period. It used to be two nearly identical weekly
bar charts at opposite ends of the screen — volume at the top, load at the
bottom — saying overlapping things. The ramp warning moved here with it.

The seven-day strip beneath it only appears in week scope.

## Form

Each dimension sits on a track running from your worst to your best over the
last 12 months, with a band for recent typical and a dot for now. Direction
tells you whether you're improving; position tells you how good it is in your
own terms. Windows are the last 3 against the 3 before.

A dimension with fewer than two observations has no range and gets no track —
it collapses into one line with the others still waiting.

## Load

Banister TRIMP: minutes weighted by heart-rate reserve, exponentially.

```
HRr   = (avg HR − resting) / (max − resting)
TRIMP = minutes × HRr × 0.64 × e^(1.92 × HRr)
```

It needs only average heart rate and the two anchors, so every run already
logged has one. The exponential is the point:

| | | |
|---|---|---|
| 13 Aug | 22 min @ 143 | **36** |
| 8 Oct  | 35 min @ 124 | **34** |
| 29 Nov | 93 min @ 142 | **146** |

A 22-minute run and a 35-minute one cost the same because the shorter was 19
beats harder — the thing distance can never tell you.

**Session RPE** (minutes × your 1–10 rating) is stored alongside where you've
recorded an effort. It comes from you rather than the watch, so where both
exist they cross-check each other.

Weekly load is flagged when it rises by half again or more. Flagged, never
judged — a jump can be exactly what you meant. There is deliberately **no
acute-to-chronic ratio and no fitness/freshness curve**: both need consistent
daily training and a load model that is genuinely contested.

## The week strip

Seven days under the header. Height is load, colour is the zone that day mostly
sat in, rest days are a faint rule rather than a gap. Answers "am I being
consistent" and "how hard was it" in one row.

## Importing

One paste box. Pipes, commas or tabs all parse — Gemini varies its output and
the app doesn't care.

Absent fields keep their stored value on a replace, a field written as `—`
clears it, and **name, source and note are never touched by a paste**.

## The noticing card

Appears only when a run beats the median of your last six by more than twice
their spread, with at least four prior runs and a six-second floor on the
spread so an unusually consistent stretch can't make everything look
significant. Compared within your ±20% length band where there's enough data.

Silent otherwise — no card, no placeholder. It shows its working so you can
disagree with it.

Checked against real history: fires on 17 Nov 2025, silent on 1 Dec.

## Feedback

Every action confirms. Buttons go busy mid-flight, and a second tap while one
is running does nothing — disabling alone doesn't stop a fast double-tap, so
there's an in-flight flag behind it. A run once got added twice because saving
completed in silence.

Navigation writes to browser history, so Android's back button and edge-swipe
go back a screen rather than leaving the app.

## Duplicates

Same type and date, and either the distance within 2% or the duration within a
minute. Distance alone was too strict — a re-paste where Garmin rounded
differently slipped through and landed as a second copy.

## Comparing like with like

The hero's delta compares against runs within 20% of the same distance, and
only once there are three of them. A 7.5 km against a 3 km is mostly a
distance effect — colouring that red would be a lie. With too few peers it says
so rather than inventing a comparison.

## Against runs this length

On the detail screen: where a run ranks among others within 20% of its
distance, the median of the rest, and the best at that length. A pace means
nothing until you know what it's relative to, and a 3 km and a 12 km are not
the same job.

## Editing

**Edit** — every field plus a lap table, validated exactly as an import is.

**Replace from paste** — paste a full table or only the lap rows. Absent fields
keep their stored value, a field written as `—` clears it, and **name, source,
conditions, pack and note are never touched by a paste**. You approve a diff,
not a re-import.

## Deltas

Arrows carry colour only where a direction is defensibly better — aerobic pace,
drift, ascent rate, resting HR, cumulative ascent. Weekly volume gets a grey
arrow: a short week might be a recovery week.

`--good` and `--bad` sit outside the zone ramp so a green arrow is never
mistaken for a Z2 block.

## Precision

Computed on unrounded values, displayed at the precision the unit deserves, and
parts always sum to the whole. Time in zone reads `7:12 · 23:04 · 11:25` and
adds to `41:41` — never `7′ · 23′ · 11′` making 42 minutes.

## Tests

```
node tests/harness.js       99 assertions — maths and parsing, on real data
npm install jsdom
node tests/integration.js   77 assertions — boots the UI and drives it
node tests/charts.js        54 assertions — charts, Form, deltas
node tests/load.js          39 assertions — load, the week strip, the importer
node tests/body.js          49 assertions — day records, the weekly paste, the anchor
```

## Sheets

Local is the working copy — instant, offline, always readable. Sheets is the
durable copy, and the whole point of it is that a browser clearing its storage
no longer loses anything.

**The rule that matters: a fetch from Sheets never deletes local data.** An
empty sheet gets pushed to rather than copied from; an unreachable one leaves
the phone alone and records the error. Both are tested.

Writes go to both. When the network isn't there the local write still lands and
the remote one queues; the queue flushes on the next load.

A row present in both is resolved by `updated_at`, newest wins.

### The connection survives a storage clear

Android cleared this app's storage four times, twice after it was installed to
the home screen, so `navigator.storage.persist()` is not a guarantee. The fix
is not to depend on browser storage for the one thing that makes recovery
possible.

The web-app URL and token are looked for in three places, best survival first:

1. **`sheets.json`, deployed with the site.** Cannot be evicted, works on a
   device that has never seen the app. Fill it in and commit it and you never
   retype anything again. The trade: it is served publicly, so anyone who knows
   your Pages address can read it. For run data that is usually an acceptable
   swap; rotate the token with `makeToken()` if you change your mind.
2. **IndexedDB.** Survives most clears. Written on every boot, not just at
   setup — a copy only written once is no copy at all.
3. **localStorage.** The working copy, and the first thing evicted.

Whichever answers first wins and is written back to the others. Setup says
which one it came from, and whether the browser has agreed to keep this app's
storage.

`restore()` can never reject. It runs before the first render, so a failure
there would show a blank screen; with no `fetch` and no IndexedDB the app still
boots and simply reports sync as off.

### Connecting it

1. New Google Sheet → Extensions → Apps Script → paste `Code.gs`
2. Run `setup()` — creates the Activities, Laps and Config tabs
3. Run `makeToken()` if you want one — leave it and the endpoint is open to
   anyone holding the URL
4. Deploy → New deployment → Web app, execute as **Me**, access **Anyone**
5. In the app: Setup → Sheets → paste the `/exec` URL and the token → Save and sync

No code change needed. The URL and token live in localStorage, deliberately
outside the synced config so they can't be overwritten by a pull.

## Settings that matter

- **Max HR / resting HR** — the Karvonen anchors. Every zone follows them.
- **Export** — until Sheets is wired, this device is the only copy.

## Still to come

Icons. Block-overlay chart. Drift over time, once five runs carry lap HR.
