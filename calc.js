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
    /* pinned when the metric was introduced; see refHr */
    /* The share of time you're aiming to spend in Z2. 70% is the usual
       base-building convention, not a law — it's yours to move. */
    z2_target: 70,
    pace_ref_hr: 145,
    pace_ref_dated: '2026-08-16',
    FLAT_KMH: 5,
    ASCENT_MH: 600,
    STOP_SHARE_LIMIT: 0.15,
    GAP_DAYS: 21
  };

  /* ---------- zones (Karvonen) ---------- */

  function zoneBounds(cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const hrr = c.max_hr - c.resting_hr;
    /* the watch's own zones, when the app has them: never recomputed */
    const w = c.watch_zones;
    if (w && w.z2 && w.z3 && w.z4 && w.z5)
      return { hrr: hrr, z2: w.z2, z3: w.z3, z4: w.z4, z5: w.z5, from: 'watch' };
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
    return (Array.isArray(laps) ? laps : [])
      .filter(l => l && typeof l.distance_km === 'number' && l.distance_km >= PARTIAL_KM);
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

  /* Terrain alone can move drift by a couple of beats on a rolling loop — a
     hill in the first or last third shifts it, one in the middle doesn't. So
     anything inside this is reported as flat rather than as a figure. */
  const DRIFT_FLAT = 3;

  /* Drift for one run: measured on the file's second-by-second record when the
     run has one, from lap averages when it hasn't. Same definition either way. */
  function driftOf(act) {
    if (!act || hrLocked(act)) return null;
    if (act.drift_bpm != null && act.drift_bpm !== '') return Number(act.drift_bpm);
    return drift(act.laps);
  }

  function driftIsFlat(d) { return d != null && Math.abs(d) <= DRIFT_FLAT; }

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
    if (isNaN(d.getTime())) return '----W--';
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
    if (isNaN(d.getTime())) return null;
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }

  function dayIndex(dateStr) {            // Mon = 0 .. Sun = 6
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return 0;
    return (d.getDay() + 6) % 7;
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
    rpe: null, feel: null, session: null, note: null, terrain: null, hr_trust: null,
    laps: [], created_at: null, updated_at: null
  };

  function make(partial) {
    const a = Object.assign({}, BLANK, partial || {});
    const now = new Date().toISOString();
    if (!a.id) a.id = newId(a.type, a.date || 'undated');
    a.created_at = a.created_at || now;
    a.updated_at = now;
    if (a.type === 'day') a.name = a.date || '';
    if (!a.name && a.session) {
      const L = sessionLabel(a.session);
      if (L) a.name = L + ' \u00b7 ' + (+a.date.slice(8)) +
        ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+a.date.slice(5,7)-1];
    }
    if (!a.name) {
      const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = a.date ? (+a.date.slice(8)) + ' ' + M[+a.date.slice(5, 7) - 1] : 'undated';
      a.name = (a.type === 'hike' ? 'Hike' : 'Run') + ' \u00b7 ' + d;
    }
    return a;
  }

  /* Same day, near enough the same run. Distance alone was too strict — a
     re-paste where the figure rounded differently slipped through and landed
     as a second copy — so a matching duration counts as well. */
  function findDuplicate(act, all) {
    return all.find(a => {
      if (a.id === act.id || a.type !== act.type || a.date !== act.date) return false;
      const dOk = a.distance_km != null && act.distance_km != null &&
        Math.abs(a.distance_km - act.distance_km) <= Math.max(0.05, act.distance_km * 0.02);
      const tOk = a.elapsed_s != null && act.elapsed_s != null &&
        Math.abs(a.elapsed_s - act.elapsed_s) <= 60;
      return dOk || tOk;
    }) || null;
  }

  function migrate(bundle) {
    const b = bundle || {};
    if (!b.schema) b.schema = SCHEMA;
    /* stored JSON can be anything — a non-array here used to throw on the
       first forEach and take the whole boot down */
    if (!Array.isArray(b.activities)) b.activities = [];
    b.activities = b.activities
      .filter(a => a && typeof a === 'object')
      .map(a => normalise(a) || a);
    if (!b.config || typeof b.config !== 'object') b.config = {};
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

  /* First and last day of a period, so a past period can be read as it stood. */
  function periodStart(key, scope) {
    if (scope === 'week') return key;
    if (scope === 'month') return key + '-01';
    return key + '-01-01';
  }

  function periodEnd(key, scope) {
    if (scope === 'week') {
      const d = new Date(key + 'T12:00:00');
      d.setDate(d.getDate() + 6);
      return d.toISOString().slice(0, 10);
    }
    if (scope === 'month') {
      const d = new Date(key + '-01T12:00:00');
      d.setMonth(d.getMonth() + 1); d.setDate(0);
      return d.toISOString().slice(0, 10);
    }
    return key + '-12-31';
  }


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

  const ACTIVITY_TYPES = ['run'];

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
  /* The twelve periods ending now — not ending at the selection. Looking at
     September used to make October disappear, which made the chart feel like
     it had lost data rather than like you had scrolled back. */
  /* How far back the ribbon will reach, per scope. Not a display limit — the
     ribbon scrolls — but a point past which scrolling week by week stops being
     navigation and starts being a chore. Use Month or Year to go further. */
  const MAX_RIBBON = { week: 52, month: 36, year: 20 };

  function ribbon(acts, scope, selectedKey, n, metric, cfg, asOf) {
    const cfgFor = () => cfg;
    const endKey = periodKey(asOf || new Date().toISOString().slice(0, 10), scope);
    /* window ends at now; if the selection is older than that, extend back far
       enough to include it so you can always see where you are */
    /* Don't draw a decade of empty years. Start no earlier than the first
       activity, but always keep at least four periods so the chart has shape. */
    const dates = (acts || []).filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0)
      .map(a => a.date).sort();
    const firstKey = dates.length ? periodKey(dates[0], scope) : null;
    /* The window runs from the first activity to now — every period you have
       data for is reachable. `n` is only the number that fits on screen; past
       that the ribbon scrolls. Capped at twelve it meant that backfilling 2024
       put ten of its months beyond reach from Month scope. */
    const cap = MAX_RIBBON[scope] || 24;
    const stepsBack = (to) => {
      let k = endKey, steps = 0;
      while (k > to && steps < cap) { k = shiftKey(k, scope, -1); steps++; }
      return steps;
    };

    let last = endKey;
    let span = Math.max(3, n);
    if (firstKey) span = Math.max(3, Math.min(cap, stepsBack(firstKey) + 1));
    if (selectedKey && selectedKey < endKey)
      span = Math.max(span, Math.min(cap, stepsBack(selectedKey) + 1));
    const out = [];
    let key = last;
    for (let i = 0; i < span; i++) { out.unshift(key); key = shiftKey(key, scope, -1); }
    return out.map(k => {
      const inK = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && inPeriod(a, scope, k));
      const s = summarize(inK);
      const v = metric === 'load'
        ? inK.reduce((t, a) => t + (load(a, cfgFor(metric)) || 0), 0)
        : s.distance_km;
      return { key: k, value: v, count: s.count, distance_km: s.distance_km,
               zones: timeInZone(lapsOf(inK), zoneBounds(cfgFor())),
               selected: k === selectedKey };
    });
  }

  /** Most recent period before `key` that actually has something in it. */
  /* how the cut-off reads beside the period it cuts: '24 Oct', '24', 'Wed' */
  function shortDay(date, scope) {
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (scope === 'week') return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dayIndex(date)];
    if (scope === 'month') return String(+date.slice(8));
    return (+date.slice(8)) + ' ' + M[+date.slice(5, 7) - 1];
  }

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
  /* How many consecutive empty periods sit immediately before this one.
     Counted only back to the first activity — before that there is no gap,
     there is simply no history, and the old cap produced "nothing for 400
     years before this". */
  function emptyRunBefore(acts, scope, key) {
    const mine = (acts || []).filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0);
    if (!mine.length) return 0;
    const firstKey = periodKey(mine.map(a => a.date).sort()[0], scope);
    let k = shiftKey(key, scope, -1);
    let n = 0;
    while (k >= firstKey && n < 500) {
      if (mine.some(a => inPeriod(a, scope, k))) break;
      n++;
      k = shiftKey(k, scope, -1);
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

     The reference is PINNED, not derived from the zones. It was the top of Z2,
     which meant re-anchoring rescaled every historical value: get fitter, drop
     your resting heart rate, and every aerobic pace you have ever recorded gets
     slower. The metric would have punished the adaptation it exists to detect.

     Pinned, it is simply a unit — cost expressed in min/km, comparable forever.
     The zones still move freely for the work they actually do. */
  function refHr(cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    return c.pace_ref_hr || zoneBounds(c).z3;
  }

  /* What the reference would be if it were re-derived from today's anchors.
     Offered, never applied silently. */
  function suggestedPaceRef(cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const derived = zoneBounds(c).z3;
    return derived !== refHr(c) ? derived : null;
  }

  function aerobicPace(act, cfg) {
    const c = aerobicCost(act);
    if (!c) return null;
    return c.value / refHr(cfg) * 60;      // seconds per km
  }

  const PACE_WINDOW = 20;

  /* The minimum stretch of time a trend is drawn over. A week on its own is
     not a trend, so a short period reaches back far enough to be one. */
  const TREND_MIN_DAYS = 120;

  /* Date-ordered pace series, split wherever training stopped.

     Points carry their date because the chart places them in TIME, not by
     index. Spacing by point count meant three single-run blocks each took 12%
     of the width while a fourteen-run block took 5%, and the gutters between
     them took 35% — the chart said more about how the data was grouped than
     about the running. */
  function paceSeries(acts, cfg, from, to) {
    let runs = (acts || [])
      .filter(a => a.type === 'run' && a.avg_hr != null && isAerobicMeasure(a))
      .sort((a, b) => a.date.localeCompare(b.date));

    const total = runs.length;
    if (to) runs = runs.filter(a => a.date <= to);
    if (from) runs = runs.filter(a => a.date >= from);

    const segs = splitOnGaps(runs, cfg).map(seg =>
      seg.map(a => ({ id: a.id, date: a.date, name: a.name, value: aerobicPace(a, cfg) }))
         .filter(p => p.value != null)
    ).filter(seg => seg.length);

    segs.total = total;
    segs.shown = runs.length;
    segs.from = runs.length ? runs[0].date : null;
    segs.to = runs.length ? runs[runs.length - 1].date : null;
    return segs;
  }

  /* How far back a trend should reach for the period being viewed. */
  function trendRange(scope, key, today, isCurrent, runs) {
    const end = isCurrent ? today : periodEnd(key, scope);
    let start = periodStart(key, scope);
    if (daysBetween(start, end) < TREND_MIN_DAYS) {
      const d = new Date(end + 'T12:00:00');
      d.setDate(d.getDate() - TREND_MIN_DAYS);
      start = d.toISOString().slice(0, 10);
    }

    /* Start at the first run in range rather than at the calendar edge. The
       2026 view ran 1 Jan to 21 Oct with nothing before August, so three
       quarters of the chart was blank — and blank before your first run says
       nothing the ribbon has not already said. Gaps BETWEEN runs are kept:
       those are the part worth seeing. */
    if (runs && runs.length) {
      const within = runs.filter(a => a.date >= start && a.date <= end)
        .map(a => a.date).sort();
      if (within.length) {
        start = within[0];
        return { from: start, to: within[within.length - 1] > end ? end : end };
      }
    }
    return { from: start, to: end };
  }



  /* ---------- normalising what comes back from Sheets ----------
     A date column that didn't take the plain-text format comes back as a real
     date, and Oslo midnight serialises as the previous day in UTC. So a naive
     slice of the ISO string loses a day. Round to the nearest day instead. */

  function normaliseDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const t = (v instanceof Date) ? v.getTime() : Date.parse(v);
    if (isNaN(t)) return null;
    /* nearest midnight: 23:00 UTC is the next day somewhere east of Greenwich,
       01:00 UTC is the same day somewhere west of it */
    const d = new Date(Math.round(t / 86400000) * 86400000);
    return d.toISOString().slice(0, 10);
  }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  const NUMERIC = ['distance_km', 'elapsed_s', 'moving_s', 'ascent_m', 'temp_c',
                   'avg_hr', 'gap_pace_s', 'cadence_spm', 'rpe'];

  /* Make one record safe to render whatever shape it arrived in. */
  function normalise(a) {
    if (!a || typeof a !== 'object') return null;
    const out = Object.assign({}, a);
    out.date = normaliseDate(a.date);
    NUMERIC.forEach(k => { if (k in out) out[k] = toNumber(out[k]); });
    out.laps = (Array.isArray(a.laps) ? a.laps : []).map(l => ({
      n: toNumber(l && l.n),
      distance_km: toNumber(l && l.distance_km),
      time_s: toNumber(l && l.time_s),
      avg_hr: toNumber(l && l.avg_hr),
      role: (l && l.role) || 'main'
    })).filter(l => l.distance_km != null && l.time_s != null);
    return out;
  }

  /* ---------- damaged records ----------
     A row coming back from Sheets can have blanks where the app expects
     values. One of those used to throw inside the first render and leave a
     blank screen with no way to reach Setup. They are set aside instead. */

  function isUsable(a) {
    return !!a && typeof a.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date) &&
      typeof a.distance_km === 'number' && isFinite(a.distance_km) && a.distance_km > 0 &&
      typeof a.elapsed_s === 'number' && isFinite(a.elapsed_s) && a.elapsed_s > 0;
  }

  function damaged(acts) { return (acts || []).filter(a => a && a.type !== 'test' && !isUsable(a)); }

  function whatsMissing(a) {
    const gaps = [];
    if (!a || typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) gaps.push('date');
    if (!a || typeof a.distance_km !== 'number' || !(a.distance_km > 0)) gaps.push('distance');
    if (!a || typeof a.elapsed_s !== 'number' || !(a.elapsed_s > 0)) gaps.push('time');
    return gaps;
  }

  /* ---------- records ---------- */

  function records(acts, cfg) { return recordsOf(acts, cfg); }
  function recordsOf(acts, cfg) {
    const mine = acts.filter(a => a.type === 'run');
    if (!mine.length) return [];
    const out = [];
    const by = (arr, f, dir) => arr.filter(a => f(a) != null)
      .sort((a, b) => dir === 'min' ? f(a) - f(b) : f(b) - f(a))[0];

    const best = by(aerobicSamples(mine), a => aerobicPace(a, cfg), 'min');
    if (best) out.push({ label: 'Best aerobic pace', value: fmtPace(aerobicPace(best, cfg)),
      unit: '/km', when: best.date, id: best.id });
    const far = by(mine, a => a.distance_km, 'max');
    if (far) out.push({ label: 'Longest run', value: far.distance_km.toFixed(2),
      unit: 'km', when: far.date, id: far.id });
    const weeks = {};
    mine.forEach(a => { const k = weekStart(a.date); weeks[k] = (weeks[k] || 0) + (a.distance_km || 0); });
    const bw = Object.keys(weeks).sort((a, b) => weeks[b] - weeks[a])[0];
    if (bw) out.push({ label: 'Biggest week', value: weeks[bw].toFixed(1), unit: 'km', when: bw });
    const drifts = mine.map(a => ({ a: a, d: driftOf(a) })).filter(x => x.d != null);
    if (drifts.length) {
      const low = drifts.sort((x, y) => x.d - y.d)[0];
      out.push({ label: 'Lowest drift', value: (low.d >= 0 ? '+' : '') + low.d, unit: 'bpm',
        when: drifts.length > 1 ? low.a.date : 'only one measured', id: low.a.id });
    }
    return out;
  }

  /* Parts of a whole, rounded so they still total the whole.

     Rounding each share on its own is the obvious thing and it is wrong: a
     three-way even split gives 33+33+33 = 99, and one real zone split on this
     app's own data gave 101. Largest remainder hands the leftover points to
     whichever parts were rounded down hardest, which is both correct and the
     fairest place to put them. */
  function sharesOf(values, total) {
    const sum = total != null ? total : values.reduce((a, b) => a + b, 0);
    if (!sum) return values.map(() => 0);
    const exact = values.map(v => v / sum * 100);
    const floors = exact.map(Math.floor);
    let left = 100 - floors.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ i: i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    const out = floors.slice();
    for (let k = 0; k < order.length && left > 0; k++) { out[order[k].i]++; left--; }
    return out;
  }

  /* ---------- deltas ---------- */

  /* How a change reads. A percentage of a percentage is nonsense — Z2 going
     from 61 to 33 is "28 points", not "51%" — and a percentage of a near-zero
     baseline is worse: drift improving from +15 to 0 showed as "100%" when the
     story is fifteen beats. Declared on the metric so no render site has to
     choose, which is how the wrong default got applied in the first place. */
  function deltaText(d, as) {
    if (!d) return '';
    const n = Math.abs(d.diff);
    if (as === 'seconds') return Math.round(n) + 's';
    if (as === 'bpm') return Math.round(n) + ' bpm';
    if (as === 'points') return Math.round(n) + (Math.round(n) === 1 ? ' point' : ' points');
    if (as === 'days') return (Math.round(n * 10) / 10) + (n === 1 ? ' day' : ' days');
    if (as === 'km') return (Math.round(n * 100) / 100) + ' km';
    return Math.abs(d.pct).toFixed(0) + '%';
  }



  /* betterWhen: 'down' | 'up' | null. Null means direction is shown without a
     verdict — a shorter week may be a recovery week, and the app doesn't know. */
  /* `neverBad` is for metrics where a fall is a legitimate choice rather than a
     failure. Z2 share is the case that matters: a tempo week is lower by
     design, and colouring that red tells you off for following your own plan.
     Declared on the metric, so every render site inherits it. */
  function delta(value, baseline, betterWhen, neverBad) {
    if (value == null || baseline == null || !baseline) return null;
    const diff = value - baseline;
    const pct = diff / baseline * 100;
    const dir = Math.abs(pct) < 0.5 ? 'flat' : (diff > 0 ? 'up' : 'down');
    let tone = 'flat';
    if (dir !== 'flat' && betterWhen) tone = (dir === betterWhen) ? 'good' : 'bad';
    else if (dir !== 'flat') tone = 'neutral';
    if (neverBad && tone === 'bad') tone = 'neutral';
    return { diff: diff, pct: pct, dir: dir, tone: tone };
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
    if (!act || act.type !== 'run' || !isAerobicMeasure(act)) return null;
    const value = aerobicPace(act, cfg);
    if (value == null) return null;

    const lo = act.distance_km * 0.8, hi = act.distance_km * 1.2;
    const earlier = acts
      .filter(a => a.type === 'run' && a.id !== act.id && a.date <= act.date && a.avg_hr != null && isAerobicMeasure(a))
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

  /* Shares come from `z2Of`, which counts only time whose zone is known. This
     used to add unknown time into the denominator on its own, which is how
     Form reported 0% in Z2 on a year the caption below called 71%. */
  function zoneShareSeries(acts, cfg, n, endKey) {
    const bounds = zoneBounds(cfg);
    return weekKeys(acts, n, endKey).map(k => {
      const inWeek = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && weekStart(a.date) === k);
      const laps = lapsOf(inWeek);
      const tz = timeInZone(laps, bounds);
      const share = z2Of(laps, cfg);
      return {
        key: k, zones: tz,
        total: share ? share.total : 0,        /* known time only */
        unknown: tz.unknown,
        z2pct: share ? share.pct : null,
        distance_km: summarize(inWeek).distance_km
      };
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

  /* `asOf` ends the window and `since` begins it. Given a past period's own
     dates, every row describes that period instead of now — the section used
     to show today's form under a title that said 2025. */
  function readRows(acts, cfg, asOf, since) {
    const count = arr => (arr || []).length;
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    let pool = acts.filter(a => a.type === 'run' || a.type === 'test');
    if (since) pool = pool.filter(a => a.date >= since);
    const year = lastYear(pool, asOf);
    const mine = year.filter(a => a.type === 'run').sort((a, b) => a.date.localeCompare(b.date));
    const rows = [];

    const push = (o) => rows.push(o);

    {
      /* Races excluded: aerobic pace claims to be what you would hold at
         145 bpm, and a race is not that. Drift below deliberately keeps them —
         how much you faded over a race is exactly when drift is worth
         knowing. */
      const paces = aerobicSamples(mine).filter(a => a.avg_hr != null)
        .map(a => aerobicPace(a, c)).filter(v => v != null);
      const w = windowStats(paces);
      push({ n: count(paces), key: 'pace', label: 'Aerobic pace', unit: '/km', kind: 'pace',
             window: 'last 3 runs', deltaAs: 'seconds',
             now: w.now, prev: w.prev, need: w.need, betterWhen: 'down',
             range: rangeOf(paces), band: paces.length >= 3 ? rangeOf(paces.slice(-3)) : null,
             bestLabel: 'best', worstLabel: '' });

      const drifts = mine.map(a => driftOf(a)).filter(v => v != null);
      const dw = windowStats(drifts);
      push({ n: count(drifts), key: 'drift', label: 'Drift', unit: 'bpm', kind: 'bpm',
             window: 'last 3 measured', deltaAs: 'bpm',
             now: dw.now, prev: dw.prev, need: dw.need, betterWhen: 'down',
             range: rangeOf(drifts), band: drifts.length >= 3 ? rangeOf(drifts.slice(-3)) : null,
             bestLabel: 'lowest', missingNote: 'needs runs of 4 km or more with lap HR' });

      const zs = zoneShareSeries(mine, c, 12, asOf ? weekStart(asOf) : null)
        .filter(x => x.z2pct != null).map(x => x.z2pct);
      const zw = windowStats(zs);
      push({ n: count(zs), key: 'z2', label: 'Time in Z2', unit: '%', kind: 'pct',
             window: 'last 3 runs', neverBad: true, deltaAs: 'points',
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
             window: 'last 3 weeks', deltaAs: 'days',
             now: cw.now, prev: cw.prev, need: cw.need, betterWhen: 'up',
             range: rangeOf(days), band: null, bestLabel: 'most' });

      const loads = loadSeries(mine, c, 12, asOf ? weekStart(asOf) : null)
        .filter(x => blockStart == null || x.key >= blockStart)
        .map(x => x.value).filter(v => v > 0);
      const lw = windowStats(loads);
      push({ n: loads.length, key: 'load', label: 'Weekly load', unit: '', kind: 'int',
             window: 'last 3 weeks',
             now: lw.now, prev: lw.prev, need: lw.need, betterWhen: null,
             range: rangeOf(loads), band: loads.length >= 3 ? rangeOf(loads.slice(-3)) : null,
             worstLabel: 'least', bestLabel: 'most',
             note: 'Minutes weighted by how hard your heart was working. A bigger week is not automatically a better one.' });

      const vols = weeklySeries(mine, 12, asOf ? weekStart(asOf) : null, 'distance')
        .filter(x => blockStart == null || x.key >= blockStart)
        .map(x => x.value).filter(v => v > 0);
      const vw = windowStats(vols);
      push({ n: count(vols), key: 'volume', label: 'Weekly volume', unit: 'km', kind: 'km',
             window: 'last 3 weeks',
             now: vw.now, prev: vw.prev, need: vw.need, betterWhen: null,
             range: rangeOf(vols), band: vols.length >= 3 ? rangeOf(vols.slice(-3)) : null,
             worstLabel: 'least', bestLabel: 'most',
             note: 'Shown without a verdict \u2014 a short week may be the right week.' });
    }

    return rows;
  }

  /* The Z2 share of the periods before this one, so a single session reads
     against your own habit rather than against nothing. Median of up to the
     last 8 periods that carried lap heart rate. */
  function z2Typical(acts, cfg, scope, selectedKey) {
    const b = zoneBounds(cfg);
    const vals = [];
    let k = shiftKey(selectedKey, scope, -1);
    for (let i = 0; i < 12 && vals.length < 8; i++) {
      const inK = acts.filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && inPeriod(a, scope, k));
      const s = z2Of(lapsOf(inK), cfg);
      if (s) vals.push(s.pct);
      k = shiftKey(k, scope, -1);
    }
    return vals.length >= 3 ? Math.round(median(vals)) : null;
  }

  /* ---------- Z2 discipline ----------
     Z2 share is a choice, not an adaptation: you could hit 100% by walking.
     So it is reported next to aerobic pace, never instead of it — the share is
     the method, the pace is the evidence it is working. */

  /* The only place Z2 share is ever worked out. It used to be computed in five
     different places over three different windows, which is how the same screen
     came to show 29%, 33% and 29% for what a reader would take to be one
     number. Everything now goes through here, and every caller has to say
     which window it is asking about. */
  function z2Of(laps, cfg) {
    const tz = timeInZone(laps || [], zoneBounds(cfg));
    const total = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0);
    if (!total) return null;
    return {
      pct: Math.round(tz[2] / total * 100),
      above: Math.round((tz[3] + tz[4] + tz[5]) / total * 100),
      seconds: tz[2], total: total, tz: tz
    };
  }

  /* What time in zone is counted from, for one run: the seconds the watch
     recorded at each heart rate when the run has its file (exact), or its lap
     averages when it hasn't (a 1 km lap averaging 144 hides the minutes at
     155). Every zone figure in the app comes through here, so a run is never
     counted one way on one screen and the other way on the next. Each
     heart-rate bucket is handed on as a lap-shaped piece of time, which is all
     the zone arithmetic needs. */
  function zoneLaps(act) {
    if (!act || hrLocked(act)) return [];
    const h = act.hr_hist;
    if (h && typeof h === 'string') {
      const out = [];
      h.split(',').forEach(part => {
        const kv = part.split(':');
        const bpm = +kv[0], sec = +kv[1];
        if (bpm > 0 && sec > 0) out.push({ avg_hr: bpm, time_s: sec, role: 'main' });
      });
      if (out.length) return out;
    }
    return act.laps || [];
  }

  function lapsOf(acts) {
    const laps = [];
    (acts || []).forEach(a => {
      if (ACTIVITY_TYPES.indexOf(a.type) < 0) return;
      zoneLaps(a).forEach(l => laps.push(l));
    });
    return laps;
  }

  function z2Share(acts, cfg) { return z2Of(lapsOf(acts), cfg); }

  /* How many of the last n periods cleared the target. A count, not a streak —
     a chain that resets on one bad week is a punishment, and a week disrupted
     by work is not a training failure. */
  function z2Record(acts, cfg, scope, endKey, n) {
    const want = (cfg && cfg.z2_target) || DEFAULT_CONFIG.z2_target;
    const periods = [];
    let k = endKey;
    for (let i = 0; i < (n || 10); i++) {
      const inK = (acts || []).filter(a =>
        ACTIVITY_TYPES.indexOf(a.type) >= 0 && inPeriod(a, scope, k));
      const s = z2Share(inK, cfg);
      if (s) periods.push({ key: k, pct: s.pct, cleared: s.pct >= want });
      k = shiftKey(k, scope, -1);
    }
    if (periods.length < 3) return null;
    return {
      cleared: periods.filter(p => p.cleared).length,
      of: periods.length,
      target: want,
      periods: periods
    };
  }

  /* Green when the share is at or above target, amber below. Never red — a
     tempo session is sometimes exactly the point. */
  function z2Tone(pct, cfg) {
    const want = (cfg && cfg.z2_target) || DEFAULT_CONFIG.z2_target;
    if (pct == null) return 'none';
    return pct >= want ? 'good' : pct >= want - 15 ? 'near' : 'under';
  }

  /* ---------- what the session was meant to be ----------
     Tagging intent is worth more than a place name: it lets the app compare
     what you meant to run against what you actually ran. A recovery run spent
     above Z2 is a miss; a tempo run spent above Z2 is the point. */

  const SESSIONS = [
    { key: 'easy',      label: 'Easy',      z2: 'high' },
    { key: 'long',      label: 'Long',      z2: 'high' },
    { key: 'recovery',  label: 'Recovery',  z2: 'high' },
    { key: 'steady',    label: 'Steady',    z2: 'mid'  },
    { key: 'tempo',     label: 'Tempo',     z2: 'low'  },
    { key: 'intervals', label: 'Intervals', z2: 'low'  },
    { key: 'race',      label: 'Race',      z2: 'low'  },
    /* a field test (a yearly lactate threshold test): measured like a race */
    { key: 'test',      label: 'Test',      z2: 'low'  }
  ];

  function isTest(a) { return !!a && a.session === 'test'; }

  function sessionOf(key) {
    return SESSIONS.find(s => s.key === key) || null;
  }

  function sessionLabel(key) {
    const s = sessionOf(key);
    return s ? s.label : null;
  }

  /* Did the run match what it was called? Only answers where the intent is
     clear and lap heart rate exists. */
  function intentCheck(act, cfg) {
    const s = sessionOf(act && act.session);
    if (!s) return null;
    const share = z2Of(zoneLaps(act), cfg);
    if (!share) return null;
    const target = (cfg && cfg.z2_target) || DEFAULT_CONFIG.z2_target;
    const above = share.above;

    if (s.z2 === 'high') {
      return share.pct >= target
        ? { ok: true, session: s, pct: share.pct }
        : { ok: false, session: s, pct: share.pct, above: above };
    }
    if (s.z2 === 'low') {
      /* a hard session is supposed to be hard — nothing to report */
      return { ok: true, session: s, pct: share.pct, hard: true };
    }
    return { ok: share.pct >= target - 20, session: s, pct: share.pct, above: above };
  }

  /* What to say about a single run's zone split. One implementation, so the
     home screen and the detail screen can never disagree — the home note used
     to call a run tagged Tempo "a tempo run, not base work", scolding you for
     doing exactly what you had planned. */
  /* "a easy run" is the kind of thing that makes an app feel machine-made. */
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function article(word) {
    return /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
  }

  function sessionNote(act, cfg) {
    const share = z2Of(zoneLaps(act), cfg);
    if (!share) return null;
    const target = (cfg && cfg.z2_target) || DEFAULT_CONFIG.z2_target;
    const s = sessionOf(act && act.session);

    if (s) {
      if (s.z2 === 'low') {
        /* a hard session run hard needs no comment at all */
        return share.above >= 40
          ? { tone: 'ok', text: cap(article(s.label)) + ' ' + s.label.toLowerCase() +
              ' session, run like one \u2014 <b>' + share.above + '% above Z2</b>.' }
          : { tone: 'ok', text: 'Tagged ' + s.label.toLowerCase() + ', but <b>' + share.pct +
              '% of it sat in Z2</b>.' };
      }
      if (share.pct >= target) {
        return { tone: 'ok', text: cap(article(s.label)) + ' ' + s.label.toLowerCase() +
          ' run, run like one \u2014 <b>' + share.pct + '% in Z2</b>.' };
      }
      return { tone: 'warn', text: 'You called this ' + article(s.label) + ' <b>' +
        s.label.toLowerCase() + ' run</b>, and <b>' + share.above +
        '% of it was above Z2</b>.' };
    }

    /* untagged: no intent to measure against, so only the plain fact */
    if (share.above >= 50) {
      return { tone: 'warn', text: '<b>' + share.above + '% above Z2</b> \u2014 ' +
        'tag it so the app knows whether that was the plan.' };
    }
    if (share.pct >= target) {
      return { tone: 'ok', text: 'Mostly <b>base work</b> \u2014 ' + share.pct + '% in Z2.' };
    }
    return null;
  }

  /* ---------- the rolling window ----------
     At two runs a week a calendar week holds two sessions, so one tempo run
     drops the share from 95% to 30% on no change in behaviour, and every
     Monday resets the sample to nothing. 28 days is eight or nine sessions and
     is always "now". */

  const ROLLING_DAYS = 28;

  function sinceDays(acts, days, asOf) {
    const end = asOf || new Date().toISOString().slice(0, 10);
    const d = new Date(end + 'T12:00:00');
    d.setDate(d.getDate() - (days - 1));
    const from = d.toISOString().slice(0, 10);
    return (acts || []).filter(a =>
      ACTIVITY_TYPES.indexOf(a.type) >= 0 && a.date >= from && a.date <= end);
  }

  /* Z2 over the rolling window, with how many runs went into it so a thin
     sample can say so rather than presenting itself as a verdict. */
  function z2Rolling(acts, cfg, asOf, days) {
    const n = days || ROLLING_DAYS;
    const within = sinceDays(acts, n, asOf);
    const share = z2Of(lapsOf(within), cfg);
    if (!share) return null;
    share.runs = within.filter(a => (a.laps || []).length).length;
    share.days = n;
    return share;
  }

  /* ---------- the view model ----------

     The whole class of bug this app kept producing had one shape: a value
     computed in one place and rendered in another, with the render site
     deciding for itself which activities, which window, and whether there was
     anything worth showing. There were twenty-one such decisions in ui.js and
     they disagreed with each other — that is how one screen came to show three
     Z2 figures, how Form kept displaying today under a title that said 2025,
     and how a zone bar appeared above a caption saying there was no zone data.

     So the decisions move here, once. `homeModel` returns every value the home
     screen needs, each already scoped, already labelled with the window it
     describes, and already marked present or absent with a reason. The render
     layer cannot get scoping wrong because it is never given the raw
     activities to scope. */

  /* A value that knows its own window and whether it exists. */
  function stat(value, opts) {
    opts = opts || {};
    const missing = value == null || (typeof value === 'number' && !isFinite(value));
    return {
      value: missing ? null : value,
      present: !missing,
      unit: opts.unit || null,
      window: missing ? null : (opts.window || null),
      foot: missing ? null : (opts.foot || null),
      /* a reason is only a reason when there is nothing there. Carrying both a
         value and an excuse is how a screen ends up saying two things. */
      absent: missing ? (opts.absent || 'not available') : null,
      tone: missing ? null : (opts.tone || null),
      n: opts.n == null ? null : opts.n
    };
  }

  function homeModel(all, cfg, scope, key, today) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    const runs = (all || []).filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0 && isUsable(a));
    const isCurrent = periodKey(today, scope) === key;
    /* A closed period is a summary, not a training screen. See reviewModel. */
    if (!isCurrent) return reviewModel(runs, c, scope, key, today);
    const start = periodStart(key, scope);
    const end = isCurrent ? today : periodEnd(key, scope);
    const label = periodLabel(key, scope, today);
    const word = (isCurrent ? 'this ' : 'that ') + scope;

    const inP = runs.filter(a => inPeriod(a, scope, key))
      .sort((a, b) => b.date.localeCompare(a.date));
    /* history up to the end of the period — never beyond it */
    const upTo = runs.filter(a => a.date <= end);

    /* ---- the run the heroes describe: from the period, or nothing ----
       A race is not an aerobic-pace measurement, so it never becomes the
       exemplar. It stays in the list, the totals and the zone split. */
    const inPHr = inP.filter(a => a.avg_hr != null && isAerobicMeasure(a));
    /* the card is about now: in the current period, before you've run in it,
       it keeps showing your latest run rather than going blank */
    const lastRun = inPHr.length ? inPHr[0] : (isCurrent ? (upTo.filter(a => a.avg_hr != null && isAerobicMeasure(a))
      .sort((a, b) => b.date.localeCompare(a.date))[0] || null) : null);
    const pace = lastRun ? aerobicPace(lastRun, c) : null;

    /* ---- what that run is measured against: all history, never the period ---- */
    const hist = upTo.filter(a => a.avg_hr != null && isAerobicMeasure(a))
      .sort((a, b) => b.date.localeCompare(a.date));
    let peers = [], band = null, prevRun = null;
    if (lastRun) {
      const lo = lastRun.distance_km * 0.8, hi = lastRun.distance_km * 1.2;
      peers = hist.filter(a => a.id !== lastRun.id &&
        a.distance_km >= lo && a.distance_km <= hi)
        .map(a => aerobicPace(a, c)).filter(v => v != null);
      band = peers.length >= 3 ? { median: median(peers), n: peers.length, lo: lo, hi: hi } : null;
      prevRun = hist.find(a => a.date < lastRun.date ||
        (a.date === lastRun.date && a.id !== lastRun.id)) || null;
    }

    /* ---- Z2: rolling on the current period, the period itself otherwise ---- */
    const rolling = isCurrent ? z2Rolling(runs, c, today) : null;
    const periodShare = z2Of(lapsOf(inP), c);
    const share = isCurrent ? rolling : periodShare;
    const z2Window = isCurrent ? 'last ' + ROLLING_DAYS + ' days' : word;
    const target = c.z2_target;

    /* ---- the zone split for the period ---- */
    const laps = lapsOf(inP);
    const tz = timeInZone(laps, zoneBounds(c));
    const zoned = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0);
    const summary = summarize(inP);

    /* ---- Form, read as of the end of the period ---- */
    /* Read to the last run in the period, not the calendar edge. Ending at
       31 December meant the last three weeks of 2025 were empty, so a year
       with fourteen runs reported "0 days / week". */
    const readTo = isCurrent ? today : (inP.length ? inP[0].date : end);
    const rows = readRows(all, c, readTo, isCurrent ? null : start);

    const prevKey = previousWithData(runs, scope, key);
    /* An unfinished period is compared with the previous one at the same
       point: 1 Jan-24 Oct 2026 against 1 Jan-24 Oct 2025, not all of 2025. */
    let prevCut = null, nothingYet = false;
    if (prevKey && isCurrent) {
      /* finished days only, plus today once today has a run: a Monday morning
         before your run is not "100% down" on last Monday */
      const ranToday = inP.some(a => a.date === today);
      const off = daysBetween(start, today) - (ranToday ? 0 : 1);
      if (off < 0) nothingYet = true;
      else {
        prevCut = addDays(periodStart(prevKey, scope), off);
        if (prevCut >= periodEnd(prevKey, scope)) prevCut = null;
      }
    }
    const prev = prevKey && !nothingYet ? summarize(runs.filter(a => inPeriod(a, scope, prevKey) && (!prevCut || a.date <= prevCut))) : null;

    return {
      mode: 'live',
      period: { key: key, scope: scope, label: label, word: word,
                isCurrent: isCurrent, start: start, end: end },
      runs: inP,
      count: inP.length,
      summary: summary,
      previous: prev ? { key: prevKey, summary: prev, cut: prevCut,
                         label: periodLabel(prevKey, scope, today) + (prevCut ? ' to ' + shortDay(prevCut, scope) : '') } : null,

      hero: {
        pace: stat(pace, {
          unit: '/km',
          window: lastRun ? (isCurrent ? 'last run' : null) : null,
          n: inPHr.length,
          absent: inPHr.length ? null
            : (inP.length ? 'needs average heart rate' : 'no runs in this period')
        }),
        z2: stat(share ? share.pct : null, {
          unit: '%', window: z2Window,
          n: share ? (share.runs == null ? inP.length : share.runs) : 0,
          tone: share ? z2Tone(share.pct, c) : null,
          absent: inP.length ? 'needs lap heart rate' : 'no runs in this period'
        }),
        target: target,
        thin: !!(isCurrent && share && share.runs != null && share.runs < 4),
        lastRun: lastRun,
        band: band,
        previousRun: prevRun ? { run: prevRun, pace: aerobicPace(prevRun, c) } : null,
        note: lastRun ? sessionNote(lastRun, c) : null
      },

      zones: {
        tz: tz, zoned: zoned, unknown: tz.unknown,
        elapsed: summary.elapsed_s,
        share: zoned ? z2Of(laps, c) : null,
        /* "recent typical" and the target line are training-week ideas */
        typical: scope === 'year' ? null : z2Typical(runs, c, scope, key),
        window: word,
        absent: zoned ? null
          : (summary.elapsed_s ? 'no lap heart rate' : 'nothing logged')
      },

      trend: (function () {
        const range = trendRange(scope, key, today, isCurrent, aerobicSamples(runs));
        const segs = paceSeries(runs, c, range.from, range.to);
        const prevSeg = segs.length > 1 ? segs[segs.length - 2] : null;
        return {
          segments: segs,
          mark: prevSeg && prevSeg.length >= 3
            ? Math.min.apply(null, prevSeg.map(p => p.value)) : null,
          shown: segs.shown, total: segs.total,
          from: range.from, to: range.to,
          days: daysBetween(range.from, range.to),
          /* One point is not a trend. It used to draw an axis with a single
             dot on it, which says nothing the hero has not already said. */
          absent: segs.shown >= 2 ? null
            : (segs.shown === 1 ? 'one run so far \u2014 a trend needs two'
                                : 'no runs with heart rate in this stretch')
        };
      })(),

      form: { rows: rows, label: isCurrent ? null : label },

      races: inP.filter(isRace),
      leftOut: leftOutOf(inP),

      ribbon: ribbon(runs, scope, key, 12, 'load', c, today),
      gapBefore: emptyRunBefore(runs, scope, key),
      record: scope === 'year' ? null : z2Record(runs, c, scope, key, 10),
      days: scope === 'week' ? weekDays(runs, c, key) : null
    };
  }

  /* ---------- the review model: a closed period ----------

     A past year used to be the live screen rewound to its last day: the hero
     described the last run of 2024, Form read the last three weeks of 2024,
     and a two-year-old run was asked to be tagged "so the app knows whether
     that was the plan". Every card answered "where am I now?" with "now"
     moved to 31 December — a question nobody asks of a finished year.

     A closed period answers a different question: how did it go. So it gets
     its own model, and the live training values — the heroes, Form, the
     28-day Z2, the target count, the load ramp — are ABSENT here, not
     rewound.

     Two rules hold for everything this returns:

     - It is frozen. Nothing in it depends on today, so the same data gives
       the same summary whenever you look at it. Only the ribbon, which is
       navigation rather than content, still ends at now.
     - It never claims anything about runs that are not logged. The backfill
       is unfinished, so an empty month is "nothing logged", never "time
       off", and the year before is shown beside this one as plain numbers —
       no arrows, no percentages, because a fall might only be a gap in the
       backfill. The figures simply grow as runs are added. */

  /* How many runs a card needs before it says anything. Below these it is
     absent rather than a verdict drawn from two data points. */
  const REVIEW_MIN = { bests: 2, mix: 3, months: 2 };
  const BUILD_DAYS = 84;
  const EVEN_SPLIT_S = 5;
  /* the same distances as everywhere else; a function because they are declared further down */
  const reviewEfforts = () => EFFORT_DISTANCES;

  function runPace(a) {
    return a.gap_pace_s != null ? a.gap_pace_s : paceSecPerKm(a.distance_km, a.elapsed_s);
  }

  /* First half against second half, split by distance on whole laps. */
  function halves(laps) {
    const full = fullLaps(laps).filter(l => l.time_s);
    if (full.length < 4) return null;
    const total = full.reduce((t, l) => t + l.distance_km, 0);
    let d = 0, i = 0;
    while (i < full.length && d + full[i].distance_km <= total / 2 + 1e-9) { d += full[i].distance_km; i++; }
    const a = full.slice(0, i), b = full.slice(i);
    if (!a.length || !b.length) return null;
    const pace = arr => arr.reduce((t, l) => t + l.time_s, 0) /
                        arr.reduce((t, l) => t + l.distance_km, 0);
    const first = pace(a), second = pace(b);
    const fade = Math.round(second - first);
    return { first: first, second: second, fade: fade,
             shape: Math.abs(fade) <= EVEN_SPLIT_S ? 'even' : fade > 0 ? 'positive' : 'negative' };
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* What a race was run on: the twelve weeks before it, from logged runs.
     Eight missed most of a marathon block — 2024's July build sat seven to
     twelve weeks out. */
  function raceBuild(race, runs) {
    const from = addDays(race.date, -BUILD_DAYS);
    const before = runs.filter(a => a.id !== race.id && a.date >= from && a.date < race.date);
    if (!before.length) return { count: 0, days: BUILD_DAYS };
    const longest = before.slice().sort((a, b) => b.distance_km - a.distance_km)[0];
    return {
      count: before.length, days: BUILD_DAYS,
      distance_km: Math.round(before.reduce((t, a) => t + a.distance_km, 0) * 100) / 100,
      longest: longest,
      longestWeeksOut: Math.round(daysBetween(longest.date, race.date) / 7)
    };
  }

  function reviewModel(runs, c, scope, key, today) {
    const start = periodStart(key, scope), end = periodEnd(key, scope);
    const label = periodLabel(key, scope, today);
    const word = 'that ' + scope;
    const inP = runs.filter(a => inPeriod(a, scope, key))
      .sort((a, b) => b.date.localeCompare(a.date));
    const summary = summarize(inP);
    const n = inP.length;

    /* ---- races, and what they were run on ---- */
    const races = inP.filter(isRace).slice().reverse().map(r => ({
      run: r,
      pace: paceSecPerKm(r.distance_km, r.elapsed_s),
      gap: r.gap_pace_s != null ? r.gap_pace_s : null,
      halves: halves(r.laps),
      drift: driftOf(r),
      /* pace and heart rate kilometre by kilometre: the race as a story */
      splits: fullLaps(r.laps).filter(l => l.time_s && l.distance_km)
        .map((l, i) => ({ km: i + 1, pace: l.time_s / l.distance_km, hr: l.avg_hr != null ? l.avg_hr : null })),
      build: raceBuild(r, runs)
    }));

    /* ---- the period beside the one before it: plain numbers, no verdict ---- */
    const prevKey = scope === 'all' ? null : shiftKey(key, scope, -1);
    const prevRuns = prevKey ? runs.filter(a => inPeriod(a, scope, prevKey)) : [];
    const previous = prevKey ? { key: prevKey, label: periodLabel(prevKey, scope, today),
                                 summary: summarize(prevRuns) } : null;

    /* ---- months, for a year ---- */
    let months = null;
    if (scope === 'year') {
      const list = [];
      for (let m = 1; m <= 12; m++) {
        const ym = key + '-' + String(m).padStart(2, '0');
        const these = inP.filter(a => a.date.slice(0, 7) === ym);
        list.push({ key: ym, count: these.length,
          distance_km: Math.round(these.reduce((t, a) => t + a.distance_km, 0) * 100) / 100 });
      }
      const withRuns = list.filter(m => m.count);
      const top = withRuns.slice().sort((a, b) => b.distance_km - a.distance_km)[0] || null;
      months = {
        list: list, logged: withRuns.length,
        top: withRuns.length >= REVIEW_MIN.months ? top : null,
        absent: withRuns.length >= REVIEW_MIN.months ? null
          : 'runs logged in only ' + withRuns.length + (withRuns.length === 1 ? ' month' : ' months')
      };
    }

    /* ---- bests ---- */
    let bests = null;
    if (n >= REVIEW_MIN.bests) {
      const byLength = inP.slice().sort((a, b) => b.distance_km - a.distance_km);
      const longest = byLength[0];
      const training = byLength.find(a => !isRace(a)) || null;
      const allBoard = bestEffortBoard(runs, reviewEfforts());
      const held = {};
      allBoard.forEach(b => { held[b.km] = b.run.id; });
      const efforts = bestEffortBoard(inP, reviewEfforts())
        .map(e => Object.assign({}, e, { pb: held[e.km] === e.run.id }));
      const aer = inP.filter(a => a.avg_hr != null && isAerobicMeasure(a))
        .map(a => ({ run: a, pace: aerobicPace(a, c) })).filter(x => x.pace != null)
        .sort((a, b) => a.pace - b.pace)[0] || null;
      bests = {
        longest: longest,
        /* the race is usually the longest run of its year; the build is the
           longest thing you did to get there */
        longestTraining: isRace(longest) && training ? training : null,
        efforts: efforts,
        aerobic: aer
      };
    }

    /* ---- what you mainly did ---- */
    let mix = null;
    if (n >= REVIEW_MIN.mix) {
      const counts = {};
      inP.forEach(a => { const k = sessionOf(a.session) ? a.session : 'untagged';
                         counts[k] = (counts[k] || 0) + 1; });
      const order = SESSIONS.map(s => s.key).concat(['untagged']);
      mix = Object.keys(counts).map(k => ({ key: k,
        label: k === 'untagged' ? 'untagged' : sessionLabel(k).toLowerCase(), count: counts[k] }))
        .sort((a, b) => b.count - a.count || order.indexOf(a.key) - order.indexOf(b.key));
    }

    /* ---- the same runs read by heart rate alone, beside the tags ---- */
    const byHr = mix ? effortMix(inP, c) : null;

    /* ---- zones: the period's own split, no rolling window, no "usual" ---- */
    const laps = lapsOf(inP);
    const tz = timeInZone(laps, zoneBounds(c));
    const zoned = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0);

    /* ---- aerobic pace across the period itself, and nothing outside it ---- */
    const trend = (function () {
      const samples = aerobicSamples(inP).filter(a => a.avg_hr != null).map(a => a.date).sort();
      const from = samples[0] || start, to = samples[samples.length - 1] || end;
      const segs = paceSeries(inP, c, from, to);
      return {
        segments: segs, shown: segs.shown, from: from, to: to,
        days: daysBetween(from, to),
        absent: segs.shown >= 2 ? null
          : (segs.shown === 1 ? 'one run with heart rate \u2014 a trend needs two'
                              : 'no runs with heart rate')
      };
    })();

    /* ---- a year's pictures: only for a year ---- */
    const pictures = scope === 'year' ? yearPictures(runs, c, key) : null;

    return {
      mode: 'review',
      pictures: pictures,
      period: { key: key, scope: scope, label: label, word: word,
                isCurrent: false, start: start, end: end },
      runs: inP,
      count: n,
      summary: summary,
      previous: previous,
      races: races,
      leftOut: leftOutOf(inP),
      months: months,
      bests: bests,
      mix: mix,
      byHr: byHr,
      zones: {
        tz: tz, zoned: zoned, unknown: tz.unknown,
        elapsed: summary.elapsed_s,
        share: zoned ? z2Of(laps, c) : null,
        typical: null,
        window: word,
        absent: zoned ? null
          : (summary.elapsed_s ? 'no lap heart rate' : 'nothing logged')
      },
      trend: trend,
      /* the live training values, absent rather than rewound */
      hero: null, form: null, record: null, days: null,
      ribbon: ribbon(runs, scope, key, 12, 'load', c, today),
      gapBefore: emptyRunBefore(runs, scope, key)
    };
  }

  /* The year review's charts, all from logged runs. Pace against heart rate
     uses only aerobic measurements (no races, no trail): a race or a
     technical trail would sit off the cloud for reasons that aren't fitness. */
  function yearPictures(runs, c, key) {
    const prevKey = String(+key - 1);
    const runPace = a => a.gap_pace_s != null ? a.gap_pace_s : paceSecPerKm(a.distance_km, a.elapsed_s);
    const dots = y => runs.filter(a => a.date.slice(0, 4) === y && isAerobicMeasure(a) && a.avg_hr != null)
      .map(a => ({ id: a.id, date: a.date, hr: a.avg_hr, pace: runPace(a) })).filter(p => p.pace > 0);

    /* cumulative km, every year on one January-to-December axis */
    const years = Array.from(new Set(runs.map(a => a.date.slice(0, 4)))).sort();
    const cumulative = years.map(y => {
      let sum = 0;
      const pts = runs.filter(a => a.date.slice(0, 4) === y).sort((a, b) => a.date.localeCompare(b.date))
        .map(a => { sum += a.distance_km || 0; return { date: '2000' + a.date.slice(4), value: Math.round(sum * 10) / 10 }; });
      return { year: y, points: pts, total: Math.round(sum) };
    }).filter(y => y.points.length);

    return { year: key, scatter: { now: dots(key), prev: dots(prevKey), prevYear: prevKey },
             cumulative: cumulative };
  }

  /* ---------- what counts as a measurement of aerobic fitness ----------

     Aerobic pace is "what you would hold at 145 bpm", and it only means that
     for a run where you were trying to sit at an even aerobic effort. A
     marathon at 156 bpm for five hours is a different thing entirely: it set
     the 2024 headline, it sat in the trend, and it dragged the all-time best.

     Races are kept everywhere else — distance, time, load, zone split, the
     list — because they happened and they cost you something. They are only
     excluded from the places that claim to measure aerobic pace. */

  function isRace(a) { return !!a && a.session === 'race'; }

  /* Terrain: road unless said otherwise. Set from Garmin's "Trail Run" type
     at import, or by hand on the run. */
  function isTrail(a) { return !!a && a.terrain === 'trail'; }

  /* What counts as a measurement of aerobic pace. A race is run to a
     different brief, and a technical trail is slow for reasons that have
     nothing to do with fitness, so neither is one. Every aerobic-pace figure
     in the app asks here. */
  /* Heart rate that followed cadence for a third or more of the run (a wrist
     sensor locked onto the stride, as the Forerunner 235 did) says nothing
     about the heart. Such a run stays out of everything built on heart rate,
     unless you've said to trust it. */
  const HR_LOCK_LIMIT = 30;
  function hrLocked(a) {
    return !!a && a.hr_trust !== 'trust' && a.hr_lock != null && a.hr_lock !== '' && Number(a.hr_lock) >= HR_LOCK_LIMIT;
  }

  function isAerobicMeasure(a) { return !!a && !isRace(a) && !isTest(a) && !isTrail(a) && !hrLocked(a); }

  function aerobicSamples(acts) {
    return (acts || []).filter(isAerobicMeasure);
  }

  /* What a period's aerobic-pace caption has to own up to leaving out. */
  function leftOutOf(acts) {
    const runs = (acts || []).filter(a => ACTIVITY_TYPES.indexOf(a.type) >= 0);
    return { races: runs.filter(isRace).length,
             tests: runs.filter(a => isTest(a) && !isRace(a)).length,
             trail: runs.filter(a => isTrail(a) && !isRace(a) && !isTest(a)).length,
             locked: runs.filter(a => hrLocked(a) && !isRace(a) && !isTest(a) && !isTrail(a)).length };
  }

  /* Runs to rank this one against: a similar distance (within 20%) on the
     same kind of ground. A technical trail ranked against road runs comes
     last for reasons that aren't fitness. */
  function lengthPeers(act, all, cfg) {
    if (!act || act.distance_km == null || hrLocked(act) || isTest(act)) return null;
    const mine = aerobicPace(act, cfg);
    if (mine == null) return null;
    const lo = act.distance_km * 0.8, hi = act.distance_km * 1.2, trail = isTrail(act);
    const peers = (all || [])
      .filter(x => x.type === 'run' && x.id !== act.id && x.avg_hr != null && !hrLocked(x) && !isTest(x) &&
                   x.distance_km >= lo && x.distance_km <= hi && isTrail(x) === trail)
      .map(x => ({ act: x, pace: aerobicPace(x, cfg) }))
      .filter(x => x.pace != null)
      .sort((p, q) => p.pace - q.pace);
    return { mine: mine, peers: peers, lo: lo, hi: hi, trail: trail };
  }

  /* ---------- best efforts ----------

     One source for every best in the app. A run with its watch file carries
     efforts measured on the second-by-second record (worked out in the Apps
     Script at import): the fastest stretch of exactly each distance, starting
     anywhere, so a stretch that began 300 m into a lap counts, a stray lap
     button doesn't matter, and a 21.46 km trail half yields a Half.

     A run without a file falls back to whole laps: the fastest run of
     consecutive full kilometres, only at whole-kilometre distances. Laps can't
     give a fair 400 m or mile, so those come from files only. Two methods are
     never mixed for the same run: a run with a file is measured from the file
     at every distance. */

  const EFFORT_DISTANCES = [0.4, 1, 1.609, 5, 10, 21.1, 42.2];
  /* how each distance is keyed in the file-measured efforts */
  const EFFORT_METERS = { 0.4: 400, 1: 1000, 1.609: 1609, 5: 5000, 10: 10000, 21.1: 21097, 42.2: 42195 };
  const LAP_EFFORTS = [1, 5, 10, 21.1, 42.2];

  /* Fastest run of `km` consecutive full laps, or null if the run is shorter.
     Laps are rarely exactly 1 km, so distance is accumulated rather than
     counted, and a window must cover at least the distance asked for. */
  function bestEffort(laps, km) {
    const full = fullLaps(laps);
    if (!full.length) return null;
    let best = null;
    for (let i = 0; i < full.length; i++) {
      let dist = 0, time = 0;
      for (let j = i; j < full.length; j++) {
        dist += full[j].distance_km;
        time += full[j].time_s;
        if (dist >= km) {
          /* pace over the window, so a window that overshoots is not favoured */
          const pace = time / dist;
          if (best == null || pace < best.pace)
            best = { pace: pace, seconds: Math.round(pace * km),
                     from: full[i].n, to: full[j].n, source: 'laps',
                     overDistance: Math.round((dist - km) * 100) / 100 };
          break;
        }
      }
    }
    return best;
  }

  function streamEfforts(act) {
    if (!act || !(Number(act.stream_v) >= 1)) return null;
    const e = act.efforts;
    if (e && typeof e === 'object') return e;
    try { return e ? JSON.parse(e) : {}; } catch (err) { return {}; }
  }

  /* One run, one distance, whichever way the run can be measured. */
  function bestEffortOf(act, km) {
    const st = streamEfforts(act);
    if (st) {
      const sec = st[EFFORT_METERS[km]];
      if (!(sec > 0)) return null;
      const realKm = EFFORT_METERS[km] / 1000;
      return { seconds: Math.round(sec), pace: sec / realKm, source: 'stream' };
    }
    if (LAP_EFFORTS.indexOf(km) < 0) return null;
    return bestEffort(act && act.laps, km);
  }

  /* Every distance this run has an effort for. */
  function effortsOf(act, distances) {
    const out = [];
    (distances || EFFORT_DISTANCES).forEach(km => {
      const e = bestEffortOf(act, km);
      if (e) out.push(Object.assign({ km: km }, e));
    });
    return out;
  }

  /* The best each distance has ever been, and which run holds it. Races count
     here — a best effort is a best effort, however it was come by. */
  function bestEffortBoard(acts, distances) {
    const runs = (acts || []).filter(a => a.type === 'run' && isUsable(a));
    return (distances || EFFORT_DISTANCES).map(km => {
      let best = null;
      runs.forEach(a => {
        const e = bestEffortOf(a, km);
        if (e && (best == null || e.seconds < best.seconds))
          best = Object.assign({ km: km, run: a }, e);
      });
      return best;
    }).filter(Boolean);
  }

  /* ---------- runs read by heart rate alone ----------

     Display only, beside your tags: easy when 70% or more of the time is in
     Z1-Z2, hard when 30% or more is in Z4-Z5, steady otherwise. A run without
     zone data isn't guessed at. Nothing else in the app uses this. */
  function effortMix(runs, cfg) {
    const b = zoneBounds(cfg);
    const out = { easy: 0, steady: 0, hard: 0, unknown: 0 };
    (runs || []).forEach(a => {
      const tz = timeInZone(zoneLaps(a), b);
      const tot = [1, 2, 3, 4, 5].reduce((t, z) => t + tz[z], 0);
      if (!tot) { out.unknown++; return; }
      if ((tz[1] + tz[2]) / tot >= 0.7) out.easy++;
      else if ((tz[4] + tz[5]) / tot >= 0.3) out.hard++;
      else out.steady++;
    });
    return out;
  }

  /* ---------- threshold tests ----------

     A run tagged Test, read the standard way for a 30-minute test: heart rate
     and pace over the last 20 minutes, from the laps (a lap that straddles the
     cut counts for the part inside it). Each test against the one before. */
  const TEST_WINDOW_S = 1200;

  function testReading(a) {
    const laps = (a.laps || []).filter(l => l.time_s > 0 && l.distance_km > 0).slice().sort((x, y) => x.n - y.n);
    if (!laps.length) return null;
    let t = 0, d = 0, hrT = 0, hrS = 0;
    for (let i = laps.length - 1; i >= 0 && t < TEST_WINDOW_S; i--) {
      const l = laps[i], take = Math.min(1, (TEST_WINDOW_S - t) / l.time_s);
      t += l.time_s * take; d += l.distance_km * take;
      if (l.avg_hr != null) { hrT += l.time_s * take; hrS += l.avg_hr * l.time_s * take; }
    }
    return { seconds: Math.round(t), full: t >= TEST_WINDOW_S - 1,
             hr: hrT ? Math.round(hrS / hrT) : null, pace: d ? t / d : null };
  }

  function testsModel(runs) {
    const tests = (runs || []).filter(a => a.type === 'run' && isTest(a))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(a => Object.assign({ run: a }, testReading(a) || {}));
    tests.forEach((t, i) => {
      const prev = tests[i + 1];
      t.vs = prev && prev.pace && t.pace ? {
        date: prev.run.date,
        pace: delta(t.pace, prev.pace, 'down'),
        hr: t.hr != null && prev.hr != null ? t.hr - prev.hr : null
      } : null;
    });
    return tests;
  }

  /* ---------- worth knowing ----------

     Plain facts the data has to say, shown only when genuinely notable and
     never more than three. Nothing here changes a number anywhere else. */
  const WORTH = { restingBpm: 3, weekGapWeeks: 8, runGapDays: 56, bestGapDays: 365, minWeekKm: 10, max: 3 };

  function worthKnowing(acts, cfg, resting, today) {
    const t = String(today).slice(0, 10);
    const runs = (acts || []).filter(a => a.type === 'run' && isUsable(a)).sort((a, b) => a.date.localeCompare(b.date));
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const when = d => (+d.slice(8)) + ' ' + M[+d.slice(5, 7) - 1] + (d.slice(0, 4) !== t.slice(0, 4) ? ' ' + d.slice(0, 4) : '');
    const monthOf = d => M[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);
    const out = [];

    /* resting HR against three months ago */
    if (resting && resting.length) {
      const r = restingModel(resting, 'month', t);
      if (r.now != null && r.ago3m != null && Math.abs(r.now - r.ago3m) >= WORTH.restingBpm) {
        const lower = r.now < r.ago3m;
        out.push({ kind: 'resting', go: 'resting', tone: lower ? 'good' : 'bad',
          text: 'Resting HR is ' + Math.round(Math.abs(r.now - r.ago3m)) + ' bpm ' + (lower ? 'lower' : 'higher') +
            ' than three months ago \u2014 ' + Math.round(r.now) + ' against ' + Math.round(r.ago3m) + '.' });
      }
    }

    /* a best effort in the last 30 days that stands out */
    const recentFrom = addDays(t, -30);
    let best = null;
    EFFORT_DISTANCES.slice().reverse().forEach(km => {
      if (best && best.allTime) return;
      const recent = bestEffortBoard(runs.filter(a => a.date > recentFrom), [km])[0];
      if (!recent) return;
      const earlier = runs.filter(a => a.date < recentFrom).map(a => ({ a: a, e: bestEffortOf(a, km) })).filter(x => x.e);
      /* an all-time best only means something against a real history */
      if (earlier.length < 5) return;
      const faster = earlier.filter(x => x.e.seconds <= recent.seconds).sort((x, y) => y.a.date.localeCompare(x.a.date))[0];
      if (!faster) best = { km: km, e: recent, allTime: true };
      else if (!best && daysBetween(faster.a.date, recent.run.date) >= WORTH.bestGapDays)
        best = { km: km, e: recent, since: faster.a.date.slice(0, 4) };
    });
    if (best) {
      const name = { 0.4: '400 m', 1: '1 km', 1.609: 'mile', 21.1: 'half marathon', 42.2: 'marathon' }[best.km] || best.km + ' km';
      out.push({ kind: 'best', id: best.e.run.id, tone: 'good',
        text: (best.allTime ? 'New all-time ' + name + ' best: ' : 'Your fastest ' + name + ' since ' + best.since + ': ') +
          fmtDuration(best.e.seconds) + ' on ' + when(best.e.run.date) + '.' });
    }

    /* last full week against the weeks before it */
    const thisWeek = weekStart(t), lastWeek = addDays(thisWeek, -7);
    const weekKm = {};
    runs.forEach(a => { const w = weekStart(a.date); weekKm[w] = (weekKm[w] || 0) + (a.distance_km || 0); });
    const lw = weekKm[lastWeek] || 0;
    if (lw >= WORTH.minWeekKm) {
      const bigger = Object.keys(weekKm).filter(w => w < lastWeek && weekKm[w] >= lw).sort().pop();
      if (!bigger) out.push({ kind: 'week', tone: 'good', text: 'Last week was your biggest ever: ' + lw.toFixed(1) + ' km.' });
      else if (daysBetween(bigger, lastWeek) >= WORTH.weekGapWeeks * 7)
        out.push({ kind: 'week', tone: 'good', text: 'Last week was your biggest since ' + monthOf(bigger) + ': ' + lw.toFixed(1) + ' km.' });
    }

    /* the longest run in the last fortnight against everything before it */
    const recentRuns = runs.filter(a => a.date > addDays(t, -14));
    if (recentRuns.length) {
      const L = recentRuns.slice().sort((a, b) => b.distance_km - a.distance_km)[0];
      const longer = runs.filter(a => a.date < L.date && a.distance_km >= L.distance_km).pop();
      if (L.distance_km >= 10 && !longer)
        out.push({ kind: 'long', id: L.id, tone: 'good', text: 'Your longest run ever: ' + L.distance_km.toFixed(1) + ' km on ' + when(L.date) + '.' });
      else if (L.distance_km >= 10 && longer && daysBetween(longer.date, L.date) >= WORTH.runGapDays)
        out.push({ kind: 'long', id: L.id, tone: 'good', text: 'Your longest run since ' + monthOf(longer.date) + ': ' +
          L.distance_km.toFixed(1) + ' km on ' + when(L.date) + '.' });
    }

    /* back after a break */
    if (runs.length >= 2) {
      const last = runs[runs.length - 1], before = runs[runs.length - 2];
      const gap = daysBetween(before.date, last.date);
      if (daysBetween(last.date, t) <= 7 && gap >= 28)
        out.push({ kind: 'back', id: last.id, tone: 'good', text: 'First run in ' + Math.round(gap / 7) + ' weeks. Welcome back.' });
    }

    return out.slice(0, WORTH.max);
  }

  /* ---------- training progress ----------

     Four measures, now against three months ago, always shown (a row only
     drops out when one side has nothing to compare). Every number here is the
     app's existing measure, unchanged: aerobic pace counts the same runs by
     the same rules; this only lines it up across time. Below them, "lately":
     the occasional notable facts from worthKnowing, resting HR excepted since
     it has a row of its own. */
  const PROGRESS_BACK = 91, PROGRESS_DAYS = 28;

  /* Below these, a change is "about the same": night-to-night and run-to-run
     noise is bigger than this, so a verdict on it would be a verdict on noise.
     One table for every screen. */
  const SAME = { rhr: 1, hrv: 2, aerobic: 3, z2: 2, volume: 0.5 };

  /* a delta that knows when it is too small to mean anything */
  function changeOf(now, then, better, key) {
    if (now == null || then == null) return null;
    const diff = now - then;
    if (Math.abs(diff) < (SAME[key] || 0)) return { dir: 'flat', diff: diff, same: true, tone: 'neutral' };
    const d = better ? delta(now, then, better) : delta(now, then, null);
    return d ? Object.assign(d, { same: false }) : { dir: diff > 0 ? 'up' : 'down', diff: diff, same: false,
      tone: !better ? 'neutral' : (diff > 0) === (better === 'up') ? 'good' : 'bad' };
  }

  function progressModel(acts, cfg, resting, today, hrv) {
    const t = String(today).slice(0, 10);
    const runs = (acts || []).filter(a => a.type === 'run' && isUsable(a));
    const thenEnd = addDays(t, -PROGRESS_BACK);
    const inWin = (end) => runs.filter(a => a.date > addDays(end, -PROGRESS_DAYS) && a.date <= end);
    const rows = [];

    const aer = end => {
      const v = inWin(end).filter(a => isAerobicMeasure(a) && a.avg_hr != null).map(a => aerobicPace(a, cfg)).filter(x => x != null);
      return v.length >= 3 ? median(v) : null;
    };
    const aN = aer(t), aT = aer(thenEnd);
    if (aN != null && aT != null)
      rows.push({ key: 'aerobic', label: 'Aerobic pace', unit: '/km', now: aN, then: aT,
        change: changeOf(aN, aT, 'down', 'aerobic'), note: 'middle of 28 days' });

    const z2 = end => { const s = z2Of(lapsOf(inWin(end)), cfg); return s && s.total ? s.pct : null; };
    const zN = z2(t), zT = z2(thenEnd);
    if (zN != null && zT != null)
      rows.push({ key: 'z2', label: 'Time in Z2', unit: '%', now: zN, then: zT,
        change: changeOf(zN, zT, 'up', 'z2'), note: 'share of 28 days' });

    const kmN = inWin(t).reduce((s, a) => s + (a.distance_km || 0), 0) / 4;
    const kmT = inWin(thenEnd).reduce((s, a) => s + (a.distance_km || 0), 0) / 4;
    if (inWin(t).length || inWin(thenEnd).length)
      /* more is not automatically better: shown without a verdict */
      rows.push({ key: 'volume', label: 'Weekly distance', unit: 'km', now: kmN, then: kmT,
        change: kmT ? changeOf(kmN, kmT, null, 'volume') : null, note: 'average of 4 weeks' });

    /* one sentence on top, the same way Recovery's is built */
    const A = rows.find(r => r.key === 'aerobic'), Z = rows.find(r => r.key === 'z2');
    let summary = null;
    if (A) {
      summary = A.change.same ? 'Aerobic pace about the same as three months ago'
        : 'Aerobic pace ' + Math.round(Math.abs(A.change.diff)) + ' s/km ' + (A.change.diff < 0 ? 'faster' : 'slower') + ' than three months ago';
      if (Z && !Z.change.same) summary += ', with ' + (Z.change.diff > 0 ? 'more' : 'less') + ' of your running in Z2';
      summary += '.';
    }

    const rec = recoveryModel(resting, hrv, t, acts, cfg);
    const lately = worthKnowing(acts, cfg, [], today).filter(w => w.kind !== 'resting');
    return { rows: rows, summary: summary, aerobic: A || null, recovery: rec.verdict, lately: lately, thenDate: thenEnd };
  }

  /* ---------- recovery: resting HR and HRV read together ----------

     Each measure is placed against your own normal: the last 60 nights'
     average, plus or minus your usual variation (one standard deviation).
     The last 3 nights say where you are now; the last 4 weeks against the 4
     before say where you're heading. Statements say what the numbers do and
     what that often means, never a diagnosis, and need enough nights behind
     them to appear at all. */
  const RECOVERY = { normalNights: 60, minNormal: 30, nowNights: 3, trendDays: 28,
                     patternNights: 90, patternMin: { hrv: 4, rhr: 2 }, perDayMin: 8, hardDaysMin: 8 };

  function nightsOf(days) {
    const seen = {};
    (days || []).forEach(x => { if (!x || !(+x[1] > 0)) return; const d = nightDate(x[0]); if (d) seen[d] = +x[1]; });
    return Object.keys(seen).sort().map(k => ({ date: k, v: seen[k] }));
  }

  function measureState(days, today, key, better, acts, cfg) {
    const n = nightsOf(days);
    if (!n.length) return null;
    const t = String(today).slice(0, 10);
    const between = (from, to) => n.filter(x => x.date > from && x.date <= to).map(x => x.v);
    const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    const r1 = v => v == null ? null : Math.round(v * 10) / 10;

    const base = between(addDays(t, -RECOVERY.normalNights), t);
    let band = null;
    if (base.length >= RECOVERY.minNormal) {
      const m = avg(base), sd = Math.sqrt(avg(base.map(v => (v - m) * (v - m))));
      band = { mean: r1(m), sd: r1(sd), lo: r1(m - sd), hi: r1(m + sd) };
    }
    const last3 = between(addDays(t, -RECOVERY.nowNights), t);
    const now3 = last3.length >= 2 ? avg(last3) : null;
    let pos = null;
    if (band && now3 != null) {
      const z = band.sd ? (now3 - band.mean) / band.sd : 0;
      pos = z < -1 ? (z < -2 ? 'well below' : 'below') : z > 1 ? (z > 2 ? 'well above' : 'above') : 'inside';
    }
    const now7 = avg(between(addDays(t, -7), t));
    const cur = avg(between(addDays(t, -RECOVERY.trendDays), t));
    const prev = avg(between(addDays(t, -2 * RECOVERY.trendDays), addDays(t, -RECOVERY.trendDays)));
    const trend = cur != null && prev != null ? changeOf(cur, prev, better, key) : null;

    /* patterns in your own weeks, once there are enough nights */
    const patterns = [];
    const recent = n.filter(x => x.date > addDays(t, -365));
    if (recent.length >= RECOVERY.patternNights) {
      const all = avg(recent.map(x => x.v));
      const byDay = [0,1,2,3,4,5,6].map(i => recent.filter(x => dayIndex(x.date) === i).map(x => x.v));
      const off = byDay.map((a, i) => ({ i: i, n: a.length, d: a.length >= RECOVERY.perDayMin ? avg(a) - all : 0 }));
      const worse = off.filter(o => better === 'up' ? o.d <= -RECOVERY.patternMin[key] : o.d >= RECOVERY.patternMin[key]);
      if (worse.length && worse.length <= 3) {
        const D = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
        const names = worse.map(o => D[o.i]);
        const mag = Math.round(Math.abs(avg(worse.map(o => o.d))) * 10) / 10;
        patterns.push({ kind: 'weekday', text: 'Your ' + (key === 'hrv' ? 'HRV' : 'resting HR') + ' is ' +
          (better === 'up' ? 'lowest' : 'highest') + ' on ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.slice(-1) : names[0]) +
          ' mornings: ' + mag + ' ' + (key === 'hrv' ? 'ms' : 'bpm') + (better === 'up' ? ' below' : ' above') + ' your average.' });
      }
      /* the morning after your hardest training days */
      if (acts && acts.length) {
        const dayLoad = {};
        acts.filter(a => a.type === 'run').forEach(a => { const l = load(a, cfg); if (l) dayLoad[a.date] = (dayLoad[a.date] || 0) + l; });
        const loads = Object.keys(dayLoad).filter(d => d > addDays(t, -365)).map(d => dayLoad[d]).sort((a, b) => a - b);
        if (loads.length >= 10) {
          const cut = loads[Math.floor(loads.length * 0.8)];
          const after = Object.keys(dayLoad).filter(d => dayLoad[d] >= cut).map(d => recent.find(x => x.date === addDays(d, 1))).filter(Boolean).map(x => x.v);
          if (after.length >= RECOVERY.hardDaysMin) {
            const dlt = avg(after) - all;
            if (better === 'up' ? dlt <= -RECOVERY.patternMin[key] : dlt >= RECOVERY.patternMin[key])
              patterns.push({ kind: 'hard', text: 'The morning after your hardest training days, ' + (key === 'hrv' ? 'HRV' : 'resting HR') +
                ' averages ' + Math.round(Math.abs(dlt) * 10) / 10 + ' ' + (key === 'hrv' ? 'ms ' : 'bpm ') +
                (better === 'up' ? 'lower' : 'higher') + ' than usual.' });
          }
        }
      }
    }
    return { key: key, better: better, nights: n.length, now7: r1(now7), now3: r1(now3), band: band, pos: pos,
             trend: trend, trendNow: r1(cur), trendPrev: r1(prev), patterns: patterns };
  }

  /* the two together: one sentence for now, one for the trend */
  function recoveryModel(resting, hrv, today, acts, cfg) {
    const R = measureState(resting, today, 'rhr', 'down', acts, cfg);
    const H = measureState(hrv, today, 'hrv', 'up', acts, cfg);
    const good = (M, p) => M && M.pos && (M.better === 'up' ? /above/.test(M.pos) : /below/.test(M.pos)) === p;
    const off = M => M && M.pos && M.pos !== 'inside';
    let now = null, tone = 'neutral';
    if (H && R && H.pos && R.pos) {
      const hB = /below/.test(H.pos), hA = /above/.test(H.pos), rB = /below/.test(R.pos), rA = /above/.test(R.pos);
      const well = /well/.test(H.pos) || /well/.test(R.pos);
      const where = M => M.pos === 'inside' ? 'inside your normal range' : M.pos + ' your normal range';
      let meaning;
      if (!off(H) && !off(R)) meaning = 'steady';
      else if ((hA && !rA) && (rB || !off(R))) { meaning = 'well rested'; tone = 'good'; }
      else if ((rB && !hB) && (hA || !off(H))) { meaning = 'well rested'; tone = 'good'; }
      else if (hB && rA) { meaning = (well ? 'both clearly point to under-recovery' : 'both point to under-recovery') +
        ' \u2014 often sleep, alcohol, illness or a hard block'; tone = 'bad'; }
      else if (hB && !off(R)) { meaning = 'often one late night or drinks; worth watching tomorrow'; tone = 'bad'; }
      else if (rA && !off(H)) { meaning = 'can be heat, a late meal or something coming on'; tone = 'bad'; }
      else if (hB && rB) meaning = 'mixed \u2014 sometimes deep fatigue after a big training block';
      else meaning = 'mixed \u2014 unusual, worth watching for a day or two';
      now = 'Last 3 nights: HRV ' + Math.round(H.now3) + ' ms, ' + where(H) + '; resting HR ' + Math.round(R.now3) +
        ' bpm, ' + where(R) + ' \u2014 ' + meaning + '.';
    }
    let trend = null, verdict = null;
    if (H && R && H.trend && R.trend) {
      const hs = H.trend.same, rs = R.trend.same;
      const hGood = !hs && H.trend.tone === 'good', rGood = !rs && R.trend.tone === 'good';
      const hBad = !hs && H.trend.tone === 'bad', rBad = !rs && R.trend.tone === 'bad';
      const nums = 'HRV ' + (hs ? 'about the same' : (H.trend.diff > 0 ? 'up ' : 'down ') + Math.round(Math.abs(H.trend.diff)) + ' ms') +
        ', resting HR ' + (rs ? 'about the same' : (R.trend.diff > 0 ? 'up ' : 'down ') + Math.round(Math.abs(R.trend.diff)) + ' bpm');
      if (hGood && rGood) { verdict = { key: 'right', text: 'both moving the right way', tone: 'good' }; trend = 'Over four weeks both are moving the right way: ' + nums + '.'; }
      else if (hBad && rBad) { verdict = { key: 'wrong', text: 'both moving the wrong way', tone: 'bad' }; trend = 'Over four weeks both are moving the wrong way: ' + nums + '. Worth easing off or checking sleep.'; }
      else if (hs && rs) { verdict = { key: 'same', text: 'about the same', tone: 'neutral' }; trend = 'Over four weeks: about the same.'; }
      else { verdict = { key: 'mixed', text: 'mixed', tone: 'neutral' }; trend = 'Over four weeks it\u2019s mixed: ' + nums + '. Give it time.'; }
    }
    return { rhr: R, hrv: H, now: now, nowTone: tone, trend: trend, verdict: verdict };
  }

  /* ---------- the Best-of page ----------

     Everything here is all-time, so nothing depends on which period the home
     screen has selected. "This year" is the calendar year of today. */

  function bestOfModel(acts, cfg, today) {
    const runs = (acts || []).filter(a => a.type === 'run' && isUsable(a));
    if (!runs.length) return { count: 0, board: [], progression: [], records: [], races: [] };
    const year = String(today).slice(0, 4);
    const thisYear = runs.filter(a => a.date.slice(0, 4) === year);
    const years = Array.from(new Set(runs.map(a => a.date.slice(0, 4)))).sort();

    const all = bestEffortBoard(runs);
    const now = {};
    bestEffortBoard(thisYear).forEach(b => { now[b.km] = b; });
    const board = all.map(b => ({ km: b.km, best: b, thisYear: now[b.km] || null }));

    /* each distance, its best in every year that has one */
    const progression = EFFORT_DISTANCES.map(km => {
      const per = years.map(y => {
        const b = bestEffortBoard(runs.filter(a => a.date.slice(0, 4) === y), [km])[0];
        return b ? { year: y, seconds: b.seconds, pace: b.pace, run: b.run } : null;
      }).filter(Boolean);
      if (!per.length) return null;
      const fastest = per.slice().sort((x, y) => x.seconds - y.seconds)[0].year;
      /* each year against the last year you ran it: faster or slower, by how much */
      return { km: km, years: per.map((p, i) => Object.assign({
        fastest: p.year === fastest, thisYear: p.year === year,
        vs: i ? per[i - 1].year : null,
        change: i ? delta(p.seconds, per[i - 1].seconds, 'down') : null
      }, p)) };
    }).filter(Boolean);

    /* records: the existing set, plus climbing and the biggest month and year */
    const records = recordsOf(runs, cfg);
    const climb = runs.filter(a => a.ascent_m != null).sort((a, b) => b.ascent_m - a.ascent_m)[0];
    if (climb) records.push({ label: 'Most climbing', value: String(Math.round(climb.ascent_m)),
      unit: 'm', when: climb.date, id: climb.id });
    const sumBy = keyOf => {
      const m = {};
      runs.forEach(a => { const k = keyOf(a); m[k] = (m[k] || 0) + (a.distance_km || 0); });
      const k = Object.keys(m).sort((x, y) => m[y] - m[x])[0];
      return k ? { key: k, km: m[k] } : null;
    };
    const bm = sumBy(a => a.date.slice(0, 7));
    if (bm) records.push({ label: 'Biggest month', value: bm.km.toFixed(1), unit: 'km', when: bm.key });
    const by = sumBy(a => a.date.slice(0, 4));
    if (by) records.push({ label: 'Biggest year', value: by.km.toFixed(0), unit: 'km', when: by.key });

    const races = runs.filter(isRace).sort((a, b) => b.date.localeCompare(a.date)).map(r => ({
      run: r, seconds: r.elapsed_s, pace: paceSecPerKm(r.distance_km, r.elapsed_s) }));

    return { count: runs.length, year: year, years: years, board: board,
             progression: progression, records: records, races: races, tests: testsModel(runs) };
  }

  /* ---------- resting HR ----------

     Context, not a training number: zones come from the watch. Three views,
     each averaging enough nights that one bad night doesn't spike the line:
     every night for 30 days, weekly averages for a year, monthly for all. */

  /* A night's date, however it arrived: a 'YYYY-MM-DD' string (possibly with
     stray characters around it), a full ISO timestamp, or something a
     spreadsheet turned into a date. Anything that can't be read is counted,
     never drawn. */
  function nightDate(v) {
    if (v == null) return null;
    const s = String(v).replace(/[^0-9T:.\-Z+]/g, '');
    const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) {
      const iso = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
      return isNaN(new Date(iso + 'T12:00:00').getTime()) ? null : iso;
    }
    const t = new Date(v);
    return isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
  }

  /* Month (every night, a calendar month at a time) is the default; Year is a
     calendar year of weekly averages; All is every year, monthly. Month and
     Year step back and forth through time by `key`. */
  const RESTING_VIEWS = ['month', 'year', 'all'];

  function restingModel(days, view, today, key) {
    let bad = 0, badSample = null;
    const seen = {};
    (days || []).forEach(x => {
      if (!x || !(+x[1] > 0)) return;
      const date = nightDate(x[0]);
      if (!date) { bad++; if (badSample == null) badSample = String(x[0]); return; }
      seen[date] = +x[1];                       // one value a night, the last one given
    });
    const d = Object.keys(seen).sort().map(k => ({ date: k, bpm: seen[k] }));
    if (!d.length) return { count: 0, bad: bad, badSample: badSample };
    const t = String(today).slice(0, 10);
    const back = n => { const x = new Date(t + 'T12:00:00'); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
    const mean = arr => arr.length ? Math.round(arr.reduce((a, x) => a + x.bpm, 0) / arr.length * 10) / 10 : null;

    let pts = [], gapDays, from = null, to = null, k = null;
    if (view === 'month') {
      k = /^\d{4}-\d\d$/.test(key || '') ? key : t.slice(0, 7);
      from = k + '-01';
      to = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).toISOString().slice(0, 10);
      pts = d.filter(x => x.date >= from && x.date <= to).map(x => ({ date: x.date, value: x.bpm }));
      gapDays = 3;
    } else if (view === 'year') {
      k = /^\d{4}$/.test(key || '') ? key : t.slice(0, 4);
      from = k + '-01-01'; to = k + '-12-31';
      const g = {};
      d.filter(x => x.date >= from && x.date <= to).forEach(x => { (g[weekStart(x.date)] = g[weekStart(x.date)] || []).push(x); });
      pts = Object.keys(g).sort().filter(w => g[w].length >= 3).map(w => ({ date: w, value: mean(g[w]), n: g[w].length }));
      gapDays = 15;
    } else {
      const g = {};
      d.forEach(x => { const m = x.date.slice(0, 7) + '-15'; (g[m] = g[m] || []).push(x); });
      pts = Object.keys(g).sort().filter(m => g[m].length >= 7).map(m => ({ date: m, value: mean(g[m]), n: g[m].length }));
      gapDays = 62;
    }
    /* a gap in the record breaks the line rather than drawing across it */
    const segments = [];
    pts.forEach((p, i) => {
      if (i && daysBetween(pts[i - 1].date, p.date) <= gapDays) segments[segments.length - 1].push(p);
      else segments.push([p]);
    });
    const inRange = from ? d.filter(x => x.date >= from && x.date <= to) : d;
    const period = from ? { key: k, from: from, to: to, nights: inRange.length, avg: mean(inRange),
      hasPrev: d[0].date < from, hasNext: to < t } : null;

    const now = mean(d.filter(x => x.date > back(7)));
    const at = n => { const end = back(n); const w = d.filter(x => x.date > back(n + 7) && x.date <= end); return w.length >= 3 ? mean(w) : null; };
    const months = {};
    d.forEach(x => { (months[x.date.slice(0, 7)] = months[x.date.slice(0, 7)] || []).push(x); });
    const full = Object.keys(months).filter(k => months[k].length >= 10)
      .map(k => ({ month: k, bpm: mean(months[k]) })).sort((a, b) => a.bpm - b.bpm);
    return {
      bad: bad, badSample: badSample, period: period,
      count: d.length, first: d[0].date, last: d[d.length - 1].date, view: view,
      segments: segments, shown: pts.length,
      now: now, ago3m: at(91), ago1y: at(365),
      lowestMonth: full[0] || null, highestMonth: full[full.length - 1] || null
    };
  }

  /* Which distances this run holds the record for, as of the whole history. */
  function recordsSetBy(act, acts, distances) {
    const board = bestEffortBoard(acts, distances);
    return board.filter(b => b.run && b.run.id === act.id);
  }

  /* ---------- load ----------
     Banister TRIMP: minutes weighted by heart-rate reserve, exponentially, so a
     short hard effort can cost the same as a long easy one. Needs only average
     heart rate and the two anchors, so it works on every run already logged. */

  function load(act, cfg) {
    const c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    if (!act || act.avg_hr == null || !act.elapsed_s || hrLocked(act)) return null;
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
      const tz = timeInZone(lapsOf(onDay), zoneBounds(cfg));
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
    aerobicCost, drift, timeInZone, comparable, median,
    isoWeek, weekStart, periodStart, periodEnd, dayIndex, daysBetween, splitOnGaps,
    ACTIVITY_TYPES, homeModel, reviewModel, halves, raceBuild, REVIEW_MIN, stat, weekRollup, monthRollup, confidence,
    periodKey, shiftKey, inPeriod, periodLabel, periodSpan, nextWithData,
    summarize, ribbon, previousWithData, emptyRunBefore, medianCost,
    refHr, suggestedPaceRef, aerobicPace, paceSeries, PACE_WINDOW, trendRange, TREND_MIN_DAYS, records, delta, deltaText, sharesOf, driftNeeds, driftIsFlat, DRIFT_FLAT,
    isUsable, damaged, whatsMissing, normalise, normaliseDate, toNumber,
    load, sessionRpe, z2Typical, z2Share, z2Record, z2Tone,
    SESSIONS, sessionOf, sessionLabel, intentCheck, sessionNote, z2Of, lapsOf,
    isRace, aerobicSamples,
    EFFORT_DISTANCES, bestEffort, bestEffortOf, effortsOf, bestEffortBoard, recordsSetBy,
    zoneLaps, driftOf, bestOfModel, progressModel, recoveryModel, measureState, changeOf, SAME, isTest, effortMix, testsModel, testReading, worthKnowing, WORTH, hrLocked, HR_LOCK_LIMIT, restingModel, RESTING_VIEWS, isTrail, isAerobicMeasure, leftOutOf, lengthPeers,
    ROLLING_DAYS, sinceDays, z2Rolling, loadSeries, rampFlag, weekDays, RAMP_LIMIT, spread, noticed, NOTICE,
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
