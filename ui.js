/* ui.js — rendering and interaction. All maths lives in calc.js.
   Two worlds (run, hike) share this shell but differ in scope, hero and density. */

(function () {
  'use strict';

  const WORLD = {
    run:  { scopes: ['week', 'month', 'year'], scope: 'week', ribbon: 12, metric: 'distance' },
    hike: { scopes: ['month', 'year', 'all'],  scope: 'year', ribbon: 12, metric: 'ascent' }
  };

  let world = 'run';
  let scope = WORLD.run.scope;
  let periodKey = null;      // null = current period
  let draft = null;

  const el = id => document.getElementById(id);
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ZCOL = { 1: 'var(--z1)', 2: 'var(--z2)', 3: 'var(--z3)', 4: 'var(--z4)', 5: 'var(--z5)' };
  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const today = () => new Date().toISOString().slice(0, 10);

  function fmtDate(d) {
    const [y, m, day] = d.split('-');
    const base = (+day) + ' ' + MON[+m - 1];
    return (+y === new Date().getFullYear()) ? base : base + ' ' + y;
  }

  function acts() { return Store.all().filter(a => a.type === world || a.type === 'test'); }
  function real() { return Store.all().filter(a => a.type === world); }
  function key() { return periodKey || Calc.periodKey(today(), scope); }

  /* ---------------------------------------------------------------- pieces */

  function stripHTML(a, bounds, tall) {
    const laps = Calc.fullLaps(a.laps);
    if (!laps.length) return '';
    return '<div class="strip' + (tall ? ' tall' : '') + '">' + laps.map(l => {
      const z = Calc.zoneOf(l.avg_hr, bounds);
      return '<div class="blk' + (z ? '' : ' unknown') + '" style="background:' +
        (z ? ZCOL[z] : 'var(--stop)') + '"></div>';
    }).join('') + '</div>';
  }

  function vbarsHTML(a, bounds, mini) {
    const laps = Calc.fullLaps(a.laps);
    if (!laps.length) return '';
    const max = Math.max.apply(null, laps.map(l => l.time_s));
    return '<div class="vbars' + (mini ? ' mini' : '') + '">' + laps.map(l => {
      const z = Calc.zoneOf(l.avg_hr, bounds);
      return '<div class="vcol">' +
        (mini ? '' : '<div class="vlbl">' + Math.round(l.time_s / 60) + '</div>') +
        '<div class="vbar" style="background:' + (z ? ZCOL[z] : 'var(--stop)') +
        '; height:' + Math.max(6, Math.round(l.time_s / max * 100)) + '%"></div></div>';
    }).join('') + '</div>';
  }

  function zoneBarHTML(tz) {
    const total = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;
    if (!total) return '';
    const parts = [1,2,3,4,5].filter(z => tz[z] > 0).map(z =>
      '<div class="zseg" style="background:' + ZCOL[z] + '; flex:' + tz[z] + '">' +
      Math.round(tz[z] / 60) + '\u2032</div>');
    if (tz.unknown > 0) parts.push('<div class="zseg" style="background:var(--stop); flex:' + tz.unknown + '"></div>');
    return '<div class="zbar">' + parts.join('') + '</div>';
  }

  function zoneKeyHTML(b) {
    return '<div class="zkey">' +
      '<span><i style="background:var(--z1)"></i>Z1 &lt;' + b.z2 + '</span>' +
      '<span><i style="background:var(--z2)"></i>Z2 ' + b.z2 + '\u2013' + (b.z3 - 1) + '</span>' +
      '<span><i style="background:var(--z3)"></i>Z3 ' + b.z3 + '\u2013' + (b.z4 - 1) + '</span>' +
      '<span><i style="background:var(--z4)"></i>Z4 ' + b.z4 + '+</span></div>';
  }

  function metric(label, value, unit, caption, pending) {
    return '<div><div class="g-l">' + esc(label) + '</div>' +
      '<div class="g-v' + (pending ? ' pending' : '') + '">' + esc(value) +
      (unit ? '<s>' + esc(unit) + '</s>' : '') + '</div>' +
      (caption ? '<div class="g-c">' + esc(caption) + '</div>' : '') + '</div>';
  }

  function cmp(k, v, aside) {
    return '<div class="cmp"><span class="k">' + esc(k) + '</span><span class="v">' + v +
      (aside ? '<s>' + esc(aside) + '</s>' : '') + '</span></div>';
  }

  function ribbonHTML() {
    const cfg = WORLD[world];
    if (scope === 'all') return '';
    const bars = Calc.ribbon(real(), scope, key(), cfg.ribbon, cfg.metric);
    const max = Math.max.apply(null, bars.map(b => b.value).concat([1]));
    const label = b => {
      if (scope === 'week') return Calc.isoWeek(b.key).split('-W')[1].replace(/^0/, '');
      if (scope === 'month') return MON[+b.key.slice(5) - 1][0];
      return b.key.slice(2);
    };
    const cells = bars.map((b, i) =>
      '<div class="rp' + (b.selected ? ' on' : '') + (b.value ? '' : ' none') +
      '" data-period="' + b.key + '"><div class="b" style="height:' +
      (b.value ? Math.max(6, Math.round(b.value / max * 100)) : 0) + '%"></div></div>').join('');
    const labels = bars.map((b, i) =>
      '<div>' + (scope === 'week' ? (i % 2 === 0 || b.selected ? label(b) : '') : label(b)) + '</div>'
    ).join('');

    const gap = Calc.emptyRunBefore(real(), scope, key());
    const unit = scope === 'week' ? 'weeks' : scope === 'month' ? 'months' : 'years';
    const gapLine = gap >= 2
      ? '<div class="gapmark">\u2191 nothing for ' + gap + ' ' + unit + ' before this</div>' : '';

    return '<div class="ribbon">' + cells + '</div><div class="rlbl">' + labels + '</div>' + gapLine;
  }


  /* ------------------------------------------------------------- charts */

  /* Line chart from one or more segments of {value} points.
     invert: true plots smaller values higher (used for pace, where faster is
     better) so a rising line always means improvement. */
  function lineChart(segments, opt) {
    opt = opt || {};
    const all = [].concat.apply([], segments).map(p => p.value).filter(v => v != null);
    if (all.length < 2) return null;
    let lo = opt.min != null ? opt.min : Math.min.apply(null, all);
    let hi = opt.max != null ? opt.max : Math.max.apply(null, all);
    if (hi === lo) { hi = lo + 1; }
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const yOf = v => {
      const t = (v - lo) / (hi - lo);
      return opt.invert ? (t * 100) : (100 - t * 100);
    };

    /* segments get width in proportion to their point count, with a fixed
       visual break between them so a training gap reads as a gap */
    const counts = segments.map(s => s.length);
    const totalPts = counts.reduce((a, b) => a + b, 0);
    const breaks = segments.length - 1;
    const breakW = breaks ? 9 : 0;
    const usable = 100 - breakW * breaks;
    let x = 0;
    const paths = [];
    const marks = [];
    segments.forEach((seg, si) => {
      const w = counts[si] / totalPts * usable;
      const step = seg.length > 1 ? w / (seg.length - 1) : 0;
      const pts = seg.map((p, i) => (x + i * step).toFixed(2) + ',' + yOf(p.value).toFixed(2));
      const last = si === segments.length - 1;
      paths.push({ points: pts.join(' '), last: last, single: seg.length === 1,
                   cx: x + (seg.length - 1) * step, cy: yOf(seg[seg.length - 1].value) });
      x += w;
      if (si < segments.length - 1) { marks.push([x, x + breakW]); x += breakW; }
    });

    let svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" height="' +
      (opt.height || 150) + '" role="img" aria-label="' + esc(opt.label || 'chart') + '">';

    if (opt.band) {
      const y1 = yOf(opt.band[0]), y2 = yOf(opt.band[1]);
      svg += '<rect x="0" y="' + Math.min(y1, y2).toFixed(2) + '" width="100" height="' +
        Math.abs(y2 - y1).toFixed(2) + '" fill="#35A28F" fill-opacity=".10"/>';
    }
    svg += '<g stroke="#2B383C" stroke-width=".4" vector-effect="non-scaling-stroke">' +
      '<line x1="0" y1="2" x2="100" y2="2"/><line x1="0" y1="50" x2="100" y2="50"/>' +
      '<line x1="0" y1="98" x2="100" y2="98"/></g>';
    marks.forEach(m => {
      svg += '<rect x="' + m[0].toFixed(2) + '" y="0" width="' + (m[1] - m[0]).toFixed(2) +
        '" height="100" fill="#151D20"/>' +
        '<g stroke="#55686D" stroke-width=".4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke">' +
        '<line x1="' + m[0].toFixed(2) + '" y1="0" x2="' + m[0].toFixed(2) + '" y2="100"/>' +
        '<line x1="' + m[1].toFixed(2) + '" y1="0" x2="' + m[1].toFixed(2) + '" y2="100"/></g>';
    });
    paths.forEach(p => {
      const col = p.last ? 'var(--z2)' : 'var(--mute)';
      const wgt = p.last ? 2.2 : 1.6;
      if (!p.single) svg += '<polyline fill="none" stroke="' + col + '" stroke-width="' + wgt +
        '" vector-effect="non-scaling-stroke" points="' + p.points + '"/>';
      if (p.last) svg += '<circle cx="' + p.cx.toFixed(2) + '" cy="' + p.cy.toFixed(2) +
        '" r="2.4" fill="var(--z2)"/>';
    });
    svg += '</svg>';

    const fmt = opt.format || (v => Math.round(v));
    const axis = [0.02, 0.5, 0.98].map(t => {
      const v = opt.invert ? lo + t * (hi - lo) : hi - t * (hi - lo);
      return '<span style="top:' + (t * 100) + '%">' + fmt(v) + '</span>';
    }).join('');

    return '<div class="chart"><div class="cwrap">' + svg +
      '<div class="yax" style="height:' + (opt.height || 150) + 'px">' + axis + '</div></div>' +
      (opt.xax ? '<div class="xax">' + opt.xax.map(s => '<span>' + esc(s) + '</span>').join('') + '</div>' : '') +
      (opt.legend ? '<div class="legend">' + opt.legend + '</div>' : '') + '</div>';
  }

  function deltaHTML(d, fmt) {
    if (!d || d.dir === 'flat') return '';
    const arrow = d.dir === 'up' ? '\u25b2' : '\u25bc';
    const cls = d.tone === 'good' ? 'good' : d.tone === 'bad' ? 'bad' : 'neutral';
    const text = fmt ? fmt(d) : (Math.abs(d.pct).toFixed(0) + '%');
    return '<span class="delta ' + cls + '">' + arrow + ' ' + text + '</span>';
  }

  function recordsHTML(type) {
    const cfg = Store.config();
    const recs = Calc.records(Store.all(), cfg, type);
    if (!recs.length) return '';
    return '<div class="sec"><span>Records</span><span>all time</span></div>' +
      '<div class="recs">' + recs.map(r =>
        '<div class="rec"' + (r.id ? ' data-id="' + esc(r.id) + '"' : '') + '>' +
        '<div class="l">' + esc(r.label) + '</div>' +
        '<div class="v">' + esc(r.value) + (r.unit ? '<s>' + esc(r.unit) + '</s>' : '') + '</div>' +
        '<div class="w">' + esc(/^\d{4}-\d{2}-\d{2}$/.test(r.when) ? fmtDate(r.when) :
          /^\d{4}-\d{2}$/.test(r.when) ? MON[+r.when.slice(5) - 1] + ' ' + r.when.slice(0, 4) : r.when) +
        '</div></div>').join('') + '</div>';
  }

  /* ------------------------------------------------------------------ home */

  function renderHome() {
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const wc = WORLD[world];
    const k = key();
    const mine = real();
    const inP = mine.filter(a => Calc.inPeriod(a, scope, k));

    let h = '<div class="top"><div>' +
      '<div class="ttl">' + esc(Calc.periodLabel(k, scope, today())) + '</div>' +
      '<div class="sub">' + esc(Calc.periodSpan(k, scope, today())) + '</div>' +
      '</div><button class="corner" data-go="settings">SETUP</button></div>';

    h += '<div class="bar">' + wc.scopes.map(s =>
      '<button class="chip" data-scope="' + s + '" aria-pressed="' + (s === scope) + '">' +
      (s === 'all' ? 'All time' : s[0].toUpperCase() + s.slice(1)) + '</button>').join('') + '</div>';

    if (!mine.length) {
      h += '<div class="empty-state">No ' + (world === 'run' ? 'runs' : 'hikes') + ' logged yet.<br>' +
        'Tap + to paste your first one.</div>';
      el('view-home').innerHTML = h;
      bind();
      return;
    }

    h += ribbonHTML();
    h += '<div class="rule"></div>';
    h += (world === 'run' ? runHero(inP, mine, bounds) : hikeHero(inP, mine, k));

    /* the list */
    const sorted = inP.slice().sort((a, b) => b.date.localeCompare(a.date));
    h += '<div class="sec"><span>' + esc(Calc.periodLabel(k, scope, today())) + '</span><span>' +
      (sorted.length ? sorted.length + (world === 'run' ? ' runs' : ' days out') : '') + '</span></div>';

    if (!sorted.length) {
      const noun = world === 'run' ? 'run' : 'hike';
      const prev = Calc.previousWithData(mine, scope, k);
      const next = prev ? null : Calc.nextWithData(mine, scope, k);
      let line = '';
      if (prev) line = '<br>Last ' + noun + ' before this: ' + esc(Calc.periodLabel(prev, scope, today())) + '.';
      else if (next) line = '<br>Nothing this early \u2014 your first ' + noun +
        ' lands in ' + esc(Calc.periodLabel(next, scope, today())) + '.';
      h += '<div class="empty-state">Nothing here.' + line + '</div>';
    } else {
      h += sorted.map(a => world === 'run' ? runRow(a, bounds) : hikeCard(a, bounds)).join('');
    }

    el('view-home').innerHTML = h;
    bind();
  }

  /* ---------- run world ---------- */

  function runHero(inP, mine, bounds) {
    const cfg = Store.config();
    const withHr = mine.filter(a => a.avg_hr != null).sort((a, b) => b.date.localeCompare(a.date));
    const last = withHr[0];
    const pace = last ? Calc.aerobicPace(last, cfg) : null;
    const prevPace = withHr[1] ? Calc.aerobicPace(withHr[1], cfg) : null;
    const s = Calc.summarize(inP);

    let h = '<div class="eyebrow">Aerobic pace \u00b7 at ' + Calc.refHr(cfg) + ' bpm</div>';
    if (pace != null) {
      const d = Calc.delta(pace, prevPace, 'down');
      h += '<div class="hero"><div class="hnum">' + Calc.fmtPace(pace) + '</div>' +
        '<div class="hunit">/km</div>' +
        deltaHTML(d, x => Math.abs(Math.round(x.diff)) + 's') + '</div>';
      h += '<div class="hsub">' + (prevPace != null
        ? 'What you would hold at ' + Calc.refHr(cfg) + ' bpm. Last run: ' + Calc.fmtPace(prevPace) + '.'
        : 'What you would hold at ' + Calc.refHr(cfg) + ' bpm \u2014 nothing to compare it to yet.') + '</div>';
    } else {
      h += '<div class="hero"><div class="hnum pending">\u2014</div><div class="hunit">/km</div></div>' +
        '<div class="hsub">Needs a run with average heart rate.</div>';
    }

    /* the trend — always all-time, whatever period is selected */
    const segs = Calc.paceSeries(mine, cfg);
    const flat = [].concat.apply([], segs);
    if (flat.length >= 2) {
      const prevSeg = segs.length > 1 ? segs[segs.length - 2] : null;
      const band = prevSeg && prevSeg.length >= 3
        ? [Math.min.apply(null, prevSeg.slice(-6).map(p => p.value)),
           Math.max.apply(null, prevSeg.slice(-6).map(p => p.value))]
        : null;
      const first = flat[0].date, lastD = flat[flat.length - 1].date;
      h += lineChart(segs, {
        invert: true, band: band, height: 150,
        format: v => Calc.fmtPace(v),
        label: 'Aerobic pace across ' + flat.length + ' runs. Faster is higher.',
        xax: [fmtDate(first).toUpperCase(), segs.length > 1 ? 'break' : '', fmtDate(lastD).toUpperCase()],
        legend: (band ? '<span><i style="background:var(--z2); opacity:.35"></i>previous block</span>' : '') +
                '<span><i style="background:var(--z2)"></i>now</span>'
      });
      h += '<div class="est">Faster is higher, so the line rising is always progress. ' +
        (segs.length > 1 ? 'The break is time off, drawn rather than smoothed over. ' : '') +
        'Rescales if you change your anchors \u2014 the shape never moves.</div>';
    } else {
      h += '<div class="est">The trend line opens once you have two runs with heart rate.</div>';
    }

    /* zone split across the period */
    const laps = [];
    inP.forEach(a => (a.laps || []).forEach(l => laps.push(l)));
    const tz = Calc.timeInZone(laps, bounds);
    const zTotal = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;
    if (zTotal) {
      h += '<div class="sec"><span>Time in zone</span><span>' + Math.round(zTotal / 60) + ' min</span></div>';
      h += zoneBarHTML(tz) + zoneKeyHTML(bounds);
      h += '<div class="est">' + Math.round(tz[2] / zTotal * 100) +
        '% in Z2. Each kilometre counts whole to the zone of its average.</div>';
    }

    const prevKey = Calc.previousWithData(real(), scope, key());
    const prev = prevKey ? Calc.summarize(real().filter(a => Calc.inPeriod(a, scope, prevKey))) : null;
    const vs = prevKey ? Calc.periodLabel(prevKey, scope, today()) : null;
    const dd = (v, p, better) => deltaHTML(Calc.delta(v, p, better));

    h += '<div style="margin-top:15px">';
    h += cmp('Distance', s.distance_km.toFixed(2) + ' km ' + (prev ? dd(s.distance_km, prev.distance_km, null) : ''),
      prev ? vs + ' ' + prev.distance_km.toFixed(2) : 'nothing before this');
    h += cmp('Time', Calc.fmtDuration(s.elapsed_s) + ' ' + (prev ? dd(s.elapsed_s, prev.elapsed_s, null) : ''),
      prev ? vs + ' ' + Calc.fmtDuration(prev.elapsed_s) : '');
    h += cmp('Runs', String(s.count), prev ? vs + ' ' + prev.count : '');
    h += '</div>';
    h += recordsHTML('run');
    return h;
  }

  function runRow(a, bounds) {
    const c = Calc.aerobicCost(a);
    const d = Calc.drift(a.laps);
    const meta = [];
    const pace = a.gap_pace_s != null ? a.gap_pace_s : Calc.paceSecPerKm(a.distance_km, a.elapsed_s);
    meta.push(Calc.fmtPace(pace) + (a.gap_pace_s != null ? ' GAP' : ''));
    if (a.avg_hr != null) meta.push(a.avg_hr + ' bpm');
    if (d != null) meta.push('<b>drift ' + (d >= 0 ? '+' : '') + d + '</b>');
    if (a.temp_c != null) meta.push(a.temp_c + '\u00b0');

    return '<div class="rrow" data-id="' + esc(a.id) + '">' +
      '<div class="rtop"><div class="rday">' + DAYS[Calc.dayIndex(a.date)] + ' ' + a.date.slice(8) + '</div>' +
      '<div class="rnm">' + esc(a.name) + ' <span>\u00b7 ' + a.distance_km.toFixed(2) + ' km</span></div>' +
      '<div class="rfig">' + (c ? c.value : '\u2014') + '</div></div>' +
      stripHTML(a, bounds) +
      '<div class="rmeta">' + meta.join(' \u00b7 ') + '</div></div>';
  }

  /* ---------- hike world ---------- */

  function hikeHero(inP, mine, k) {
    const cfg = Store.config();
    const s = Calc.summarize(inP);
    const label = scope === 'all' ? 'ever' : scope === 'year' ? 'this year' : 'this month';
    const yr = scope === 'year' ? key() : today().slice(0, 4);

    let h = '<div class="eyebrow">Climbed ' + label + '</div>';
    if (s.ascent_m != null) {
      /* against the same point last year */
      const thisYr = Calc.cumulativeAscent(mine, yr);
      const lastYr = Calc.cumulativeAscent(mine, String(+yr - 1));
      const nowFrac = scope === 'year' && yr === today().slice(0, 4)
        ? thisYr[thisYr.length - 1].frac : 1;
      let atSamePoint = null;
      if (lastYr.length > 1) {
        atSamePoint = 0;
        lastYr.forEach(p => { if (p.frac <= nowFrac) atSamePoint = p.total; });
      }
      const d = scope === 'year' && atSamePoint ? Calc.delta(s.ascent_m, atSamePoint, 'up') : null;

      h += '<div class="hero"><div class="hnum">' +
        s.ascent_m.toLocaleString('en-GB').replace(/,/g, '\u2009') +
        '</div><div class="hunit">metres up</div>' + deltaHTML(d) + '</div>';
      h += '<div class="hsub">Across <b>' + s.days + ' day' + (s.days === 1 ? '' : 's') + ' out</b>' +
        (atSamePoint ? '. At this point in ' + (+yr - 1) + ' you were on ' +
          atSamePoint.toLocaleString('en-GB').replace(/,/g, '\u2009') + ' m' : '') +
        (s.ascent_of < s.count ? ', from ' + s.ascent_of + ' of ' + s.count + ' with ascent recorded' : '') +
        '.</div>';

      /* the racing curve */
      if (scope === 'year' && thisYr.length > 1) {
        const segs = [];
        if (lastYr.length > 1) segs.push(lastYr.map(p => ({ value: p.total, frac: p.frac })));
        segs.push(thisYr.map(p => ({ value: p.total, frac: p.frac })));
        h += cumulativeChart(segs, yr);
        h += '<div class="est">Cumulative, so it only ever climbs. The dashed line is today \u2014 ' +
          'everything to its right is what ' + (+yr - 1) + ' still had left.</div>';
      }
    } else {
      h += '<div class="hero"><div class="hnum pending">\u2014</div><div class="hunit">metres up</div></div>' +
        '<div class="hsub">No ascent recorded for this period.</div>';
    }

    const prevKey = Calc.previousWithData(real(), scope, k);
    const prev = prevKey ? Calc.summarize(real().filter(a => Calc.inPeriod(a, scope, prevKey))) : null;
    const vs = prevKey ? Calc.periodLabel(prevKey, scope, today()) : null;

    const factors = inP.map(a => Calc.terrainFactor(a, cfg)).filter(x => x != null);
    const rates = inP.map(a => { const r = Calc.ascentRate(a); return r && r.value; }).filter(Boolean);
    const biggest = inP.filter(a => a.ascent_m != null).sort((a, b) => b.ascent_m - a.ascent_m)[0];
    const dd = (v, p, better) => deltaHTML(Calc.delta(v, p, better));

    h += '<div style="margin-top:15px">';
    h += cmp('Days out', String(s.days) + ' ' + (prev ? dd(s.days, prev.days, null) : ''),
      prev ? vs + ' ' + prev.days : '');
    h += cmp('Time on feet', Calc.fmtDuration(s.moving_s), prev ? vs + ' ' + Calc.fmtDuration(prev.moving_s) : '');
    h += cmp('Distance', s.distance_km.toFixed(1) + ' km', prev ? vs + ' ' + prev.distance_km.toFixed(1) : '');
    if (biggest) h += cmp('Biggest day', biggest.ascent_m + ' m', esc(biggest.name));
    if (rates.length) h += cmp('Ascent rate', Math.round(Calc.median(rates)) + ' m/h', 'median of ' + rates.length);
    h += cmp('Terrain factor',
      factors.length ? Calc.median(factors).toFixed(2) : '\u2014',
      factors.length ? 'median of ' + factors.length :
        Calc.confidence(factors.length, 'terrain_trend').need + ' more tracked hikes');
    h += '</div>';

    /* ascent rate — the fitness line under the accumulation */
    const rs = Calc.ascentRateSeries(mine);
    if (rs.length >= 3) {
      h += '<div class="sec"><span>Ascent rate</span><span>' + rs.length + ' tracked</span></div>';
      h += lineChart([rs], { height: 76, format: v => Math.round(v) + ' m/h',
        label: 'Ascent rate in metres per hour across tracked hikes.' });
      h += '<div class="est">Metres per hour, hike by hike. Slower to move than aerobic pace \u2014 ' +
        'it needs a season, not a month.</div>';
    }

    if (inP.length >= 3) h += scatterHTML(inP);
    h += recordsHTML('hike');
    return h;
  }

  /* Cumulative ascent, this year against last, plotted on day-of-year. */
  function cumulativeChart(segs, yr) {
    const all = [].concat.apply([], segs).map(p => p.value);
    const hi = Math.max.apply(null, all) * 1.12 || 1;
    const yOf = v => 100 - v / hi * 100;
    const todayFrac = (new Date() - new Date(yr + '-01-01T12:00:00')) / 86400000 /
      (((+yr % 4 === 0 && +yr % 100 !== 0) || +yr % 400 === 0) ? 366 : 365);

    let svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" height="150" role="img" ' +
      'aria-label="Cumulative ascent through the year, ' + yr + ' against ' + (+yr - 1) + '.">';
    svg += '<g stroke="#2B383C" stroke-width=".4" vector-effect="non-scaling-stroke">' +
      '<line x1="0" y1="2" x2="100" y2="2"/><line x1="0" y1="50" x2="100" y2="50"/>' +
      '<line x1="0" y1="98" x2="100" y2="98"/></g>';
    if (todayFrac > 0 && todayFrac < 1) {
      const x = (todayFrac * 100).toFixed(1);
      svg += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="100" stroke="#55686D" ' +
        'stroke-width=".4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>';
    }
    segs.forEach((seg, i) => {
      const last = i === segs.length - 1;
      const pts = seg.map(p => (p.frac * 100).toFixed(2) + ',' + yOf(p.value).toFixed(2)).join(' ');
      svg += '<polyline fill="none" stroke="' + (last ? 'var(--z2)' : 'var(--mute)') +
        '" stroke-width="' + (last ? 2.2 : 1.6) + '" vector-effect="non-scaling-stroke" points="' + pts + '"/>';
      if (last) {
        const e = seg[seg.length - 1];
        svg += '<circle cx="' + (e.frac * 100).toFixed(2) + '" cy="' + yOf(e.value).toFixed(2) +
          '" r="2.4" fill="var(--z2)"/>';
      }
    });
    svg += '</svg>';

    const axis = [0.02, 0.5].map(t =>
      '<span style="top:' + (t * 100) + '%">' + Math.round(hi * (1 - t)).toLocaleString('en-GB').replace(/,/g, '\u2009') + ' m</span>'
    ).join('');

    return '<div class="chart"><div class="cwrap">' + svg +
      '<div class="yax" style="height:150px">' + axis + '</div></div>' +
      '<div class="xax"><span>JAN</span><span>TODAY</span><span>DEC</span></div>' +
      '<div class="legend"><span><i style="background:var(--mute)"></i>' + (+yr - 1) + '</span>' +
      '<span><i style="background:var(--z2)"></i>' + yr + '</span></div></div>';
  }

  function scatterHTML(list) {
    const pts = list.filter(a => a.ascent_m != null && a.distance_km != null);
    if (pts.length < 3) return '';
    const maxD = Math.max.apply(null, pts.map(a => a.distance_km)) * 1.15;
    const maxA = Math.max.apply(null, pts.map(a => a.ascent_m)) * 1.15;
    const newest = pts.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    let h = '<div class="sec"><span>Shape of your hiking</span><span>' + pts.length + ' hikes</span></div>';
    h += '<div class="scat">' + pts.map(a => {
      const x = (a.distance_km / maxD * 100).toFixed(1);
      const y = (100 - a.ascent_m / maxA * 100).toFixed(1);
      const on = a.id === newest.id;
      return '<div class="pt' + (on ? ' on' : '') + '" style="left:' + x + '%; top:' + y + '%"></div>' +
        (on ? '<div class="plbl" style="left:' + x + '%; top:' + y + '%">' + esc(a.name) + '</div>' : '');
    }).join('') + '</div>';
    h += '<div class="ax"><span>0 km</span><span>distance \u2192</span><span>' +
      Math.round(maxD) + ' km</span></div>';
    h += '<div class="est">Up the side is ascent. Top-left is short and steep; far right is long and rolling.</div>';
    return h;
  }

  function hikeCard(a, bounds) {
    const cfg = Store.config();
    const r = Calc.ascentRate(a);
    const tf = Calc.terrainFactor(a, cfg);
    const st = [];
    if (a.ascent_m != null) st.push(['Ascent', a.ascent_m, 'm']);
    st.push(['Distance', a.distance_km.toFixed(1), 'km']);
    st.push(['On feet', Calc.fmtDuration(a.moving_s != null ? a.moving_s : a.elapsed_s), '']);
    if (r) st.push(['Rate', r.value, 'm/h']);
    if (tf != null) st.push(['Factor', tf.toFixed(2), '']);

    return '<div class="hcard" data-id="' + esc(a.id) + '">' +
      '<div class="hdate">' + DAYS[Calc.dayIndex(a.date)] + ' ' + fmtDate(a.date).toUpperCase() +
      ' \u00b7 ' + a.source.toUpperCase() + '</div>' +
      '<div class="hname">' + esc(a.name) + '</div>' +
      '<div class="hstats">' + st.map(x =>
        '<div class="hstat"><div class="l">' + x[0] + '</div><div class="v">' + x[1] +
        (x[2] ? '<s>' + x[2] + '</s>' : '') + '</div></div>').join('') + '</div>' +
      vbarsHTML(a, bounds, true) + '</div>';
  }

  /* ---------------------------------------------------------------- detail */

  function renderDetail(id) {
    const a = Store.byId(id);
    if (!a) { go('home'); return; }
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const c = Calc.aerobicCost(a);
    const d = Calc.drift(a.laps);
    const tz = Calc.timeInZone(a.laps, bounds);
    const zTotal = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;
    const ss = Calc.stopShare(a);
    const hrOk = Calc.hrIsReliable(a, cfg);

    let h = '<div class="back" data-back="1">\u2190 Back</div>';
    h += '<div class="ttl">' + esc(a.name) + '</div>';
    const sub = [DAYS[Calc.dayIndex(a.date)], fmtDate(a.date).toUpperCase(), a.source.toUpperCase()];
    if (a.temp_c != null) sub.push(a.temp_c + '\u00b0');
    if (a.rpe != null) sub.push('RPE ' + a.rpe);
    if (a.conditions) sub.push(String(a.conditions).toUpperCase());
    h += '<div class="sub">' + esc(sub.join(' \u00b7 ')) + '</div>';

    if (Calc.fullLaps(a.laps).length) {
      h += '<div class="sec"><span>Per kilometre</span></div>';
      if (a.type === 'hike') {
        h += vbarsHTML(a, bounds, false);
        h += '<div class="est">Height is minutes for that kilometre; colour is heart-rate zone. Tall and amber is the climb.</div>';
      } else {
        h += stripHTML(a, bounds, true);
        h += '<div class="rmeta" style="margin-left:0">' +
          Calc.fullLaps(a.laps).map(l => l.avg_hr == null ? '\u2014' : l.avg_hr).join(' \u00b7 ') + '</div>';
      }
    }

    if (d != null) h += '<div class="callout' + (d > 8 ? ' warn' : '') + '">' +
      'Heart rate moved <b>' + (d >= 0 ? '+' : '') + d + ' bpm</b> from the first third to the last' +
      (d > 8 ? '. A base effort should hold closer to flat.' : '.') + '</div>';

    h += '<div class="rule"></div><div class="grid2">';
    if (a.type === 'run') {
      h += metric('Aerobic cost', c ? c.value : '\u2014', c ? 'b/km' : '',
        c ? (c.basis === 'gap' ? 'gradient-adjusted' : 'raw pace') : 'needs heart rate', !c);
      h += metric('Pace', Calc.fmtPace(Calc.paceSecPerKm(a.distance_km, a.elapsed_s)), '/km',
        a.gap_pace_s != null ? 'GAP ' + Calc.fmtPace(a.gap_pace_s) : '');
    } else {
      const ar = Calc.ascentRate(a);
      h += metric('Ascent', a.ascent_m == null ? '\u2014' : a.ascent_m, a.ascent_m == null ? '' : 'm',
        a.descent_m != null ? 'descent ' + a.descent_m + ' m' : '', a.ascent_m == null);
      h += metric('Ascent rate', ar ? ar.value : '\u2014', ar ? 'm/h' : '',
        ar ? 'on ' + ar.basis + ' time' : 'needs ascent', !ar);
    }
    h += metric('Distance', a.distance_km.toFixed(2), 'km',
      a.type === 'hike' && Calc.flatEquivKm(a) != null ? 'flat-equiv ' + Calc.flatEquivKm(a) + ' km' : '');
    h += metric('Time', Calc.fmtDuration(a.elapsed_s), '',
      a.moving_s != null ? 'moving ' + Calc.fmtDuration(a.moving_s) : '');
    h += metric('Avg HR', a.avg_hr == null ? '\u2014' : a.avg_hr, a.avg_hr == null ? '' : 'bpm',
      ss != null && !hrOk ? Math.round(ss * 100) + '% stopped' : '', a.avg_hr == null);
    if (a.type === 'hike') {
      const tf = Calc.terrainFactor(a, cfg);
      h += metric('Terrain factor', tf == null ? '\u2014' : tf.toFixed(2), '',
        tf == null ? 'needs moving time' :
          'Naismith ' + Calc.fmtDuration(Calc.naismithHours(a.distance_km, a.ascent_m, cfg) * 3600), tf == null);
    }
    if (a.cadence_spm != null) h += metric('Cadence', a.cadence_spm, 'spm', '');
    h += '</div>';

    if (ss != null && !hrOk) h += '<div class="callout warn">Average heart rate is dragged down by <b>' +
      Calc.fmtDuration(a.elapsed_s - a.moving_s) + ' stopped</b>. Shown here, kept out of trends.</div>';

    if (zTotal) {
      h += '<div class="sec"><span>Time in zone</span><span>' + Math.round(zTotal / 60) + ' min</span></div>';
      h += zoneBarHTML(tz) + zoneKeyHTML(bounds);
    }

    if (a.feel) h += '<div class="sec"><span>Felt</span></div><div class="small muted">' + esc(a.feel) + '</div>';
    if (a.note) h += '<div class="sec"><span>Note</span></div><div class="small muted">' + esc(a.note) + '</div>';

    h += '<button class="btn danger" data-delete="' + esc(a.id) + '">Delete this ' + a.type + '</button>';

    el('view-detail').innerHTML = h;
    $('#view-detail [data-back]').onclick = () => go('home');
    $('#view-detail [data-delete]').onclick = () => {
      if (!confirm('Delete "' + a.name + '"? This cannot be undone.')) return;
      Store.remove(a.id).then(() => go('home'));
    };
  }

  /* ---------------------------------------------------------------- import */

  function renderImport() {
    draft = null;
    let type = world;
    let h = '<div class="back" data-back="1">\u2190 Back</div>';
    h += '<div class="ttl">Add a ' + (type === 'run' ? 'run' : 'hike') + '</div>';
    h += '<div class="bar">' +
      '<button class="chip" data-imp="run" aria-pressed="' + (type === 'run') + '">Run</button>' +
      '<button class="chip" data-imp="hike" aria-pressed="' + (type === 'hike') + '">Hike</button>' +
      '<button class="chip" data-imp="auto" aria-pressed="false">Decide for me</button></div>';
    h += '<label><span>Paste the table</span><textarea id="paste" placeholder="Paste straight from Gemini. Pipes, headers and flag lines are all fine."></textarea></label>';
    h += '<button class="btn" id="read">Read it</button>';
    h += '<div class="small muted" style="margin-top:11px">Nothing is saved until you have seen the preview.</div>';
    h += '<div id="preview"></div>';
    el('view-import').innerHTML = h;

    $('#view-import [data-back]').onclick = () => go('home');
    document.querySelectorAll('#view-import [data-imp]').forEach(b => {
      b.onclick = () => {
        type = b.dataset.imp;
        document.querySelectorAll('#view-import [data-imp]').forEach(x =>
          x.setAttribute('aria-pressed', String(x === b)));
      };
    });

    el('read').onclick = () => {
      const text = el('paste').value;
      if (!text.trim()) return;
      const p = Parse.parse(text, { today: today() });
      const t = type === 'auto' ? (Parse.inferType(p) || 'run') : type;
      draft = Parse.toActivity(p, { type: t });
      renderPreview(p, Parse.validate(p, { today: today() }));
    };
  }

  function renderPreview(p, flags) {
    const bounds = Calc.zoneBounds(Store.config());
    const a = draft;
    const c = Calc.aerobicCost(a);
    const d = Calc.drift(a.laps);
    const dup = a.date && a.distance_km ? Model.findDuplicate(a, Store.all()) : null;

    let h = '<div class="rule"></div><div class="eyebrow">Check it</div>';
    h += '<label><span>Name</span><input type="text" id="p-name" value="' + esc(a.name || '') + '" placeholder="Where was it?"></label>';
    if (a.type === 'hike') {
      h += '<div class="field-row">' +
        '<label><span>Conditions</span><input type="text" id="p-cond" placeholder="dry, warm"></label>' +
        '<label><span>Pack</span><select id="p-pack"><option value="">\u2014</option>' +
        '<option value="day">Day</option><option value="overnight">Overnight</option>' +
        '<option value="multi">Multi-day</option></select></label></div>';
    }
    h += '<label><span>Source</span><select id="p-source">' +
      '<option value="tracked">Tracked on the watch</option>' +
      '<option value="typed">Not recorded \u2014 typed from memory</option></select></label>';

    if (Calc.fullLaps(a.laps).length) {
      h += '<div style="margin-top:16px">' +
        (a.type === 'hike' ? vbarsHTML(a, bounds, false) : stripHTML(a, bounds, true)) + '</div>';
      h += '<div class="rmeta" style="margin-left:0">' + Calc.fullLaps(a.laps).length + ' laps' +
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
    if (a.type === 'run') h += metric('Aerobic cost', c ? c.value : '\u2014', c ? 'b/km' : '',
      c ? c.basis + ' pace' : '', !c);
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
        const cd = el('p-cond'), pk = el('p-pack');
        draft.conditions = cd && cd.value.trim() ? cd.value.trim() : null;
        draft.pack = pk && pk.value ? pk.value : null;
      }
      if (dup) draft.id = dup.id;
      const act = Model.make(draft);
      Store.put(act).then(() => {
        setWorld(act.type);
        periodKey = Calc.periodKey(act.date, scope);
        go('detail', act.id);
      });
    };
  }

  /* -------------------------------------------------------------- settings */

  function renderSettings() {
    const cfg = Store.config();
    const b = Calc.zoneBounds(cfg);
    const ageDays = d => d ? Math.round((Date.now() - new Date(d + 'T12:00:00')) / 86400000) : null;

    let h = '<div class="back" data-back="1">\u2190 Back</div><div class="ttl">Setup</div>';

    h += '<div class="sec"><span>Zone anchors \u00b7 Karvonen</span></div>';
    h += '<div class="field-row">' +
      '<label><span>Max HR</span><input type="number" id="c-max" value="' + cfg.max_hr + '"></label>' +
      '<label><span>Resting HR</span><input type="number" id="c-rest" value="' + cfg.resting_hr + '"></label></div>';

    const seg = (from, to, col, label) =>
      '<div class="zseg" style="background:' + col + '; flex:' + (to - from) + '">' + label + '</div>';
    h += '<div class="zbar" style="margin-top:14px">' +
      seg(cfg.resting_hr, b.z2, 'var(--z1)', 'Z1') +
      seg(b.z2, b.z3, 'var(--z2)', 'Z2') +
      seg(b.z3, b.z4, 'var(--z3)', 'Z3') +
      seg(b.z4, b.z5, 'var(--z4)', 'Z4') +
      seg(b.z5, cfg.max_hr, 'var(--z5)', 'Z5') + '</div>';
    h += '<div class="zkey">' +
      '<span>' + cfg.resting_hr + '</span><span>' + b.z2 + '</span><span>' + b.z3 +
      '</span><span>' + b.z4 + '</span><span>' + b.z5 + '</span><span>' + cfg.max_hr + '</span></div>';
    h += '<div class="est">Reserve ' + b.hrr + ' beats. Base work lives in Z2, ' + b.z2 + '\u2013' + (b.z3 - 1) + '.</div>';

    if (ageDays(cfg.max_hr_dated) > 365) h += '<div class="flag"><i>!</i><div>Max HR was set ' +
      Math.round(ageDays(cfg.max_hr_dated) / 30) + ' months ago.</div></div>';
    h += '<div class="small muted" style="margin-top:10px">Resting heart rate wants to be a 90-day median, ' +
      'nudged every few weeks. The zones follow it.</div>';

    h += '<div class="sec"><span>Hiking constants</span></div>';
    h += '<div class="field-row">' +
      '<label><span>Flat km/h</span><input type="number" step="0.1" id="c-flat" value="' + cfg.FLAT_KMH + '"></label>' +
      '<label><span>Ascent m/h</span><input type="number" id="c-asc" value="' + cfg.ASCENT_MH + '"></label></div>';
    h += '<div class="est">Naismith. 5 km/h is the classic value; 4 is the conservative rough-terrain ' +
      'variant. Changing it moves every terrain factor you have.</div>';
    h += '<button class="btn" id="c-save">Save settings</button>';

    const n = Store.all().length;
    h += '<div class="sec"><span>Your data</span></div>';
    h += '<div class="small muted">' + n + ' activit' + (n === 1 ? 'y' : 'ies') +
      ', on this device only. Export now and then.</div>';
    h += '<button class="btn ghost" id="c-export">Export everything</button>';
    h += '<label class="filebtn btn ghost" for="c-import" style="margin-top:8px">Import a backup' +
      '<input id="c-import" type="file" accept="application/json"></label>';

    el('view-settings').innerHTML = h;
    $('#view-settings [data-back]').onclick = () => go('home');

    el('c-save').onclick = () => Store.setConfig({
      max_hr: +el('c-max').value,
      resting_hr: +el('c-rest').value,
      resting_hr_dated: today(),
      FLAT_KMH: +el('c-flat').value,
      ASCENT_MH: +el('c-asc').value
    }).then(renderSettings);

    el('c-export').onclick = () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'groundwork-' + today() + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    el('c-import').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          Store.importJSON(r.result).then(count => { alert(count + ' activities restored.'); go('home'); });
        } catch (err) { alert('Could not read that file: ' + err.message); }
      };
      r.readAsText(f);
    };
  }

  /* --------------------------------------------------------------- wiring */

  function bind() {
    document.querySelectorAll('#view-home [data-scope]').forEach(b => {
      b.onclick = () => { scope = b.dataset.scope; periodKey = null; renderHome(); };
    });
    document.querySelectorAll('#view-home [data-period]').forEach(b => {
      b.onclick = () => { periodKey = b.dataset.period; renderHome(); };
    });
    document.querySelectorAll('#view-home [data-id]').forEach(r => {
      r.onclick = () => go('detail', r.dataset.id);
    });
    document.querySelectorAll('#view-home .rec[data-id]').forEach(r => {
      r.style.cursor = 'pointer';
    });
    const setup = $('#view-home [data-go="settings"]');
    if (setup) setup.onclick = () => go('settings');
  }

  function setWorld(w) {
    world = w;
    scope = WORLD[w].scope;
    periodKey = null;
    document.querySelectorAll('#worlds button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.world === w)));
  }

  const VIEWS = ['home', 'detail', 'import', 'settings'];

  function go(view, param) {
    VIEWS.forEach(v => { el('view-' + v).hidden = (v !== view); });
    el('worlds').hidden = (view !== 'home');
    el('fab').hidden = (view === 'import');
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    if (view === 'detail') renderDetail(param);
    if (view === 'import') renderImport();
    if (view === 'settings') renderSettings();
  }

  document.querySelectorAll('#worlds button').forEach(b => {
    b.onclick = () => { setWorld(b.dataset.world); go('home'); };
  });
  el('fab').onclick = () => go('import');

  Store.init().then(() => { setWorld('run'); go('home'); });

  window.Groundwork = { go: go, setWorld: setWorld };

})();
