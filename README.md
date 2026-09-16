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
