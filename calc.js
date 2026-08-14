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

  function drift(laps) {
    const m = mainLaps(laps).filter(l => l.avg_hr != null);
    if (m.length < 3) return null;
    const n = Math.ceil(m.length / 3);
    const mean = arr => arr.reduce((a, l) => a + l.avg_hr, 0) / arr.length;
    const first = mean(m.slice(0, n));
    const last = mean(m.slice(-n));
    return Math.round(last - first);
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
      a.type !== 'test' &&
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
    const inMonth = acts.filter(a => a.type !== 'test' && a.date.slice(0, 7) === ym);
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

  const SCHEMA = 1;

  function newId(type, date) {
    const r = Math.random().toString(36).slice(2, 6);
    return type + '-' + date + '-' + r;
  }

  const BLANK = {
    id: null, type: 'run', date: null, name: '', source: 'tracked',
    distance_km: null, elapsed_s: null, moving_s: null,
    ascent_m: null, descent_m: null, ele_min_m: null, ele_max_m: null,
    temp_c: null, avg_hr: null, gap_pace_s: null, cadence_spm: null,
    rpe: null, feel: null, conditions: null, pack: null, note: null,
    laps: [], created_at: null, updated_at: null
  };

  function make(partial) {
    const a = Object.assign({}, BLANK, partial || {});
    const now = new Date().toISOString();
    if (!a.id) a.id = newId(a.type, a.date || 'undated');
    a.created_at = a.created_at || now;
    a.updated_at = now;
    if (!a.name) a.name = (a.type === 'hike' ? 'Hike' : 'Run') + ', ' + (a.date || '');
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
    /* future migrations branch on b.schema here, then set it forward */
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
    return 'Week ' + isoWeek(key).split('-W')[1];
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

  function summarize(acts) {
    const real = acts.filter(a => a.type !== 'test');
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
      const inK = acts.filter(a => a.type !== 'test' && inPeriod(a, scope, k));
      const s = summarize(inK);
      const v = metric === 'ascent' ? (s.ascent_m || 0) : s.distance_km;
      return { key: k, value: v, count: s.count, selected: k === selectedKey };
    });
  }

  /** Most recent period before `key` that actually has something in it. */
  function previousWithData(acts, scope, key) {
    let k = shiftKey(key, scope, -1);
    for (let i = 0; i < 60; i++) {
      if (acts.some(a => a.type !== 'test' && inPeriod(a, scope, k))) return k;
      k = shiftKey(k, scope, -1);
    }
    return null;
  }

  /** Nearest period after `key` that has something in it. */
  function nextWithData(acts, scope, key) {
    let k = shiftKey(key, scope, 1);
    for (let i = 0; i < 60; i++) {
      if (acts.some(a => a.type !== 'test' && inPeriod(a, scope, k))) return k;
      k = shiftKey(k, scope, 1);
    }
    return null;
  }

  /** How many periods of empty sit immediately before `key`. */
  function emptyRunBefore(acts, scope, key) {
    let k = shiftKey(key, scope, -1), n = 0;
    for (let i = 0; i < 400; i++) {
      if (acts.some(a => a.type !== 'test' && inPeriod(a, scope, k))) return n;
      n++; k = shiftKey(k, scope, -1);
    }
    return n;
  }

  function medianCost(acts, costFn) {
    return median(acts.filter(a => a.type !== 'test').map(a => {
      const c = costFn(a); return c ? c.value : null;
    }));
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
    weekRollup, monthRollup, confidence,
    periodKey, shiftKey, inPeriod, periodLabel, periodSpan, nextWithData,
    summarize, ribbon, previousWithData, emptyRunBefore, medianCost
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    module.exports.Model = Model;
  } else {
    root.Calc = api;
    root.Model = Model;
  }

})(typeof self !== 'undefined' ? self : this);
