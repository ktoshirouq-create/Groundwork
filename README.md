# Groundwork

Running and hiking analytics. Data arrives as a table transcribed from a Garmin
screenshot and pasted in. Everything else is computed.

## The eight files that serve the site

```
index.html   app.css   sw.js   manifest.json
calc.js      store.js  parse.js  ui.js
```

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

## Three worlds

|          | Running              | Hiking                | Body                  |
|----------|----------------------|-----------------------|-----------------------|
| Scopes   | Week / Month / Year  | Month / Year / All    | Week / Month / Year   |
| Default  | Week                 | Year                  | Month                 |
| Hero     | Aerobic pace, min/km | Cumulative ascent     | Resting HR vs baseline|
| Record   | one per activity     | one per activity      | **one per day**       |

No Week for hiking — you don't hike weekly. No All time for running — the
training block is the unit. Body defaults to Month because seven points show
nothing.

## Body

One record per day: resting HR, sleep, sleep score, overnight HRV. Pasted
weekly on a Sunday from Garmin's 7d screens, which aligns with the
Monday–Sunday weeks everything else uses.

**Day records never enter an activity rollup.** `Calc.ACTIVITY_TYPES` is the
explicit list; anything counting runs or hikes filters on it.

**Resting HR has two sources and one precedence rule.** A day record always
wins for its own date; a run's own reading fills the gaps between Sundays.
Where both exist and differ by 3 bpm or more, the app says so rather than
silently choosing. The 90-day median is computed over merged dates, so one
morning can never be counted twice.

Before Body, that median came only from days you ran — days you felt well
enough to run. A daily sample removes the bias, and the zone anchor follows it
on any shift of 2 bpm or more.

**SpO2 is deliberately absent.** Wrist pulse oximetry through motion and skin
contact is unreliable; an 84% reading is artifact, not data, and no trend
should be built on it.

### Comparing groups

`splitCompare` answers questions like "is pace worse after a short night" as
two medians, never a scatter with a fitted line. It measures spread **within**
each group — pooling the raw values would fold the difference being tested into
the yardstick, so a real gap would inflate the spread enough to hide itself.
It reports significance only past twice that spread.

One confound to remember: Thursday-to-Sunday night shifts mean short nights
cluster on work days, so a sleep effect and a weekday effect look identical.

## Aerobic pace

Aerobic cost is heart rate × pace: a real measurement in an unreadable unit.
Divide it by a fixed heart rate — the top of Z2 — and it becomes **the pace you
would hold at that heart rate**.

```
8:14  8 Oct 2025      6:51  17 Nov 2025      7:10  13 Aug 2026
```

The reference follows your anchors, so re-anchoring rescales everything by the
same factor: absolute paces shift, the shape of the curve never does. There's a
test for that.

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

## The read

Six dimensions, each on a track running from your worst to your best over the
last 12 months, with a band for recent typical and a dot for now. Direction
tells you whether you're improving; position tells you how good it is in your
own terms.

Windows are the last 3 against the 3 before. Anything short of that shows the
track greyed and says what it needs.

## The noticing card

Appears only when a run beats the median of your last six by more than twice
their spread, with at least four prior runs and a six-second floor on the
spread so an unusually consistent stretch can't make everything look
significant. Compared within your ±20% length band where there's enough data.

Silent otherwise — no card, no placeholder. It shows its working so you can
disagree with it.

Checked against real history: fires on 17 Nov 2025, silent on 1 Dec.

## Resting HR

A field on the paste. Its 90-day rolling median is what the Karvonen resting
anchor follows, and the anchor only moves on a shift of 2 bpm or more so
aerobic pace never drifts for non-fitness reasons.

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
node tests/harness.js       98 assertions — maths and parsing, on real data
npm install jsdom
node tests/integration.js   77 assertions — boots the UI and drives it
node tests/charts.js        47 assertions — charts, the read, deltas
node tests/body.js          42 assertions — day records, the weekly paste, the anchor
```

## Moving to Sheets

1. New Google Sheet, Extensions > Apps Script, paste `Code.gs`
2. Run `setup()` — creates the Activities, Laps and Config tabs
3. Run `makeToken()` — copy the token it logs
4. Deploy > New deployment > Web app, execute as **Me**, access **Anyone**
5. In `store.js`, one line in `Store.init`:

```js
this.adapter = new SheetsAdapter('https://script.google.com/.../exec', 'TOKEN');
```

Reads still come from the local cache, so the app stays instant offline. Writes
go to both and queue when there's no connection. The URL and token are the only
thing protecting the data — treat both as secrets.

## Settings that matter

- **Max HR / resting HR** — the Karvonen anchors. Every zone follows them.
- **Flat km/h, ascent m/h** — Naismith. 5 km/h is classic, 4 is the
  conservative rough-terrain variant. Changing it moves every terrain factor.
- **Export** — until Sheets is wired, this device is the only copy.

## Still to come

Icons. Block-overlay chart. Drift over time, once five runs carry lap HR.
