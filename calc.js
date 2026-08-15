/* calc.js — all derived values. Pure functions, no DOM, no storage.
   Loaded in the browser as a global, and require()d by tests. */

(function (root) {
  'use strict';

  /* ---------- config defaults ---------- */

  const DEFAULT_CONFIG = {
    max_hr: 185,
    resting_hr: 53,
    lthr: 168,
    max_hr_dated: '2025-11-06',
    resting_hr_dated: '2026-08-14',
    lthr_dated: '2025-11-20',
    FLAT_KMH: 5,
    ASCENT_MH: 600,
    STOP_SHARE_LIMIT: 0.15,
    GAP_DAYS: 21
  };

  /* ---------- zones (Karvonen) ---------- */

  function zoneBounds(cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const hrr = c.max_hr - c.resting_hr;
    const at = p => Math.round(c.resting_hr + p * hrr);
    return {
      hrr: hrr,
      z2: at(0.60),   // Z1 below this
      z3: at(0.70),   // Z2 below this
      z4: at(0.80),
      z5: at(0.90)
    };
  }

  function zoneOf(hr, bounds) {
    if (hr == null) return null;
    if (hr < bounds.z2) return 1;
    if (hr < bounds.z3) return 2;
    if (hr < bounds.z4) return 3;
    if (hr < bounds.z5) return 4;
    return 5;
  }

  /* ---------- pace ---------- */

  function paceSecPerKm(distance_km, seconds) {
    if (!distance_km || distance_km <= 0 || seconds == null) return null;
    return seconds / distance_km;
  }

  function fmtPace(secPerKm) {
    if (secPerKm == null) return '—';
    const s = Math.round(secPerKm);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fmtDuration(seconds) {
    if (seconds == null) return '—';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return m + ':' + String(sec).padStart(2, '0');
  }

  /* ---------- laps ---------- */

  const PARTIAL_KM = 0.5;

  function fullLaps(laps) {
    return (laps || []).filter(l => l.distance_km >= PARTIAL_KM);
  }

  function mainLaps(laps) {
    const full = fullLaps(laps);
    const tagged = full.filter(l => (l.role || 'main') === 'main');
    return tagged.length ? tagged : full;
  }

  function hasLapHr(laps) {
    return mainLaps(laps).some(l => l.avg_hr != null);
  }

  /* time-weighted mean HR over the given laps */
  function weightedHr(laps) {
    let num = 0, den = 0;
    laps.forEach(l => {
      if (l.avg_hr != null && l.time_s) { num += l.avg_hr * l.time_s; den += l.time_s; }
    });
    return den ? num / den : null;
  }

  /* ---------- aerobic cost (beats per km) ---------- */

  function aerobicCost(act) {
    if (!act || act.avg_hr == null) return null;

    const full = fullLaps(act.laps);
    const tagged = (act.laps || []).some(l => l.role && l.role !== 'main');
    const usable = full.length > 0 && full.every(l => l.time_s != null && l.distance_km != null);

    let scope = 'whole', dist = act.distance_km, secs = act.elapsed_s,
        hr = act.avg_hr, approx = false;

    if (tagged && usable) {
      const m = mainLaps(act.laps);
      if (m.length) {
        scope = 'main';
        dist = m.reduce((a, l) => a + l.distance_km, 0);
        secs = m.reduce((a, l) => a + l.time_s, 0);
        const lapHr = m.every(l => l.avg_hr != null) ? weightedHr(m) : null;
        hr = lapHr != null ? lapHr : act.avg_hr;
        approx = lapHr == null;
      }
    }

    if (hr == null || !dist || !secs) return null;

    let paceSec = paceSecPerKm(dist, secs);
    let basis = 'raw';
    let scaled = false;

    if (act.gap_pace_s != null) {
      const wholePace = paceSecPerKm(act.distance_km, act.elapsed_s);
      if (scope === 'whole') {
        paceSec = act.gap_pace_s;
        basis = 'gap';
      } else if (wholePace) {
        // apply the whole-run gradient correction to the main-lap pace
        paceSec = paceSec * (act.gap_pace_s / wholePace);
        basis = 'gap';
        scaled = true;
      }
    }

    return {
      value: Math.round(hr * (paceSec / 60)),
      basis: basis,
      scope: scope,
      hr_approx: approx,
      gap_scaled: scaled
    };
  }

  /* ---------- drift ---------- */

  /* Cardiac drift. The first full kilometre is dropped: heart rate climbing
     from rest at the start of a run is not drift, and including it makes every
     run look like it drifted. That leaves a four-kilometre minimum. */
  function drift(laps, opts) {
    const tagged = (laps || []).some(l => l.role && l.role !== 'main');
    let m = mainLaps(laps).filter(l => l.avg_hr != null);
    if (!tagged) m = m.slice(1);          // untagged: drop the opening km
    if (m.length < 3) return null;
    const n = Math.ceil(m.length / 3);
    const mean = arr => arr.reduce((a, l) => a + l.avg_hr, 0) / arr.length;
    return Math.round(mean(m.slice(-n)) - mean(m.slice(0, n)));
  }

  /* How many more full laps a run needs before drift can be computed. */
  function driftNeeds(laps) {
    const tagged = (laps || []).some(l => l.role && l.role !== 'main');
    let m = mainLaps(laps).filter(l => l.avg_hr != null);
    if (!tagged) m = m.slice(1);
    return Math.max(0, 3 - m.length);
  }

  /* ---------- time in zone ---------- */

  function timeInZone(laps, bounds) {
    const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 };
    (laps || []).forEach(l => {
      const z = zoneOf(l.avg_hr, bounds);
      if (z == null) out.unknown += l.time_s || 0;
      else out[z] += l.time_s || 0;
    });
    return out;
  }

  /* ---------- hiking ---------- */

  function stopShare(act) {
    if (!act || act.moving_s == null || !act.elapsed_s) return null;
    return (act.elapsed_s - act.moving_s) / act.elapsed_s;
  }

  function hrIsReliable(act, cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const ss = stopShare(act);
    if (ss == null) return true;
    return ss <= c.STOP_SHARE_LIMIT;
  }

  function ascentRate(act) {
    if (!act || act.ascent_m == null) return null;
    const secs = act.moving_s != null ? act.moving_s : act.elapsed_s;
    if (!secs) return null;
    return {
      value: Math.round(act.ascent_m / (secs / 3600)),
      basis: act.moving_s != null ? 'moving' : 'elapsed'
    };
  }

  function naismithHours(distance_km, ascent_m, cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    if (distance_km == null || ascent_m == null) return null;
    return distance_km / c.FLAT_KMH + ascent_m / c.ASCENT_MH;
  }

  function terrainFactor(act, cfg) {
    if (!act || act.moving_s == null) return null;
    const n = naismithHours(act.distance_km, act.ascent_m, cfg);
    if (!n) return null;
    return Math.round((act.moving_s / 3600) / n * 100) / 100;
  }

  function flatEquivKm(act, cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    if (!act || act.distance_km == null || act.ascent_m == null) return null;
    return Math.round((act.distance_km + act.ascent_m * c.FLAT_KMH / c.ASCENT_MH) * 100) / 100;
  }

  /* ---------- baselines ---------- */

  function comparable(act, all) {
    if (!act || act.distance_km == null) return [];
    const lo = act.distance_km * 0.8, hi = act.distance_km * 1.2;
    return all
      .filter(a => a.id !== act.id)
      .filter(a => a.type === act.type && a.source === 'tracked' && a.type !== 'test')
      .filter(a => a.distance_km >= lo && a.distance_km <= hi)
      .filter(a => a.date <= act.date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }

  function median(nums) {
    const x = nums.filter(n => n != null).slice().sort((a, b) => a - b);
    if (!x.length) return null;
    const mid = Math.floor(x.length / 2);
    return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
  }

  /* ---------- dates and weeks ---------- */

  function isoWeek(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = (d.getDay() + 6) % 7;          // Mon = 0
    d.setDate(d.getDate() - day + 3);          // Thursday of this week
    const firstThu = new Date(d.getFullYear(), 0, 4);
    const fday = (firstThu.getDay() + 6) % 7;
    firstThu.setDate(firstThu.getDate() - fday + 3);
    const week = 1 + Math.round((d - firstThu) / 604800000);
    return d.getFullYear() + '-W' + String(week).padStart(2, '0');
  }

  function weekStart(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }

  function dayIndex(dateStr) {            // Mon = 0 .. Sun = 6
    return (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7;
  }

  function daysBetween(a, b) {
    return Math.round(
      (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000
    );
  }

  /* Split a date-ordered series wherever the gap exceeds GAP_DAYS. */
  function splitOnGaps(sorted, cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const out = [];
    let run = [];
    sorted.forEach(a => {
      if (run.length && daysBetween(run[run.length - 1].date, a.date) > c.GAP_DAYS) {
        out.push(run); run = [];
      }
      run.push(a);
    });
    if (run.length) out.push(run);
    return out;
  }

  /* ---------- rollups ---------- */

  function weekRollup(acts, weekStartDate, cutDayIndex) {
    const end = cutDayIndex == null ? 6 : cutDayIndex;
    const inWeek = acts.filter(a =>
      ACTIVITY_TYPES.indexOf(a.type) >= 0 &&
      weekStart(a.date) === weekStartDate &&
      dayIndex(a.date) <= end
    );
    const sum = (f) => inWeek.reduce((t, a) => t + (a[f] || 0), 0);
    const ascentKnown = inWeek.filter(a => a.ascent_m != null);
    return {
      count: inWeek.length,
      distance_km: Math.round(sum('distance_km') * 100) / 100,
      elapsed_s: sum('elapsed_s'),
      ascent_m: ascentKnown.length ? ascentKnown.reduce((t, a) => t + a.ascent_m, 0) : null,
      ascent_of: ascentKnown.length,
      ascent_total_acts: inWeek.length,
      activities: inWeek
    };
  }

  function monthRollup(acts, ym) {          // ym = 'YYYY-MM'
    const inMonth = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && a.date.slice(0, 7) === ym);
    const ascentKnown = inMonth.filter(a => a.ascent_m != null && a.source === 'tracked');
    const sum = (f) => inMonth.reduce((t, a) => t + (a[f] || 0), 0);
    return {
      count: inMonth.length,
      distance_km: Math.round(sum('distance_km') * 100) / 100,
      elapsed_s: sum('elapsed_s'),
      ascent_m: ascentKnown.length ? ascentKnown.reduce((t, a) => t + a.ascent_m, 0) : null,
      ascent_of: ascentKnown.length,
      ascent_total_acts: inMonth.length
    };
  }

  /* ---------- confidence ---------- */

  const NEEDS = {
    week_vs_last: 2,
    rolling_4w: 8,
    baseline: 5,
    cost_trend: 5,
    drift_trend: 5,
    terrain_trend: 5,
    fit_flat_kmh: 8
  };

  function confidence(have, key) {
    const need = NEEDS[key];
    if (have >= need) return { state: 'live', need: 0 };
    if (have > 0) return { state: 'building', need: need - have };
    return { state: 'empty', need: need };
  }

  /* ---------- model: shape, ids, duplicates, migrations ---------- */

  const SCHEMA = 2;

  function newId(type, date) {
    const r = Math.random().toString(36).slice(2, 6);
    return type + '-' + date + '-' + r;
  }

  const BLANK = {
    id: null, type: 'run', date: null, name: '', source: 'tracked',
    distance_km: null, elapsed_s: null, moving_s: null,
    ascent_m: null, descent_m: null, ele_min_m: null, ele_max_m: null,
    temp_c: null, avg_hr: null, resting_hr: null, gap_pace_s: null, cadence_spm: null,
    rpe: null, feel: null, conditions: null, pack: null, note: null,
    sleep_s: null, sleep_score: null, hrv_ms: null,
    laps: [], created_at: null, updated_at: null
  };

  function make(partial) {
    const a = Object.assign({}, BLANK, partial || {});
    const now = new Date().toISOString();
    if (!a.id) a.id = newId(a.type, a.date || 'undated');
    a.created_at = a.created_at || now;
    a.updated_at = now;
    if (a.type === 'day') a.name = a.date || '';
    if (!a.name) {
      const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = a.date ? (+a.date.slice(8)) + ' ' + M[+a.date.slice(5, 7) - 1] : 'undated';
      a.name = (a.type === 'hike' ? 'Hike' : 'Run') + ' \u00b7 ' + d;
    }
    return a;
  }

  /* same type + date + distance within 50 m */
  function findDuplicate(act, all) {
    return all.find(a =>
      a.id !== act.id &&
      a.type === act.type &&
      a.date === act.date &&
      a.distance_km != null && act.distance_km != null &&
      Math.abs(a.distance_km - act.distance_km) <= 0.05
    ) || null;
  }

  function migrate(bundle) {
    const b = bundle || {};
    if (!b.schema) b.schema = SCHEMA;
    b.activities = b.activities || [];
    b.config = b.config || {};
    /* names written as "Run, 2026-08-11" predate the readable format */
    if (b.schema < 2) {
      const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      b.activities.forEach(a => {
        const m = /^(Run|Hike), (\d{4})-(\d{2})-(\d{2})$/.exec(a.name || '');
        if (m) a.name = m[1] + ' \u00b7 ' + (+m[4]) + ' ' + M[+m[3] - 1];
      });
    }
    b.schema = SCHEMA;
    return b;
  }

  const Model = { SCHEMA, BLANK, make, newId, findDuplicate, migrate };

  /* ---------- periods: week / month / year / all ---------- */

  function periodKey(dateStr, scope) {
    if (scope === 'week') return weekStart(dateStr);
    if (scope === 'month') return dateStr.slice(0, 7);
    if (scope === 'year') return dateStr.slice(0, 4);
    return 'all';
  }

  function shiftKey(key, scope, delta) {
    if (scope === 'all') return 'all';
    if (scope === 'week') {
      const d = new Date(key + 'T12:00:00');
      d.setDate(d.getDate() + delta * 7);
      return d.toISOString().slice(0, 10);
    }
    if (scope === 'month') {
      let y = +key.slice(0, 4), m = +key.slice(5) + delta;
      y += Math.floor((m - 1) / 12);
      m = ((m - 1) % 12 + 12) % 12 + 1;
      return y + '-' + String(m).padStart(2, '0');
    }
    return String(+key + delta);
  }

  function inPeriod(act, scope, key) {
    if (scope === 'all') return true;
    return periodKey(act.date, scope) === key;
  }

  /** Human label for a period key. */
  function periodLabel(key, scope, todayStr) {
    const today = todayStr || new Date().toISOString().slice(0, 10);
    if (scope === 'all') return 'All time';
    if (scope === 'year') return key;
    if (scope === 'month') {
      const M = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
      return M[+key.slice(5) - 1] + ' ' + key.slice(0, 4);
    }
    /* a week label without its year is a trap: "Week 50" read as recent when it
       was December of last year */
    const parts = isoWeek(key).split('-W');
    const sameYear = parts[0] === today.slice(0, 4);
    return 'Week ' + parts[1] + (sameYear ? '' : ' ' + parts[0]);
  }

  /** Sub-line under the title: the span, plus whether it is still running. */
  function periodSpan(key, scope, todayStr) {
    const today = todayStr || new Date().toISOString().slice(0, 10);
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const cur = periodKey(today, scope) === key;
    if (scope === 'all') return 'EVERYTHING LOGGED';
    if (scope === 'year') return cur ? 'YEAR TO DATE' : 'FULL YEAR';
    if (scope === 'month') {
      const last = cur ? +today.slice(8) : new Date(+key.slice(0,4), +key.slice(5), 0).getDate();
      return '1\u2013' + last + ' ' + M[+key.slice(5) - 1] + (cur ? ' \u00b7 MONTH TO DATE' : '');
    }
    const a = new Date(key + 'T12:00:00');
    const b = new Date(key + 'T12:00:00'); b.setDate(b.getDate() + 6);
    const span = a.getDate() + '\u2013' + b.getDate() + ' ' + M[b.getMonth()] + ' ' + b.getFullYear();
    return span + (cur ? ' \u00b7 THIS WEEK' : '');
  }

  const ACTIVITY_TYPES = ['run', 'hike'];

  function summarize(acts) {
    const real = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0);
    const ascentKnown = real.filter(a => a.ascent_m != null && a.source === 'tracked');
    const days = {};
    real.forEach(a => { days[a.date] = 1; });
    return {
      count: real.length,
      days: Object.keys(days).length,
      distance_km: Math.round(real.reduce((t, a) => t + (a.distance_km || 0), 0) * 100) / 100,
      elapsed_s: real.reduce((t, a) => t + (a.elapsed_s || 0), 0),
      moving_s: real.reduce((t, a) => t + (a.moving_s != null ? a.moving_s : a.elapsed_s || 0), 0),
      ascent_m: ascentKnown.length ? ascentKnown.reduce((t, a) => t + a.ascent_m, 0) : null,
      ascent_of: ascentKnown.length,
      activities: real
    };
  }

  /** Bars for the period ribbon. metric: 'distance' | 'ascent'. */
  function ribbon(acts, scope, selectedKey, n, metric) {
    const out = [];
    let key = selectedKey;
    for (let i = 0; i < n; i++) { out.unshift(key); key = shiftKey(key, scope, -1); }
    return out.map(k => {
      const inK = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && inPeriod(a, scope, k));
      const s = summarize(inK);
      const v = metric === 'ascent' ? (s.ascent_m || 0) : s.distance_km;
      return { key: k, value: v, count: s.count, selected: k === selectedKey };
    });
  }

  /** Most recent period before `key` that actually has something in it. */
  function previousWithData(acts, scope, key) {
    let k = shiftKey(key, scope, -1);
    for (let i = 0; i < 60; i++) {
      if (acts.some(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && inPeriod(a, scope, k))) return k;
      k = shiftKey(k, scope, -1);
    }
    return null;
  }

  /** Nearest period after `key` that has something in it. */
  function nextWithData(acts, scope, key) {
    let k = shiftKey(key, scope, 1);
    for (let i = 0; i < 60; i++) {
      if (acts.some(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && inPeriod(a, scope, k))) return k;
      k = shiftKey(k, scope, 1);
    }
    return null;
  }

  /** How many periods of empty sit immediately before `key`. */
  function emptyRunBefore(acts, scope, key) {
    let k = shiftKey(key, scope, -1), n = 0;
    for (let i = 0; i < 400; i++) {
      if (acts.some(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && inPeriod(a, scope, k))) return n;
      n++; k = shiftKey(k, scope, -1);
    }
    return n;
  }

  function medianCost(acts, costFn) {
    return median(acts.filter(a => a.type !== 'test').map(a => {
      const c = costFn(a); return c ? c.value : null;
    }));
  }

  /* ---------- aerobic pace: cost expressed in min/km ---------- */

  /* Aerobic cost is HR x pace. Divide by a fixed heart rate and it becomes the
     pace you would hold at that heart rate — same measurement, readable units.
     The reference is the top of Z2, so it follows the anchors; re-anchoring
     rescales every value by the same factor and never changes the shape. */
  function refHr(cfg) { return zoneBounds(cfg).z3; }

  function aerobicPace(act, cfg) {
    const c = aerobicCost(act);
    if (!c) return null;
    return c.value / refHr(cfg) * 60;      // seconds per km
  }

  const PACE_WINDOW = 20;

  /* Date-ordered pace series, split wherever training stopped.
     `limit` keeps the most recent n runs: an early block sets a floor the scale
     never escapes otherwise, and six months from now three ancient points would
     flatten everything worth seeing. Pass 0 for the whole history. */
  function paceSeries(acts, cfg, limit) {
    const n = limit === undefined ? PACE_WINDOW : limit;
    let runs = acts
      .filter(a => a.type === 'run' && a.avg_hr != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = runs.length;
    if (n && total > n) runs = runs.slice(total - n);
    const segs = splitOnGaps(runs, cfg).map(seg =>
      seg.map(a => ({ id: a.id, date: a.date, name: a.name, value: aerobicPace(a, cfg) }))
         .filter(p => p.value != null)
    ).filter(seg => seg.length);
    segs.total = total;
    segs.shown = runs.length;
    return segs;
  }

  /* Cumulative ascent through a calendar year, as {frac, total} points. */
  function cumulativeAscent(acts, year) {
    const inYear = acts
      .filter(a => a.type === 'hike' && a.date.slice(0, 4) === String(year) && a.ascent_m != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const start = new Date(year + '-01-01T12:00:00');
    const days = ((+year % 4 === 0 && +year % 100 !== 0) || +year % 400 === 0) ? 366 : 365;
    let total = 0;
    const pts = [{ frac: 0, total: 0, date: year + '-01-01' }];
    inYear.forEach(a => {
      total += a.ascent_m;
      const doy = Math.round((new Date(a.date + 'T12:00:00') - start) / 86400000);
      pts.push({ frac: doy / days, total: total, date: a.date });
    });
    return pts;
  }

  function ascentRateSeries(acts) {
    return acts
      .filter(a => a.type === 'hike' && a.source === 'tracked')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(a => { const r = ascentRate(a); return r ? { date: a.date, value: r.value } : null; })
      .filter(Boolean);
  }

  /* ---------- records ---------- */

  function records(acts, cfg, type) {
    const mine = acts.filter(a => a.type === type);
    if (!mine.length) return [];
    const out = [];
    const by = (arr, f, dir) => arr.filter(a => f(a) != null)
      .sort((a, b) => dir === 'min' ? f(a) - f(b) : f(b) - f(a))[0];

    if (type === 'run') {
      const best = by(mine, a => aerobicPace(a, cfg), 'min');
      if (best) out.push({ label: 'Best aerobic pace', value: fmtPace(aerobicPace(best, cfg)), unit: '/km', when: best.date, id: best.id });
      const far = by(mine, a => a.distance_km, 'max');
      if (far) out.push({ label: 'Longest run', value: far.distance_km.toFixed(2), unit: 'km', when: far.date, id: far.id });
      const weeks = {};
      mine.forEach(a => { const k = weekStart(a.date); weeks[k] = (weeks[k] || 0) + (a.distance_km || 0); });
      const bw = Object.keys(weeks).sort((a, b) => weeks[b] - weeks[a])[0];
      if (bw) out.push({ label: 'Biggest week', value: weeks[bw].toFixed(1), unit: 'km', when: bw });
      const drifts = mine.map(a => ({ a: a, d: drift(a.laps) })).filter(x => x.d != null);
      if (drifts.length) {
        const low = drifts.sort((x, y) => x.d - y.d)[0];
        out.push({ label: 'Lowest drift', value: (low.d >= 0 ? '+' : '') + low.d, unit: 'bpm',
          when: drifts.length > 1 ? low.a.date : 'only one measured', id: low.a.id });
      }
    } else {
      const high = by(mine, a => a.ascent_m, 'max');
      if (high) out.push({ label: 'Biggest day', value: high.ascent_m, unit: 'm', when: high.date, id: high.id });
      const rate = by(mine, a => { const r = ascentRate(a); return r && r.value; }, 'max');
      if (rate) out.push({ label: 'Fastest climb', value: ascentRate(rate).value, unit: 'm/h', when: rate.date, id: rate.id });
      const months = {};
      mine.forEach(a => { if (a.ascent_m == null) return;
        const k = a.date.slice(0, 7); months[k] = (months[k] || 0) + a.ascent_m; });
      const bm = Object.keys(months).sort((a, b) => months[b] - months[a])[0];
      if (bm) out.push({ label: 'Biggest month', value: months[bm], unit: 'm', when: bm });
      const tf = by(mine, a => terrainFactor(a, cfg), 'min');
      if (tf) out.push({ label: 'Best terrain factor', value: terrainFactor(tf, cfg).toFixed(2), unit: '', when: tf.date, id: tf.id });
    }
    return out;
  }

  /* ---------- deltas ---------- */

  /* betterWhen: 'down' | 'up' | null. Null means direction is shown without a
     verdict — a shorter week may be a recovery week, and the app doesn't know. */
  function delta(value, baseline, betterWhen) {
    if (value == null || baseline == null || !baseline) return null;
    const diff = value - baseline;
    const pct = diff / baseline * 100;
    const dir = Math.abs(pct) < 0.5 ? 'flat' : (diff > 0 ? 'up' : 'down');
    let tone = 'flat';
    if (dir !== 'flat' && betterWhen) tone = (dir === betterWhen) ? 'good' : 'bad';
    else if (dir !== 'flat') tone = 'neutral';
    return { diff: diff, pct: pct, dir: dir, tone: tone };
  }

  /* ---------- resting heart rate ---------- */

  /* 90-day rolling median. This is what the Karvonen anchor follows. */
  function restingBaseline(acts, asOf) {
    const end = asOf || new Date().toISOString().slice(0, 10);
    const start = new Date(end + 'T12:00:00');
    start.setDate(start.getDate() - 90);
    const from = start.toISOString().slice(0, 10);
    const vals = restingSeries(acts).filter(p => p.date >= from && p.date <= end).map(p => p.value);
    return vals.length >= 3 ? median(vals) : null;
  }

  /* The anchor only moves on a shift of 2 bpm or more, so aerobic pace never
     drifts for reasons that have nothing to do with fitness. */
  function suggestedRestingAnchor(acts, cfg, asOf) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const b = restingBaseline(acts, asOf);
    if (b == null) return null;
    const rounded = Math.round(b);
    return Math.abs(rounded - c.resting_hr) >= 2 ? rounded : null;
  }

  /* ---------- spread and significance ---------- */

  /* Median absolute deviation, scaled to be comparable with a std deviation. */
  function spread(values) {
    if (!values || values.length < 2) return null;
    const m = median(values);
    return median(values.map(v => Math.abs(v - m))) * 1.4826;
  }

  const NOTICE = { window: 6, minPrior: 4, threshold: 2, floorSeconds: 6 };

  /* Did this run move meaningfully against the ones before it?
     Compares aerobic pace within the same length band where possible. */
  function noticed(act, acts, cfg) {
    if (!act || act.type !== 'run') return null;
    const value = aerobicPace(act, cfg);
    if (value == null) return null;

    const lo = act.distance_km * 0.8, hi = act.distance_km * 1.2;
    const earlier = acts
      .filter(a => a.type === 'run' && a.id !== act.id && a.date <= act.date && a.avg_hr != null)
      .sort((a, b) => b.date.localeCompare(a.date));

    let banded = earlier.filter(a => a.distance_km >= lo && a.distance_km <= hi);
    const useBand = banded.length >= NOTICE.minPrior;
    const pool = (useBand ? banded : earlier).slice(0, NOTICE.window);
    if (pool.length < NOTICE.minPrior) return null;

    const vals = pool.map(a => aerobicPace(a, cfg)).filter(v => v != null);
    if (vals.length < NOTICE.minPrior) return null;

    const base = median(vals);
    const sd = Math.max(NOTICE.floorSeconds, spread(vals) || NOTICE.floorSeconds);
    const gain = base - value;                      // positive means faster
    const ratio = gain / sd;
    if (ratio < NOTICE.threshold) return null;

    return {
      value: value, baseline: base, spread: sd, gain: gain, ratio: ratio,
      n: vals.length, banded: useBand, lo: lo, hi: hi
    };
  }

  /* ---------- weekly series, for the read and the zone chart ---------- */

  function weekKeys(acts, n, endKey) {
    const end = endKey || weekStart(new Date().toISOString().slice(0, 10));
    const out = [];
    let k = end;
    for (let i = 0; i < n; i++) { out.unshift(k); k = shiftKey(k, 'week', -1); }
    return out;
  }

  function zoneShareSeries(acts, cfg, n, endKey) {
    const bounds = zoneBounds(cfg);
    return weekKeys(acts, n, endKey).map(k => {
      const inWeek = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && weekStart(a.date) === k);
      const laps = [];
      inWeek.forEach(a => (a.laps || []).forEach(l => laps.push(l)));
      const tz = timeInZone(laps, bounds);
      const total = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;
      return { key: k, zones: tz, total: total, distance_km: summarize(inWeek).distance_km };
    });
  }

  function weeklySeries(acts, n, endKey, field) {
    const bounds = null;
    return weekKeys(acts, n, endKey).map(k => {
      const inWeek = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && weekStart(a.date) === k);
      const s = summarize(inWeek);
      return { key: k, value: field === 'days' ? s.days : s.distance_km, count: s.count };
    });
  }

  /* ---------- the read ---------- */

  function windowStats(values, w) {
    w = w || 3;
    if (values.length < w * 2) return { now: values.length ? median(values.slice(-w)) : null, prev: null, need: w * 2 - values.length };
    return { now: median(values.slice(-w)), prev: median(values.slice(-w * 2, -w)), need: 0 };
  }

  /* A single observation has no range. Returning min == max produced tracks
     reading "+0 ... +0 lowest", which look like data and are not. */
  function rangeOf(values) {
    if (!values || values.length < 2) return null;
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (min === max) return null;
    return { min: min, max: max, n: values.length };
  }

  /* Values from the last 12 months, used for every track's endpoints. */
  function lastYear(acts, asOf) {
    const end = asOf || new Date().toISOString().slice(0, 10);
    const d = new Date(end + 'T12:00:00');
    d.setFullYear(d.getFullYear() - 1);
    const from = d.toISOString().slice(0, 10);
    return acts.filter(a => a.date >= from && a.date <= end);
  }

  function readRows(acts, cfg, type, asOf) {
    const count = arr => (arr || []).length;
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const year = type === 'body'
      ? lastYear(acts, asOf)
      : lastYear(acts.filter(a => a.type === type || a.type === 'test'), asOf);
    const mine = year.filter(a => a.type === type).sort((a, b) => a.date.localeCompare(b.date));
    const rows = [];

    const push = (o) => rows.push(o);

    if (type === 'body') {
      const rs = restingSeries(year).map(p => p.value);
      const rw = windowStats(rs);
      push({ n: rs.length, key: 'resting', label: 'Resting HR', unit: 'bpm', kind: 'int',
             now: rw.now, prev: rw.prev, need: rw.need, betterWhen: 'down',
             range: rangeOf(rs), band: rs.length >= 3 ? rangeOf(rs.slice(-3)) : null,
             bestLabel: 'lowest' });

      const sl = sleepSeries(year).map(p => p.value);
      const sw = windowStats(sl);
      push({ n: sl.length, key: 'sleep', label: 'Sleep', unit: 'median', kind: 'sleep',
             now: sw.now, prev: sw.prev, need: sw.need, betterWhen: 'up',
             range: rangeOf(sl), band: sl.length >= 3 ? rangeOf(sl.slice(-3)) : null,
             worstLabel: 'shortest', bestLabel: 'longest' });

      const hv = hrvSeries(year).map(p => p.value);
      const hw = windowStats(hv);
      push({ n: hv.length, key: 'hrv', label: 'Overnight HRV', unit: 'ms', kind: 'int',
             now: hw.now, prev: hw.prev, need: hw.need, betterWhen: 'up',
             range: rangeOf(hv), band: hv.length >= 3 ? rangeOf(hv.slice(-3)) : null,
             bestLabel: 'highest' });

      const sc = dayRecords(year).filter(d => d.sleep_score != null)
        .sort((a, b) => a.date.localeCompare(b.date)).map(d => d.sleep_score);
      const cw2 = windowStats(sc);
      push({ n: sc.length, key: 'score', label: 'Sleep score', unit: '', kind: 'int',
             now: cw2.now, prev: cw2.prev, need: cw2.need, betterWhen: 'up',
             range: rangeOf(sc), band: sc.length >= 3 ? rangeOf(sc.slice(-3)) : null,
             bestLabel: 'best' });
      return rows;
    }

    if (type === 'run') {
      const paces = mine.filter(a => a.avg_hr != null).map(a => aerobicPace(a, c)).filter(v => v != null);
      const w = windowStats(paces);
      push({ n: count(paces), key: 'pace', label: 'Aerobic pace', unit: '/km', kind: 'pace',
             now: w.now, prev: w.prev, need: w.need, betterWhen: 'down',
             range: rangeOf(paces), band: paces.length >= 3 ? rangeOf(paces.slice(-3)) : null,
             bestLabel: 'best', worstLabel: '' });

      const drifts = mine.map(a => drift(a.laps)).filter(v => v != null);
      const dw = windowStats(drifts);
      push({ n: count(drifts), key: 'drift', label: 'Drift', unit: 'bpm', kind: 'bpm',
             now: dw.now, prev: dw.prev, need: dw.need, betterWhen: 'down',
             range: rangeOf(drifts), band: drifts.length >= 3 ? rangeOf(drifts.slice(-3)) : null,
             bestLabel: 'lowest', missingNote: 'needs runs of 4 km or more with lap HR' });

      const zs = zoneShareSeries(mine, c, 12, asOf ? weekStart(asOf) : null)
        .filter(x => x.total > 0).map(x => x.zones[2] / x.total * 100);
      const zw = windowStats(zs);
      push({ n: count(zs), key: 'z2', label: 'Time in Z2', unit: '%', kind: 'pct',
             now: zw.now, prev: zw.prev, need: zw.need, betterWhen: 'up',
             range: rangeOf(zs), band: zs.length >= 3 ? rangeOf(zs.slice(-3)) : null,
             bestLabel: 'most' });

      /* Only weeks inside the current training block. Averaging across the
         eight months you weren't running is how you get "0 days/week" in a
         week you ran twice. */
      const blocks = splitOnGaps(mine, c);
      const blockStart = blocks.length ? weekStart(blocks[blocks.length - 1][0].date) : null;
      const days = weeklySeries(mine, 12, asOf ? weekStart(asOf) : null, 'days')
        .filter(x => blockStart == null || x.key >= blockStart)
        .map(x => x.value);
      const cw = windowStats(days);
      push({ n: count(days), key: 'days', label: 'Consistency', unit: 'days / week', kind: 'int',
             now: cw.now, prev: cw.prev, need: cw.need, betterWhen: 'up',
             range: rangeOf(days), band: null, bestLabel: 'most' });

      const loads = loadSeries(mine, c, 12, asOf ? weekStart(asOf) : null)
        .filter(x => blockStart == null || x.key >= blockStart)
        .map(x => x.value).filter(v => v > 0);
      const lw = windowStats(loads);
      push({ n: loads.length, key: 'load', label: 'Weekly load', unit: '', kind: 'int',
             now: lw.now, prev: lw.prev, need: lw.need, betterWhen: null,
             range: rangeOf(loads), band: loads.length >= 3 ? rangeOf(loads.slice(-3)) : null,
             worstLabel: 'least', bestLabel: 'most',
             note: 'Minutes weighted by how hard your heart was working. A bigger week is not automatically a better one.' });

      const vols = weeklySeries(mine, 12, asOf ? weekStart(asOf) : null, 'distance')
        .filter(x => blockStart == null || x.key >= blockStart)
        .map(x => x.value).filter(v => v > 0);
      const vw = windowStats(vols);
      push({ n: count(vols), key: 'volume', label: 'Weekly volume', unit: 'km', kind: 'km',
             now: vw.now, prev: vw.prev, need: vw.need, betterWhen: null,
             range: rangeOf(vols), band: vols.length >= 3 ? rangeOf(vols.slice(-3)) : null,
             worstLabel: 'least', bestLabel: 'most',
             note: 'Shown without a verdict \u2014 a short week may be the right week.' });
    } else {
      const rates = mine.map(a => { const r = ascentRate(a); return r && r.value; }).filter(Boolean);
      const rw = windowStats(rates);
      push({ n: count(rates), key: 'rate', label: 'Ascent rate', unit: 'm/h', kind: 'int',
             now: rw.now, prev: rw.prev, need: rw.need, betterWhen: 'up',
             range: rangeOf(rates), band: rates.length >= 3 ? rangeOf(rates.slice(-3)) : null,
             bestLabel: 'fastest' });

      const tfs = mine.map(a => terrainFactor(a, c)).filter(v => v != null);
      const tw = windowStats(tfs);
      push({ n: count(tfs), key: 'tf', label: 'Terrain factor', unit: '', kind: 'factor',
             now: tw.now, prev: tw.prev, need: tw.need, betterWhen: 'down',
             range: rangeOf(tfs), band: tfs.length >= 3 ? rangeOf(tfs.slice(-3)) : null,
             bestLabel: 'best' });

      const months = {};
      mine.forEach(a => { if (a.ascent_m == null) return;
        const k = a.date.slice(0, 7); months[k] = (months[k] || 0) + a.ascent_m; });
      const ms = Object.keys(months).sort().map(k => months[k]);
      const mw = windowStats(ms, 2);
      push({ n: count(ms), key: 'ascent', label: 'Monthly ascent', unit: 'm', kind: 'int',
             now: mw.now, prev: mw.prev, need: mw.need, betterWhen: null,
             range: rangeOf(ms), band: null, bestLabel: 'most' });
    }

    /* resting HR applies to both activity worlds */
    const rest = restingSeries(year).map(p => p.value);
    const restW = windowStats(rest);
    push({ n: count(rest), key: 'resting', label: 'Resting HR', unit: 'bpm', kind: 'int',
           now: restW.now, prev: restW.prev, need: restW.need, betterWhen: 'down',
           range: rangeOf(rest), band: rest.length >= 3 ? rangeOf(rest.slice(-3)) : null,
           bestLabel: 'lowest', missingNote: 'add Resting HR to the paste' });

    return rows;
  }

  /* ---------- Body: one record per day ----------
     Sundays bring a week of nights from the 7d screens; a run may also carry a
     resting HR read the same morning. Both are kept, and a day record always
     wins for its own date so a single morning can never hold two figures. */

  const DAY_FIELDS = ['resting_hr', 'sleep_s', 'sleep_score', 'hrv_ms'];

  function dayRecords(acts) {
    return acts.filter(a => a.type === 'day');
  }

  /* One value per date. Day records first, run-day readings only where no day
     record covers that date. */
  function restingByDate(acts) {
    const out = {};
    acts.filter(a => a.type !== 'day' && a.type !== 'test' && a.resting_hr != null)
        .forEach(a => { out[a.date] = { value: a.resting_hr, from: 'activity' }; });
    dayRecords(acts).filter(d => d.resting_hr != null)
        .forEach(d => { out[d.date] = { value: d.resting_hr, from: 'day' }; });
    return out;
  }

  function restingSeries(acts) {
    const by = restingByDate(acts);
    return Object.keys(by).sort().map(d => ({ date: d, value: by[d].value, from: by[d].from }));
  }

  /* Dates where a day record and an activity disagree by 3 bpm or more. */
  function restingConflicts(acts, threshold) {
    const t = threshold || 3;
    const byAct = {};
    acts.filter(a => a.type !== 'day' && a.type !== 'test' && a.resting_hr != null)
        .forEach(a => { byAct[a.date] = a.resting_hr; });
    return dayRecords(acts).filter(d => d.resting_hr != null && byAct[d.date] != null &&
      Math.abs(d.resting_hr - byAct[d.date]) >= t)
      .map(d => ({ date: d.date, day: d.resting_hr, activity: byAct[d.date] }));
  }

  function sleepSeries(acts) {
    return dayRecords(acts).filter(d => d.sleep_s != null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, value: d.sleep_s, score: d.sleep_score }));
  }

  function hrvSeries(acts) {
    return dayRecords(acts).filter(d => d.hrv_ms != null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, value: d.hrv_ms }));
  }

  function dayFor(acts, date) {
    return dayRecords(acts).find(d => d.date === date) || null;
  }

  /* Dates carrying an activity, for the training ticks under the RHR chart. */
  function trainedDates(acts) {
    const s = {};
    acts.filter(a => a.type === 'run' || a.type === 'hike').forEach(a => { s[a.date] = 1; });
    return s;
  }

  /* Two groups, compared only when the gap clears twice their spread — the same
     bar the noticing card uses. Never draws a trend line through fifteen dots. */
  function splitCompare(a, b, betterWhen) {
    if (!a || !b || a.length < 3 || b.length < 3) {
      return { enough: false, needA: Math.max(0, 3 - (a || []).length),
               needB: Math.max(0, 3 - (b || []).length) };
    }
    const ma = median(a), mb = median(b);
    /* Spread must be measured WITHIN each group. Pooling the raw values would
       fold the very difference we're testing into the yardstick, and a real gap
       would inflate the spread enough to hide itself. */
    const dev = a.map(v => Math.abs(v - ma)).concat(b.map(v => Math.abs(v - mb)));
    const sd = Math.max(median(dev) * 1.4826, 1e-9);
    const diff = ma - mb;
    return {
      enough: true, a: ma, b: mb, n: a.length, m: b.length,
      diff: diff, ratio: Math.abs(diff) / sd, spread: sd,
      significant: Math.abs(diff) / sd >= 2,
      betterWhen: betterWhen
    };
  }

  /* ---------- load ----------
     Banister TRIMP: minutes weighted by heart-rate reserve, exponentially, so a
     short hard effort can cost the same as a long easy one. Needs only average
     heart rate and the two anchors, so it works on every run already logged. */

  function load(act, cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    if (!act || act.avg_hr == null || !act.elapsed_s) return null;
    const reserve = c.max_hr - c.resting_hr;
    if (reserve <= 0) return null;
    const r = Math.max(0, Math.min(1, (act.avg_hr - c.resting_hr) / reserve));
    const minutes = (act.moving_s != null ? act.moving_s : act.elapsed_s) / 60;
    return Math.round(minutes * r * 0.64 * Math.exp(1.92 * r));
  }

  /* Foster session-RPE — minutes x perceived effort. Independent of the watch,
     so where both exist they cross-check each other. */
  function sessionRpe(act) {
    if (!act || act.rpe == null || !act.elapsed_s) return null;
    return Math.round(act.elapsed_s / 60 * act.rpe);
  }

  function loadSeries(acts, cfg, n, endKey) {
    return weekKeys(acts, n, endKey).map(k => {
      const inWeek = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && weekStart(a.date) === k);
      const total = inWeek.reduce((t, a) => t + (load(a, cfg) || 0), 0);
      return { key: k, value: total, count: inWeek.length };
    });
  }

  /* A week more than half again the one before it. Flagged, never judged — a
     jump can be exactly what you meant to do. */
  const RAMP_LIMIT = 0.5;

  function rampFlag(series) {
    if (!series || series.length < 2) return null;
    const now = series[series.length - 1], prev = series[series.length - 2];
    if (!prev.value || !now.value) return null;
    const change = (now.value - prev.value) / prev.value;
    return change >= RAMP_LIMIT
      ? { from: prev.value, to: now.value, change: change }
      : null;
  }

  /* Load by day of the week, for the strip under the header. */
  function weekDays(acts, cfg, weekKey) {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekKey + 'T12:00:00');
      d.setDate(d.getDate() + i);
      const date = d.toISOString().slice(0, 10);
      const onDay = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && a.date === date);
      const total = onDay.reduce((t, a) => t + (load(a, cfg) || 0), 0);
      const laps = [];
      onDay.forEach(a => (a.laps || []).forEach(l => laps.push(l)));
      const tz = timeInZone(laps, zoneBounds(cfg));
      let top = null, best = 0;
      [1, 2, 3, 4, 5].forEach(z => { if (tz[z] > best) { best = tz[z]; top = z; } });
      out.push({ date: date, dow: i, count: onDay.length, load: total, zone: top,
                 activities: onDay });
    }
    return out;
  }

  const api = {
    DEFAULT_CONFIG, NEEDS,
    zoneBounds, zoneOf,
    paceSecPerKm, fmtPace, fmtDuration,
    fullLaps, mainLaps, hasLapHr, weightedHr,
    aerobicCost, drift, timeInZone,
    stopShare, hrIsReliable, ascentRate,
    naismithHours, terrainFactor, flatEquivKm,
    comparable, median,
    isoWeek, weekStart, dayIndex, daysBetween, splitOnGaps,
    ACTIVITY_TYPES, weekRollup, monthRollup, confidence,
    periodKey, shiftKey, inPeriod, periodLabel, periodSpan, nextWithData,
    summarize, ribbon, previousWithData, emptyRunBefore, medianCost,
    refHr, aerobicPace, paceSeries, PACE_WINDOW, cumulativeAscent, ascentRateSeries,
    records, delta, driftNeeds,
    load, sessionRpe, loadSeries, rampFlag, weekDays, RAMP_LIMIT,
    restingSeries, restingBaseline, suggestedRestingAnchor,
    DAY_FIELDS, dayRecords, restingByDate, restingConflicts,
    sleepSeries, hrvSeries, dayFor, trainedDates, splitCompare,
    spread, noticed, NOTICE,
    weekKeys, zoneShareSeries, weeklySeries,
    windowStats, rangeOf, lastYear, readRows
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    module.exports.Model = Model;
  } else {
    root.Calc = api;
    root.Model = Model;
  }

})(typeof self !== 'undefined' ? self : this);
