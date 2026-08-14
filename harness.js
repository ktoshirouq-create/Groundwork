/* Node harness. Run: node tests/harness.js
   Validates the maths against Jack's real Oct 2025 - Aug 2026 data. */

const Calc = require('../js/calc.js');
const Parse = require('../js/parse.js');

let pass = 0, fail = 0;
function eq(label, got, want, tol) {
  const ok = tol != null ? Math.abs(got - want) <= tol : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + ' -> got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}

console.log('\nZONES (Karvonen, max 185 / rest 53)');
const B = Calc.zoneBounds();
eq('HR reserve', B.hrr, 132);
eq('Z2 floor', B.z2, 132);
eq('Z3 floor', B.z3, 145);
eq('Z4 floor', B.z4, 159);
eq('Z5 floor', B.z5, 172);
eq('131 is Z1', Calc.zoneOf(131, B), 1);
eq('143 is Z2', Calc.zoneOf(143, B), 2);
eq('149 is Z3', Calc.zoneOf(149, B), 3);
eq('185 is Z5', Calc.zoneOf(185, B), 5);

console.log('\nAEROBIC COST — real 2025 runs (whole-run, raw pace)');
const runs2025 = [
  ['8 Oct',  3.65, 2110, 124, 1194],
  ['12 Oct', 7.17, 3936, 131, 1199],
  ['13 Oct', 3.56, 1976, 129, 1193],
  ['19 Oct', 9.01, 4180, 137, 1059],
  ['26 Oct', 10.10, 4719, 137, 1067],   // time corrected, see note below
  ['2 Nov',  10.24, 5165, 134, 1128],
  ['17 Nov', 6.67, 3011, 132,  992],
  ['24 Nov', 4.89, 2126, 141, 1020],
  ['29 Nov', 12.58, 5569, 142, 1048],
  ['8 Dec',  5.45, 2511, 134, 1027]
];
runs2025.forEach(([d, km, s, hr, want]) => {
  const c = Calc.aerobicCost({ distance_km: km, elapsed_s: s, avg_hr: hr });
  eq('cost ' + d, c.value, want, 2);
});

console.log('\nAEROBIC COST — 2026, GAP applied');
eq('11 Aug gap', Calc.aerobicCost({ distance_km: 5.36, elapsed_s: 2501, avg_hr: 140, gap_pace_s: 455 }).value, 1062, 2);
eq('13 Aug gap', Calc.aerobicCost({ distance_km: 3.01, elapsed_s: 1337, avg_hr: 143, gap_pace_s: 436 }).value, 1039, 2);
eq('13 Aug basis', Calc.aerobicCost({ distance_km: 3.01, elapsed_s: 1337, avg_hr: 143, gap_pace_s: 436 }).basis, 'gap');

console.log('\nMAIN-LAP SCOPE');
const withWarmup = {
  distance_km: 6.67, elapsed_s: 3011, avg_hr: 132,
  laps: [
    { n: 1, distance_km: 1.21, time_s: 607, avg_hr: 124, role: 'warmup' },
    { n: 2, distance_km: 1.00, time_s: 440, avg_hr: 131, role: 'main' },
    { n: 3, distance_km: 1.00, time_s: 438, avg_hr: 134, role: 'main' },
    { n: 4, distance_km: 1.00, time_s: 441, avg_hr: 136, role: 'main' },
    { n: 5, distance_km: 1.00, time_s: 445, avg_hr: 139, role: 'main' },
    { n: 6, distance_km: 1.46, time_s: 640, avg_hr: 141, role: 'main' }
  ]
};
const mc = Calc.aerobicCost(withWarmup);
eq('scope is main', mc.scope, 'main');
eq('main-lap value', mc.value, 1003, 1);
eq('differs from whole-run', mc.value !== Calc.aerobicCost({distance_km:6.67,elapsed_s:3011,avg_hr:132}).value, true);
eq('drift over thirds', Calc.drift(withWarmup.laps), 8);

console.log('\nDRIFT — 13 Aug, three laps');
eq('drift +16', Calc.drift([
  { distance_km: 1, time_s: 430, avg_hr: 133 },
  { distance_km: 1, time_s: 444, avg_hr: 143 },
  { distance_km: 1, time_s: 456, avg_hr: 149 }
]), 16);
eq('two laps is not enough', Calc.drift([
  { distance_km: 1, time_s: 430, avg_hr: 133 },
  { distance_km: 1, time_s: 456, avg_hr: 149 }
]), null);
eq('partial lap ignored', Calc.drift([
  { distance_km: 1, time_s: 430, avg_hr: 133 },
  { distance_km: 1, time_s: 444, avg_hr: 143 },
  { distance_km: 1, time_s: 456, avg_hr: 149 },
  { distance_km: 0.01, time_s: 7, avg_hr: 60 }
]), 16);

console.log('\nTIME IN ZONE');
const tz = Calc.timeInZone([
  { time_s: 430, avg_hr: 133 }, { time_s: 444, avg_hr: 143 }, { time_s: 456, avg_hr: 149 }
], B);
eq('Z2 seconds', tz[2], 874);
eq('Z3 seconds', tz[3], 456);
eq('Z1 seconds', tz[1], 0);

console.log('\nHIKING — Urke to Patchellhytta');
const urke = { distance_km: 7.84, ascent_m: 641, elapsed_s: 14700, moving_s: 12240, avg_hr: 128 };
eq('Naismith hours', Math.round(Calc.naismithHours(7.84, 641) * 100) / 100, 2.64, 0.01);
eq('terrain factor', Calc.terrainFactor(urke), 1.29, 0.01);
eq('ascent rate m/h', Calc.ascentRate(urke).value, 189, 1);
eq('ascent rate basis', Calc.ascentRate(urke).basis, 'moving');
eq('stop share', Math.round(Calc.stopShare(urke) * 100), 17);
eq('HR unreliable', Calc.hrIsReliable(urke), false);
eq('flat equivalent', Calc.flatEquivKm(urke), 13.18, 0.01);

console.log('\nWEEKS AND GAPS');
eq('ISO week of 13 Aug 2026', Calc.isoWeek('2026-08-13'), '2026-W33');
eq('week starts Monday', Calc.weekStart('2026-08-13'), '2026-08-10');
eq('Sunday belongs to its week', Calc.weekStart('2026-08-16'), '2026-08-10');
eq('Monday belongs to itself', Calc.weekStart('2026-08-10'), '2026-08-10');
eq('Thursday is day 3', Calc.dayIndex('2026-08-13'), 3);
const series = [
  { date: '2025-11-24' }, { date: '2025-11-29' }, { date: '2025-12-08' },
  { date: '2026-08-11' }, { date: '2026-08-13' }
];
const segs = Calc.splitOnGaps(series);
eq('gap breaks the series', segs.length, 2);
eq('first segment length', segs[0].length, 3);
eq('second segment length', segs[1].length, 2);

console.log('\nWEEK ROLLUP — week 33, cut at Friday');
const acts = [
  { id: 'a', type: 'run', date: '2026-08-11', distance_km: 5.36, elapsed_s: 2501, ascent_m: 82 },
  { id: 'b', type: 'run', date: '2026-08-13', distance_km: 3.01, elapsed_s: 1337, ascent_m: null },
  { id: 't', type: 'test', date: '2026-08-12', distance_km: 4.74, elapsed_s: 2357 }
];
const wk = Calc.weekRollup(acts, '2026-08-10', 4);
eq('two activities', wk.count, 2);
eq('test excluded', wk.activities.every(a => a.type !== 'test'), true);
eq('distance', wk.distance_km, 8.37);
eq('ascent counts only what is known', wk.ascent_m, 82);
eq('ascent coverage', wk.ascent_of + ' of ' + wk.ascent_total_acts, '1 of 2');

console.log('\nCONFIDENCE');
eq('no data is empty', Calc.confidence(0, 'cost_trend').state, 'empty');
eq('two runs is building', Calc.confidence(2, 'cost_trend').state, 'building');
eq('three more needed', Calc.confidence(2, 'cost_trend').need, 3);
eq('five is live', Calc.confidence(5, 'cost_trend').state, 'live');

console.log('\nPARSER');
const paste = [
  '| Metric | Value |', '|---|---|',
  '| Date | 13 Aug 2026 |', '| Temperature | 19° |',
  '| Total Distance | 3.01 km |', '| Total Time | 22:17 |',
  '| Avg Pace | 7:24 /km |', '| Avg Grade-Adj Pace | 7:16 /km |',
  '| Avg HR | 143 bpm |', '| Max HR | 157 bpm |',
  '| Avg Cadence | 171 spm |', '| Total Ascent | — |',
  '| RPE | 5 / 10 |', '| Feel | Strong |', '',
  '| Lap | Dist | Time | Pace | HR | Role |', '|---|---|---|---|---|---|',
  '| 1 | 1.00 km | 7:10 | 7:10 | 133 | main |',
  '| 2 | 1.00 km | 7:24 | 7:24 | 143 | main |',
  '| 3 | 1.00 km | 7:36 | 7:36 | 149 | main |',
  '| 4 | 0.01 km | 0:07 | — | — | main |',
  'Missing field: Total Ascent'
].join('\n');
const p = Parse.parse(paste, { today: '2026-08-14' });
eq('date', p.fields.date, '2026-08-13');
eq('distance', p.fields.distance_km, 3.01);
eq('elapsed seconds', p.fields.elapsed_s, 1337);
eq('gap pace seconds', p.fields.gap_pace_s, 436);
eq('max HR dropped', p.fields.max_hr, undefined);
eq('temperature', p.fields.temp_c, 19);
eq('rpe', p.fields.rpe, 5);
eq('four laps', p.laps.length, 4);
eq('lap 3 HR', p.laps[2].avg_hr, 149);
eq('transcription note kept', p.notes.length, 1);
eq('no errors', Parse.validate(p, { today: '2026-08-14' }).filter(f => f.level === 'error').length, 0);

console.log('\nPARSER — year inference and durations');
eq('1 Dec with no year', Parse._date('1 Dec', '2026-08-14').value, '2025-12-01');
eq('inferred flag set', Parse._date('1 Dec', '2026-08-14').inferredYear, true);
eq('Saturday 29 Nov', Parse._date('Saturday 29 Nov', '2026-08-14').value, '2025-11-29');
eq('8 Dec (Monday)', Parse._date('8 Dec (Monday)', '2026-08-14').value, '2025-12-08');
eq('explicit year wins', Parse._date('13 Aug 2026', '2026-08-14').value, '2026-08-13');
eq('ISO passes through', Parse._date('2025-10-08', '2026-08-14').value, '2025-10-08');
eq('h:mm:ss', Parse._duration('1:32:49'), 5569);
eq('mm:ss', Parse._duration('22:17'), 1337);
eq('tenths', Parse._duration('6:52.6'), 412);

console.log('\nPARSER — bad data is flagged, not swallowed');
const bad = Parse.parse([
  '| Date | 13 Aug 2026 |', '| Total Distance | 3.01 km |', '| Total Time | 22:17 |',
  '| Avg HR | 143 bpm |', '| Moving Time | 30:00 |',
  '| 1 | 1.00 km | 7:10 | 133 |', '| 2 | 1.00 km | 7:24 | 143 |'
].join('\n'), { today: '2026-08-14' });
const bf = Parse.validate(bad, { today: '2026-08-14' });
eq('moving > elapsed caught', bf.some(f => /Moving time is longer/.test(f.msg)), true);
eq('lap distance mismatch caught', bf.some(f => /Laps total/.test(f.msg)), true);

console.log('\nREAL-DATA INCONSISTENCY — 26 Oct 2025 as transcribed');
const oct26 = Parse.parse([
  '| Date | 26 Oct 2025 |', '| Total Distance | 10.10 km |',
  '| Total Time | 1:08:39 |', '| Avg Pace | 7:44 /km |', '| Avg HR | 137 bpm |'
].join('\n'), { today: '2026-08-14' });
eq('pace mismatch is caught', Parse.validate(oct26, { today: '2026-08-14' })
  .some(f => /Stated pace does not match/.test(f.msg)), true);

console.log('\nHIKE INFERENCE');
const hikePaste = Parse.parse([
  '| Date | 14 Aug 2026 |', '| Total Distance | 7.84 km |',
  '| Elapsed Time | 4:05:00 |', '| Moving Time | 3:24:00 |',
  '| Total Ascent | 641 m |', '| Avg HR | 128 bpm |'
].join('\n'), { today: '2026-08-14' });
eq('inferred as hike', Parse.inferType(hikePaste), 'hike');
eq('elapsed parsed', hikePaste.fields.elapsed_s, 14700);
eq('moving parsed', hikePaste.fields.moving_s, 12240);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
