# Fit

Running and hiking analytics. Data arrives as a table transcribed from a Garmin
screenshot and pasted in. Everything else is computed.

## Upload

Drop the whole folder into a repo and enable GitHub Pages. No build step, no
dependencies, no bundler. Two icon files are the only things missing —
`icon-192.png` and `icon-512.png` in the root — and the app runs fine without
them until you add them.

## Files

```
index.html      shell — every screen is a <section>
app.css         design tokens; colour means heart-rate zone and nothing else
js/calc.js      all derived maths. Pure functions, no DOM. Change formulas here.
js/model.js     activity shape, ids, duplicate detection, schema migrations
js/store.js     storage behind an adapter — LocalAdapter now, SheetsAdapter later
js/parse.js     paste parser and validation
js/ui.js        rendering and interaction
sw.js           service worker — BUMP `CACHE` ON EVERY JS OR CSS CHANGE
tests/          Node harness, run before shipping any change to calc or parse
```

## Tests

```
node tests/harness.js       82 assertions — maths and parsing, on real data
npm install jsdom
node tests/integration.js   31 assertions — boots the UI, pastes, saves, clicks
```

## Moving to Sheets later

`js/store.js` already contains `SheetsAdapter`. Deploy the Apps Script, then
change one line in `Store.init`:

```js
this.adapter = new SheetsAdapter('https://script.google.com/.../exec');
```

Reads still come from the local cache, so the app stays instant and works
offline. Writes go to both, and queue when there is no connection.

## Settings that matter

- **Max HR / resting HR** — the Karvonen anchors. Every zone follows them.
- **Flat km/h, ascent m/h** — Naismith. 5 km/h is classic, 4 is the
  conservative rough-terrain variant. Changing it moves every terrain factor.
- **Export** — do it regularly. Until Sheets is wired, this device is the only
  copy.
