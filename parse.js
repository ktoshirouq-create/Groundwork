/* parse.js — turns a pasted transcription table into a draft activity.
   Forgiving in, strict out: nothing here rejects, it only reports. */

(function (root) {
  'use strict';

  const MONTHS = {
    jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
    jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, des:12, dec:12
  };

  /* field name -> canonical key */
  const SYNONYMS = {
    date: 'date',
    temperature: 'temp_c', temp: 'temp_c', weather: 'temp_c',
    totaldistance: 'distance_km', distance: 'distance_km',
    totaltime: 'elapsed_s', elapsedtime: 'elapsed_s', time: 'elapsed_s',
    movingtime: 'moving_s',
    avgpace: 'avg_pace_s', averagepace: 'avg_pace_s', pace: 'avg_pace_s',
    avggradeadjpace: 'gap_pace_s', gappace: 'gap_pace_s',
    gradeadjustedpace: 'gap_pace_s', avggradeadjustedpace: 'gap_pace_s',
    avghr: 'avg_hr', averageheartrate: 'avg_hr', avgheartrate: 'avg_hr', hr: 'avg_hr',
    restinghr: 'resting_hr', restingheartrate: 'resting_hr', resting: 'resting_hr',
    maxhr: '_ignore', maxheartrate: '_ignore',
    avgcadence: 'cadence_spm', cadence: 'cadence_spm', avgruncadence: 'cadence_spm',
    totalascent: 'ascent_m', ascent: 'ascent_m', elevationgain: 'ascent_m', elevation: 'ascent_m',
    totaldescent: 'descent_m', descent: 'descent_m',
    minelevation: 'ele_min_m', maxelevation: 'ele_max_m',
    rpe: 'rpe', perceivedeffort: 'rpe',
    feel: 'feel'
  };

  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  /* ---------- value parsers ---------- */

  function num(v) {
    if (v == null) return null;
    const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  /* "22:17" -> 1337 ; "1:32:49" -> 5569 ; "7:24 /km" -> 444 ; "6:52.6" -> 413 */
  function duration(v) {
    if (v == null) return null;
    const m = String(v).match(/(\d+):(\d{2})(?::(\d{2}))?(?:\.(\d+))?/);
    if (!m) return null;
    const a = +m[1], b = +m[2], c = m[3] != null ? +m[3] : null;
    const base = c != null ? a * 3600 + b * 60 + c : a * 60 + b;
    return m[4] != null && c == null ? base : base;
  }

  function rpe(v) {
    const n = num(v);
    return n != null && n >= 1 && n <= 10 ? n : null;
  }

  /* "13 Aug 2026", "Saturday 29 Nov", "8 Dec (Monday)", "2026-08-13", "1 Dec" */
  function date(v, todayStr) {
    if (v == null) return { value: null, inferredYear: false };
    const s = String(v).trim();
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return { value: iso[0], inferredYear: false };

    const m = s.match(/(\d{1,2})\s*\.?\s*([A-Za-zÆØÅæøå]+)\.?\s*(\d{4})?/);
    if (!m) return { value: null, inferredYear: false };
    const day = +m[1];
    const mon = MONTHS[norm(m[2]).slice(0, 4)] || MONTHS[norm(m[2]).slice(0, 3)];
    if (!mon) return { value: null, inferredYear: false };

    const today = todayStr || new Date().toISOString().slice(0, 10);
    let year = m[3] ? +m[3] : +today.slice(0, 4);
    const mk = y => y + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    let inferred = false;
    if (!m[3]) {
      inferred = true;
      if (mk(year) > today) year -= 1;   // no year given and it'd be in the future
    }
    return { value: mk(year), inferredYear: inferred };
  }

  /* ---------- line classification ---------- */

  function cells(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  }

  const isSeparator = line => /^[\s|:-]+$/.test(line);
  const isFlagLine = line => /^(missing field|screenshot unreadable|value seems wrong|no lap hr)/i.test(line.trim());

  /* ---------- main ---------- */

  function parse(text, opts) {
    opts = opts || {};
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const out = {
      fields: {},
      cleared: [],
      laps: [],
      notes: [],      // flag lines carried through from the transcription
      unmatched: [],  // rows we couldn't place
      warnings: []
    };

    String(text || '').split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      if (isFlagLine(line)) { out.notes.push(line); return; }
      if (!line.includes('|')) { out.unmatched.push(line); return; }
      if (isSeparator(line)) return;

      const c = cells(line).filter((v, i, a) => !(v === '' && i === a.length - 1));
      if (!c.length) return;

      /* header rows */
      const h0 = norm(c[0]);
      if (h0 === 'metric' || h0 === 'lap' || h0 === 'field') return;

      /* lap row: first cell is a bare number and there are 3+ cells */
      if (c.length >= 3 && /^\d+$/.test(c[0])) {
        const lap = {
          n: +c[0],
          distance_km: num(c[1]),
          time_s: duration(c[2]),
          avg_hr: null,
          role: 'main'
        };
        /* remaining cells: find an HR (2-3 digits, 30-220) and a role word */
        c.slice(3).forEach(v => {
          const w = norm(v);
          if (['warmup', 'main', 'cooldown', 'cool', 'warm'].includes(w)) {
            lap.role = w.startsWith('warm') ? 'warmup' : w.startsWith('cool') ? 'cooldown' : 'main';
          } else if (/^\d{2,3}$/.test(v.replace(/[^0-9]/g, '')) && !v.includes(':')) {
            const n = num(v);
            if (n != null && n >= 30 && n <= 220) lap.avg_hr = n;
          }
        });
        if (lap.distance_km != null && lap.time_s != null) out.laps.push(lap);
        else out.unmatched.push(line);
        return;
      }

      /* key/value row */
      if (c.length >= 2) {
        const key = SYNONYMS[norm(c[0])];
        const val = c[1];
        if (!key) { out.unmatched.push(line); return; }
        if (key === '_ignore') return;
        if (val === '' || val === '—' || val === '-' || norm(val) === 'na') {
          out.cleared.push(key); return;
        }

        switch (key) {
          case 'date': {
            const d = date(val, today);
            out.fields.date = d.value;
            if (d.inferredYear) out.warnings.push('Year not given for the date — assumed ' + (d.value || '').slice(0, 4) + '.');
            break;
          }
          case 'elapsed_s':
          case 'moving_s':
            out.fields[key] = duration(val); break;
          case 'avg_pace_s':
          case 'gap_pace_s':
            out.fields[key] = duration(val); break;
          case 'rpe':
            out.fields.rpe = rpe(val); break;
          case 'feel':
            out.fields.feel = val; break;
          default:
            out.fields[key] = num(val);
        }
        return;
      }

      out.unmatched.push(line);
    });

    return out;
  }

  /* ---------- inference and validation ---------- */

  function inferType(p) {
    if (p.fields.ascent_m != null && p.fields.moving_s != null) return 'hike';
    if (p.fields.cadence_spm != null || p.fields.gap_pace_s != null) return 'run';
    return null;
  }

  const RANGES = {
    avg_hr: [30, 220],
    resting_hr: [25, 120],
    cadence_spm: [100, 220],
    distance_km: [0.1, 100],
    ascent_m: [0, 5000],
    descent_m: [0, 5000],
    ele_min_m: [-500, 3000],
    ele_max_m: [-500, 3000],
    temp_c: [-40, 50],
    rpe: [1, 10]
  };

  function validate(p, opts) {
    opts = opts || {};
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const f = p.fields, flags = [];
    const add = (level, msg) => flags.push({ level: level, msg: msg });

    if (f.date == null) add('error', 'No date found.');
    else if (f.date > today) add('error', 'Date is in the future.');
    else if (f.date < '2015-01-01') add('error', 'Date is before 2015.');

    if (f.distance_km == null) add('error', 'No distance found.');
    if (f.elapsed_s == null) add('error', 'No time found.');

    Object.keys(RANGES).forEach(k => {
      if (f[k] == null) return;
      const [lo, hi] = RANGES[k];
      if (f[k] < lo || f[k] > hi) add('error', k + ' is ' + f[k] + ', outside ' + lo + '–' + hi + '.');
    });

    if (f.moving_s != null && f.elapsed_s != null && f.moving_s > f.elapsed_s)
      add('error', 'Moving time is longer than elapsed time.');

    if (f.ele_min_m != null && f.ele_max_m != null && f.ele_max_m < f.ele_min_m)
      add('error', 'Max elevation is below min elevation.');

    /* cross-checks against the laps */
    if (p.laps.length) {
      const ld = p.laps.reduce((a, l) => a + l.distance_km, 0);
      const lt = p.laps.reduce((a, l) => a + l.time_s, 0);
      if (f.distance_km != null && Math.abs(ld - f.distance_km) / f.distance_km > 0.02)
        add('warn', 'Laps total ' + ld.toFixed(2) + ' km against a stated ' + f.distance_km + ' km.');
      if (f.elapsed_s != null && Math.abs(lt - f.elapsed_s) > 30)
        add('warn', 'Laps total ' + Math.round(lt) + 's against a stated ' + f.elapsed_s + 's.');
      const noHr = p.laps.every(l => l.avg_hr == null);
      if (noHr) add('info', 'No lap heart rate — drift and time in zone are unavailable.');
    } else {
      add('info', 'No laps — drift and time in zone are unavailable.');
    }

    /* stated pace against distance over time */
    if (f.avg_pace_s != null && f.distance_km && f.elapsed_s) {
      const derived = f.elapsed_s / f.distance_km;
      if (Math.abs(derived - f.avg_pace_s) / derived > 0.03)
        add('warn', 'Stated pace does not match distance over time.');
    }

    p.warnings.forEach(w => add('warn', w));
    p.unmatched.forEach(u => add('info', 'Row not recognised: ' + u.slice(0, 48)));

    return flags;
  }

  function toActivity(p, extra) {
    const f = p.fields;
    const a = Object.assign({
      type: extra && extra.type || inferType(p) || 'run',
      date: f.date,
      name: (extra && extra.name) || '',
      source: (extra && extra.source) || 'tracked',
      distance_km: f.distance_km,
      elapsed_s: f.elapsed_s,
      moving_s: f.moving_s != null ? f.moving_s : null,
      ascent_m: f.ascent_m != null ? f.ascent_m : null,
      descent_m: f.descent_m != null ? f.descent_m : null,
      ele_min_m: f.ele_min_m != null ? f.ele_min_m : null,
      ele_max_m: f.ele_max_m != null ? f.ele_max_m : null,
      temp_c: f.temp_c != null ? f.temp_c : null,
      avg_hr: f.avg_hr != null ? f.avg_hr : null,
      resting_hr: f.resting_hr != null ? f.resting_hr : null,
      gap_pace_s: f.gap_pace_s != null ? f.gap_pace_s : null,
      cadence_spm: f.cadence_spm != null ? f.cadence_spm : null,
      rpe: f.rpe != null ? f.rpe : null,
      feel: f.feel || null,
      conditions: (extra && extra.conditions) || null,
      pack: (extra && extra.pack) || null,
      note: (extra && extra.note) || null
    }, extra && extra.override || {});
    a.laps = p.laps.map(l => ({
      n: l.n, distance_km: l.distance_km, time_s: l.time_s,
      avg_hr: l.avg_hr, role: a.type === 'hike' ? 'main' : l.role
    }));
    return a;
  }


  /* ---------- merge, for replacing an existing activity ----------
     A field absent from the paste keeps its stored value; a field written as
     "—" clears it. Typed fields are never touched by a paste — they came from
     you, not from a screenshot. */

  const TYPED = ['name', 'source', 'conditions', 'pack', 'note'];

  function mergeInto(existing, p, opts) {
    opts = opts || {};
    const f = p.fields;
    const out = Object.assign({}, existing);
    const changes = [];

    const set = (k, v) => {
      const before = out[k];
      if (before === v) return;
      out[k] = v;
      changes.push({ field: k, from: before, to: v });
    };

    Object.keys(f).forEach(k => {
      if (k === 'avg_pace_s') return;          // derived, never stored
      if (TYPED.indexOf(k) >= 0) return;
      set(k, f[k]);
    });

    /* cleared fields: the parser drops "—" rows, so anything the transcription
       explicitly voided arrives here */
    (p.cleared || []).forEach(k => {
      if (TYPED.indexOf(k) >= 0) return;
      set(k, null);
    });

    if (p.laps.length) {
      const prev = existing.laps || [];
      const sig = ls => ls.map(l =>
        [l.n, l.distance_km, l.time_s, l.avg_hr, l.role || 'main'].join(':')).join('|');
      out.laps = p.laps.map(l => ({
        n: l.n, distance_km: l.distance_km, time_s: l.time_s,
        avg_hr: l.avg_hr, role: out.type === 'hike' ? 'main' : l.role
      }));
      /* compare content, not just count — a lap-only paste that adds heart rate
         to laps you already had is exactly the case this exists for */
      if (sig(prev) !== sig(out.laps)) {
        const hrBefore = prev.filter(l => l.avg_hr != null).length;
        const hrAfter = out.laps.filter(l => l.avg_hr != null).length;
        changes.push({
          field: 'laps',
          from: prev.length + ' laps' + (hrBefore ? ', ' + hrBefore + ' with HR' : ', no HR'),
          to: out.laps.length + ' laps' + (hrAfter ? ', ' + hrAfter + ' with HR' : ', no HR')
        });
      }
    }

    out.updated_at = new Date().toISOString();
    return { activity: out, changes: changes };
  }

  /* Validation for a replace: the stored record supplies anything the paste
     leaves out, so a lap-only paste is legal. */
  function validateMerge(existing, p, opts) {
    const merged = mergeInto(existing, p, opts).activity;
    const flags = [];
    const add = (level, msg) => flags.push({ level: level, msg: msg });

    if (!p.laps.length && !Object.keys(p.fields).length)
      add('error', 'Nothing recognised in that paste.');

    if (p.fields.date && p.fields.date !== existing.date)
      add('warn', 'This paste is dated ' + p.fields.date + ', the stored run is ' + existing.date + '.');

    if (p.laps.length) {
      const ld = p.laps.reduce((a, l) => a + l.distance_km, 0);
      const lt = p.laps.reduce((a, l) => a + l.time_s, 0);
      if (merged.distance_km && Math.abs(ld - merged.distance_km) / merged.distance_km > 0.02)
        add('warn', 'Laps total ' + ld.toFixed(2) + ' km against ' + merged.distance_km + ' km on the record.');
      if (merged.elapsed_s && Math.abs(lt - merged.elapsed_s) > 30)
        add('warn', 'Laps total ' + Math.round(lt) + 's against ' + merged.elapsed_s + 's on the record.');
    }

    Object.keys(RANGES).forEach(k => {
      if (merged[k] == null) return;
      const [lo, hi] = RANGES[k];
      if (merged[k] < lo || merged[k] > hi) add('error', k + ' would become ' + merged[k] + '.');
    });

    p.warnings.forEach(w => add('warn', w));
    p.unmatched.forEach(u => add('info', 'Row not recognised: ' + u.slice(0, 48)));
    return flags;
  }

  const api = { parse, validate, inferType, toActivity, mergeInto, validateMerge, TYPED,
                _duration: duration, _date: date };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parse = api;

})(typeof self !== 'undefined' ? self : this);
