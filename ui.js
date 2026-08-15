/* ui.js — rendering and interaction. All maths lives in calc.js.
   Two worlds (run, hike) share this shell but differ in scope, hero and density. */

(function () {
  'use strict';

  const WORLD = {
    run:  { scopes: ['week', 'month', 'year'], scope: 'week', ribbon: 12, metric: 'distance' },
    hike: { scopes: ['month', 'year', 'all'],  scope: 'year', ribbon: 12, metric: 'ascent' },
    /* Body holds one record per day, so it has no ribbon and no activity list. */
    body: { scopes: ['week', 'month', 'year'], scope: 'month', ribbon: 0, metric: null }
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
    /* exact m:ss per zone — the parts add up to the whole */
    /* a seven-second sliver can't hold "0:07" — it clipped to "0:" */
    const MIN_SHARE = 0.09;
    const label = v => (v / total >= MIN_SHARE) ? Calc.fmtDuration(v) : '';
    const parts = [1,2,3,4,5].filter(z => tz[z] > 0).map(z =>
      '<div class="zseg" style="background:' + ZCOL[z] + '; flex:' + tz[z] + '" title="' +
      Calc.fmtDuration(tz[z]) + '">' + label(tz[z]) + '</div>');
    if (tz.unknown > 0) parts.push('<div class="zseg" style="background:var(--stop); flex:' +
      tz.unknown + '" title="' + Calc.fmtDuration(tz.unknown) + '">' + label(tz.unknown) + '</div>');
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
    const wc = WORLD[world];
    if (scope === 'all') return '';
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const bars = Calc.ribbon(real(), scope, key(), wc.ribbon, wc.metric);
    const max = Math.max.apply(null, bars.map(b => b.value).concat([1]));

    const label = b => {
      if (scope === 'week') return Calc.isoWeek(b.key).split('-W')[1].replace(/^0/, '');
      if (scope === 'month') return MON[+b.key.slice(5) - 1][0];
      return b.key.slice(2);
    };

    /* each bar's height is volume; its make-up is time in zone, so twelve
       periods of zone balance read at a glance */
    const cells = bars.map(b => {
      if (!b.value) return '<div class="rp none" data-period="' + b.key + '"><div class="seg"></div></div>';
      const h = Math.max(6, Math.round(b.value / max * 100));
      const inP = real().filter(a => Calc.inPeriod(a, scope, b.key));
      const laps = [];
      inP.forEach(a => (a.laps || []).forEach(l => laps.push(l)));
      const tz = Calc.timeInZone(laps, bounds);
      const zTotal = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;

      let inner;
      if (!zTotal) {
        inner = '<div class="seg" style="background:var(--dim); height:100%"></div>';
      } else {
        const order = [5, 4, 3, 2, 1];
        inner = order.filter(z => tz[z] > 0).map(z =>
          '<div class="seg" style="background:' + ZCOL[z] + '; height:' +
          (tz[z] / zTotal * 100).toFixed(1) + '%"></div>').join('');
        if (tz.unknown > 0) inner = '<div class="seg" style="background:var(--stop); height:' +
          (tz.unknown / zTotal * 100).toFixed(1) + '%"></div>' + inner;
      }
      return '<div class="rp' + (b.selected ? ' on' : '') + '" data-period="' + b.key +
        '" style="height:100%"><div class="stackwrap" style="height:' + h + '%">' + inner + '</div></div>';
    }).join('');

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
  /* Line chart over one or more segments. A training gap is drawn as a gutter
     inside a single plot — never a second panel with its own axis. */
  function lineChart(segments, opt) {
    opt = opt || {};
    const all = [].concat.apply([], segments).map(p => p.value).filter(v => v != null);
    if (all.length < 2) return null;
    let lo = opt.min != null ? opt.min : Math.min.apply(null, all);
    let hi = opt.max != null ? opt.max : Math.max.apply(null, all);
    if (hi === lo) hi = lo + 1;
    /* extra headroom at the good end, so a best-ever value can't sit on the
       dashed rule marking the previous best */
    const pad = (hi - lo) * 0.12;
    lo -= pad * (opt.invert ? 1.6 : 1); hi += pad * (opt.invert ? 1 : 1.6);
    const yOf = v => {
      const t = (v - lo) / (hi - lo);
      return opt.invert ? t * 100 : 100 - t * 100;
    };

    const counts = segments.map(s => s.length);
    const totalPts = counts.reduce((a, b) => a + b, 0);
    const breaks = segments.length - 1;
    const breakW = 7;
    const usable = 100 - breakW * breaks;
    /* Width is proportional to how many runs a block holds — a two-run block
       must not occupy the same width as a fourteen-run one. The floor only
       exists so a single-point segment doesn't vanish. */
    const MINW = segments.length > 1 ? 12 : 0;
    let raw = counts.map(n => n / totalPts * usable);
    if (MINW) {
      const short = raw.map(w => Math.max(0, MINW - w));
      const owed = short.reduce((a, b) => a + b, 0);
      const spare = raw.reduce((a, w, i) => a + Math.max(0, w - MINW), 0);
      raw = raw.map((w, i) => w < MINW ? MINW : w - (spare ? (w - MINW) / spare * owed : 0));
    }
    let x = 0;
    const paths = [], gutters = [];
    segments.forEach((seg, si) => {
      const w = raw[si];
      const step = seg.length > 1 ? w / (seg.length - 1) : 0;
      const pts = seg.map((p, i) => (x + i * step).toFixed(2) + ',' + yOf(p.value).toFixed(2));
      paths.push({ points: pts.join(' '), last: si === segments.length - 1,
                   single: seg.length === 1,
                   cx: x + (seg.length - 1) * step, cy: yOf(seg[seg.length - 1].value) });
      x += w;
      if (si < segments.length - 1) { gutters.push([x, x + breakW]); x += breakW; }
    });

    let svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" height="' +
      (opt.height || 150) + '" role="img" aria-label="' + esc(opt.label || 'chart') + '">';

    /* A filled band has a hard top and bottom edge, and any full-height divider
       crossing it turns one plot into two boxes. Rendered side by side, every
       filled variant boxed and every line variant did not — so the previous
       block's best is a single dashed rule instead. */
    if (opt.mark != null) {
      const my = yOf(opt.mark).toFixed(2);
      svg += '<line x1="0" y1="' + my + '" x2="100" y2="' + my + '" stroke="var(--z2)" ' +
        'stroke-width=".7" stroke-dasharray="3 3" opacity=".75" vector-effect="non-scaling-stroke"/>';
    }
    svg += '<g stroke="#2B383C" stroke-width=".4" vector-effect="non-scaling-stroke">' +
      '<line x1="0" y1="2" x2="100" y2="2"/><line x1="0" y1="50" x2="100" y2="50"/>' +
      '<line x1="0" y1="98" x2="100" y2="98"/></g>';

    /* small ticks under the plot, marking days you trained */
    if (opt.ticksBelow && opt.ticksBelow.length) {
      opt.ticksBelow.forEach(px => {
        svg += '<line x1="' + px.toFixed(2) + '" y1="94" x2="' + px.toFixed(2) +
          '" y2="100" stroke="var(--z3)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
      });
    }

    /* Ticks at the edges, never a full-height rule. A line spanning the plot
       divides it however it's styled. */
    gutters.forEach(g => {
      const mid = ((g[0] + g[1]) / 2).toFixed(2);
      svg += '<line x1="' + mid + '" y1="0" x2="' + mid + '" y2="8" stroke="#55686D" ' +
        'stroke-width=".7" vector-effect="non-scaling-stroke"/>' +
        '<line x1="' + mid + '" y1="92" x2="' + mid + '" y2="100" stroke="#55686D" ' +
        'stroke-width=".7" vector-effect="non-scaling-stroke"/>';
    });

    paths.forEach((p, i) => {
      const col = p.last ? 'var(--z2)' : 'var(--mute)';
      if (!p.single) svg += '<polyline class="draw" fill="none" stroke="' + col +
        '" stroke-width="' + (p.last ? 2.2 : 1.6) +
        '" vector-effect="non-scaling-stroke" points="' + p.points + '"/>';
      if (p.last) svg += '<circle class="tip" cx="' + p.cx.toFixed(2) + '" cy="' +
        p.cy.toFixed(2) + '" r="2.4" fill="var(--z2)"/>';
    });
    svg += '</svg>';

    /* axis labels sit outside the plot, in their own column */
    /* label the values you actually ran, not the padded frame */
    const fmt = opt.format || (v => Math.round(v));
    const best = Math.min.apply(null, all), worst = Math.max.apply(null, all);
    const anchors = opt.invert ? [best, worst] : [worst, best];
    const axis = anchors.map((v, i) =>
      '<span style="top:' + yOf(v).toFixed(1) + '%">' + fmt(v) +
      (opt.anchorLabels ? '<em>' + opt.anchorLabels[i] + '</em>' : '') + '</span>').join('');

    return '<div class="chart"><div class="cwrap">' +
      '<div class="cplot">' + svg + '</div>' +
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



  /* ------------------------------------------------------------ week strip */

  /* Seven days, height is load, colour is the zone that day mostly sat in.
     Answers "am I being consistent" and "how hard was it" in one row. */
  function weekStripHTML() {
    const cfg = Store.config();
    const wk = scope === 'week' ? key() : Calc.weekStart(today());
    const days = Calc.weekDays(real(), cfg, wk);
    if (!days.some(d => d.count)) return '';

    const max = Math.max.apply(null, days.map(d => d.load).concat([1]));
    const L = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const now = today();

    let h = '<div class="wsb">' + days.map(d => {
      if (!d.count) return '<div class="col rest"><div class="v"></div></div>';
      const col = d.zone ? ZCOL[d.zone] : 'var(--mute)';
      const ht = d.load ? Math.max(14, Math.round(d.load / max * 100)) : 22;
      return '<div class="col" title="' + d.date + (d.load ? ' \u00b7 load ' + d.load : '') +
        '"><div class="v" style="height:' + ht + '%; background:' + col + '"></div></div>';
    }).join('') + '</div>';

    h += '<div class="wslbl">' + days.map(d =>
      '<div' + (d.date === now ? ' class="today"' : '') + '>' + L[d.dow] + '</div>').join('') + '</div>';

    const total = days.reduce((t, d) => t + d.load, 0);
    const out = days.filter(d => d.count).length;
    h += '<div class="est">' + out + ' of 7 days' + (total ? ', load ' + total : '') +
      '. Height is load \u2014 minutes weighted by how hard your heart was working.</div>';
    return h;
  }

  /* Weekly load, with a flag when a week jumps by half again. */
  function loadHTML() {
    const cfg = Store.config();
    const series = Calc.loadSeries(real(), cfg, 12, scope === 'week' ? key() : null);
    const withData = series.filter(s => s.value > 0);
    if (withData.length < 3) return '';

    const max = Math.max.apply(null, series.map(s => s.value).concat([1]));
    let h = '<div class="sec"><span>Load</span><span>12 weeks</span></div>';
    h += '<div class="loadbars">' + series.map((s, i) => {
      if (!s.value) return '<div class="lb none"><div class="v"></div></div>';
      const prev = i > 0 ? series[i - 1].value : 0;
      const spike = prev && (s.value - prev) / prev >= Calc.RAMP_LIMIT;
      return '<div class="lb' + (spike ? ' spike' : '') + '" title="' + s.key + ' \u00b7 ' +
        s.value + '"><div class="v" style="height:' +
        Math.max(4, Math.round(s.value / max * 100)) + '%"></div></div>';
    }).join('') + '</div>';
    h += '<div class="wslbl" style="font-size:8px">' + series.map((s, i) =>
      '<div>' + (i % 2 === 0 ? Calc.isoWeek(s.key).split('-W')[1].replace(/^0/, '') : '') +
      '</div>').join('') + '</div>';

    const ramp = Calc.rampFlag(series.filter(s => s.value > 0));
    if (ramp) h += '<div class="callout warn">Load went <b>' + ramp.from + ' \u2192 ' + ramp.to +
      '</b>, up ' + Math.round(ramp.change * 100) + '%. Worth knowing, not necessarily wrong.</div>';
    return h;
  }


  /* ---------------------------------------------------------- the read */

  function fmtRead(v, kind) {
    if (v == null) return '\u2014';
    if (kind === 'pace') return Calc.fmtPace(v);
    if (kind === 'sleep') { const h = Math.floor(v / 3600), m = Math.round((v % 3600) / 60);
      return h + ':' + String(m).padStart(2, '0'); }
    if (kind === 'pct') return Math.round(v);
    if (kind === 'km') return (Math.round(v * 100) / 100).toFixed(2);
    if (kind === 'factor') return v.toFixed(2);
    if (kind === 'bpm') return (v >= 0 ? '+' : '') + Math.round(v);
    return Math.round(v);
  }

  /* Position on the track. Runs worst -> best, so the dot moving right is
     always improvement whichever direction the metric prefers. */
  function trackPos(v, range, betterWhen) {
    if (v == null || !range || range.max === range.min) return null;
    const t = (v - range.min) / (range.max - range.min);
    return betterWhen === 'down' ? (1 - t) * 100 : t * 100;
  }

  function readHTML(type) {
    const cfg = Store.config();
    const rows = Calc.readRows(Store.all(), cfg, type, today());
    if (!rows.length) return '';

    const live = rows.filter(r => r.range && r.now != null);
    const waiting = rows.filter(r => !(r.range && r.now != null));

    let h = '<div class="sec"><span>Form</span><span>' +
      (live.length ? 'last 3 vs 3 before' : '') + '</span></div>';

    live.forEach(r => {
      const d = r.need === 0 ? Calc.delta(r.now, r.prev, r.betterWhen) : null;
      const pos = trackPos(r.now, r.range, r.betterWhen);
      const bandFrom = r.band ? trackPos(r.betterWhen === 'down' ? r.band.max : r.band.min, r.range, r.betterWhen) : null;
      const bandTo = r.band ? trackPos(r.betterWhen === 'down' ? r.band.min : r.band.max, r.range, r.betterWhen) : null;
      const worst = r.betterWhen === 'down' ? r.range.max : r.range.min;
      const best = r.betterWhen === 'down' ? r.range.min : r.range.max;

      h += '<div class="rd">';
      h += '<div class="rd-top"><div class="rd-name">' + esc(r.label) + '</div><div class="rd-val">' +
        fmtRead(r.now, r.kind) + (r.unit ? '<s>' + esc(r.unit) + '</s>' : '') +
        (d ? ' ' + deltaHTML(d, r.kind === 'pace' ? (x => Math.abs(Math.round(x.diff)) + 's')
             : r.kind === 'sleep' ? (x => Math.abs(Math.round(x.diff / 60)) + 'm') : null) : '') +
        '</div></div>';
      h += '<div class="track' + (r.need ? ' off' : '') + '"><div class="line"></div>' +
        (bandFrom != null && bandTo != null && Math.abs(bandTo - bandFrom) > 0.5
          ? '<div class="band" style="left:' + Math.min(bandFrom, bandTo).toFixed(1) +
            '%; width:' + Math.abs(bandTo - bandFrom).toFixed(1) + '%"></div>' : '') +
        '<div class="dot' + (r.need ? ' off' : '') + '" style="left:' + pos.toFixed(1) + '%"></div></div>';
      h += '<div class="rd-ends"><span>' + fmtRead(worst, r.kind) +
        (r.worstLabel ? ' ' + esc(r.worstLabel) : '') + '</span><span>' +
        fmtRead(best, r.kind) + (r.bestLabel ? ' ' + esc(r.bestLabel) : '') + '</span></div>';
      if (r.need > 0) h += '<div class="rd-note">' + r.need + ' more before the arrow opens.</div>';
      if (r.note) h += '<div class="rd-note">' + esc(r.note) + '</div>';
      h += '</div>';
    });

    /* Everything that can't say anything yet gets one line between them all,
       rather than a track apiece pretending a single reading is a range. */
    if (waiting.length) {
      const unitOf = { '%': '%', 'bpm': ' bpm', 'km': ' km', '/km': '/km',
                       'days / week': ' a week', 'm/h': ' m/h', 'm': ' m' };
      const named = waiting.map(r => {
        const un = unitOf[r.unit] != null ? unitOf[r.unit] : (r.unit ? ' ' + r.unit : '');
        /* one observation is not a value worth printing — that's the same
           degenerate case the tracks already refuse */
        const v = (r.now != null && r.n >= 2) ? fmtRead(r.now, r.kind) + un : null;
        return esc(r.label.toLowerCase()) + (v ? ' <b>' + v + '</b>' : '');
      });
      const last = named.pop();
      h += '<div class="waiting">' +
        (named.length ? named.join(', ') + ' and ' + last : last) +
        ' \u2014 ' + (waiting.length > 1 ? 'these open' : 'this opens') + ' as more runs land.</div>';
    }
    return h;
  }

  /* ------------------------------------------------- the noticing card */

  function noticedHTML(act) {
    const n = Calc.noticed(act, Store.all(), Store.config());
    if (!n) return '';
    const gain = Math.round(n.gain);
    const pct = Math.min(100, n.ratio / (Calc.NOTICE.threshold * 2) * 100);
    return '<div class="noticed">' +
      '<div class="l">Something changed</div>' +
      '<div class="h">' + gain + ' seconds faster at the same heart rate' +
      '<s>than your last ' + n.n + '</s></div>' +
      '<div class="w">Those ' + n.n + ' sat at ' + Calc.fmtPace(n.baseline) + ' with a ' +
      Math.round(n.spread) + '-second spread. This came in at ' + Calc.fmtPace(n.value) +
      ' \u2014 ' + n.ratio.toFixed(1) + '\u00d7 that spread, so it is not just a good day.' +
      (n.banded ? ' Compared against runs of similar length.' : '') + '</div>' +
      '<div class="sigbar"><div class="l2"></div>' +
      '<div class="fill" style="width:' + pct.toFixed(0) + '%"></div>' +
      '<div class="thr" style="left:50%"></div>' +
      '<div class="cap" style="left:50%; transform:translateX(-50%)">threshold</div>' +
      '<div class="cap" style="right:0">' + n.ratio.toFixed(1) + '\u00d7</div></div></div>';
  }

  /* --------------------------------------------- zone share, by week */

  function zoneShareHTML() {
    const cfg = Store.config();
    const all = Calc.zoneShareSeries(real(), cfg, 12, scope === 'week' ? key() : null);
    const withData = all.filter(w => w.total > 0);
    /* one bar among eleven empty slots is a chart of nothing */
    if (withData.length < 3) return '';
    /* show from the first week that has data, not a fixed twelve */
    const firstIdx = all.findIndex(w => w.total > 0);
    const weeks = all.slice(Math.max(0, firstIdx - 1));

    let h = '<div class="sec"><span>Zone share</span><span>12 weeks</span></div>';
    h += '<div class="zchart">' + weeks.map(w => {
      if (!w.total) return '<div class="zc none"><div class="s"></div></div>';
      const order = [5, 4, 3, 2, 1];
      let inner = order.filter(z => w.zones[z] > 0).map(z =>
        '<div class="s" style="background:' + ZCOL[z] + '; height:' +
        (w.zones[z] / w.total * 100).toFixed(1) + '%"></div>').join('');
      if (w.zones.unknown > 0) inner = '<div class="s" style="background:var(--stop); height:' +
        (w.zones.unknown / w.total * 100).toFixed(1) + '%"></div>' + inner;
      return '<div class="zc">' + inner + '</div>';
    }).join('') + '</div>';
    h += '<div class="zclbl">' + weeks.map((w, i) =>
      '<div>' + (i % 2 === 0 ? Calc.isoWeek(w.key).split('-W')[1].replace(/^0/, '') : '') + '</div>'
    ).join('') + '</div>';
    h += '<div class="est">One bar per week, scaled to 100%.</div>';
    return h;
  }


  /* ------------------------------------------------------------------ home */

  function renderHome() {
    if (world === 'body') return renderBody();
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
    if (world === 'run') h += weekStripHTML();
    h += '<div class="rule"></div>';
    h += (world === 'run' ? runHero(inP, mine, bounds) : hikeHero(inP, mine, k));

    /* the list */
    const sorted = inP.slice().sort((a, b) => b.date.localeCompare(a.date));
    const isNow = Calc.periodKey(today(), scope) === k;
    h += '<div class="sec"><span>' + (isNow ? 'This ' + scope : esc(Calc.periodLabel(k, scope, today()))) +
      '</span><span>' + (sorted.length ? sorted.length + (world === 'run' ? ' runs' : ' days out') : '') +
      '</span></div>';

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

    const newest = mine.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    if (newest) h += noticedHTML(newest);

    /* Year scope shows the whole history; otherwise the recent window, so the
       scale tracks where you actually are. */
    const showAll = scope === 'year';
    const segs = Calc.paceSeries(mine, cfg, showAll ? 0 : Calc.PACE_WINDOW);
    const flat = [].concat.apply([], segs);
    if (flat.length >= 2) {
      const prevSeg = segs.length > 1 ? segs[segs.length - 2] : null;
      const mark = prevSeg && prevSeg.length >= 3
        ? Math.min.apply(null, prevSeg.map(p => p.value))
        : null;
      const first = flat[0].date, lastD = flat[flat.length - 1].date;
      h += lineChart(segs, {
        invert: true, mark: mark, height: 150,
        format: v => Calc.fmtPace(v),
        anchorLabels: ['best', 'slowest'],
        label: 'Aerobic pace across ' + flat.length + ' runs. Faster is higher.',
        xax: [fmtDate(first).toUpperCase(), segs.length > 1 ? 'break' : '', fmtDate(lastD).toUpperCase()],
        legend: '<span><i class="sw now"></i>this block</span>' +
                (segs.length > 1 ? '<span><i class="sw prev"></i>before the break</span>' : '')
      });
      const hidden = segs.total - segs.shown;
      h += '<div class="est">Faster is higher' +
        (mark != null ? '. Dashed rule is your previous best, ' + Calc.fmtPace(mark) : '') +
        (hidden > 0 ? '. Last ' + segs.shown + ' runs \u2014 switch to Year for all ' +
          segs.total : '') + '.</div>';
    } else {
      h += '<div class="est">The trend line opens once you have two runs with heart rate.</div>';
    }

    /* zone split across the period */
    const laps = [];
    inP.forEach(a => (a.laps || []).forEach(l => laps.push(l)));
    const tz = Calc.timeInZone(laps, bounds);
    const zTotal = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;
    if (zTotal) {
      /* Lap durations and elapsed time can differ by a few seconds. Show the
         activity total, and note the shortfall rather than printing two
         different figures for the same week. */
      const covered = zTotal, whole = s.elapsed_s;
      h += '<div class="sec"><span>Time in zone</span><span>' + Calc.fmtDuration(whole) + '</span></div>';
      h += zoneBarHTML(tz) + zoneKeyHTML(bounds);
      const missing = whole - covered;
      h += '<div class="est">' + Math.round(tz[2] / covered * 100) + '% in Z2' +
        (missing > 30 ? ', from ' + Calc.fmtDuration(covered) + ' with lap heart rate' : '') +
        '.</div>';
    }

    /* facts before analysis: you should never scroll past a trend to reach a total */
    const prevKey = Calc.previousWithData(real(), scope, key());
    const prev = prevKey ? Calc.summarize(real().filter(a => Calc.inPeriod(a, scope, prevKey))) : null;
    const vs = prevKey ? Calc.periodLabel(prevKey, scope, today()) : null;
    const dd = (v, p, better) => deltaHTML(Calc.delta(v, p, better));

    h += '<div class="totals">';
    h += cmp('Distance', s.distance_km.toFixed(2) + ' km ' + (prev ? dd(s.distance_km, prev.distance_km, null) : ''),
      prev ? vs + ' ' + prev.distance_km.toFixed(2) : 'nothing before this');
    h += cmp('Time', Calc.fmtDuration(s.elapsed_s) + ' ' + (prev ? dd(s.elapsed_s, prev.elapsed_s, null) : ''),
      prev ? vs + ' ' + Calc.fmtDuration(prev.elapsed_s) : '');
    h += cmp('Runs', String(s.count), prev ? vs + ' ' + prev.count : '');
    h += '</div>';

    h += readHTML('run');
    h += loadHTML();
    h += zoneShareHTML();
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

    /* magnitude shows in the type: a long run reads as a long run */
    const all = Store.all().filter(x => x.type === a.type).map(x => x.distance_km);
    const top = all.length ? Math.max.apply(null, all) : a.distance_km;
    const scale = top ? Math.min(1, a.distance_km / top) : 0;
    const size = (12 + scale * 3.4).toFixed(1);

    return '<div class="rrow" data-id="' + esc(a.id) + '">' +
      '<div class="rtop"><div class="rday">' + DAYS[Calc.dayIndex(a.date)] + ' ' + a.date.slice(8) + '</div>' +
      '<div class="rnm" style="font-size:' + size + 'px">' + esc(a.name) +
      ' <span>\u00b7 ' + a.distance_km.toFixed(2) + ' km</span></div>' +
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
    h += readHTML('hike');
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

  function hikeNameSize(a) {
    const all = Store.all().filter(x => x.type === 'hike' && x.ascent_m != null).map(x => x.ascent_m);
    const top = all.length ? Math.max.apply(null, all) : null;
    const scale = (top && a.ascent_m != null) ? Math.min(1, a.ascent_m / top) : 0.5;
    return (15.5 + scale * 3.5).toFixed(1);
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
      '<div class="hname" style="font-size:' + hikeNameSize(a) + 'px">' + esc(a.name) + '</div>' +
      '<div class="hstats">' + st.map(x =>
        '<div class="hstat"><div class="l">' + x[0] + '</div><div class="v">' + x[1] +
        (x[2] ? '<s>' + x[2] + '</s>' : '') + '</div></div>').join('') + '</div>' +
      vbarsHTML(a, bounds, true) + '</div>';
  }


  /* ------------------------------------------------------------------ body */

  function fmtSleep(sec) {
    if (sec == null) return '\u2014';
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h + ':' + String(m).padStart(2, '0');
  }

  function renderBody() {
    const cfg = Store.config();
    const all = Store.all();
    const k = key();
    const rest = Calc.restingSeries(all);
    const inP = rest.filter(p => Calc.inPeriod({ date: p.date, type: 'day' }, scope, k));

    let h = '<div class="top"><div>' +
      '<div class="ttl">' + esc(Calc.periodLabel(k, scope, today())) + '</div>' +
      '<div class="sub">' + esc(Calc.periodSpan(k, scope, today())) + '</div>' +
      '</div><button class="corner" data-go="settings">SETUP</button></div>';
    h += '<div class="bar">' + WORLD.body.scopes.map(sc =>
      '<button class="chip" data-scope="' + sc + '" aria-pressed="' + (sc === scope) + '">' +
      sc[0].toUpperCase() + sc.slice(1) + '</button>').join('') + '</div>';

    if (!rest.length) {
      h += '<div class="empty-state">Nothing logged yet.<br>' +
        'Tap + and paste a week from the Heart Rate and Sleep screens.</div>';
      el('view-home').innerHTML = h;
      bind();
      return;
    }

    h += '<div class="rule"></div>';

    /* hero: today against the rolling baseline */
    const base = Calc.restingBaseline(all, today());
    const latest = rest[rest.length - 1];
    h += '<div class="eyebrow">Resting heart rate</div>';
    h += '<div class="hero"><div class="hnum">' + latest.value + '</div><div class="hunit">bpm</div>' +
      (base != null ? deltaHTML(Calc.delta(latest.value, base, 'down'),
        x => Math.abs(Math.round(x.diff)) + '') : '') + '</div>';
    h += '<div class="hsub">' + (base == null
      ? 'Baseline opens once three nights are logged.'
      : (latest.value === Math.round(base)
          ? 'At your baseline of <b>' + Math.round(base) + '</b>, the 90-day median.'
          : Math.abs(latest.value - Math.round(base)) + ' ' +
            (latest.value > base ? 'above' : 'below') + ' your baseline of <b>' +
            Math.round(base) + '</b>, the 90-day median.')) + '</div>';

    /* resting HR, with training days ticked underneath */
    if (inP.length >= 4) {
      const trained = Calc.trainedDates(all);
      h += lineChart([inP], {
        invert: true, mark: base, height: 140,
        format: v => Math.round(v),
        anchorLabels: ['lowest', 'highest'],
        label: 'Resting heart rate with the 90-day median and the days you trained.',
        ticksBelow: inP.map((p, i) => trained[p.date] ? i / (inP.length - 1) * 100 : null).filter(v => v != null),
        xax: [fmtDate(inP[0].date).toUpperCase(), fmtDate(latest.date).toUpperCase()],
        legend: '<span><i class="sw now"></i>resting HR</span>' +
                (base != null ? '<span><i class="sw mark"></i>90-day median</span>' : '') +
                '<span><i class="sw tick"></i>you trained</span>'
      }) || '';

      /* the finding worth surfacing: raised for days after training */
      const runs = inP.filter(p => trained[p.date]);
      const above = inP.filter(p => base != null && p.value - base >= 4);
      if (above.length >= 3) h += '<div class="callout warn">Resting heart rate sat <b>4 or more above baseline</b> on ' +
        above.length + ' of these days. That is the pattern to watch when a block starts biting.</div>';
    } else {
      h += '<div class="est">The trend opens once four days are logged in this period.</div>';
    }

    /* sleep */
    const sleep = Calc.sleepSeries(all)
      .filter(p => Calc.inPeriod({ date: p.date, type: 'day' }, scope, k));
    if (sleep.length >= 3) {
      const med = Calc.median(sleep.map(p => p.value));
      const max = Math.max.apply(null, sleep.map(p => p.value));
      h += '<div class="sec"><span>Sleep</span><span>' + fmtSleep(med) + ' median</span></div>';
      h += '<div class="sleep">' + sleep.map(p =>
        '<div class="sb' + (p.value < 6 * 3600 ? ' low' : '') + '" title="' + p.date + ' \u00b7 ' +
        fmtSleep(p.value) + '"><div class="v" style="height:' +
        Math.max(6, Math.round(p.value / max * 100)) + '%"></div></div>').join('') + '</div>';
      h += '<div class="est">Amber is a night under six hours. The reference is your own median, not eight hours.</div>';
    }

    h += readHTML('body');

    /* recent nights */
    const days = Calc.dayRecords(all)
      .filter(d => Calc.inPeriod(d, scope, k))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);
    if (days.length) {
      h += '<div class="sec"><span>Recent nights</span><span>' + days.length + ' shown</span></div>';
      h += days.map(d => {
        const hi = base != null && d.resting_hr != null && d.resting_hr - base >= 4;
        const bits = [];
        if (d.sleep_s != null) bits.push(fmtSleep(d.sleep_s));
        if (d.sleep_score != null) bits.push('score ' + d.sleep_score);
        if (d.hrv_ms != null) bits.push('HRV ' + d.hrv_ms);
        return '<div class="drow" data-id="' + esc(d.id) + '">' +
          '<div class="dday">' + DAYS[Calc.dayIndex(d.date)] + ' ' + (+d.date.slice(8)) + '</div>' +
          '<div class="dmain">' + esc(bits.join(' \u00b7 ')) + '</div>' +
          '<div class="dfig' + (hi ? ' up' : '') + '">' +
          (d.resting_hr == null ? '\u2014' : d.resting_hr) + '</div></div>';
      }).join('');
    }

    /* conflicts, if a run and a day record disagree */
    const conf = Calc.restingConflicts(all);
    if (conf.length) {
      h += '<div class="flag"><i>!</i><div>' + conf.length + ' day' + (conf.length === 1 ? '' : 's') +
        ' where a run and a night record disagree by 3 bpm or more. The night record is used.</div></div>';
    }

    el('view-home').innerHTML = h;
    bind();
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

    if (a.type === 'run') h += noticedHTML(a);

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

    if (d != null) {
      h += '<div class="callout' + (d > 8 ? ' warn' : '') + '">' +
        'Heart rate moved <b>' + (d >= 0 ? '+' : '') + d + ' bpm</b> across the run' +
        (d > 8 ? '. A base effort should hold closer to flat.' : '.') +
        '</div><div class="est">Measured after the opening kilometre \u2014 heart rate ' +
        'climbing from rest at the start is not drift.</div>';
    } else if (Calc.hasLapHr(a.laps)) {
      const need = Calc.driftNeeds(a.laps);
      h += '<div class="est">Drift needs ' + need + ' more full kilometre' + (need === 1 ? '' : 's') +
        ' \u2014 the opening one is dropped, and three are needed after that.</div>';
    }

    h += '<div class="rule"></div><div class="grid2">';
    if (a.type === 'run') {
      const ap = Calc.aerobicPace(a, cfg);
      h += metric('Aerobic pace', ap != null ? Calc.fmtPace(ap) : '\u2014', ap != null ? '/km' : '',
        ap != null ? 'at ' + Calc.refHr(cfg) + ' bpm' + (c.basis === 'gap' ? ', gradient-adjusted' : '')
                   : 'needs heart rate', ap == null);
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
    if (a.resting_hr != null) {
      const bl = Calc.restingBaseline(Store.all(), a.date);
      h += metric('Resting HR', a.resting_hr, 'bpm',
        bl != null ? (a.resting_hr === Math.round(bl) ? 'at baseline'
          : Math.abs(a.resting_hr - bl).toFixed(0) + ' ' + (a.resting_hr > bl ? 'above' : 'below') + ' baseline')
        : '');
    }
    const ld = Calc.load(a, cfg);
    if (ld != null) {
      const sr = Calc.sessionRpe(a);
      h += metric('Load', ld, '', sr != null ? 'session RPE ' + sr : 'from heart rate');
    }
    if (a.cadence_spm != null) h += metric('Cadence', a.cadence_spm, 'spm', '');
    h += '</div>';

    if (ss != null && !hrOk) h += '<div class="callout warn">Average heart rate is dragged down by <b>' +
      Calc.fmtDuration(a.elapsed_s - a.moving_s) + ' stopped</b>. Shown here, kept out of trends.</div>';

    if (zTotal) {
      h += '<div class="sec"><span>Time in zone</span><span>' + Calc.fmtDuration(zTotal) + '</span></div>';
      h += zoneBarHTML(tz) + zoneKeyHTML(bounds);
    }

    if (a.feel) h += '<div class="sec"><span>Felt</span></div><div class="small muted">' + esc(a.feel) + '</div>';
    if (a.note) h += '<div class="sec"><span>Note</span></div><div class="small muted">' + esc(a.note) + '</div>';

    h += '<div class="btnrow">' +
      '<button class="btn" data-edit="' + esc(a.id) + '">Edit</button>' +
      '<button class="btn" data-replace="' + esc(a.id) + '">Replace from paste</button></div>';
    h += '<button class="btn danger" data-delete="' + esc(a.id) + '">Delete this ' + a.type + '</button>';

    el('view-detail').innerHTML = h;
    $('#view-detail [data-back]').onclick = () => go('home');
    $('#view-detail [data-edit]').onclick = () => go('edit', a.id);
    $('#view-detail [data-replace]').onclick = () => go('replace', a.id);
    $('#view-detail [data-delete]').onclick = () => {
      if (!confirm('Delete "' + a.name + '"? This cannot be undone.')) return;
      Store.remove(a.id).then(() => go('home'));
    };
  }

  /* ---------------------------------------------------------------- import */

  function renderImport() {
    draft = null;
    /* Inference is right nearly always, so it leads. The explicit chips are the
       override, not the norm. */
    let type = 'auto';
    const LABEL = { run: 'Add a run', hike: 'Add a hike', body: 'Add nights', auto: 'Add' };
    const PLACEHOLDER = {
      run: 'Paste the run table from Gemini.',
      hike: 'Paste the hike table from Gemini.',
      body: 'Paste a week of nights — one row per day.',
      auto: 'Paste straight from Gemini. Runs, hikes and nights are all recognised.'
    };

    let h = '<div class="back" data-back="1">\u2190 Back</div>';
    h += '<div class="ttl" id="imp-title">' + LABEL[type] + '</div>';
    h += '<div class="bar">' +
      ['auto', 'run', 'hike', 'body'].map(t =>
        '<button class="chip" data-imp="' + t + '" aria-pressed="' + (t === type) + '">' +
        (t === 'auto' ? 'Decide for me' : t === 'body' ? 'Body' : t[0].toUpperCase() + t.slice(1)) +
        '</button>').join('') + '</div>';
    h += '<label><span>Paste the table</span><textarea id="paste" placeholder="' +
      esc(PLACEHOLDER[type]) + '"></textarea></label>';
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
        el('imp-title').textContent = LABEL[type];
        el('paste').placeholder = PLACEHOLDER[type];
        el('preview').innerHTML = '';
      };
    });

    el('read').onclick = () => {
      const text = el('paste').value;
      if (!text.trim()) return;
      const p = Parse.parse(text, { today: today() });

      /* day rows are unambiguous — they can only be nights */
      if (p.days.length) { renderDayPreview(p); return; }
      if (type === 'body') {
        el('preview').innerHTML = '<div class="flag error"><i>\u2715</i><div>' +
          'No day rows in that paste. A week of nights needs one row per date.</div></div>';
        return;
      }

      const guess = Parse.inferType(p);
      const t = type === 'auto' ? (guess || 'run') : type;
      draft = Parse.toActivity(p, { type: t });
      const flags = Parse.validate(p, { today: today() });
      /* an explicit choice always wins, but the app says when it disagrees */
      if (type !== 'auto' && guess && guess !== type) {
        flags.unshift({ level: 'warn', msg: 'You chose ' + type + ', but this reads as a ' +
          guess + '. Saving it as ' + type + '.' });
      }
      renderPreview(p, flags);
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
      if (dup) {
        draft.id = dup.id;
        draft.created_at = dup.created_at;
        /* a paste never overwrites what you typed */
        Parse.TYPED.forEach(k => {
          if (k === 'name' || k === 'source') return;   // both are on this form
          draft[k] = dup[k];
        });
      }
      const act = Model.make(draft);
      Store.put(act).then(() => {
        setWorld(act.type);
        periodKey = Calc.periodKey(act.date, scope);
        go('detail', act.id);
      });
    };
  }


  function renderDayPreview(p) {
    const all = Store.all();
    const recs = Parse.toDays(p, all, { today: today() });
    const flags = Parse.validateDays(p, all, { today: today() });
    const errors = flags.filter(f => f.level === 'error');

    /* On a first import there is no baseline yet, so compare against the median
       of the week being pasted — otherwise the preview says nothing at exactly
       the moment the anchor is being established. */
    const prior = Calc.restingBaseline(all, today());
    const incoming = Calc.median(recs.map(r => r.resting_hr).filter(v => v != null));
    const base = prior != null ? prior : incoming;
    const firstEver = prior == null;

    let h = '<div class="rule"></div><div class="sec"><span>Check it</span><span>' +
      recs.length + ' night' + (recs.length === 1 ? '' : 's') + '</span></div>';
    h += '<div class="small muted" style="margin-bottom:10px">Day rows are read as nights ' +
      'whichever type is selected.</div>';

    recs.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(d => {
      const hi = base != null && d.resting_hr != null && d.resting_hr - base >= 4;
      const bits = [];
      if (d.sleep_s != null) bits.push(fmtSleep(d.sleep_s));
      if (d.sleep_score != null) bits.push('score ' + d.sleep_score);
      if (d.hrv_ms != null) bits.push('HRV ' + d.hrv_ms);
      h += '<div class="drow"><div class="dday">' + DAYS[Calc.dayIndex(d.date)] + ' ' +
        (+d.date.slice(8)) + '</div><div class="dmain">' + esc(bits.join(' \u00b7 ')) +
        (d.replaces ? ' <span>\u00b7 replaces</span>' : '') + '</div>' +
        '<div class="dfig' + (hi ? ' up' : '') + '">' +
        (d.resting_hr == null ? '\u2014' : d.resting_hr) + '</div></div>';
    });

    if (!errors.length) h += '<div class="flag ok"><i>\u2713</i><div>Nothing inconsistent found.</div></div>';
    flags.forEach(f => {
      const cls = f.level === 'error' ? 'error' : f.level === 'info' ? 'info' : '';
      const mark = f.level === 'error' ? '\u2715' : f.level === 'info' ? 'i' : '!';
      h += '<div class="flag ' + cls + '"><i>' + mark + '</i><div>' + esc(f.msg) + '</div></div>';
    });

    /* say what this does to the anchor, before it happens */
    const after = Calc.restingBaseline(
      all.filter(a => !recs.some(r => r.id && r.id === a.id))
         .concat(recs.map(r => Object.assign({}, r, { id: r.id || 'x' + r.date }))), today());
    if (after != null) {
      const anchor = Store.config().resting_hr;
      const moves = Math.abs(Math.round(after) - anchor) >= 2;
      h += '<div class="flag info"><i>i</i><div>' +
        (firstEver
          ? '90-day median will be set to ' + Math.round(after) + '.'
          : '90-day median moves ' + Math.round(prior) + ' \u2192 ' + Math.round(after) + '.') +
        (moves
          ? ' Your zone anchor follows, ' + anchor + ' \u2192 ' + Math.round(after) + '.'
          : ' Your zones don\u2019t change.') + '</div></div>';
    }

    h += '<button class="btn" id="save-days"' + (errors.length ? ' disabled' : '') + '>Save ' +
      recs.length + ' night' + (recs.length === 1 ? '' : 's') + '</button>';
    el('preview').innerHTML = h;

    const btn = el('save-days');
    if (btn && !errors.length) btn.onclick = () => {
      const chain = recs.reduce((prom, r) =>
        prom.then(() => Store.put(Model.make(r))), Promise.resolve());
      chain.then(() => {
        /* the anchor follows the rolling median, but only on a real shift */
        const next = Calc.suggestedRestingAnchor(Store.all(), Store.config(), today());
        return next != null
          ? Store.setConfig({ resting_hr: next, resting_hr_dated: today() })
          : null;
      }).then(() => { setWorld('body'); go('home'); });
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


  /* ------------------------------------------------------------ editing */

  const FIELD_DEFS = {
    run: [
      ['date', 'Date', 'date'], ['name', 'Name', 'text'],
      ['distance_km', 'Distance (km)', 'number'], ['elapsed_s', 'Time (m:ss)', 'duration'],
      ['gap_pace_s', 'GAP pace (m:ss)', 'duration'], ['avg_hr', 'Avg HR', 'number'],
      ['resting_hr', 'Resting HR', 'number'], ['cadence_spm', 'Cadence', 'number'],
      ['ascent_m', 'Ascent (m)', 'number'], ['temp_c', 'Temperature', 'number'],
      ['rpe', 'RPE', 'number'], ['feel', 'Feel', 'text']
    ],
    hike: [
      ['date', 'Date', 'date'], ['name', 'Name', 'text'],
      ['distance_km', 'Distance (km)', 'number'], ['elapsed_s', 'Elapsed (h:mm:ss)', 'duration'],
      ['moving_s', 'Moving (h:mm:ss)', 'duration'], ['ascent_m', 'Ascent (m)', 'number'],
      ['descent_m', 'Descent (m)', 'number'], ['avg_hr', 'Avg HR', 'number'],
      ['resting_hr', 'Resting HR', 'number'], ['temp_c', 'Temperature', 'number'],
      ['rpe', 'RPE', 'number'], ['conditions', 'Conditions', 'text']
    ]
  };

  function fieldValue(a, key, kind) {
    const v = a[key];
    if (v == null) return '';
    if (kind === 'duration') return Calc.fmtDuration(v);
    return String(v);
  }

  function parseField(raw, kind) {
    const s = String(raw).trim();
    if (s === '') return null;
    if (kind === 'duration') return Parse._duration(s);
    if (kind === 'number') { const n = parseFloat(s.replace(',', '.')); return isNaN(n) ? null : n; }
    return s;
  }

  function renderEdit(id) {
    const a = Store.byId(id);
    if (!a) { go('home'); return; }
    const defs = FIELD_DEFS[a.type] || FIELD_DEFS.run;

    let h = '<div class="back" data-back="1">\u2190 Cancel</div>';
    h += '<div class="ttl">Edit</div><div class="sub">' + esc(a.name.toUpperCase()) + '</div>';

    h += '<div class="sec"><span>Fields</span><span>blank clears</span></div>';
    defs.forEach(([k, label, kind]) => {
      h += '<label><span>' + esc(label) + '</span><input type="text" data-f="' + k +
        '" data-kind="' + kind + '" value="' + esc(fieldValue(a, k, kind)) + '"></label>';
    });

    h += '<label><span>Source</span><select data-f="source" data-kind="text">' +
      '<option value="tracked"' + (a.source === 'tracked' ? ' selected' : '') + '>Tracked on the watch</option>' +
      '<option value="typed"' + (a.source === 'typed' ? ' selected' : '') + '>Not recorded \u2014 typed</option>' +
      '</select></label>';
    if (a.type === 'hike') {
      h += '<label><span>Pack</span><select data-f="pack" data-kind="text">' +
        ['', 'day', 'overnight', 'multi'].map(v =>
          '<option value="' + v + '"' + (a.pack === (v || null) ? ' selected' : '') + '>' +
          (v ? v[0].toUpperCase() + v.slice(1) : '\u2014') + '</option>').join('') + '</select></label>';
    }
    h += '<label><span>Note</span><input type="text" data-f="note" data-kind="text" value="' +
      esc(a.note || '') + '"></label>';

    if ((a.laps || []).length) {
      h += '<div class="sec"><span>Laps</span><span>' + a.laps.length + '</span></div>';
      a.laps.forEach((l, i) => {
        h += '<div class="lapedit"><div class="ln">' + l.n + '</div>' +
          '<input type="text" data-lap="' + i + '" data-lk="distance_km" value="' + l.distance_km + '" aria-label="Lap distance">' +
          '<input type="text" data-lap="' + i + '" data-lk="time_s" value="' + Calc.fmtDuration(l.time_s) + '" aria-label="Lap time">' +
          '<input type="text" data-lap="' + i + '" data-lk="avg_hr" value="' + (l.avg_hr == null ? '' : l.avg_hr) + '" aria-label="Lap heart rate">' +
          '</div>';
      });
      h += '<div class="est">Distance in km, time as m:ss, heart rate in bpm. Blank clears.</div>';
    }

    h += '<div id="editflags"></div>';
    h += '<button class="btn" id="e-save">Save changes</button>';
    h += '<button class="btn ghost" data-back="1">Cancel</button>';

    el('view-edit').innerHTML = h;
    document.querySelectorAll('#view-edit [data-back]').forEach(b => b.onclick = () => go('detail', id));

    el('e-save').onclick = () => {
      const next = Object.assign({}, a);
      document.querySelectorAll('#view-edit [data-f]').forEach(inp => {
        next[inp.dataset.f] = parseField(inp.value, inp.dataset.kind);
      });
      if ((a.laps || []).length) {
        next.laps = a.laps.map((l, i) => {
          const get = k => {
            const inp = document.querySelector('#view-edit [data-lap="' + i + '"][data-lk="' + k + '"]');
            return inp ? inp.value : '';
          };
          return {
            n: l.n,
            distance_km: parseField(get('distance_km'), 'number'),
            time_s: parseField(get('time_s'), 'duration'),
            avg_hr: parseField(get('avg_hr'), 'number'),
            role: l.role
          };
        }).filter(l => l.distance_km != null && l.time_s != null);
      }

      const flags = validateActivity(next);
      const errors = flags.filter(f => f.level === 'error');
      el('editflags').innerHTML = flags.map(f =>
        '<div class="flag ' + (f.level === 'error' ? 'error' : f.level === 'info' ? 'info' : '') + '">' +
        '<i>' + (f.level === 'error' ? '\u2715' : f.level === 'info' ? 'i' : '!') + '</i><div>' +
        esc(f.msg) + '</div></div>').join('');
      if (errors.length) return;

      next.updated_at = new Date().toISOString();
      Store.put(next).then(() => go('detail', next.id));
    };
  }

  /* Same checks as an import, applied to a hand-edited record. */
  function validateActivity(a) {
    const flags = [];
    const add = (level, msg) => flags.push({ level: level, msg: msg });
    if (!a.date) add('error', 'A date is required.');
    else if (a.date > today()) add('error', 'That date is in the future.');
    if (a.distance_km == null || a.distance_km <= 0) add('error', 'A distance is required.');
    if (a.elapsed_s == null || a.elapsed_s <= 0) add('error', 'A time is required.');
    if (a.moving_s != null && a.elapsed_s != null && a.moving_s > a.elapsed_s)
      add('error', 'Moving time is longer than elapsed time.');
    if (a.avg_hr != null && (a.avg_hr < 30 || a.avg_hr > 220)) add('error', 'Avg HR is out of range.');
    if (a.resting_hr != null && (a.resting_hr < 25 || a.resting_hr > 120)) add('error', 'Resting HR is out of range.');
    (a.laps || []).forEach(l => {
      if (l.avg_hr != null && (l.avg_hr < 30 || l.avg_hr > 220))
        add('error', 'Lap ' + l.n + ' heart rate is out of range.');
    });
    if ((a.laps || []).length) {
      const ld = a.laps.reduce((t, l) => t + l.distance_km, 0);
      const lt = a.laps.reduce((t, l) => t + l.time_s, 0);
      if (a.distance_km && Math.abs(ld - a.distance_km) / a.distance_km > 0.02)
        add('warn', 'Laps total ' + ld.toFixed(2) + ' km against ' + a.distance_km + ' km.');
      if (a.elapsed_s && Math.abs(lt - a.elapsed_s) > 30)
        add('warn', 'Laps total ' + Calc.fmtDuration(lt) + ' against ' + Calc.fmtDuration(a.elapsed_s) + '.');
    }
    return flags;
  }

  /* ------------------------------------------------- replace from paste */

  function renderReplace(id) {
    const a = Store.byId(id);
    if (!a) { go('home'); return; }

    let h = '<div class="back" data-back="1">\u2190 Cancel</div>';
    h += '<div class="ttl">Replace from paste</div><div class="sub">' + esc(a.name.toUpperCase()) + '</div>';
    h += '<div class="small muted" style="margin-top:12px">Paste a full table or just the lap ' +
      'rows. Anything the paste leaves out keeps its current value; a field written as ' +
      '\u2014 is cleared. Your name, source and notes are never touched.</div>';
    h += '<label><span>Paste</span><textarea id="r-paste" placeholder="Paste the table, or only the lap rows."></textarea></label>';
    h += '<button class="btn" id="r-read">Read it</button>';
    h += '<div id="r-preview"></div>';

    el('view-replace').innerHTML = h;
    document.querySelectorAll('#view-replace [data-back]').forEach(b => b.onclick = () => go('detail', id));

    el('r-read').onclick = () => {
      const text = el('r-paste').value;
      if (!text.trim()) return;
      const p = Parse.parse(text, { today: today() });
      const merged = Parse.mergeInto(a, p);
      const flags = Parse.validateMerge(a, p);
      const errors = flags.filter(f => f.level === 'error');

      let ph = '<div class="rule"></div><div class="sec"><span>What changes</span><span>' +
        merged.changes.length + '</span></div>';
      if (!merged.changes.length) ph += '<div class="empty-state">Nothing in that paste differs from the record.</div>';
      merged.changes.forEach(ch => {
        ph += '<div class="diff"><div class="dk">' + esc(ch.field) + '</div>' +
          '<div class="dv"><s>' + esc(ch.from == null ? '\u2014' : ch.from) + '</s> \u2192 ' +
          '<b>' + esc(ch.to == null ? '\u2014' : ch.to) + '</b></div></div>';
      });
      flags.forEach(f => {
        ph += '<div class="flag ' + (f.level === 'error' ? 'error' : f.level === 'info' ? 'info' : '') +
          '"><i>' + (f.level === 'error' ? '\u2715' : f.level === 'info' ? 'i' : '!') + '</i><div>' +
          esc(f.msg) + '</div></div>';
      });
      ph += '<button class="btn" id="r-save"' +
        (errors.length || !merged.changes.length ? ' disabled' : '') + '>Apply these changes</button>';
      el('r-preview').innerHTML = ph;

      const save = el('r-save');
      if (save && !save.disabled) save.onclick = () =>
        Store.put(merged.activity).then(() => go('detail', id));
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

  const VIEWS = ['home', 'detail', 'import', 'settings', 'edit', 'replace'];

  function go(view, param) {
    VIEWS.forEach(v => { el('view-' + v).hidden = (v !== view); });
    el('worlds').hidden = (view !== 'home');
    el('fab').hidden = (view !== 'home' && view !== 'detail');
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    if (view === 'detail') renderDetail(param);
    if (view === 'import') renderImport();
    if (view === 'settings') renderSettings();
    if (view === 'edit') renderEdit(param);
    if (view === 'replace') renderReplace(param);
  }

  document.querySelectorAll('#worlds button').forEach(b => {
    b.onclick = () => { setWorld(b.dataset.world); go('home'); };
  });
  el('fab').onclick = () => go('import');

  /* The add button floats over whatever row happens to be beneath it. Tuck it
     away while you're scrolling down through content, bring it back the moment
     you stop or scroll up. */
  (function () {
    const fab = el('fab');
    let last = 0, idle = null;
    window.addEventListener('scroll', function () {
      const y = window.scrollY || 0;
      const down = y > last + 4;
      const up = y < last - 4;
      if (down) fab.classList.add('tucked');
      else if (up) fab.classList.remove('tucked');
      last = y;
      clearTimeout(idle);
      idle = setTimeout(() => fab.classList.remove('tucked'), 550);
    }, { passive: true });
  })();

  Store.init().then(() => { setWorld('run'); go('home'); });

  window.Groundwork = { go: go, setWorld: setWorld };

})();
