# Groundwork

Running and hiking analytics. Data arrives as a table transcribed from a Garmin
screenshot and pasted in. Everything else is computed.

## Upload — everything sits at the root

```
index.html   app.css   sw.js   manifest.json
calc.js      store.js  parse.js  ui.js
```

No folders. GitHub mobile drops subfolders silently, which is exactly what
broke the first upload. Eight files, all at the top level of the repo.

`Code.gs` and `tests/` are for you, not the site — they can live in the repo or
not, Pages ignores them either way.

## Files

```
index.html    shell — world switch, four <section> views, the add button
app.css       design tokens; colour means heart-rate zone and nothing else
calc.js       all maths, plus the activity model. Pure functions, no DOM.
store.js      storage behind an adapter — local now, Sheets later
parse.js      paste parser and validation
ui.js         rendering and interaction
sw.js         service worker — BUMP `CACHE` ON EVERY JS OR CSS CHANGE
Code.gs       Apps Script backend, for when you move to Sheets
```

## Tests

```
node tests/harness.js       82 assertions — maths and parsing, on real data
npm install jsdom
node tests/integration.js   31 assertions — boots the UI, pastes, saves, clicks
```

## Moving to Sheets

1. New Google Sheet, Extensions > Apps Script, paste `Code.gs`
2. Run `setup()` — creates the Activities, Laps and Config tabs
3. Run `makeToken()` — copy the token it logs
4. Deploy > New deployment > Web app, execute as **Me**, access **Anyone**
5. In `store.js`, change one line in `Store.init`:

```js
this.adapter = new SheetsAdapter('https://script.google.com/.../exec', 'TOKEN');
```

Reads still come from the local cache, so the app stays instant and works
offline. Writes go to both and queue when there's no connection.

The URL and token are the only thing protecting the data — treat both as
secrets.

## Settings that matter

- **Max HR / resting HR** — the Karvonen anchors. Every zone follows them.
- **Flat km/h, ascent m/h** — Naismith. 5 km/h is classic, 4 is the
  conservative rough-terrain variant. Changing it moves every terrain factor.
- **Export** — do it regularly. Until Sheets is wired, this device is the only
  copy.

## Two worlds

Running and Hiking are separate worlds sharing one shell. They differ on
purpose:

|            | Running                   | Hiking                          |
|------------|---------------------------|---------------------------------|
| Scopes     | Week / Month / Year       | Month / Year / All time         |
| Default    | Week                      | Year                            |
| Hero       | Aerobic cost, beats/km    | Cumulative ascent, metres up    |
| Ribbon     | Distance per week         | Ascent per month                |
| List       | Dense rows, drift strips  | Spacious cards, one per day out |
| Compares   | Zone time, drift          | Days out, time on feet, factor  |

There is no Week for hiking (you don't hike on a weekly rhythm) and no All time
for running (the training block is the unit).

## Still to come

Trend charts — aerobic cost over time, drift over time, weekly zone split,
pace × HR scatter. Held back deliberately: lines need eight to ten points
before they stop looking like noise.
