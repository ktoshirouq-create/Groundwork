/* ui.js — rendering and interaction. All maths lives in calc.js. */

(function () {
  'use strict';

  let mode = 'run';          // which type the Week screen is showing
  let draft = null;          // parsed activity awaiting save

  const $ = sel => document.querySelector(sel);
  const el = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const ZCOL = { 1: 'var(--z1)', 2: 'var(--z2)', 3: 'var(--z3)', 4: 'var(--z4)', 5: 'var(--z5)' };
  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function fmtDate(d) {
    const [y, m, day] = d.split('-');
    const thisYear = new Date().getFullYear();
    const base = (+day) + ' ' + MON[+m - 1];
    return (+y === thisYear) ? base : base + ' ' + y;   // show year only when it isn't this one
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  /* ---------- shared fragments ---------- */

  function stripHTML(act, bounds, tall) {
    const laps = Calc.fullLaps(act.laps);
    if (!laps.length) return '';
    const blocks = laps.map(l => {
      const z = Calc.zoneOf(l.avg_hr, bounds);
      const bg = z ? ZCOL[z] : 'var(--stop)';
      return '<div class="blk' + (z ? '' : ' unknown') + '" style="background:' + bg + '"></div>';
    }).join('');
    return '<div class="strip' + (tall ? ' tall' : '') + '">' + blocks + '</div>';
  }

  function zoneBarHTML(tz, totalS) {
    if (!totalS) return '';
    const parts = [1, 2, 3, 4, 5].filter(z => tz[z] > 0).map(z =>
      '<div class="zseg" style="background:' + ZCOL[z] + '; flex:' + tz[z] + '">' +
      Math.round(tz[z] / 60) + '\u2032</div>'
    );
    if (tz.unknown > 0) parts.push('<div class="zseg" style="background:var(--stop); flex:' + tz.unknown + '"></div>');
    return '<div class="zbar">' + parts.join('') + '</div>';
  }

  function zoneKeyHTML(bounds) {
    return '<div class="zkey">' +
      '<span><i style="background:var(--z1)"></i>Z1 &lt;' + bounds.z2 + '</span>' +
      '<span><i style="background:var(--z2)"></i>Z2 ' + bounds.z2 + '\u2013' + (bounds.z3 - 1) + '</span>' +
      '<span><i style="background:var(--z3)"></i>Z3 ' + bounds.z3 + '\u2013' + (bounds.z4 - 1) + '</span>' +
      '<span><i style="background:var(--z4)"></i>Z4 ' + bounds.z4 + '+</span>' +
      '</div>';
  }

  function costOf(act) { return Calc.aerobicCost(act); }

  /* ---------- week ---------- */

  function renderWeek() {
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const all = Store.all().filter(a => a.type === mode);
    const today = todayStr();
    const ws = Calc.weekStart(today);
    const cut = Calc.dayIndex(today);
    const wk = Calc.weekRollup(all, ws, 6);

    const withCost = all
      .filter(a => a.avg_hr != null)
      .sort((a, b) => b.date.localeCompare(a.date));
    const last = withCost[0];
    const lastCost = last ? costOf(last) : null;

    let h = '';
    h += '<div class="hd"><div class="hd-t">Week ' + Calc.isoWeek(today).split('-W')[1] + '</div>' +
         '<div class="hd-x">' + fmtDate(ws).toUpperCase() + '</div></div>';

    h += '<div class="modes">' +
         '<button class="mode" data-mode="run" aria-pressed="' + (mode === 'run') + '">Run</button>' +
         '<button class="mode" data-mode="hike" aria-pressed="' + (mode === 'hike') + '">Hike</button>' +
         '</div>';

    if (!all.length) {
      h += '<div class="empty-state">Nothing logged yet.<br>Paste your first ' + mode + ' from the Add tab.</div>';
      el('view-week').innerHTML = h;
      bindModes();
      return;
    }

    /* hero — aerobic cost of the most recent activity with HR */
    h += '<div class="eyebrow">Aerobic cost \u00b7 last ' + mode + '</div>';
    if (lastCost) {
      h += '<div class="hero-fig"><div class="hero-num">' + lastCost.value + '</div>' +
           '<div class="hero-unit">beats / km</div></div>';
      const others = withCost.slice(1, 6).map(a => { const c = costOf(a); return c && c.value; }).filter(Boolean);
      const med = Calc.median(others);
      h += '<div class="hero-sub">' + (med
        ? 'Median of your last ' + others.length + ': <b>' + Math.round(med) + '</b>'
        : Calc.confidence(withCost.length, 'baseline').need + ' more with heart rate before this compares to anything.')
        + '</div>';
      const basis = [];
      if (lastCost.basis === 'gap') basis.push('gradient-adjusted');
      if (lastCost.scope === 'main') basis.push('main laps only');
      if (lastCost.hr_approx) basis.push('whole-run HR');
      if (basis.length) h += '<div class="est">Computed from ' + basis.join(', ') + '.</div>';
    } else {
      h += '<div class="hero-fig"><div class="hero-num pending">\u2014</div>' +
           '<div class="hero-unit">beats / km</div></div>' +
           '<div class="hero-sub">Needs an activity with average heart rate.</div>';
    }

    /* time in zone this week */
    const weekLaps = [];
    wk.activities.forEach(a => (a.laps || []).forEach(l => weekLaps.push(l)));
    const tz = Calc.timeInZone(weekLaps, bounds);
    const zTotal = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;
    if (zTotal > 0) {
      h += '<div class="rule"></div>';
      h += '<div class="eyebrow">Time in zone \u00b7 ' + Math.round(zTotal / 60) + ' min</div>';
      h += zoneBarHTML(tz, zTotal);
      h += zoneKeyHTML(bounds);
      h += '<div class="est">Each kilometre is assigned whole to the zone of its average heart rate.</div>';
    }

    /* volume */
    h += '<div class="rule"></div><div class="grid2">';
    h += metric('Distance', wk.distance_km.toFixed(2), 'km');
    h += metric('Time', Calc.fmtDuration(wk.elapsed_s), '');
    h += metric('Ascent',
      wk.ascent_m == null ? '\u2014' : wk.ascent_m, 'm',
      wk.ascent_of < wk.ascent_total_acts ? wk.ascent_of + ' of ' + wk.ascent_total_acts : '');
    h += metric(mode === 'run' ? 'Runs' : 'Hikes', String(wk.count), '');
    h += '</div>';

    /* this week's activities */
    h += '<div class="sec">This week</div>';
    if (!wk.activities.length) h += '<div class="empty-state">Nothing this week yet.</div>';
    else h += wk.activities
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(a => rowHTML(a, bounds)).join('');

    el('view-week').innerHTML = h;
    bindModes();
    bindRows();
  }

  function metric(label, value, unit, caption, pending) {
    return '<div><div class="g-l">' + esc(label) + '</div>' +
      '<div class="g-v' + (pending ? ' pending' : '') + '">' + esc(value) +
      (unit ? '<s>' + esc(unit) + '</s>' : '') + '</div>' +
      (caption ? '<div class="g-c">' + esc(caption) + '</div>' : '') + '</div>';
  }

  function rowHTML(a, bounds) {
    const c = costOf(a);
    const d = Calc.drift(a.laps);
    const meta = [];
    if (a.type === 'run') {
      const pace = a.gap_pace_s != null ? a.gap_pace_s : Calc.paceSecPerKm(a.distance_km, a.elapsed_s);
      meta.push(Calc.fmtPace(pace) + (a.gap_pace_s != null ? ' GAP' : ''));
    } else if (a.ascent_m != null) {
      meta.push('+' + a.ascent_m + ' m');
    }
    if (a.avg_hr != null) meta.push(a.avg_hr + ' bpm');
    if (d != null) meta.push('<b>drift ' + (d >= 0 ? '+' : '') + d + '</b>');
    if (a.temp_c != null) meta.push(a.temp_c + '\u00b0');

    return '<div class="row-a" data-id="' + esc(a.id) + '">' +
      '<div class="row-top">' +
        '<div class="row-day">' + DAYS[Calc.dayIndex(a.date)] + '</div>' +
        '<div class="row-nm">' + esc(a.name) + ' <span>\u00b7 ' + a.distance_km.toFixed(2) + ' km</span></div>' +
        '<div class="row-fig">' + (c ? c.value : '\u2014') + '</div>' +
      '</div>' +
      '<div class="row-indent">' + stripHTML(a, bounds) + '</div>' +
      (meta.length ? '<div class="row-meta row-indent">' + meta.join(' \u00b7 ') + '</div>' : '') +
      '</div>';
  }

  /* ---------- list ---------- */

  function renderList() {
    const bounds = Calc.zoneBounds(Store.config());
    const all = Store.all().slice().sort((a, b) => b.date.localeCompare(a.date));
    let h = '<div class="hd"><div class="hd-t">Log</div><div class="hd-x">' + all.length + ' LOGGED</div></div>';
    if (!all.length) {
      h += '<div class="empty-state">Nothing yet.</div>';
    } else {
      let lastMonth = '';
      all.forEach(a => {
        const ym = a.date.slice(0, 7);
        if (ym !== lastMonth) {
          lastMonth = ym;
          const m = Calc.monthRollup(all, ym);
          h += '<div class="sec">' + MON[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4) +
               ' \u00b7 ' + m.distance_km.toFixed(1) + ' km' +
               (m.ascent_m != null ? ' \u00b7 +' + m.ascent_m + ' m' : '') + '</div>';
        }
        h += rowHTML(a, bounds);
      });
    }
    el('view-list').innerHTML = h;
    bindRows();
  }

  /* ---------- detail ---------- */

  function renderDetail(id) {
    const a = Store.byId(id);
    if (!a) { go('list'); return; }
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const c = costOf(a);
    const d = Calc.drift(a.laps);
    const tz = Calc.timeInZone(a.laps, bounds);
    const zTotal = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;
    const ss = Calc.stopShare(a);
    const hrOk = Calc.hrIsReliable(a, cfg);

    let h = '<div class="back" data-back="1">\u2190 Back</div>';
    h += '<div class="hd-t">' + esc(a.name) + '</div>';
    const sub = [fmtDate(a.date).toUpperCase(), a.type.toUpperCase(), a.source.toUpperCase()];
    if (a.temp_c != null) sub.push(a.temp_c + '\u00b0');
    if (a.rpe != null) sub.push('RPE ' + a.rpe);
    if (a.conditions) sub.push(String(a.conditions).toUpperCase());
    h += '<div class="hd-x" style="margin-top:6px">' + esc(sub.join(' \u00b7 ')) + '</div>';

    /* per-km view */
    const laps = Calc.fullLaps(a.laps);
    if (laps.length) {
      h += '<div class="sec">Per kilometre</div>';
      if (a.type === 'hike') {
        const maxT = Math.max.apply(null, laps.map(l => l.time_s));
        h += '<div class="vbars">' + laps.map(l => {
          const z = Calc.zoneOf(l.avg_hr, bounds);
          const bg = z ? ZCOL[z] : 'var(--stop)';
          return '<div class="vcol"><div class="vlbl">' + Math.round(l.time_s / 60) + '</div>' +
            '<div class="vbar" style="background:' + bg + '; height:' +
            Math.max(6, Math.round(l.time_s / maxT * 100)) + '%"></div></div>';
        }).join('') + '</div>' +
        '<div class="est">Bar height is minutes for that kilometre; colour is heart-rate zone. Tall and amber is the climb.</div>';
      } else {
        h += stripHTML(a, bounds, true);
        h += '<div class="row-meta" style="margin-top:8px">' +
          laps.map(l => l.avg_hr == null ? '\u2014' : l.avg_hr).join(' \u00b7 ') + '</div>';
      }
    }

    if (d != null) {
      h += '<div class="callout' + (d > 8 ? ' warn' : '') + '">' +
        'Heart rate moved <b>' + (d >= 0 ? '+' : '') + d + ' bpm</b> from the first third to the last' +
        (d > 8 ? '. A base run should hold closer to flat.' : '.') + '</div>';
    }

    /* metrics */
    h += '<div class="rule"></div><div class="grid2">';
    h += metric('Aerobic cost', c ? c.value : '\u2014', c ? 'b/km' : '',
      c ? (c.basis === 'gap' ? 'gradient-adjusted' : 'raw pace') : 'needs heart rate', !c);
    if (a.type === 'run') {
      h += metric('Pace', Calc.fmtPace(Calc.paceSecPerKm(a.distance_km, a.elapsed_s)), '/km',
        a.gap_pace_s != null ? 'GAP ' + Calc.fmtPace(a.gap_pace_s) : '');
    } else {
      const ar = Calc.ascentRate(a);
      h += metric('Ascent rate', ar ? ar.value : '\u2014', ar ? 'm/h' : '',
        ar ? 'on ' + ar.basis + ' time' : 'needs ascent', !ar);
    }
    h += metric('Distance', a.distance_km.toFixed(2), 'km',
      a.type === 'hike' && Calc.flatEquivKm(a) != null ? 'flat-equiv ' + Calc.flatEquivKm(a) + ' km' : '');
    h += metric('Time', Calc.fmtDuration(a.elapsed_s), '',
      a.moving_s != null ? 'moving ' + Calc.fmtDuration(a.moving_s) : '');
    if (a.ascent_m != null) h += metric('Ascent', a.ascent_m, 'm', a.descent_m != null ? 'descent ' + a.descent_m + ' m' : '');
    h += metric('Avg HR', a.avg_hr == null ? '\u2014' : a.avg_hr, a.avg_hr == null ? '' : 'bpm',
      ss != null && !hrOk ? Math.round(ss * 100) + '% stopped' : '', a.avg_hr == null);
    if (a.type === 'hike') {
      const tf = Calc.terrainFactor(a, cfg);
      h += metric('Terrain factor', tf == null ? '\u2014' : tf.toFixed(2), '',
        tf == null ? 'needs moving time' : 'Naismith ' +
          Calc.fmtDuration(Calc.naismithHours(a.distance_km, a.ascent_m, cfg) * 3600), tf == null);
    }
    if (a.cadence_spm != null) h += metric('Cadence', a.cadence_spm, 'spm', '');
    h += '</div>';

    if (ss != null && !hrOk) {
      h += '<div class="callout warn">Average heart rate is dragged down by <b>' +
        Calc.fmtDuration(a.elapsed_s - a.moving_s) + ' stopped</b>. Shown here, kept out of trends.</div>';
    }

    if (zTotal > 0) {
      h += '<div class="sec">Time in zone \u00b7 ' + Math.round(zTotal / 60) + ' min</div>';
      h += zoneBarHTML(tz, zTotal);
      h += zoneKeyHTML(bounds);
    }

    if (a.feel) h += '<div class="sec">Felt</div><div class="small muted">' + esc(a.feel) + '</div>';
    if (a.note) h += '<div class="sec">Note</div><div class="small muted">' + esc(a.note) + '</div>';

    h += '<button class="btn danger" data-delete="' + esc(a.id) + '">Delete this ' + a.type + '</button>';

    el('view-detail').innerHTML = h;
    $('#view-detail [data-back]').onclick = () => go('list');
    const del = $('#view-detail [data-delete]');
    del.onclick = () => {
      if (!confirm('Delete "' + a.name + '"? This cannot be undone.')) return;
      Store.remove(a.id).then(() => go('list'));
    };
  }

  /* ---------- import ---------- */

  function renderImport() {
    draft = null;
    let h = '<div class="hd"><div class="hd-t">Add</div></div>';
    h += '<div class="modes">' +
      '<button class="mode" data-imp="run" aria-pressed="true">Run</button>' +
      '<button class="mode" data-imp="hike" aria-pressed="false">Hike</button>' +
      '<button class="mode" data-imp="auto" aria-pressed="false">Decide for me</button>' +
      '</div>';
    h += '<div class="eyebrow">Paste the table</div>';
    h += '<textarea id="paste" placeholder="Paste straight from Gemini. Pipes, headers and flag lines are all fine."></textarea>';
    h += '<button class="btn" id="read">Read it</button>';
    h += '<div class="small muted" style="margin-top:12px">Nothing is saved until you have seen the preview.</div>';
    h += '<div id="preview"></div>';
    el('view-import').innerHTML = h;

    let impType = 'run';
    document.querySelectorAll('#view-import [data-imp]').forEach(b => {
      b.onclick = () => {
        impType = b.dataset.imp;
        document.querySelectorAll('#view-import [data-imp]').forEach(x =>
          x.setAttribute('aria-pressed', String(x === b)));
      };
    });

    el('read').onclick = () => {
      const text = el('paste').value;
      if (!text.trim()) return;
      const p = Parse.parse(text, { today: todayStr() });
      const type = impType === 'auto' ? (Parse.inferType(p) || 'run') : impType;
      const flags = Parse.validate(p, { today: todayStr() });
      draft = Parse.toActivity(p, { type: type });
      renderPreview(p, flags);
    };
  }

  function renderPreview(p, flags) {
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const a = draft;
    const c = costOf(a);
    const d = Calc.drift(a.laps);
    const dup = a.date && a.distance_km ? Model.findDuplicate(a, Store.all()) : null;

    let h = '<div class="rule"></div><div class="eyebrow">Check it</div>';
    h += '<label><span>Name</span><input id="p-name" value="' + esc(a.name || '') + '" placeholder="Where was it?"></label>';

    if (a.type === 'hike') {
      h += '<div class="field-row">' +
        '<label><span>Conditions</span><input id="p-cond" placeholder="dry, warm"></label>' +
        '<label><span>Pack</span><select id="p-pack">' +
          '<option value="">\u2014</option><option value="day">Day</option>' +
          '<option value="overnight">Overnight</option><option value="multi">Multi-day</option>' +
        '</select></label></div>';
    }

    h += '<label><span>Source</span><select id="p-source">' +
      '<option value="tracked">Tracked on the watch</option>' +
      '<option value="typed">Not recorded \u2014 typed from memory</option>' +
      '</select></label>';

    if (Calc.fullLaps(a.laps).length) {
      h += '<div style="margin-top:16px">' + stripHTML(a, bounds, true) + '</div>';
      h += '<div class="row-meta" style="margin-top:7px">' +
        Calc.fullLaps(a.laps).length + ' laps' +
        ((a.laps || []).length > Calc.fullLaps(a.laps).length ? ' + partial' : '') +
        (d != null ? ' \u00b7 <b>drift ' + (d >= 0 ? '+' : '') + d + ' bpm</b>' : '') + '</div>';
    }

    h += '<div class="rule"></div><div class="grid2">';
    h += metric('Date', a.date ? fmtDate(a.date) : '\u2014', '', '', !a.date);
    h += metric('Distance', a.distance_km == null ? '\u2014' : a.distance_km.toFixed(2), 'km', '', a.distance_km == null);
    h += metric('Time', Calc.fmtDuration(a.elapsed_s), '', a.moving_s != null ? 'moving ' + Calc.fmtDuration(a.moving_s) : '');
    h += metric('Avg HR', a.avg_hr == null ? '\u2014' : a.avg_hr, a.avg_hr == null ? '' : 'bpm', '', a.avg_hr == null);
    h += metric('Ascent', a.ascent_m == null ? 'not given' : a.ascent_m, a.ascent_m == null ? '' : 'm',
      a.ascent_m == null ? 'left out of totals' : '', a.ascent_m == null);
    h += metric('Aerobic cost', c ? c.value : '\u2014', c ? 'b/km' : '', c ? c.basis + ' pace' : '', !c);
    h += '</div>';

    const errors = flags.filter(f => f.level === 'error');
    if (!errors.length) h += '<div class="flag ok"><i>\u2713</i><div>Nothing inconsistent found.</div></div>';
    flags.forEach(f => {
      const cls = f.level === 'error' ? 'error' : f.level === 'info' ? 'info' : '';
      const mark = f.level === 'error' ? '\u2715' : f.level === 'info' ? 'i' : '!';
      h += '<div class="flag ' + cls + '"><i>' + mark + '</i><div>' + esc(f.msg) + '</div></div>';
    });
    if (dup) h += '<div class="flag"><i>!</i><div>Looks like a duplicate of "' + esc(dup.name) +
      '". Saving will replace it.</div></div>';

    h += '<button class="btn" id="save"' + (errors.length ? ' disabled' : '') + '>' +
      (dup ? 'Replace' : 'Save') + ' ' + a.type + '</button>';
    if (errors.length) h += '<div class="small muted" style="margin-top:9px">Fix the paste and read it again.</div>';

    el('preview').innerHTML = h;

    const save = el('save');
    if (save && !errors.length) save.onclick = () => {
      draft.name = el('p-name').value.trim();
      draft.source = el('p-source').value;
      if (a.type === 'hike') {
        const cond = el('p-cond'), pack = el('p-pack');
        draft.conditions = cond && cond.value.trim() ? cond.value.trim() : null;
        draft.pack = pack && pack.value ? pack.value : null;
      }
      if (dup) draft.id = dup.id;
      const act = Model.make(draft);
      Store.put(act).then(() => { mode = act.type; go('detail', act.id); });
    };
  }

  /* ---------- settings ---------- */

  function renderSettings() {
    const cfg = Store.config();
    const b = Calc.zoneBounds(cfg);
    const age = d => d ? Math.round((Date.now() - new Date(d + 'T12:00:00')) / 86400000) : null;
    const stale = d => { const a = age(d); return a != null && a > 365; };

    let h = '<div class="hd"><div class="hd-t">Setup</div></div>';
    h += '<div class="eyebrow">Zone anchors \u00b7 Karvonen</div>';
    h += '<div class="field-row" style="margin-top:4px">' +
      '<label><span>Max HR</span><input id="c-max" type="number" value="' + cfg.max_hr + '"></label>' +
      '<label><span>Resting HR</span><input id="c-rest" type="number" value="' + cfg.resting_hr + '"></label>' +
      '</div>';
    h += '<div class="small muted" style="margin-top:10px">Reserve ' + b.hrr + ' beats. ' +
      'Z1 below ' + b.z2 + ' \u00b7 Z2 ' + b.z2 + '\u2013' + (b.z3 - 1) +
      ' \u00b7 Z3 ' + b.z3 + '\u2013' + (b.z4 - 1) + ' \u00b7 Z4 ' + b.z4 + '\u2013' + (b.z5 - 1) +
      ' \u00b7 Z5 ' + b.z5 + '+</div>';
    if (stale(cfg.max_hr_dated)) h += '<div class="flag"><i>!</i><div>Max HR was set ' +
      Math.round(age(cfg.max_hr_dated) / 30) + ' months ago.</div></div>';
    h += '<div class="small muted" style="margin-top:10px">Resting heart rate should be a 90-day median, ' +
      'updated by hand every few weeks. The zones follow it.</div>';

    h += '<div class="rule"></div><div class="eyebrow">Hiking constants</div>';
    h += '<div class="field-row" style="margin-top:4px">' +
      '<label><span>Flat km/h</span><input id="c-flat" type="number" step="0.1" value="' + cfg.FLAT_KMH + '"></label>' +
      '<label><span>Ascent m/h</span><input id="c-asc" type="number" value="' + cfg.ASCENT_MH + '"></label>' +
      '</div>';
    h += '<div class="small muted" style="margin-top:10px">Naismith. 5 km/h is the classic value; ' +
      '4 is the conservative rough-terrain variant. Changing it moves every terrain factor.</div>';
    h += '<button class="btn" id="c-save">Save settings</button>';

    h += '<div class="rule"></div><div class="eyebrow">Your data</div>';
    h += '<div class="small muted" style="margin-top:8px">' + Store.all().length +
      ' activities, held on this device only. Export regularly.</div>';
    h += '<button class="btn ghost" id="c-export">Export everything</button>';
    h += '<label><span>Import a backup</span><input id="c-import" type="file" accept="application/json"></label>';

    el('view-settings').innerHTML = h;

    el('c-save').onclick = () => {
      Store.setConfig({
        max_hr: +el('c-max').value,
        resting_hr: +el('c-rest').value,
        resting_hr_dated: todayStr(),
        FLAT_KMH: +el('c-flat').value,
        ASCENT_MH: +el('c-asc').value
      }).then(renderSettings);
    };

    el('c-export').onclick = () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fit-backup-' + todayStr() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    el('c-import').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          Store.importJSON(r.result).then(n => { alert(n + ' activities restored.'); go('list'); });
        } catch (err) { alert('Could not read that file: ' + err.message); }
      };
      r.readAsText(f);
    };
  }

  /* ---------- wiring ---------- */

  function bindModes() {
    document.querySelectorAll('#view-week [data-mode]').forEach(b => {
      b.onclick = () => { mode = b.dataset.mode; renderWeek(); };
    });
  }

  function bindRows() {
    document.querySelectorAll('.row-a[data-id]').forEach(r => {
      r.onclick = () => go('detail', r.dataset.id);
    });
  }

  const VIEWS = ['week', 'list', 'detail', 'import', 'settings'];

  function go(view, param) {
    VIEWS.forEach(v => { el('view-' + v).hidden = (v !== view); });
    document.querySelectorAll('#nav button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.go === view)));
    window.scrollTo(0, 0);
    if (view === 'week') renderWeek();
    if (view === 'list') renderList();
    if (view === 'detail') renderDetail(param);
    if (view === 'import') renderImport();
    if (view === 'settings') renderSettings();
  }

  document.querySelectorAll('#nav button').forEach(b => {
    b.onclick = () => go(b.dataset.go);
  });

  Store.init().then(() => go('week'));

  window.Fit = { go: go };

})();
