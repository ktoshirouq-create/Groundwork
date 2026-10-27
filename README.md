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

*Superseded for closed periods — see "A finished period is a summary" below.
What follows still holds for the period you are in.*

Now every section answers the same question. `readRows` takes the period's own
start and end, so Form reads that period and names itself *Form · 2025*. The
trend ends at the period, showing history as it stood then. And a period with
no runs shows nothing rather than borrowing the most recent run from outside
it — the empty path had the same cross-period leak as the full one.

The totals agree with each other too: either all three rows carry a comparison
or none does, with one line saying why.

## A finished period is a summary

Rewinding the live screen to the end of a past period answered the wrong
question. 2024 showed the last run of 2024 as its hero, Form for the last three
weeks of 2024, and asked for a two-year-old run to be tagged "so the app knows
whether that was the plan". Nobody asks "where am I now?" of a finished year.

So `homeModel` makes one more decision, once: the current period is **live**,
and any closed period goes to `reviewModel` and is a **review**. In a review the
heroes, Form, the 28-day Z2, the target count and the load ramp are **absent,
not rewound**. What it shows instead, in order:

- **Races**: time, pace, heart rate and drift; first half against second half
  from whole laps (within 5 s/km reads "even"); and the build, meaning runs,
  km and the longest run in the twelve weeks before. Eight weeks missed most
  of the 2024 marathon block.
- **Logged**: runs, distance, time and ascent, with the period before **beside**
  it as plain numbers.
- **Month by month** (years only), with the biggest month named.
- **Bests**: longest run, the longest outside a race when a race is the longest,
  the period's best efforts at 1, 5, 10 km, half and marathon (**PB** where one
  still stands all-time), and the best aerobic pace, never from a race.
- **What you mainly did**: session tags counted, with untagged runs shown as
  untagged rather than guessed at, then the period's own zone split.
- **Aerobic pace** across the period, and nothing outside it.

Two rules hold for all of it.

**It is frozen.** Nothing in a review depends on today, so the same data reads
the same whenever you look. Only the ribbon, which is navigation rather than
content, still ends at now.

**It never claims anything about runs that aren't logged.** The backfill is
unfinished, so an empty month is "nothing logged", never "time off", and the
year before sits beside this one with no arrow and no percentage, because a
fall might only be a gap in the backfill. There is deliberately no "complete"
flag: the summary just grows as runs are added.

Each card has a minimum (bests 2 runs, the mix 3, the biggest month 2 months
with runs) and is absent below it rather than drawing a verdict from one or
two data points. A past week therefore mostly shows its races, totals and runs.

Over a whole year the run list carries the month under the day: "SAT 21" does
not say which Saturday.

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

**One source for every best in the app**: the Best-of page, the year reviews,
the run screen and the PB tags all ask `bestEffortOf`, so they can't disagree.

A run with its watch file is measured on the **second-by-second record**: the
fastest stretch of exactly each distance (400 m, 1 km, mile, 5 km, 10 km, half,
marathon), starting anywhere. That's the Garmin and Strava method. It sees a
stretch that began mid-kilometre, ignores stray lap presses, and gives a
21.46 km trail half a Half. Pauses over 10 s are not running time. A window
faster than 2:00/km is a GPS jump and is ignored. 100 m and 200 m are left out
on purpose: over those distances GPS error is most of the answer.

A run without a file falls back to **whole laps**: the fastest consecutive full
kilometres, at whole-kilometre distances only, since laps can't give a fair
400 m or mile. The two methods are never mixed for one run.

Distance is GPS distance either way, so a race that measured long (Oslo
Marathon: 42.87 km) shows a quicker marathon effort than its finish time.
That's stated on the run screen rather than corrected.

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

## Nothing lives only on the phone

Until Oct 2026 the sheet had no column for a run's **session tag**, or for a
field test's **result** (subtype, value, protocol note). Those lived only in the
browser, so every storage clear lost every race, long and tempo tag and both
test results, and a restore from the sheet brought them back empty.

The sheet now has those columns, and an existing sheet adds any missing header
at the end of its header row the first time the new script touches it. Nothing
already there moves. The first sync against the updated script sends the
phone's tags and results up **once, as a fill**: one request, no laps
rewritten, no timestamps moved, and never over a value already in the sheet.
Until the script is updated the app doesn't try (it would be lost), and Setup
says the script is out of date instead.

The rule behind it is checked: every field the app stores on a run must be a
sheet column.

## Garmin

Runs arrive by themselves from Garmin Connect's **Personal API**. The import
runs **inside the Apps Script**, never in the app. The site is public, and
anything in it (like `sheets.json`) can be read by anyone. The key lives only
in Script properties, where nobody can see it.

Every hour the script asks Garmin for recent runs and writes new ones to the
sheet, laps included. The app picks them up on its normal sync. Tags, RPE and
feel are still yours to add in the app.

- **Where the figures come from.** The activity list decides what is a run and
  gives the date and grade-adjusted pace. Everything else (distance, time,
  heart rate, cadence, ascent, temperature, every lap) comes from the original
  `.FIT` file. That format is published and fixed, so the import doesn't
  depend on guessed field names. The GPS track is never stored.
- **A run you already pasted** is matched (same day; distance within 2% or time
  within a minute, the app's own duplicate rule) and only **linked**. Your
  pasted figures and timestamps stay exactly as they were. The match uses the
  list's own figures first, so a pasted run is never even downloaded.
- **A Garmin run you delete** in the app stays deleted.
- **A dead key is said**, in Setup and with a message when the app opens.
  Keys expire on the date you chose when making them.

### Setting it up (once)

Easiest on a computer, or a browser in desktop mode.

1. Open the Groundwork spreadsheet, then **Extensions > Apps Script**.
2. Select everything in `Code.gs`, delete it, paste in the new `Code.gs`, then
   save.
3. Open **Project Settings** (the gear), then **Script properties > Add script
   property**. Set Property to `GARMIN_KEY` and Value to your key. Save.
4. Back in the editor, choose **setupGarmin** in the function menu and press
   **Run**. Google asks for permission to connect to an external service;
   allow it. This checks the key, writes a **Garmin check** tab, imports the
   last two weeks of runs, and turns on the hourly check.
5. **Deploy > Manage deployments**, press the pencil, set Version to **New
   version**, then **Deploy**. Same URL and token, so nothing changes in the
   app.

Then open the app once: it sends up the tags and test results.

The **Garmin check** tab reports how far back your key reaches, how many runs
per year it can see, whether grade-adjusted pace arrives, and whether the
`.FIT` file and its laps read correctly. Whether to import 2024–2025 from
Garmin is decided from that tab, not guessed.

### Importing the history (once)

In the Apps Script editor, choose **garminImportHistory** and press **Run**. It
walks every year Garmin can see, oldest first, using the same rules as the
hourly check: pasted runs are linked and never overwritten, nothing doubles,
and deleted runs stay deleted.

Google stops any script after six minutes, so the import stops itself at about
four and a half and logs how far it got. **Press Run again until the log says
"History complete".** Finished years are skipped, and runs already in the
sheet are never downloaded twice, so running it once too often does nothing.
The current year is left to the hourly check.

Imported runs are untagged, so tag races and sessions in the app. A run you
named yourself in Garmin Connect ("Holmenkollstafetten") keeps that name, so
races are easy to find. Garmin's automatic names ("Oslo Running") are replaced
by the app's own format. Activities the watch file says aren't runs, and runs
uploaded to Garmin twice, are skipped for good.

### Checking Gemini against Garmin

`garminCompare()`, run from the editor, compares every pasted run that is
linked to its Garmin original against Garmin's own file: distance, time,
heart rate, cadence, ascent, GAP, temperature, and every lap's distance, time
and heart rate. It writes a **Gemini check** tab and changes nothing else.

Each difference gets one verdict: **rounding** (one unit in the last digit
Garmin shows), **different measure** (a real Garmin figure, just not the one
stored, such as elapsed time instead of timer time, or Connect's corrected
ascent), **not pasted**, or **misread**. A misread lap time that matches its
neighbour is named as a swap.

## Best of

A page of its own (**BESTS**, beside Setup), all-time and independent of the
period selected on the home screen:

- **All time**: each distance's best, with this year's best beside it.
- **Year by year**: one distance at a time (chips), one row per year with
  that year's best, and the change against the last year you ran it, as
  faster or slower by how much, green or red. When years were skipped it
  names the year compared ("slower than 2018"). The fastest year carries the
  PB tag. A list rather than a chart: the question is "did I get faster or
  slower", and that answer is a word and a number. (A line chart was tried,
  and the 2019–2023 gap took most of its width.)
- **Records**: best aerobic pace, longest run, biggest week, month and year,
  most climbing, lowest drift. No streaks, by the rule in "A count, not a
  streak".
- **Races**: every race across every year.

## What the watch file adds

`garminEnrich()`, run once from the editor (press Run until it says
complete), gives every Garmin-linked run what its file offers. The hourly
import does the same for new runs from then on.

- **Laps from the file.** On pasted runs these replace the transcribed laps;
  the Gemini check found lap lists were where transcription went wrong.
- **Figures the paste left out** (moving time, ascent, descent, cadence, GAP,
  heart rate, max HR) are filled **only where empty**, never overwritten.
- **Seconds at each heart rate.** Time in zone is counted from these
  (`zoneLaps`) instead of lap averages, which hide the minutes above a zone
  inside a lap that averages below it. They're stored per bpm, not per zone,
  so changing your zones later is still exact.
- **Drift on the stream**, same definition as on laps (last third against
  first, opening kilometre dropped), through `driftOf`.
- **Best efforts**, as above.

Yours stays yours: name, tags, RPE, feel, notes and pasted weather
temperatures. **Temperature:** the watch's own sensor sits against your wrist
and reads warm, so imported runs store none, rather than mixing wrist readings
with the weather temperatures in your pasted runs. Enriched runs get a new
`updated_at`, which is how the app knows to take them.

## Road and trail

Every run is **road** unless it is marked **trail**: automatically when
Garmin's activity type says Trail Run (at import, and for your history by
`garminEnrich`), or by hand with the Road/Trail switch in Edit and on the
paste screen. A switch you set by hand is never overridden by Garmin's type.

A technical trail is slow for reasons that aren't fitness, so a trail run is
**not a measurement of aerobic pace**, the same as a race (`isAerobicMeasure`,
the one rule every aerobic-pace figure asks). It stays off the aerobic pace
hero, the trend chart, Form's pace row and the best-aerobic-pace record, and
the chart caption says how many were left out. **Against runs this length**
ranks a trail run only against trail runs of a similar distance, and a road run
only against road runs. Everything else counts as normal: distance, time,
load, time in zone, drift, totals and best efforts.

## Watch-file gaps (stream v2)

v1 treated every gap over 10 s as a pause and dropped its time **but kept its
distance**. Older watches record "smart", a point every few seconds and
sometimes 15–20 s apart, so hundreds of metres took no time at all, and 2017
showed a 1 km in 2:16. A gap is now a pause only if you moved slower than
0.5 m/s during it; otherwise it is running time however long it is. A step
between two points faster than 8 m/s is a GPS jump and adds no distance.
`STREAM_V` went to 2, so `garminEnrich` re-reads every file once.

## Zones come from your watch

The app's zones are **exactly the ones set on your watch**, because those are
the numbers you run by. The hourly Apps Script check reads them from Garmin
(running's set, else the default) and sends them with the Garmin status;
`Store.config()` hands them to `zoneBounds`, the one place zones are decided,
along with the watch's max and resting HR, so load uses the same anchors.
Change zones on the watch and the app follows within the hour. Setup shows
them read-only, with a **From my watch / My own** switch; My own brings back
your typed anchors with the watch's still shown. If Garmin's zones can't be
read, the last good set is kept and Setup says so.

(An earlier, never-deployed version moved zones with Garmin's daily resting
HR. That's wrong: the app would then disagree with the watch.)

## Resting HR

Garmin's daily resting heart rate, one row a day in the **Resting HR** tab,
written only by the Apps Script. `garminRestingHistory()`, run once from the
editor (press Run until it says complete), fills in every day Garmin has; the
hourly check adds the last fortnight from then on, since Garmin sometimes
settles a day's value late. The app gets the days with every sync and keeps a
copy for offline use.

A worn day whose summary carries no resting value is filled from that day's
own heart-rate record (`dailyHeartRate`), one call per such day. Days Garmin
marks as not worn are not asked about. `garminRestingProbe()` logs both views
of chosen dates when a gap looks wrong.

The **RESTING** screen (home, beside Bests) shows this week's average, the
change against three months and a year ago (lower is fitter), the lowest and
highest month, and a chart in three views: **Month** (the default, every
night of a calendar month), **Year** (weekly averages of a calendar year) and
**All years** (monthly averages). Month and Year step back and forth with the
arrows or by swiping the chart. A stretch with no
readings breaks the line. It's context only and moves nothing.

## The year's pictures

A past year's review also draws, from logged runs only:

- **Each race kilometre by kilometre**: pace above, heart rate below, on the
  same kilometres, so where one gave way you can see what the other did.
- **The year at a glance**: twelve rows of days, a dot per run sized by
  distance, a ring for a race. Tap a dot for the run.
- **Against your other years**: kilometres accumulated through the year,
  every year on one January-to-December axis, this year in colour.
- **Pace against heart rate**: a dot per run, last year in grey behind. A
  cloud sitting higher at the same heart rate is a fitter year. Races and
  trail runs are left out (`isAerobicMeasure`).
- **Aerobic pace by year**: the median of each year's measurements, every
  year with at least three, gaps breaking the line.

Charts with too little behind them are absent, not drawn from one or two
runs. Colour still means zone or "this year" only.

## HR check, and locked runs

`garminHrCheck()` reads every run's watch file and measures how much of the
running time had heart rate within 3 beats of cadence (or half cadence), the
signature of a wrist sensor locked onto your stride, and writes an **HR check**
tab. On Jack's history (Oct 2026): 2017 averaged 10% locked, 2018 20%, 2024–26
1–3% (coincidence on hard stretches); six runs, all 2017–18, were 30%+.

A run **30% or more locked** (`hrLocked`, `HR_LOCK_LIMIT`) is left out of
everything built on heart rate: time in zone, drift, load, aerobic pace (so
the hero, trend, scatter, records and "against runs this length"). It still
counts for distance, time, pace and best efforts. Its run screen says why,
with a **Trust this heart rate anyway** button (`hr_trust`), and chart
captions count it among what was left out. The share lives in `hr_lock`,
written at import for new runs and copied from the HR check tab once by
`garminHrLockApply()`.

Separate zones for 2017–18 were considered and dropped: Garmin only gives
today's watch zones, and the 2017 heart rate was mostly genuine, just higher.

## Chart lines are revealed by a wipe

Lines used to draw in with a dash of fixed length (400px). Any line longer than
that on screen, such as a zig-zagging month of resting HR, stopped partway and
looked like missing data. They now appear with a left-to-right wipe, which
doesn't depend on the line's length, and a point that can't be placed is
skipped rather than ending the line.

## No add button

Runs arrive from Garmin, so the floating + is gone. For the odd run Garmin
doesn't have, **Paste a run by hand** in Setup opens the paste screen. The run
screen no longer labels where a run came from.

## One home per measure

| Screen | Question | Owns |
|---|---|---|
| Home | How is my training going right now? | week/month/year, form, runs |
| **PROGRESS** | How am I doing? | HRV and resting HR, training progress, tests, lately |
| **BESTS** | What have I achieved? | a plaque per distance, year by year, records, races |

No number appears in full in two places. One table (`SAME`) decides when a
change is too small to mean anything and reads "about the same": resting HR
under 1 bpm, HRV under 2 ms, aerobic pace under 3 s/km, Z2 under 2 points,
weekly distance under 0.5 km.

**Progress** opens with how fresh it is ("Latest: 26 Oct resting HR 49 bpm,
HRV 50 ms · Garmin checked 09:00") and a **Check Garmin now** button, which asks
the Apps Script to run its hourly check immediately (`doPost` action
`garminSync`, routed before the write lock since it takes its own) and then
pulls. Today's resting HR is only settled once the watch has synced after you
end sleep on it; until the next check, the sheet can hold an earlier value.

Then the reading (`recoveryModel`), every line naming both measures with their
numbers: "Last 3 nights: HRV 58 ms, above your normal range; resting HR 53 bpm,
inside your normal range — well rested." Normal range: the last 60 nights'
average plus or minus one standard deviation (needs 30 nights). Then the
four-week trend for both, and the training sentence. Then a card per measure:
the 7-night average, the last 3 nights against the normal range (the words
always name the number they describe), the four-week change, what it means;
each opens its detail (charts with the normal range shaded, comparisons, and
patterns once there are 90 nights). Then **Training** (aerobic pace, time in Z2,
weekly distance, now against three months ago), **Tests**, and **Lately**.

**Bests** is the trophy room: a plaque per distance (time, run, date, this
year's best quietly beneath), year by year, records, races.

On the home screen, an unfinished period is compared over finished days only,
plus today once today has a run, so a fresh Monday isn't "100% down". In the
current period the aerobic pace card keeps showing your latest run until you
run again. The period ribbon lands on the selected period after layout.

## Tests

**Test** is a session tag, for a yearly lactate threshold test. A test counts
like a race: out of aerobic pace, the "something changed" card and "against
runs this length", in everything else. The **Tests** section on Bests reads
each one the standard way, heart rate and pace over the last 20 minutes from
the laps, newest first, each against the test before.

## Comparisons are like for like

An unfinished period is compared with the previous one at the same point:
1 January-24 October 2026 against 1 January-24 October 2025, this month to the
24th against last month to the 24th. The label says so ("2025 to 24 Oct").
On Year, the Z2 target line and "recent typical" are gone: they are
training-week ideas.

## Year review, revised

The year-at-a-glance calendar and aerobic pace by year are gone. **Against
your other years** starts at 0 km and names each line with its year.
**Pace against heart rate** has a line every 10 bpm, your Z2 band shaded, and
pace marks up the side. **What you mainly did** adds a by-heart-rate line
(easy: 70%+ of the time in Z1-Z2; hard: 30%+ in Z4-Z5; steady between),
display only. A trail race shows no halves: on a trail or obstacle course the
split is the course.

## HRV

Garmin's nightly HRV (each night's own average, in ms, never the weekly one),
one row a night in the **HRV** tab, written only by the Apps Script.
`garminHrvHistory()` fills the history once, a year per request; the hourly
check adds the last fortnight. Only watches with overnight HRV record it, so
the history starts with that watch. Garmin's HRV status and baseline band
aren't in the summaries a personal key gets, so the app shows the numbers, not
Garmin's verdict.

The **RECOVERY** screen (formerly Resting) switches between **Resting HR** and
**HRV**, with the same Month, Year and All years views and the same stepping.
Colours follow each measure: lower is better for resting HR, higher for HRV.
Training progress on Bests has an HRV row. Context only: it moves nothing.

## Strava history (2014–)

Jack's Strava goes back to 2014, phone-recorded, before his first watch run in
September 2017. `stravaImport()`, run from the editor until it says complete,
reads Strava's own export: `activities.csv` straight from Google Drive (or,
failing that, a tab made from it, found by its header row) and, if the archive's `activities` folder is
in Drive, each run's track (`.gpx`, `.tcx`, `.fit`, gzipped or not, found by
file name). Only runs. A run already here (same day; distance within 2% or
time within a minute) is linked by `strava_id` and keeps its own figures; the
rest are added. Tracks give best efforts and, where they carry heart rate, the
heart-rate figures, through the same `streamFigures` and GPS-jump filter as
watch files; a GPX's distance comes from its points. Strava's dates are UTC and
become Oslo dates. Running it again is safe: nothing is added twice, and a run
it added before its track was in Drive gets the track on the rerun. 2014 phone GPS is noisier than a watch, so its short efforts
are the least trustworthy numbers in the app.

## Bests, results and sync

**Bests** opens with **New**: all-time bests set in the last 30 days, each with
what it beat ("1 km 4:50: your fastest ever, 5 s quicker than 20 Nov 2017"),
its plaque marked NEW PB. Plaques show time, pace and date (no run names) and
this year's best with how far off it is. A run's own **best efforts** are
ranked like results: PB, 2nd or 3rd best ever, or best of its year
(`effortRanks`).

**Sync with Garmin** lives on the home screen ("Garmin synced 09:00 · Sync
now") and on pulling down at the top of home or Progress: it runs the Apps
Script's check (new runs, resting HR, HRV, zones) and pulls.

## Your routes (matched runs)

Each run with a watch file or a GPS track keeps a route fingerprint (`route`):
ten points at equal distances along it, rounded to about 10 m. Not the track:
GPS is still never stored. Two runs are the same route when their distances
are within 6% and every point lies within 150 m of the other's, either way
round (`sameRoute`). A route with three runs or more appears under **Your
routes** on Progress, and opens a screen with pace and heart rate for every run
on it. Its comparison (easy runs at the start against easy runs now, the middle
of up to three each) leaves out races, tests, trail, locked heart rate and runs
tagged tempo or intervals: same course, so no terrain excuses. Stream v3
added the fingerprint, so `garminEnrich` re-reads watch files once; the Strava
import takes it from each track.

## Years without heart rate

A year whose runs carry no heart rate at all (phone-recorded, 2014) says so
once at the top ("Recorded with a phone: no heart rate this year"). Time in
zone and the by-heart-rate line stay away rather than standing empty, and
**Pace through the year** stands in: the middle pace of each month's runs,
labelled as plain pace, not aerobic pace.

## Tagging

Tags are set on the run screen: session chips (Easy, Long, Recovery, Steady,
Tempo, Intervals, Race, Test) and terrain (Road, Trail, Mixed), saved on tap,
tapped again to clear. `suggestTags` outlines a guess, never applied by itself:
from the name first (Lactate → Test, tempo → Tempo, z2 → Easy, marathon →
Race, 6x400 → Intervals, trail → Trail, mixed → Mixed), otherwise from heart
rate (30%+ in Z4–Z5 → Tempo; 70%+ in Z1–Z2 → Easy, or Long from 15 km;
between → Steady; with no lap heart rate, the run's average against the zones).

**New runs** are asked about when they arrive: on opening the app and after a
sync, a card shows the run with the guess outlined. A session tag saves and
brings the next; terrain can be tapped first; **Later** puts it away until the
app is next opened; **Not this one** leaves it untagged for good.

**Older runs** (before `AUTO_TAG_BEFORE`, 26 Oct 2026) and runs set aside with
"not this one" carry an **auto** tag (`autoSession`): worked out each time,
never stored, shown as "EASY (AUTO)" and counted separately in year reviews.
Only training tags are guessed; Race and Test are never auto, since they
change what counts. Any tag you tap replaces the guess.

**Mixed** terrain counts for aerobic pace like road, is ranked only against
mixed runs of a similar length, and shows no race halves.

## Splits

The run screen's per-kilometre strip became **Splits**: kilometre, pace, a bar
whose length is speed and whose colour is that kilometre's heart-rate zone,
elevation (climbed minus descended, from the watch file's laps), and heart rate.
The fastest whole kilometre is marked; a partial one shows its distance. Laps
now carry `ascent_m` and `descent_m`, written at import and by `garminEnrich`.

## Settings that matter

- **Max HR / resting HR** — the Karvonen anchors. Every zone follows them.
- **Export** — until Sheets is wired, this device is the only copy.

## Still to come

Icons. Block-overlay chart. Drift over time, once five runs carry lap HR.
