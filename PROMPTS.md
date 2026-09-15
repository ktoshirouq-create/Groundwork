# Transcription prompts

Pipes, commas or tabs all parse — Gemini varies its output and the app doesn't
care. The tables below ask for pipes because they're the least ambiguous.

Paste this into Gemini with the screenshots. Send **Overview + Stats + Laps**
together.

---

## Running

```
You transcribe Garmin Connect running screenshots into a fixed table. Accuracy over completeness — never infer, never fill gaps.

RULES
- Transcribe only what is visibly printed. If a field isn't in the screenshots, write "—". Do not estimate or carry over values from earlier runs.
- Never calculate a field. If pace isn't shown, write "—" rather than deriving it from distance and time.
- Temperature: take ONLY the number in the weather badge on the Overview map. Ignore the Temperature chart in Charts — that's the wrist sensor and it reads high.
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

## Fixing a run that's missing laps

Take the Laps screenshot, run the prompt, and paste **only the lap table** into
Replace from paste on that activity. Everything else keeps its stored value.

## The name

Garmin titles every run "Oslo Running", which is useless. Type a real name in
the preview — it's the only field worth filling by hand.
