# Transcription prompts

Pipes, commas or tabs all parse — Gemini varies its output and the app doesn't
care. The tables below ask for pipes because they're the least ambiguous.

Paste one of these into Gemini with the screenshots. Send **Overview + Stats +
Laps** for a run; **Overview + Stats + Laps** for a hike too.

---

## Running

```
You transcribe Garmin Connect running screenshots into a fixed table. Accuracy over completeness — never infer, never fill gaps.

RULES
- Transcribe only what is visibly printed. If a field isn't in the screenshots, write "—". Do not estimate or carry over values from earlier runs.
- Never calculate a field. If pace isn't shown, write "—" rather than deriving it from distance and time.
- Temperature: take ONLY the number in the weather badge on the Overview map. Ignore the Temperature chart in Charts — that's the wrist sensor and it reads high.
- Resting HR comes from the Heart Rate screen for that day, not from the activity.
- Pace and GAP in min/km. Distance in km. Ascent in m. HR in bpm.
- Output the tables and nothing else. No commentary, no summary.

TABLE

| Metric | Value |
|---|---|
| Date | |
| Temperature | |
| Total Distance | |
| Total Time | |
| Avg Pace | |
| Avg Grade-Adj Pace | |
| Avg HR | |
| Resting HR | |
| Avg Cadence | |
| Total Ascent | |
| RPE | |
| Feel | |

Then a lap table, one row per lap from the Laps tab:

| Lap | Distance | Time | Pace | Avg HR | Role |
|---|---|---|---|---|---|

- Role is warmup, main, or cooldown. Use warmup/cooldown only where the lap is clearly one; otherwise main.
- Include every lap shown, including short final partial laps.
- If the Laps tab has no Avg HR column, write "—" in that column for every lap and add one line after the table: "No lap HR available."

FLAGS
After the tables, list any of these that apply, one per line. If none, write nothing.
- Missing field: <name>
- Screenshot unreadable: <what>
- Value seems wrong: <field and why>
```

---

## Hiking

```
You transcribe Garmin Connect hiking screenshots into a fixed table. Accuracy over completeness — never infer, never fill gaps.

RULES
- Transcribe only what is visibly printed. If a field isn't in the screenshots, write "—".
- Never calculate a field. If it isn't shown, it's "—".
- Temperature: ONLY the weather badge on the Overview map. Ignore the Temperature chart — that's the wrist sensor and it reads high.
- Elapsed Time and Moving Time are separate fields under TIMING on the Stats tab. Transcribe both, even when identical.
- Resting HR comes from the Heart Rate screen for that day, not from the activity.
- Distance in km, elevation in m, HR in bpm.
- Output the tables and nothing else. No commentary.

TABLE

| Metric | Value |
|---|---|
| Date | |
| Temperature | |
| Total Distance | |
| Elapsed Time | |
| Moving Time | |
| Avg HR | |
| Resting HR | |
| Total Ascent | |
| Total Descent | |
| Min Elevation | |
| Max Elevation | |
| RPE | |
| Feel | |

Then a lap table, one row per lap from the Laps tab:

| Lap | Distance | Time | Avg HR |
|---|---|---|---|

- Include every lap, including short final partial laps.
- If the Laps tab has no Avg HR column, write "—" throughout and add: "No lap HR available."

FLAGS
After the tables, one line each, or nothing if none apply:
- Missing field: <name>
- Screenshot unreadable: <what>
- Value seems wrong: <field and why>
```

---

## Body — a week of nights

Sunday, from the **Heart Rate 7d** and **Sleep 7d** screens. One paste covers
the week that just closed, which lines up with the Monday–Sunday weeks the rest
of the app uses.

```
You transcribe Garmin Connect weekly health screenshots into one table, one row per day. Accuracy over completeness — never infer, never fill gaps.

SOURCES
- Heart Rate 7d — the day list at the bottom. Each row shows TWO bpm figures: take the FIRST (resting). Ignore the second, that's the daily high.
- Sleep 7d — the day list at the bottom. Each row shows a Score and a Duration. Take both.

RULES
- Transcribe only what is visibly printed. If a value isn't shown for a day, leave that cell empty.
- Never calculate or average anything. Never carry a value across days.
- IGNORE every summary block: Avg Score, Avg Sleep Duration, Avg Resting Heart Rate, Avg Overnight Heart Rate, Sleep Need, Body Battery, SpO2, Respiration, Avg Bedtime, Avg Wake Time. Those are averages, not days.
- Ignore the Sleep Duration vs Sleep Need chart and the Sleep Consistency chart entirely. Use the day list only.
- Sleep duration in h:mm. "6h 41m" is written 6:41. "8h 12m" is 8:12.
- Output the table and nothing else. No commentary, no totals row.

TABLE

| Date | Resting HR | Sleep | Score |
|---|---|---|---|

- One row per day, OLDEST FIRST, with the year in the date. The lists are newest first, so reverse them.
- Exactly four columns. Never add a fifth.
- One row per date only — if a date appears on more than one screenshot, merge into a single row.

FLAGS
After the table, one line each, or nothing if none apply:
- Missing day: <date>
- Screenshot unreadable: <what>
- Value seems wrong: <field, day and why>
```

Paste it into the app from any tab — a table of day rows is recognised as
nights whichever type is selected.

**No HRV.** Garmin's weekly screen only reports a 7-day average, and daily
entry would be seven transcriptions for the field with the least signal.
Resting heart rate covers overlapping physiology and comes for free.

---

## Fixing a run that's missing laps

Take the Laps screenshot, run the prompt, and paste **only the lap table** into
Replace from paste on that activity. Everything else keeps its stored value.

## Name, conditions and pack

None of these appear on any Garmin screen — type them in the preview.
