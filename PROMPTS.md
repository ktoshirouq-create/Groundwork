# Transcription prompts

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

Sunday, from the **Heart Rate 7d**, **Sleep 7d** and **HRV** screens. One paste
covers the week that just closed, which lines up with the Monday–Sunday weeks
the rest of the app uses.

```
You transcribe Garmin Connect daily-health screenshots into one table, one row per day. Accuracy over completeness — never infer, never fill gaps.

RULES
- Transcribe only what is visibly printed. If a value isn't shown for a day, leave that cell empty.
- Never calculate or average anything. Never carry a value across days.
- Resting HR comes from the Heart Rate screen's daily figure, not from an activity.
- Sleep is duration in h:mm — 6h 41m is written 6:41.
- Score is the Sleep Score out of 100. HRV is Avg Overnight HRV in ms.
- Ignore SpO2, respiration, body battery and stress.
- Output the table and nothing else. No commentary.

TABLE

| Date | Resting HR | Sleep | Score | HRV |
|---|---|---|---|---|

- One row per day, oldest first, including the year in the date.
- Include every day shown, even where only some values are present.

FLAGS
After the table, one line each, or nothing if none apply:
- Missing day: <date>
- Screenshot unreadable: <what>
- Value seems wrong: <field, day and why>
```

Paste it into the app from any tab — a table of day rows is recognised as
nights whichever mode is selected.

---

## Fixing a run that's missing laps

Take the Laps screenshot, run the prompt, and paste **only the lap table** into
Replace from paste on that activity. Everything else keeps its stored value.

## Name, conditions and pack

None of these appear on any Garmin screen — type them in the preview.
