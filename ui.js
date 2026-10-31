/* ui.js — rendering and interaction. All maths lives in calc.js.
   Runs only. Hiking and Body were stripped out; the full version is in the
   repo history if either needs to come back. */

(function () {
  'use strict';

  const SCOPES = ['week', 'month', 'year'];
  const RIBBON = 12;

  let scope = 'week';
  let periodKey = null;      // null = current period
  let draft = null;

  const el = id => document.getElementById(id);
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ZCOL = { 1: 'var(--z1)', 2: 'var(--z2)', 3: 'var(--z3)', 4: 'var(--z4)', 5: 'var(--z5)' };
  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* The clock, behind one function. Tests pin it so they don't rot the moment
     the calendar moves past the fixture dates. */
  const today = () => window.__GW_TODAY || new Date().toISOString().slice(0, 10);

  function fmtDate(d) {
    const [y, m, day] = d.split('-');
    const base = (+day) + ' ' + MON[+m - 1];
    return (+y === new Date().getFullYear()) ? base : base + ' ' + y;
  }

  /* Only records the screens can actually draw. A damaged one used to throw
     mid-render and leave a blank page with no route back to Setup. */
  function real() { return Store.all().filter(a => a.type === 'run' && Calc.isUsable(a)); }
  function key() { return periodKey || Calc.periodKey(today(), scope); }

  /* ---------------------------------------------------------------- pieces */

  function stripHTML(a, bounds, tall) {
    const laps = Calc.fullLaps(a.laps);
    if (!laps.length) return '';
    return '<div class="strip' + (tall ? ' tall' : '') + '">' + laps.map(l => {
      const z = Calc.zoneOf(l.avg_hr, bounds);
      return '<div class="blk' + (z ? '' : ' unknown') + '" style="background:' +
        (z ? ZCOL[z] : 'var(--stop)') + '" title="km ' + l.n + ' \u00b7 ' +
        (l.avg_hr == null ? 'no HR' : l.avg_hr + ' bpm') + '"></div>';
    }).join('') + '</div>';
  }


  /* The bar decides for itself whether it has anything to show. Every caller
     used to make that judgement separately and they disagreed: the period view
     checked zoned time, the detail screen checked total time, so a run with
     laps but no heart rate drew a bar made entirely of "unknown". */
  /* The bar shows the split of time whose zone is KNOWN, and nothing else.

     It used to include unknown time in the denominator while `z2Of` did not,
     so one screen showed the same 24:59 as "12%" in the bar and "71% in Z2" in
     the caption underneath. Unknown time is not a zone; how much of the period
     it covers is reported in words, where it can be explained. */
  function zoneBarHTML(tz) {
    const zoned = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0);
    if (!zoned) return '';

    const MIN_SHARE = 0.07;
    const zones = [1,2,3,4,5].filter(z => tz[z] > 0);
    /* rounded together, so the segments always total 100 — rounded apart they
       came to 95 and 101 on real data */
    const pcts = Calc.sharesOf(zones.map(z => tz[z]), zoned);

    const parts = zones.map((z, i) => {
      const wide = tz[z] / zoned >= MIN_SHARE;
      return '<div class="zseg' + (z === 2 ? ' z2' : '') + '" style="background:' + ZCOL[z] +
        '; flex:' + tz[z] + '" title="' + Calc.fmtDuration(tz[z]) + ' \u00b7 ' + pcts[i] + '%">' +
        (wide ? '<b>' + pcts[i] + '%</b><s>' + Calc.fmtDuration(tz[z]) + '</s>' : '') + '</div>';
    });
    return '<div class="zbar tall">' + parts.join('') + '</div>';
  }


  /* The legend carries each zone's share when there is one, because a segment
     under seven percent is too narrow to label and the visible numbers then
     fail to reach a hundred — which reads exactly like a rounding bug. */
  function zoneKeyHTML(b, tz) {
    let pct = null;
    if (tz) {
      const zoned = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0);
      if (zoned) {
        const all = [1,2,3,4,5];
        const shares = Calc.sharesOf(all.map(z => tz[z]), zoned);
        pct = {};
        all.forEach((z, i) => { pct[z] = shares[i]; });
      }
    }
    const share = z => pct ? ' <b>\u00b7 ' + pct[z] + '%</b>' : '';
    const z5 = pct && pct[5] > 0
      ? '<span><i style="background:var(--z5)"></i>Z5' + share(5) + '</span>' : '';

    return '<div class="zkey">' +
      '<span><i style="background:var(--z1)"></i>Z1 &lt;' + b.z2 + share(1) + '</span>' +
      '<span class="key-z2"><i style="background:var(--z2)"></i>Z2 ' + b.z2 + '\u2013' + (b.z3 - 1) + share(2) + '</span>' +
      '<span><i style="background:var(--z3)"></i>Z3 ' + b.z3 + '\u2013' + (b.z4 - 1) + share(3) + '</span>' +
      '<span><i style="background:var(--z4)"></i>Z4 ' + b.z4 + '+' + share(4) + '</span>' +
      z5 + '</div>';
  }

  function metric(label, value, unit, caption, pending) {
    return '<div><div class="g-l">' + esc(label) + '</div>' +
      '<div class="g-v' + (pending ? ' pending' : '') + '">' + esc(value) +
      (unit ? '<s>' + esc(unit) + '</s>' : '') + '</div>' +
      (caption ? '<div class="g-c">' + esc(caption) + '</div>' : '') + '</div>';
  }

  /* aside is text, escaped; pass { html } for markup built here (a delta) */
  function cmp(k, v, aside, id) {
    return '<div class="cmp"' + (id ? ' data-id="' + esc(id) + '"' : '') + '><span class="k">' + esc(k) + '</span><span class="v">' + v +
      (aside ? '<s>' + (aside.html != null ? aside.html : esc(aside)) + '</s>' : '') + '</span></div>';
  }

  /* Reads the model. The zone split per bar arrives with it, so this function
     has no way to disagree with the rest of the screen about what a period
     contains. */
  function ribbonHTML(m, bounds) {
    if (scope === 'all') return '';
    const bars = m.ribbon;
    const max = Math.max.apply(null, bars.map(b => b.value).concat([1]));

    const label = b => {
      if (scope === 'week') return Calc.isoWeek(b.key).split('-W')[1].replace(/^0/, '');
      if (scope === 'month') return MON[+b.key.slice(5) - 1][0];
      return b.key.slice(2);
    };

    const cells = bars.map(b => {
      if (!b.value) return '<div class="rp none" data-period="' + b.key + '"><div class="seg"></div></div>';
      const ht = Math.max(6, Math.round(b.value / max * 100));
      const tz = b.zones || {};
      const zoned = [1,2,3,4,5].reduce((t, z) => t + (tz[z] || 0), 0);
      const zTotal = zoned + (tz.unknown || 0);

      let inner;
      if (!zoned) {
        inner = '<div class="seg nohr" title="no lap heart rate"></div>';
      } else {
        inner = [5,4,3,2,1].filter(z => tz[z] > 0).map(z =>
          '<div class="seg" style="background:' + ZCOL[z] + '; height:' +
          (tz[z] / zTotal * 100).toFixed(1) + '%"></div>').join('');
        if (tz.unknown > 0) inner = '<div class="seg nohr" style="height:' +
          (tz.unknown / zTotal * 100).toFixed(1) + '%"></div>' + inner;
      }
      return '<div class="rp' + (b.selected ? ' on' : '') + '" data-period="' + b.key +
        '" style="height:100%"><div class="stackwrap" style="height:' + ht + '%">' +
        inner + '</div></div>';
    }).join('');

    const labels = bars.map((b, i) =>
      '<div>' + (scope === 'week' ? (i % 2 === 0 || b.selected ? label(b) : '') : label(b)) + '</div>'
    ).join('');

    const unit = scope === 'week' ? 'weeks' : scope === 'month' ? 'months' : 'years';
    const gapLine = m.gapBefore >= 2
      ? '<div class="gapmark">\u2191 nothing for ' + m.gapBefore + ' ' + unit + ' before this</div>' : '';

    const rec = m.record;
    const recLine = rec
      ? '<div class="z2rec"><b>' + rec.cleared + ' of your last ' + rec.of + '</b> ' +
        unit + ' cleared ' + rec.target + '% in Z2.</div>' : '';

    /* a load jump is a training warning; a finished period has nothing to warn */
    const ramp = m.mode === 'live' ? Calc.rampFlag(bars.filter(b => b.value > 0)) : null;
    const rampLine = ramp
      ? '<div class="callout warn">Load went <b>' + ramp.from + ' \u2192 ' + ramp.to +
        '</b>, up ' + Math.round(ramp.change * 100) + '%. Worth knowing, not necessarily wrong.</div>'
      : '';

    /* FITS is how many bars the narrowest phone shows without scrolling */
    const FITS = 13;
    const scrolls = bars.length > FITS ? ' scrolls' : '';
    return '<div class="ribbonwrap' + scrolls + '" id="ribbonwrap">' +
      '<div class="ribbon">' + cells + '</div>' +
      '<div class="rlbl">' + labels + '</div></div>' +
      gapLine + recLine + rampLine;
  }



  /* ------------------------------------------------------------- charts */

  /* Line chart from one or more segments of {value} points.
     invert: true plots smaller values higher (used for pace, where faster is
     better) so a rising line always means improvement. */
  /* Line chart over one or more segments. A training gap is drawn as a gutter
     inside a single plot — never a second panel with its own axis. */
  /* A line chart placed in TIME.

     Points used to be spaced by index with a minimum width per block, which
     inverted the moment there were several small blocks: three single-run
     blocks took 12% of the width each while a fourteen-run block took 5%, and
     the gutters between them took 35%. The chart described how the data was
     grouped rather than the running.

     Now x is the date. A gap is blank because nothing happened then, which is
     the honest picture and needs no gutter at all. */
  /* What an aerobic-pace chart leaves out, said once for every chart. */
  function leftOutText(L) {
    if (!L || (!L.races && !L.tests && !L.trail && !L.locked)) return '';
    const parts = [];
    if (L.races) parts.push(L.races + ' race' + (L.races === 1 ? '' : 's'));
    if (L.tests) parts.push(L.tests + ' test' + (L.tests === 1 ? '' : 's'));
    if (L.trail) parts.push(L.trail + ' trail run' + (L.trail === 1 ? '' : 's'));
    if (L.locked) parts.push(L.locked + ' run' + (L.locked === 1 ? '' : 's') + ' whose heart rate followed cadence');
    return '. ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) +
      ' left out \u2014 ' + (parts.length > 1 ? 'none is' : 'not') + ' a measurement of aerobic pace';
  }

  function lineChart(segments, opt) {
    opt = opt || {};
    const all = [].concat.apply([], segments).map(p => p.value).filter(v => v != null);
    if (all.length < 1) return null;

    const dates = [].concat.apply([], segments).map(p => p.date)
      .filter(d => !isNaN(new Date(d + 'T12:00:00').getTime())).sort();
    const t0 = new Date((opt.from || dates[0]) + 'T12:00:00').getTime();
    const t1 = new Date((opt.to || dates[dates.length - 1]) + 'T12:00:00').getTime();
    const spanMs = Math.max(1, t1 - t0);
    const xOf = d => {
      const t = new Date(d + 'T12:00:00').getTime();
      return Math.max(0, Math.min(100, (t - t0) / spanMs * 100));
    };

    let lo = opt.min != null ? opt.min : Math.min.apply(null, all);
    let hi = opt.max != null ? opt.max : Math.max.apply(null, all);
    if (hi === lo) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    const extra = pad * 0.6;
    if (opt.invert) { lo -= pad + extra; hi += pad; }
    else { lo -= pad; hi += pad + extra; }
    /* a stated floor (0 km) is the floor, not padded below */
    if (opt.min != null && !opt.invert) lo = opt.min;
    const yOf = v => {
      const t = (v - lo) / (hi - lo);
      return opt.invert ? t * 100 : 100 - t * 100;
    };

    const dots = [], endLabels = [];
    let svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" height="' +
      (opt.height || 150) + '" role="img" aria-label="' + esc(opt.label || 'chart') + '">';

    if (opt.mark != null) {
      const my = yOf(opt.mark).toFixed(2);
      svg += '<line x1="0" y1="' + my + '" x2="100" y2="' + my + '" stroke="var(--z2)" ' +
        'stroke-width=".7" stroke-dasharray="3 3" opacity=".75" vector-effect="non-scaling-stroke"/>';
    }
    if (opt.band && isFinite(yOf(opt.band.lo)) && isFinite(yOf(opt.band.hi))) {
      const a = yOf(opt.band.hi), b = yOf(opt.band.lo);
      svg += '<rect x="0" y="' + Math.min(a, b).toFixed(2) + '" width="100" height="' + Math.abs(b - a).toFixed(2) +
        '" fill="var(--z2)" opacity=".1"/>';
    }
    svg += '<g stroke="#2B383C" stroke-width=".4" vector-effect="non-scaling-stroke">' +
      '<line x1="0" y1="2" x2="100" y2="2"/><line x1="0" y1="50" x2="100" y2="50"/>' +
      '<line x1="0" y1="98" x2="100" y2="98"/></g>';

    const last = segments.length - 1;
    segments.forEach((seg, si) => {
      /* in a review no block is "this block" — the whole period is the subject */
      const lead = opt.uniform || si === last;
      const col = lead ? 'var(--z2)' : 'var(--mute)';
      const w = lead ? 2.2 : 1.6;
      /* a point that can't be placed is left out; one NaN would end the whole line there */
      seg = seg.filter(p => isFinite(xOf(p.date)) && isFinite(yOf(p.value)));
      if (!seg.length) return;
      const pts = seg.map(p => xOf(p.date).toFixed(2) + ',' + yOf(p.value).toFixed(2));

      if (seg.length > 1) {
        svg += '<polyline class="draw" fill="none" stroke="' + col + '" stroke-width="' + w +
          '" vector-effect="non-scaling-stroke" points="' + pts.join(' ') + '"/>';
      } else {
        /* A block of one run has no line to draw. The marker goes in the HTML
           layer, not the SVG: the viewBox is stretched to the plot's width, so
           a <circle> in here comes out as a wide ellipse and reads as a smudge. */
        dots.push({ x: xOf(seg[0].date), y: yOf(seg[0].value),
                    cls: si === last ? 'now' : 'prev', r: 4 });
      }
      if (si === last) {
        const p = seg[seg.length - 1];
        dots.push({ x: xOf(p.date), y: yOf(p.value), cls: 'tip', r: 5 });
      }
      /* each line can carry its own name at its end (which year is which grey) */
      if (opt.endLabels && opt.endLabels[si] != null) {
        const p = seg[seg.length - 1];
        endLabels.push({ x: xOf(p.date), y: yOf(p.value), text: opt.endLabels[si], lead: lead });
      }
    });
    svg += '</svg>';

    const dotHTML = dots.map(d =>
      '<i class="cdot ' + d.cls + '" style="left:' + d.x.toFixed(2) + '%; top:' +
      d.y.toFixed(2) + '%; width:' + d.r + 'px; height:' + d.r + 'px"></i>').join('');

    const fmt = opt.format || (v => Math.round(v));
    const best = opt.min != null && !opt.invert ? opt.min : Math.min.apply(null, all), worst = Math.max.apply(null, all);
    const anchors = opt.invert ? [best, worst] : [worst, best];
    const axis = anchors.map((v, i) =>
      '<span style="top:' + yOf(v).toFixed(1) + '%">' + fmt(v) +
      (opt.anchorLabels ? '<em>' + opt.anchorLabels[i] + '</em>' : '') + '</span>').join('');

    return '<div class="chart"><div class="cwrap">' +
      '<div class="cplot">' + svg + dotHTML + endLabels.map(l =>
        '<b class="cend' + (l.lead ? ' lead' : '') + '" style="left:' + l.x.toFixed(2) + '%; top:' + l.y.toFixed(2) + '%">' +
        esc(l.text) + '</b>').join('') + '</div>' +
      '<div class="yax" style="height:' + (opt.height || 150) + 'px">' + axis + '</div></div>' +
      (opt.xax ? '<div class="xax">' + opt.xax.map(s => '<span>' + esc(s) + '</span>').join('') + '</div>' : '') +
      (opt.legend ? '<div class="legend">' + opt.legend + '</div>' : '') + '</div>';
  }


  /* `as` comes from the metric, never from the call site. Leaving the choice
     to each renderer meant percentage was the default, so drift improving by
     fifteen beats read as "100%". */
  function deltaHTML(d, as) {
    if (!d || d.dir === 'flat') return '';
    const arrow = d.dir === 'up' ? '\u25b2' : '\u25bc';
    const cls = d.tone === 'good' ? 'good' : d.tone === 'bad' ? 'bad' : 'neutral';
    return '<span class="delta ' + cls + '">' + arrow + ' ' + Calc.deltaText(d, as) + '</span>';
  }






  /* ------------------------------------------------------- the paste box ---

     One component, two screens. The clipboard button existed on the import
     screen and not on Replace, which is the same mistake this app keeps
     making: a thing built once at one call site. A paste box is now a paste
     box wherever it appears. */

  function pasteBoxHTML(id, label, placeholder) {
    return '<label><span>' + esc(label) + '</span><div class="pastewrap">' +
      '<textarea id="' + id + '" placeholder="' + esc(placeholder) + '"></textarea>' +
      '<button class="clear" id="' + id + '-clear" type="button" aria-label="Clear">\u2715</button>' +
      '</div></label>' +
      '<button class="btn ghost" id="' + id + '-from" hidden>Paste from clipboard</button>';
  }

  /* Wires both buttons. `onRead` runs after a successful clipboard paste, so a
     tap reads and parses in one go. */
  function bindPasteBox(id, onClear, onRead) {
    const box = el(id), clear = el(id + '-clear'), from = el(id + '-from');
    if (!box) return;

    const sync = () => { if (clear) clear.hidden = !box.value.length; };
    box.addEventListener('input', sync);
    sync();

    if (clear) clear.onclick = () => {
      box.value = '';
      sync();
      if (onClear) onClear();
      box.focus();
    };

    if (from && navigator.clipboard && navigator.clipboard.readText) {
      from.hidden = false;
      once(from, 'Reading\u2026', () =>
        navigator.clipboard.readText().then(text => {
          if (!text || !text.trim()) { toast('Clipboard is empty', 'bad'); return; }
          box.value = text;
          sync();
          if (onRead) onRead();
        }).catch(() => { toast('Could not read the clipboard', 'bad'); }));
    }
  }

  /* ------------------------------------------------------- feedback ----- */

  /* A confirmation you can't miss. Actions used to complete in silence, which
     is how a run got added twice. */
  function toast(msg, tone) {
    let t = el('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.className = 'show' + (tone ? ' ' + tone : '');
    t.textContent = msg;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.className = ''; }, 2600);
  }

  /* Runs an async action once: the button goes busy, and a second tap while
     it's in flight does nothing. Disabling alone doesn't stop a fast
     double-tap, so the in-flight flag is the real guard. */
  function once(btn, busyLabel, fn) {
    if (!btn) return;
    btn.onclick = function () {
      if (btn._busy) return;
      btn._busy = true;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = busyLabel;
      /* call straight away rather than on a microtask — validation messages
         should appear on the same tap, not a frame later */
      let result;
      try { result = fn(); }
      catch (err) { toast(String(err && err.message || err), 'bad'); }
      Promise.resolve(result)
        .catch(err => { toast(String(err && err.message || err), 'bad'); })
        .then(() => {
          btn._busy = false;
          if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = label; }
        });
    };
  }


  /* ------------------------------------------------------------ week strip */

  /* ------------------------------------------------------------ week strip */

  /* Seven days, height is load, colour is the zone that day mostly sat in.
     Answers "am I being consistent" and "how hard was it" in one row. */
  function weekStripHTML(m) {
    const days = m.days;
    if (!days || !days.some(d => d.count)) return '';
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
    h += '<div class="est">' + out + ' of 7 days, load ' + total + '.</div>';
    return h;
  }




  /* ---------------------------------------------------------- the read */

  /* "1 days / week" is the kind of thing that makes an app feel unfinished. */
  function unitFor(r) {
    if (r.unit === 'days / week' && Math.round(r.now) === 1) return 'day / week';
    return r.unit;
  }

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

  function readHTML(m) {
    const cfg = Store.config();
    const rows = m.form.rows;
    const isNow = m.period.isCurrent;
    if (!rows.length) return '';

    const live = rows.filter(r => r.range && r.now != null);
    const waiting = rows.filter(r => !(r.range && r.now != null));

    const filling = live.filter(r => r.need > 0).length;
    let h = '<div class="sec"><span>Form' + (m.form.label ? ' \u00b7 ' + esc(m.form.label) : '') +
      '</span><span>' +
      (filling ? filling + ' still filling' : live.length ? 'last 3 vs 3 before' : '') +
      '</span></div>';

    live.forEach(r => {
      /* A drift range of +2 to -2 sits entirely inside what the app itself
         calls flat. Drawing a scale across it claims a resolution that isn't
         there, so it reports flat and draws nothing until the spread is real. */
      if (r.key === 'drift' && Math.abs(r.range.max) <= Calc.DRIFT_FLAT &&
          Math.abs(r.range.min) <= Calc.DRIFT_FLAT) {
        h += '<div class="rd"><div class="rd-top"><div class="rd-name">' + esc(r.label) +
          '</div><div class="rd-val">flat<s>on all ' + r.n + '</s></div></div>' +
          '<div class="rd-note">Every measurement is inside ' + Calc.DRIFT_FLAT +
          ' bpm. A scale across that would be noise.</div></div>';
        return;
      }
      const d = r.need === 0 ? Calc.delta(r.now, r.prev, r.betterWhen, r.neverBad) : null;
      const pos = trackPos(r.now, r.range, r.betterWhen);
      const bandFrom = r.band ? trackPos(r.betterWhen === 'down' ? r.band.max : r.band.min, r.range, r.betterWhen) : null;
      const bandTo = r.band ? trackPos(r.betterWhen === 'down' ? r.band.min : r.band.max, r.range, r.betterWhen) : null;
      const worst = r.betterWhen === 'down' ? r.range.max : r.range.min;
      const best = r.betterWhen === 'down' ? r.range.min : r.range.max;

      h += '<div class="rd">';
      h += '<div class="rd-top"><div class="rd-name">' + esc(r.label) + '</div><div class="rd-val">' +
        fmtRead(r.now, r.kind) + (r.unit ? '<s>' + esc(unitFor(r)) + '</s>' : '') +
        (d ? ' ' + deltaHTML(d, r.deltaAs) : '') +
        '</div></div>';
      h += '<div class="track' + (r.need ? ' off' : '') + '"><div class="line"></div>' +
        (bandFrom != null && bandTo != null && Math.abs(bandTo - bandFrom) > 0.5
          ? '<div class="band" style="left:' + Math.min(bandFrom, bandTo).toFixed(1) +
            '%; width:' + Math.abs(bandTo - bandFrom).toFixed(1) + '%"></div>' : '') +
        '<div class="dot' + (r.need ? ' off' : '') + '" style="left:' + pos.toFixed(1) + '%"></div></div>';
      h += '<div class="rd-ends"><span>' + (r.window ? esc(r.window) + ' \u00b7 ' : '') +
        fmtRead(worst, r.kind) +
        (r.worstLabel ? ' ' + esc(r.worstLabel) : '') + '</span><span>' +
        fmtRead(best, r.kind) + (r.bestLabel ? ' ' + esc(r.bestLabel) : '') + '</span></div>';
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

  /* ---------------------------------------------------- sync with Garmin */

  /* Runs the Apps Script's hourly check now (new runs, resting HR, HRV, zones)
     and pulls. From the home screen's line, or by pulling down on home or
     Progress. */
  let syncing = false;
  function syncGarmin() {
    if (syncing || !Store.sheetsConfigured()) return;
    syncing = true;
    const b = el('h-sync'); if (b) { b.disabled = true; b.textContent = 'syncing\u2026'; }
    toast('Syncing with Garmin\u2026');
    Store.checkGarmin().then(st => {
      syncing = false;
      render(el('view-resting').hidden ? 'home' : 'resting');
      promptNewRuns();
      toast(st && st.state === 'ok' ? 'Up to date with Garmin' : 'Garmin sync failed \u2014 see Setup', st && st.state === 'ok' ? 'ok' : 'bad');
    }).catch(() => { syncing = false; render('home'); toast('Couldn\u2019t reach the sheet', 'bad'); });
  }

  /* pull down at the top of home or Progress to sync */
  (function () {
    let y0 = null;
    document.addEventListener('touchstart', e => {
      const v = !el('view-home').hidden || !el('view-resting').hidden;
      y0 = v && (window.scrollY || 0) <= 0 ? e.touches[0].clientY : null;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      y0 = null;
      if (dy > 90) syncGarmin();
    }, { passive: true });
  })();

  /* ------------------------------------------------------------- tagging --- */

  /* Session and terrain chips, saved on tap. The app's guess is outlined and
     never applied by itself. */
  function tagChipsHTML(a, pfx) {
    const S = Calc.suggestTags(a, Store.config());
    const chip = (kind, key, label, on, sugg) => '<button class="chip' + (sugg && !on ? ' sugg' : '') + '" type="button" data-' + kind +
      '="' + key + '" aria-pressed="' + on + '">' + label + '</button>';
    return '<div class="tags" id="' + pfx + '-tags"><div class="bar wrap">' +
      Calc.SESSIONS.filter(x => x.key !== 'test' || a.session === 'test')
        .map(x => chip('ts', x.key, x.label, a.session === x.key, S.session === x.key)).join('') +
      '</div><div class="bar wrap">' +
      [['road', 'Road'], ['trail', 'Trail'], ['mixed', 'Mixed']].map(t =>
        chip('tt', t[0], t[1], Calc.terrainOf(a) === t[0], S.terrain === t[0])).join('') +
      '</div>' + (S.session && !a.session ? '<div class="est">' + (Calc.autoSession(a, Store.config(), dismissedTags())
        ? 'Auto-tagged as ' + Calc.sessionLabel(Calc.autoSession(a, Store.config(), dismissedTags())).toLowerCase() +
          ' \u2014 the app\u2019s guess, outlined. Tap any tag to set your own.'
        : 'Outlined: the app\u2019s guess. Tap to confirm.') + '</div>' : '') + '</div>';
  }

  /* The run's tags as one line under its date: "TEMPO · ROAD · Edit". With
     no tag yet, the guess with a one-tap confirm. Edit opens the chips in a
     card from the bottom, the same card new runs use. */
  function tagLineHTML(a) {
    const auto = Calc.autoSession(a, Store.config(), dismissedTags());
    const guess = !a.session ? Calc.suggestTags(a, Store.config()).session : null;
    let first;
    if (a.session) first = '<b>' + esc(Calc.sessionLabel(a.session).toUpperCase()) + '</b>';
    else if (auto) first = '<b>' + esc(Calc.sessionLabel(auto).toUpperCase()) + '</b> <em>auto</em>';
    else if (guess && guess !== 'race' && guess !== 'test') first = '<button type="button" class="tconfirm" data-tc="' + guess + '">' +
      esc(Calc.sessionLabel(guess)) + '? \u2713</button>';
    else first = '<em>untagged</em>';
    return '<div class="tagline" id="d-tagline">' + first + ' <span>\u00b7</span> <b>' +
      esc(Calc.terrainOf(a).toUpperCase()) + '</b> <button type="button" class="tedit" id="d-tedit">Edit</button></div>';
  }

  /* What the run achieved, strongest first: four lines, the rest behind "more". */
  function resultsHTML(a, max) {
    const R = Calc.runResults(a, Store.all());
    if (!R.length) return '';
    const n = max || 4;
    const line = r => '<div class="res lv' + Math.floor(r.level) + '"' + (r.km ? ' data-km="' + r.km + '"' : '') + '>' + esc(r.text) + '</div>';
    return '<div class="results"' + (max ? '' : ' id="d-results"') + '>' + R.slice(0, n).map(line).join('') +
      (R.length > n ? (max ? '' : '<button type="button" class="tplink resmore">+' + (R.length - n) + ' more</button><div class="resrest" hidden>' + R.slice(n).map(line).join('') + '</div>') : '') + '</div>';
  }

  function bindResults(scope) {
    document.querySelectorAll(scope + ' .res[data-km]').forEach(r => { r.style.cursor = 'pointer'; r.onclick = () => go('bestdist', r.dataset.km); });
    const more = $(scope + ' .resmore');
    if (more) more.onclick = () => { $(scope + ' .resrest').hidden = false; more.remove(); };
  }

  function bindTagLine(a) {
    const c = $('#d-tagline [data-tc]');
    if (c) c.onclick = () => { toast('Saved \u00b7 ' + Calc.sessionLabel(c.dataset.tc), 'ok');
      Store.putQuick(Object.assign({}, a, { session: c.dataset.tc, updated_at: new Date().toISOString() })).then(() => renderDetail(a.id)); };
    el('d-tedit').onclick = () => openTagCard(a);
  }

  function openTagCard(a) {
    const box = el('tagprompt');
    box.innerHTML = '<div class="tpcard"><div class="tphead">' + esc(a.name) + '</div>' + tagChipsHTML(a, 'x') +
      '<div class="tpbtns"><button type="button" class="btn ghost" id="x-done">Done</button></div>' +
      '<button type="button" class="tplink" id="x-edit">Edit run \u2192</button></div>';
    box.hidden = false;
    const close = () => { box.hidden = true; box.innerHTML = ''; };
    bindTagChips(a, 'x', next => { renderDetail(next.id); if (next.session !== a.session) close(); else openTagCard(next); });
    el('x-done').onclick = close;
    el('x-edit').onclick = () => { close(); go('edit', a.id); };
  }

  function bindTagChips(a, pfx, after) {
    /* instant: the chip lights at once, a toast confirms, the sheet is told in the background */
    const save = (patch, btn) => {
      const next = Object.assign({}, a, patch, { updated_at: new Date().toISOString() });
      if (btn) { btn.parentNode.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false')); btn.setAttribute('aria-pressed', 'true'); }
      const word = patch.session !== undefined ? (patch.session ? Calc.sessionLabel(patch.session) : 'untagged') : patch.terrain ? patch.terrain[0].toUpperCase() + patch.terrain.slice(1) : '';
      toast('Saved \u00b7 ' + word, 'ok');
      Store.putQuick(next).then(() => after && after(next));
    };
    document.querySelectorAll('#' + pfx + '-tags [data-ts]').forEach(b => {
      b.onclick = () => save({ session: a.session === b.dataset.ts ? null : b.dataset.ts }, b);
    });
    document.querySelectorAll('#' + pfx + '-tags [data-tt]').forEach(b => {
      b.onclick = () => save({ terrain: b.dataset.tt }, b);
    });
  }

  /* Runs you've told the app to leave untagged ("not this one"). A UI
     choice, kept on this phone. */
  const DISMISS_KEY = 'groundwork:tag-dismissed';
  function dismissedTags() { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}'); } catch (e) { return {}; } }
  function dismissTag(id) { const d = dismissedTags(); d[id] = 1; localStorage.setItem(DISMISS_KEY, JSON.stringify(d)); }

  /* New runs from Garmin, asked about when they arrive: on opening the app
     and after a sync. "Later" puts the card away until the app is next
     opened; "not this one" leaves the run untagged for good (it then gets
     an auto guess like older runs). */
  let laterThisVisit = {};
  function newUntagged() {
    const d = dismissedTags();
    return Store.all().filter(a => a.type === 'run' && !a.session && a.date >= Calc.AUTO_TAG_BEFORE && !d[a.id] && !laterThisVisit[a.id])
      .sort((x, y) => x.date.localeCompare(y.date));
  }

  function promptNewRuns() {
    const box = el('tagprompt');
    if (!box) return;
    const left = newUntagged();
    if (!left.length) { box.hidden = true; box.innerHTML = ''; return; }
    const a = left[0];
    box.innerHTML = '<div class="tpcard"><div class="tphead">New run' + (left.length > 1 ? ' \u00b7 1 of ' + left.length : '') + '</div>' +
      '<div class="rvname">' + esc(a.name) + ' <span>\u00b7 ' + fmtDate(a.date) + ' \u00b7 ' + (a.distance_km || 0).toFixed(2) + ' km \u00b7 ' +
      Calc.fmtPace(Calc.paceSecPerKm(a.distance_km, a.elapsed_s)) + '/km' + (a.avg_hr != null ? ' \u00b7 ' + a.avg_hr + ' bpm' : '') + '</span></div>' +
      resultsHTML(a, 2) +
      '<div class="est">What was it?</div>' + tagChipsHTML(a, 'n') +
      '<div class="tpbtns"><button type="button" class="btn ghost" id="n-later">Later</button>' +
      '<button type="button" class="btn ghost" id="n-never">Not this one</button></div>' +
      '<button type="button" class="tplink" id="n-edit">Edit run \u2192</button></div>';
    box.hidden = false;
    /* a session tag closes it (or brings the next); terrain stays, so both can be set */
    bindTagChips(a, 'n', next => { promptNewRuns(); if (!el('view-detail').hidden) renderDetail(next.id); else if (!el('view-home').hidden) render('home'); });
    el('n-later').onclick = () => { laterThisVisit[a.id] = 1; promptNewRuns(); };
    el('n-edit').onclick = () => { laterThisVisit[a.id] = 1; box.hidden = true; box.innerHTML = ''; go('edit', a.id); };
    el('n-never').onclick = () => { dismissTag(a.id); promptNewRuns(); };
  }

  /* ------------------------------------------------------------- splits --- */

  /* A run kilometre by kilometre: bar length is speed, bar colour is that
     kilometre's heart-rate zone, so pace and effort read in one row. */
  function kmSplitsHTML(a, bounds) {
    const S = Calc.splitsOf(a);
    if (!S) return '';
    const span = Math.max(1, S.slow - S.fast);
    const zone = hr => hr == null ? 'none' : hr >= bounds.z5 ? 'z5' : hr >= bounds.z4 ? 'z4' : hr >= bounds.z3 ? 'z3' : hr >= bounds.z2 ? 'z2' : 'z1';
    let h = '<div class="sec"><span>Splits</span><span>' + (S.exact ? 'per kilometre' : 'per lap') + '</span></div><div class="splits">' +
      '<div class="sp head"><span>km</span><span>pace</span><span></span>' + (S.hasElev ? '<span>elev</span>' : '') + '<span>hr</span></div>';
    h += S.rows.map(r => {
      const at = r.end;
      const w = 30 + 70 * (S.slow - r.pace) / span;           // faster is longer
      return '<div class="sp' + (r.n === S.fastest ? ' best' : '') + (r.partial ? ' part' : '') + '">' +
        '<span>' + (Math.abs(at - Math.round(at)) < 0.05 ? Math.round(at) : at.toFixed(1)) + '</span><span>' + Calc.fmtPace(r.pace) + '</span>' +
        '<span><i class="spb" style="width:' + w.toFixed(1) + '%"></i></span>' +
        (S.hasElev ? '<span>' + (r.elev == null ? '' : (r.elev > 0 ? '+' : '') + r.elev) + '</span>' : '') +
        '<span><i class="zd ' + zone(r.hr) + '"></i>' + (r.hr == null ? '\u2013' : r.hr) + '</span></div>';
    }).join('');
    return h + '</div>';
  }

  /* Performance, on Progress: the training sentence, three measures now
     against three months ago, and the occasional notable fact beneath. */
  function progressHTML(P) {
    if (!P || (!P.rows.length && !P.lately.length)) return '';
    let h = '<div class="sec"><span>Performance</span><span>now vs ' + esc(fmtDate(P.thenDate)) + '</span></div>';
    if (P.summary) h += '<div class="psum">' + esc(P.summary) + '</div>';
    if (!P.rows.some(r => r.key === 'aerobic')) h += '<div class="est">Aerobic pace and time in Z2 appear once there are runs to compare on both sides of the three months.</div>';
    const fmtV = (r, v) => r.key === 'aerobic' ? Calc.fmtPace(v) + '/km' : r.key === 'z2' ? Math.round(v) + '%' : v.toFixed(1) + ' km';
    const diff = (r, d) => r.key === 'aerobic' ? Math.round(Math.abs(d)) + ' s/km' : r.key === 'z2' ? Math.round(Math.abs(d)) + ' points' : Math.abs(d).toFixed(1) + ' km';
    const word = (r, up) => r.key === 'aerobic' ? (up ? 'slower' : 'faster') : (up ? 'higher' : 'lower');
    P.rows.forEach(r => {
      const c = r.change;
      let aside;
      if (!c) aside = r.then === 0 ? 'up from nothing then' : 'then ' + fmtV(r, r.then);
      else if (c.same) aside = 'about the same as then (' + fmtV(r, r.then) + ')';
      else aside = { html: '<span class="delta ' + (c.tone || '') + '">' + (c.diff > 0 ? '\u25b2 ' : '\u25bc ') +
        diff(r, c.diff) + ' ' + word(r, c.diff > 0) + '</span> than ' + esc(fmtV(r, r.then)) };
      h += cmp(r.label, fmtV(r, r.now), aside);
    });
    /* the notable facts sit with the measures, no heading of their own */
    if (P.lately.length) h += P.lately.map(w =>
        '<div class="wk ' + (w.tone || '') + '"' + (w.id ? ' data-wid="' + esc(w.id) + '"' : '') +
        (w.go ? ' data-wgo="' + esc(w.go) + '"' : '') + '>' + esc(w.text) + '</div>').join('');
    h += '<div class="est">Each now against the same stretch three months earlier; a change too small to matter reads ' +
      '\u201cabout the same\u201d. Distance is shown without a verdict \u2014 more isn\u2019t automatically better.</div>';
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
      '<div class="cap above" style="left:50%; transform:translateX(-50%)">threshold</div>' +
      '<div class="cap" style="right:0">' + n.ratio.toFixed(1) + '\u00d7</div></div></div>';
  }

  /* ------------------------------------------------------------------ home */

  /* The only place the home screen touches raw activities. Everything below
     reads the model, so no render function can invent its own idea of which
     runs, which window, or whether there is anything to show. That disagreement
     was the single cause of every coherence bug in this app's history. */
  function renderHome() {
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const m = Calc.homeModel(Store.all(), cfg, scope, key(), today());

    let h = '<div class="top"><div>' +
      '<div class="ttl">' + esc(m.period.label) + (m.noHr ? ' <i class="nohrtag">NO HR</i>' : '') + '</div>' +
      '<div class="sub">' + esc(Calc.periodSpan(m.period.key, scope, today())) + '</div>' +
      '</div><div class="corners"><button class="corner" data-go="resting">PROGRESS</button>' +
      '<button class="corner" data-go="bests">BESTS</button>' +
      '<button class="corner" data-go="settings">SETUP</button></div></div>';

    h += '<div class="bar">' + SCOPES.map(s =>
      '<button class="chip" data-scope="' + s + '" aria-pressed="' + (s === scope) + '">' +
      s[0].toUpperCase() + s.slice(1) + '</button>').join('') + '</div>';

    if (!Store.all().some(a => a.type === 'run')) {
      h += '<div class="empty-state">No runs logged yet.<br>' +
        'Tap + to paste your first one.</div>';
      el('view-home').innerHTML = h;
      bind();
      return;
    }

    h += ribbonHTML(m, bounds);
    /* how fresh the Garmin data is, and a way to make it fresher */
    if (Store.sheetsConfigured() && Store.sync.garmin && Store.sync.garmin.state !== 'off') {
      const G = Store.sync.garmin, d = G.at ? new Date(G.at) : null;
      h += '<div class="syncline">' + (d ? 'Garmin synced ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : 'Garmin') +
        ' \u00b7 <button type="button" id="h-sync">Sync now</button></div>';
    }
    if (m.days) h += weekStripHTML(m);
    h += '<div class="rule"></div>';
    h += m.mode === 'review' ? reviewHTML(m, bounds) : runHero(m, bounds, cfg);

    h += '<div class="sec"><span>' +
      (m.period.isCurrent ? 'This ' + scope : esc(m.period.label)) + '</span><span>' +
      (m.count ? m.count + (m.count === 1 ? ' run' : ' runs') : '') + '</span></div>';

    if (!m.count) {
      const prevK = Calc.previousWithData(Store.all().filter(a => a.type === 'run'), scope, m.period.key);
      const nextK = prevK ? null : Calc.nextWithData(Store.all().filter(a => a.type === 'run'), scope, m.period.key);
      let line = '';
      if (prevK) line = '<br>Last run before this: ' + esc(Calc.periodLabel(prevK, scope, today())) + '.';
      else if (nextK) line = '<br>Nothing this early \u2014 your first run lands in ' +
        esc(Calc.periodLabel(nextK, scope, today())) + '.';
      h += '<div class="empty-state">Nothing here.' + line + '</div>';
    } else {
      h += m.runs.map(a => runRow(a, bounds, scope === 'year')).join('');
    }

    el('view-home').innerHTML = h;
    bind();
  }



  /* One hero renderer. A value and its unit are rendered together or not at
     all — "— %" and "—/km" were the same bug written twice, in two places, and
     fixed once. */
  function heroHTML(opts) {
    const has = opts.value != null && opts.value !== '';
    return '<div class="hcol' + (opts.tone ? ' t-' + opts.tone : '') + '">' +
      '<div class="eyebrow">' + esc(opts.label) + '</div>' +
      '<div class="hero"><div class="hnum' + (has ? (opts.numClass ? ' ' + opts.numClass : '')
        : ' pending') + '">' + (has ? opts.value : '\u2014') + '</div>' +
      (has && opts.unit ? '<div class="hunit">' + esc(opts.unit) + '</div>' : '') +
      '</div>' +
      '<div class="hfoot">' + (has ? (opts.foot || '') : esc(opts.needs || '')) + '</div></div>';
  }

  /* Pure presentation. Every value arrives already scoped and already labelled
     with the window it describes; this function cannot choose a different one
     because it is never handed the activities to choose from. */
  function runHero(m, bounds, cfg) {
    const H = m.hero;
    let h = '';

    h += '<div class="heropair">';
    h += heroHTML({
      label: 'Aerobic pace' + (H.pace.window ? ' \u00b7 ' + H.pace.window
        : H.lastRun ? ' \u00b7 ' + fmtDate(H.lastRun.date) : ''),
      value: H.pace.present ? Calc.fmtPace(H.pace.value) : null,
      unit: H.pace.unit,
      foot: 'at ' + Calc.refHr(cfg) + ' bpm' + (H.band
        ? ' ' + deltaHTML(Calc.delta(H.pace.value, H.band.median, 'down'), 'seconds') : ''),
      needs: H.pace.absent
    });
    h += heroHTML({
      label: 'In Z2 \u00b7 ' + (H.z2.window || m.period.word),
      value: H.z2.present ? H.z2.value : null,
      unit: H.z2.unit,
      numClass: 'z2num',
      tone: H.z2.present ? H.z2.tone : null,
      foot: H.z2.present
        ? (m.hero.thin
            ? 'only ' + H.z2.n + (H.z2.n === 1 ? ' run' : ' runs') + ' so far'
            : H.z2.value >= H.target ? 'at your ' + H.target + '% target'
              : (H.target - H.z2.value) + ' under ' + H.target + '%')
        : '',
      needs: H.z2.absent
    });
    h += '</div>';

    if (H.pace.present) {
      h += '<div class="hsub">' + (H.band
        ? 'Your ' + H.band.n + ' other runs around ' + H.lastRun.distance_km.toFixed(1) +
          ' km sit at ' + Calc.fmtPace(H.band.median) + '.'
        : H.previousRun
          ? (m.period.isCurrent ? 'Last run: ' : 'Before it: ') +
            Calc.fmtPace(H.previousRun.pace) + ', over ' +
            H.previousRun.run.distance_km.toFixed(1) +
            ' km \u2014 too different a distance to compare.'
          : 'No other runs near this distance yet.') + '</div>';

      if (H.note) h += '<div class="hnote' + (H.note.tone === 'ok' ? ' good' : '') + '">' +
        '<em>' + esc(m.period.isCurrent ? 'Last run' : fmtDate(H.lastRun.date)) + '</em> ' +
        H.note.text + '</div>';
    }

    if (H.lastRun) h += noticedHTML(H.lastRun);

    /* the trend */
    if (!m.trend.absent) {
      const segs = m.trend.segments;
      h += lineChart(segs, {
        invert: true, mark: m.trend.mark, height: 150,
        from: m.trend.from, to: m.trend.to,
        format: v => Calc.fmtPace(v),
        anchorLabels: ['best', 'slowest'],
        label: 'Aerobic pace across ' + m.trend.shown + ' run' +
          (m.trend.shown === 1 ? '' : 's') + '. Faster is higher.',
        xax: [fmtDate(m.trend.from).toUpperCase(), '', fmtDate(m.trend.to).toUpperCase()],
        legend: '<span><i class="sw now"></i>this block</span>' +
                (segs.length > 1 ? '<span><i class="sw prev"></i>earlier blocks</span>' : '')
      });
      h += '<div class="est">Faster is higher, spaced by date \u2014 a gap is time off' +
        leftOutText(m.leftOut) +
        (m.trend.mark != null ? '. Dashed rule is your previous best, ' +
          Calc.fmtPace(m.trend.mark) : '') +
        '. ' + m.trend.shown + ' run' + (m.trend.shown === 1 ? '' : 's') +
        (m.trend.days >= 2
          ? ' over ' + m.trend.days + ' days'
          : '') + '.</div>';
    }

    h += zonesHTML(m.zones, bounds);

    /* totals */
    const s = m.summary, P = m.previous;
    const dd = (v, p) => deltaHTML(Calc.delta(v, p, null));
    h += '<div class="totals">';
    h += cmp('Distance', s.distance_km.toFixed(2) + ' km ' +
      (P ? dd(s.distance_km, P.summary.distance_km) : ''),
      P ? P.label + ' ' + P.summary.distance_km.toFixed(2) : '');
    h += cmp('Time', Calc.fmtDuration(s.elapsed_s) + ' ' +
      (P ? dd(s.elapsed_s, P.summary.elapsed_s) : ''),
      P ? P.label + ' ' + Calc.fmtDuration(P.summary.elapsed_s) : '');
    h += cmp('Runs', String(s.count), P ? P.label + ' ' + P.summary.count : '');
    if (!P) h += '<div class="est">Nothing logged before this to compare against.</div>';
    h += '</div>';

    h += readHTML(m);
    return h;
  }


  /* Time in zone, once, for both screens. The live one compares against your
     recent typical; a review has no "recent" and passes none. */
  function zonesHTML(Z, bounds) {
    let h = '';
    if (!Z.absent) {
      h += '<div class="sec"><span>Time in zone</span><span>' +
        Calc.fmtDuration(Z.elapsed) + '</span></div>';
      h += zoneBarHTML(Z.tz) + zoneKeyHTML(bounds, Z.tz);
      const missing = Z.elapsed - Z.zoned;
      h += '<div class="est"><b class="z2mark">' + Z.share.pct + '% in Z2 ' + esc(Z.window) +
        '</b>' +
        (Z.typical != null && Math.abs(Z.share.pct - Z.typical) >= 4
          ? ' \u2014 your recent typical is ' + Z.typical + '%'
          : Z.typical != null ? ' \u2014 about your usual' : '') +
        (missing > 30 ? '. From ' + Calc.fmtDuration(Z.zoned) + ' of ' +
          Calc.fmtDuration(Z.elapsed) + ' with lap heart rate' : '') + '.</div>';
    } else if (Z.elapsed) {
      h += '<div class="sec"><span>Time in zone</span><span>' +
        Calc.fmtDuration(Z.elapsed) + '</span></div>';
      h += '<div class="est">None of these runs carried lap heart rate, so there is ' +
        'no zone split for ' + esc(Z.window) + '.</div>';
    }
    return h;
  }

  /* ------------------------------------------------------------- review ---

     A closed period, read as a summary. Pure presentation like runHero: every
     value arrives in the model, already scoped to the period and already
     marked present or absent. Nothing here can reach today, because a
     finished year should read the same whenever you look at it. */

  const EFFORT_NAME = { 0.4: '400 m', 1.609: 'Mile', 21.1: 'Half', 42.2: 'Marathon' };
  const MONTH = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  const effortName = km => EFFORT_NAME[km] || km + ' km';
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  function raceHTML(R, bounds) {
    const a = R.run;
    let h = '<div class="rvrace" data-id="' + esc(a.id) + '">' +
      '<div class="rvname"><i class="racetag">RACE</i> ' + esc(a.name) +
      ' <span>\u00b7 ' + fmtDate(a.date) + ' \u00b7 ' + a.distance_km.toFixed(2) + ' km</span></div>' +
      stripHTML(a, bounds) + '</div>';

    h += cmp('Time', Calc.fmtDuration(a.elapsed_s),
      Calc.fmtPace(R.pace) + '/km' + (R.gap != null ? ' \u00b7 ' + Calc.fmtPace(R.gap) + ' GAP' : ''));
    if (a.avg_hr != null) h += cmp('Heart rate', a.avg_hr + ' bpm',
      R.drift == null ? '' : Calc.driftIsFlat(R.drift) ? 'drift flat'
        : 'drift ' + (R.drift > 0 ? '+' : '') + R.drift);
    /* on a trail or obstacle course the split is the course, not your pacing */
    if (R.halves && Calc.terrainOf(a) === 'road') {
      const H = R.halves;
      h += cmp('Halves', Calc.fmtPace(H.first) + ' \u2192 ' + Calc.fmtPace(H.second),
        H.shape === 'even' ? 'even' : H.shape === 'positive'
          ? Math.abs(H.fade) + ' s/km slower second half'
          : Math.abs(H.fade) + ' s/km faster second half');
    }
    const B = R.build;
    h += cmp(B.days / 7 + ' weeks before', B.count
      ? plural(B.count, 'run') + ' \u00b7 ' + B.distance_km.toFixed(1) + ' km' : 'nothing logged',
      B.count ? 'longest ' + B.longest.distance_km.toFixed(1) + ' km, ' +
        (B.longestWeeksOut <= 1 ? 'race week' : B.longestWeeksOut + ' weeks out') : '');
    h += splitsHTML(R.splits);
    return h;
  }

  /* A race kilometre by kilometre: pace above, heart rate below, on the same
     kilometres, so where one gave way you can see what the other did. The
     chart component takes dates, so each kilometre is handed over as a day. */
  function splitsHTML(S) {
    if (!S || S.length < 4) return '';
    const day = i => { const d = new Date(Date.UTC(2000, 0, 1 + i)); return d.toISOString().slice(0, 10); };
    const pace = lineChart([S.map((k, i) => ({ date: day(i), value: k.pace }))], {
      invert: true, uniform: true, height: 90, format: v => Calc.fmtPace(v), anchorLabels: ['fastest', 'slowest'],
      label: 'Pace each kilometre. Faster is higher.', xax: ['KM 1', '', 'KM ' + S.length] });
    const withHr = S.filter(k => k.hr != null);
    const hr = withHr.length >= 4 ? lineChart([S.map((k, i) => ({ date: day(i), value: k.hr })).filter(p => p.value != null)], {
      uniform: true, height: 70, format: v => Math.round(v) + '', anchorLabels: ['bpm', 'bpm'],
      label: 'Heart rate each kilometre.', from: day(0), to: day(S.length - 1), xax: ['KM 1', '', 'KM ' + S.length] }) : '';
    return '<div class="pl2">Pace each kilometre</div>' + (pace || '') +
      (hr ? '<div class="pl2">Heart rate each kilometre</div>' + hr : '');
  }

  function monthsHTML(M) {
    if (!M || M.absent) return '';
    const max = Math.max.apply(null, M.list.map(m => m.distance_km).concat([1]));
    let h = '<div class="sec"><span>Month by month</span><span>km logged</span></div>';
    h += '<div class="wsb mbars">' + M.list.map(m => {
      if (!m.count) return '<div class="col rest" title="nothing logged"><div class="v"></div></div>';
      const top = M.top && m.key === M.top.key;
      return '<div class="col" title="' + m.distance_km.toFixed(1) + ' km \u00b7 ' +
        plural(m.count, 'run') + '"><div class="v' + (top ? ' top' : '') + '" style="height:' +
        Math.max(8, Math.round(m.distance_km / max * 100)) + '%"></div></div>';
    }).join('') + '</div>';
    h += '<div class="wslbl">' + M.list.map(m => '<div>' + MON[+m.key.slice(5) - 1][0] + '</div>').join('') + '</div>';
    const T = M.top;
    h += '<div class="est">Most logged: <b>' + MONTH[+T.key.slice(5) - 1] + '</b>, ' +
      T.distance_km.toFixed(1) + ' km over ' + plural(T.count, 'run') +
      '. An empty month means nothing logged, not necessarily time off.</div>';
    return h;
  }

  function bestsHTML(B, word) {
    if (!B) return '';
    const when = a => fmtDate(a.date) + (Calc.isRace(a) ? ' \u00b7 race' : '');
    let h = '<div class="sec"><span>Bests</span><span>' + esc(word) + '</span></div>';
    h += cmp('Longest run', B.longest.distance_km.toFixed(2) + ' km', when(B.longest), B.longest.id);
    if (B.longestTraining) h += cmp('Longest outside a race',
      B.longestTraining.distance_km.toFixed(2) + ' km', fmtDate(B.longestTraining.date),
      B.longestTraining.id);
    B.efforts.forEach(e => {
      h += '<div class="cmp' + (e.pb ? ' pb' : '') + '" data-id="' + esc(e.run.id) + '"><span class="k">' +
        (e.pb ? '<i class="pbtag">PB</i> ' : '') + esc(effortName(e.km)) + '</span>' +
        '<span class="v">' + Calc.fmtDuration(e.seconds) + '<s>' + Calc.fmtPace(e.pace) +
        '/km \u00b7 ' + esc(when(e.run)) + '</s></span></div>';
    });
    if (B.aerobic) h += cmp('Best aerobic pace', Calc.fmtPace(B.aerobic.pace) + '/km',
      fmtDate(B.aerobic.run.date), B.aerobic.run.id);
    if (B.efforts.length) h += '<div class="est">Efforts are the fastest stretch of each ' +
      'distance inside a run. PB marks one that still stands as your all-time best.</div>';
    return h;
  }

  /* ------------------------------------------------- the year's pictures */

  function cumulativeHTML(P) {
    if (P.cumulative.length < 2) return '';
    const mine = P.cumulative.find(y => y.year === P.year);
    if (!mine) return '';
    /* this year drawn last, so the chart gives it the colour */
    const order = P.cumulative.filter(y => y.year !== P.year).concat([mine]);
    const chart = lineChart(order.map(y => y.points), {
      height: 160, from: '2000-01-01', to: '2000-12-31', format: v => Math.round(v) + '', min: 0,
      endLabels: order.map(y => "'" + y.year.slice(2)),
      anchorLabels: ['km', 'km'], label: 'Kilometres through the year, every year.',
      xax: ['JAN', 'JUL', 'DEC'] });
    return '<div class="sec"><span>Against your other years</span><span>km through the year</span></div>' + (chart || '') +
      '<div class="mix">' + P.cumulative.map(y => '<span' + (y.year === P.year ? ' class="top"' : '') + '>' +
        esc(y.year) + ' <b>' + y.total + ' km</b></span>').join('') + '</div>' +
      '<div class="est">' + esc(P.year) + ' in colour, the rest in grey, all on one January-to-December line.</div>';
  }

  function scatterHTML(P, bounds) {
    const S = P.scatter;
    if (S.now.length < 3) return '';
    const all = S.now.concat(S.prev);
    const hrLo = Math.floor((Math.min.apply(null, all.map(p => p.hr)) - 3) / 5) * 5;
    const hrHi = Math.ceil((Math.max.apply(null, all.map(p => p.hr)) + 3) / 5) * 5;
    const pLo = Math.min.apply(null, all.map(p => p.pace)), pHi = Math.max.apply(null, all.map(p => p.pace));
    const pad = (pHi - pLo) * 0.08 || 10, yLo = pLo - pad, ySpan = pHi - pLo + 2 * pad;
    const x = hr => Math.max(0, Math.min(100, (hr - hrLo) / (hrHi - hrLo) * 100));
    const y = pace => (pace - yLo) / ySpan * 100;              // faster is higher
    const dot = (p, cls) => '<i class="sd ' + cls + '" data-id="' + esc(p.id) + '" style="left:' + x(p.hr).toFixed(2) +
      '%;top:' + y(p.pace).toFixed(2) + '%"></i>';
    /* your Z2, from the watch's zones, behind everything */
    const z2a = bounds && bounds.z2, z2b = bounds && bounds.z3;
    const band = z2a && z2b && z2b > hrLo && z2a < hrHi
      ? '<div class="sband" style="left:' + x(z2a).toFixed(2) + '%;width:' + (x(z2b) - x(z2a)).toFixed(2) + '%"><span>Z2</span></div>' : '';
    /* a line every 10 bpm, labelled underneath */
    let vlines = '', vlabels = '';
    for (let b = Math.ceil(hrLo / 10) * 10; b <= hrHi; b += 10) {
      vlines += '<i class="sv" style="left:' + x(b).toFixed(2) + '%"></i>';
      vlabels += '<span style="left:' + x(b).toFixed(2) + '%">' + b + '</span>';
    }
    /* four pace marks up the side, on whole quarter-minutes */
    let hlines = '', hlabels = '';
    const step = Math.max(15, Math.ceil((pHi - pLo) / 3 / 15) * 15);
    for (let v = Math.ceil(pLo / step) * step; v <= pHi; v += step) {
      hlines += '<i class="sh" style="top:' + y(v).toFixed(2) + '%"></i>';
      hlabels += '<span style="top:' + y(v).toFixed(2) + '%">' + Calc.fmtPace(v) + '</span>';
    }
    return '<div class="sec"><span>Pace against heart rate</span><span>' + esc(P.year) +
      (S.prev.length ? ' over ' + esc(S.prevYear) : '') + '</span></div>' +
      '<div class="scat"><div class="splot">' + band + vlines + hlines +
      S.prev.map(p => dot(p, 'prev')).join('') + S.now.map(p => dot(p, 'now')).join('') +
      '</div><div class="sya">' + hlabels + '</div></div>' +
      '<div class="sxa">' + vlabels + '<em>bpm</em></div>' +
      '<div class="est">Each dot is a run: heart rate across, pace up (faster is higher). The shaded band is your Z2. ' +
      (S.prev.length ? esc(S.prevYear) + ' in grey behind. A cloud that sits higher at the same heart rate is a fitter year. ' : '') +
      'Races, tests and trail runs left out.</div>';
  }

  /* the year in figures: all from distance and time, so a year recorded
     without heart rate reads as fully as any other */
  function figuresHTML(F) {
    if (!F) return '';
    let h = '<div class="sec"><span>The year</span><span>in figures</span></div>';
    if (F.typical) h += cmp('Typical run', F.typical.km.toFixed(1) + ' km', 'at ' + Calc.fmtPace(F.typical.pace) + '/km');
    if (F.longest) h += '<div class="cmp" data-id="' + esc(F.longest.id) + '"><span class="k">Longest run</span><span class="v">' +
      F.longest.km.toFixed(1) + ' km<s>' + fmtDate(F.longest.date) + ' \u00b7 ' + Calc.fmtPace(F.longest.pace) + '/km</s></span></div>';
    if (F.fastest.length) {
      h += '<div class="sec"><span>Fastest runs</span><span>5 km or more</span></div>';
      h += F.fastest.map(r => '<div class="cmp" data-id="' + esc(r.id) + '"><span class="k">' + fmtDate(r.date) + '</span><span class="v">' +
        Calc.fmtPace(r.pace) + '/km<s>' + r.km.toFixed(1) + ' km</s></span></div>').join('');
    }
    h += '<div class="sec"><span>Consistency</span><span></span></div>';
    h += cmp('Weeks with a run', String(F.weeks), F.streak > 1 ? 'longest streak ' + F.streak + ' weeks' : '');
    if (F.gap) h += cmp('Longest gap', F.gap.days + ' days', fmtDate(F.gap.from) + ' \u2013 ' + fmtDate(F.gap.to));
    const most = Math.max.apply(null, F.lengths.map(l => l.count)) || 1;
    h += '<div class="sec"><span>Run lengths</span><span></span></div><div class="lens">' + F.lengths.map(l =>
      '<div class="len"><span>' + l.label + '</span><span><i style="width:' + (l.count / most * 100).toFixed(1) + '%"></i></span><span>' + l.count + '</span></div>').join('') + '</div>';
    return h;
  }

  function reviewHTML(m, bounds) {
    if (!m.count) return '';
    const s = m.summary, P = m.previous;
    let h = '';


    /* races first: in a finished year they are the headline */
    if (m.races.length) {
      h += '<div class="sec"><span>' + (m.races.length === 1 ? 'Race' : 'Races') +
        '</span><span>' + (m.races.length > 1 ? m.races.length : '') + '</span></div>';
      h += m.races.map(R => raceHTML(R, bounds)).join('');
    }

    /* the period beside the one before: two numbers, never an arrow */
    const had = P && P.summary.count;
    h += '<div class="sec"><span>Logged</span><span>' +
      (had ? 'beside ' + esc(P.label) : '') + '</span></div>';
    h += '<div class="totals">';
    h += cmp('Runs', String(s.count), had ? P.label + ' ' + P.summary.count : '');
    h += cmp('Distance', s.distance_km.toFixed(2) + ' km',
      had ? P.label + ' ' + P.summary.distance_km.toFixed(2) : '');
    h += cmp('Time', Calc.fmtDuration(s.elapsed_s),
      had ? P.label + ' ' + Calc.fmtDuration(P.summary.elapsed_s) : '');
    if (s.ascent_m != null) h += cmp('Ascent', Math.round(s.ascent_m) + ' m',
      had && P.summary.ascent_m != null ? P.label + ' ' + Math.round(P.summary.ascent_m) : '');
    if (had) h += '<div class="est">Side by side rather than as a change \u2014 either total may still be missing runs.</div>';
    h += '</div>';
    h += figuresHTML(m.figures);

    h += monthsHTML(m.months);
    if (m.pictures) h += cumulativeHTML(m.pictures);
    h += bestsHTML(m.bests, m.period.word);

    if (m.mix) {
      h += '<div class="sec"><span>What you mainly did</span><span>' +
        plural(s.count, 'run') + '</span></div>';
      h += '<div class="mix">' + m.mix.map(x =>
        '<span><b>' + x.count + '</b> ' + esc(x.label) + '</span>').join('') + '</div>';
      const E = m.byHr;
      if (E && (E.easy + E.steady + E.hard)) h += '<div class="mix byhr"><span class="lbl">By heart rate</span>' +
        [['easy', E.easy], ['steady', E.steady], ['hard', E.hard]].filter(z => z[1]).map(z =>
          '<span><b>' + z[1] + '</b> ' + z[0] + '</span>').join('') +
        (E.unknown ? '<span><b>' + E.unknown + '</b> no heart rate</span>' : '') + '</div>' +
        '<div class="est">By heart rate alone: easy is 70% or more of the time in Z1\u2013Z2, hard is 30% or more in Z4\u2013Z5. Your tags are untouched.</div>';
    }
    /* a year recorded without heart rate: no empty heart-rate cards */
    if (!m.noHr) h += zonesHTML(m.zones, bounds);

    if (m.paceMonths) {
      const PMo = m.paceMonths;
      h += '<div class="sec"><span>Pace through the year</span><span>month by month</span></div>' +
        (lineChart([PMo.map(p => ({ date: p.date, value: p.value }))], { invert: true, uniform: true, height: 120,
          from: m.period.key + '-01-01', to: m.period.key + '-12-31', format: v => Calc.fmtPace(v), anchorLabels: ['fastest', 'slowest'],
          label: 'The middle pace of each month\u2019s runs.', xax: ['JAN', 'JUL', 'DEC'] }) || '') +
        '<div class="est">The middle pace of each month\u2019s runs. Plain pace, not aerobic pace: without heart rate, ' +
        'effort and terrain aren\u2019t accounted for.</div>';
    }

    if (!m.trend.absent) {
      const T = m.trend;
      h += '<div class="sec"><span>Aerobic pace</span><span>' + esc(m.period.word) + '</span></div>';
      h += lineChart(T.segments, {
        invert: true, uniform: true, height: 150, from: T.from, to: T.to,
        format: v => Calc.fmtPace(v), anchorLabels: ['best', 'slowest'],
        label: 'Aerobic pace across ' + T.shown + ' runs. Faster is higher.',
        xax: [fmtDate(T.from).toUpperCase(), '', fmtDate(T.to).toUpperCase()]
      });
      h += '<div class="est">Faster is higher, spaced by date \u2014 a gap is nothing logged' +
        leftOutText(m.leftOut) +
        '. ' + plural(T.shown, 'run') + (T.days >= 2 ? ' over ' + T.days + ' days' : '') + '.</div>';
    }
    if (m.pictures) h += scatterHTML(m.pictures, bounds);
    return h;
  }

  function runRow(a, bounds, withMonth) {
    const c = Calc.aerobicCost(a);
    const d = Calc.driftOf(a);
    const meta = [];
    const pace = a.gap_pace_s != null ? a.gap_pace_s : Calc.paceSecPerKm(a.distance_km, a.elapsed_s);
    meta.push(Calc.fmtPace(pace) + (a.gap_pace_s != null ? ' GAP' : ''));
    if (a.avg_hr != null) meta.push(a.avg_hr + ' bpm');
    if (d != null) meta.push(Calc.driftIsFlat(d)
      ? '<b class="ok">drift flat</b>'
      : '<b>drift ' + (d >= 0 ? '+' : '') + d + '</b>');
    if (a.temp_c != null) meta.push(a.temp_c + '\u00b0');

    /* magnitude shows in the type: a long run reads as a long run */
    const all = Store.all().filter(x => x.type === a.type).map(x => x.distance_km);
    const top = all.length ? Math.max.apply(null, all) : a.distance_km;
    const scale = top ? Math.min(1, a.distance_km / top) : 0;
    /* body up to strong, so magnitude reads without leaving the scale */
    const size = (13 + scale * 3).toFixed(0);

    return '<div class="rrow" data-id="' + esc(a.id) + '">' +
      '<div class="rtop"><div class="rday">' + DAYS[Calc.dayIndex(a.date)] + ' ' + a.date.slice(8) +
      /* over a whole year "SAT 21" doesn't say which Saturday */
      (withMonth ? '<br>' + MON[+a.date.slice(5, 7) - 1].toUpperCase() : '') + '</div>' +
      '<div class="rnm" style="font-size:' + size + 'px">' +
      (Calc.isRace(a) ? '<i class="racetag">RACE</i> ' : '') + esc(a.name) +
      ' <span>\u00b7 ' + a.distance_km.toFixed(2) + ' km</span></div>' +
      '<div class="rfig">' + (c ? c.value : '\u2014') + '</div></div>' +
      stripHTML(a, bounds) +
      '<div class="rmeta">' + meta.join(' \u00b7 ') + '</div></div>';
  }


  /* --------------------------------------------- against runs this length */

  /* A pace means nothing until you know what it's relative to. Grouped by
     distance within 20%, because a 3 km and a 12 km are not the same job. */
  function bandHTML(a) {
    const P = Calc.lengthPeers(a, Store.all(), Store.config());
    if (!P) return '';
    const mine = P.mine, peers = P.peers, lo = P.lo, hi = P.hi;
    if (!peers.length) return P.ground !== 'road'
      ? '<div class="sec"><span>Against ' + P.ground + ' runs this length</span><span>' + lo.toFixed(1) +
        '\u2013' + hi.toFixed(1) + ' km</span></div><div class="est">No other ' + P.ground + ' run this ' +
        'length yet. A ' + P.ground + ' run is only ranked against ' + P.ground + ' runs.</div>'
      : '';

    const all = peers.concat([{ act: a, pace: mine }]).sort((p, q) => p.pace - q.pace);
    const rank = all.findIndex(x => x.act.id === a.id) + 1;
    const med = Calc.median(peers.map(p => p.pace));
    const d = Calc.delta(mine, med, 'down');

    const ordinal = n => n === 1 ? 'Fastest' :
      n + (n === 2 ? 'nd' : n === 3 ? 'rd' : n % 10 === 1 && n !== 11 ? 'st' :
           n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th') + ' fastest';

    let h = '<div class="sec"><span>Against ' + (P.ground !== 'road' ? P.ground + ' ' : '') + 'runs this length</span><span>' +
      lo.toFixed(1) + '\u2013' + hi.toFixed(1) + ' km</span></div>';
    h += '<div class="cmp"><span class="k">' + ordinal(rank) + ' of ' + all.length +
      '</span><span class="v">' + Calc.fmtPace(mine) +
      (d ? ' ' + deltaHTML(d, 'seconds') : '') + '</span></div>';
    h += '<div class="cmp"><span class="k">Median of the rest</span><span class="v">' +
      Calc.fmtPace(med) + '</span></div>';
    if (all[0].act.id !== a.id) h += '<div class="cmp"><span class="k">Best at this length</span>' +
      '<span class="v">' + Calc.fmtPace(all[0].pace) + '<s>' + fmtDate(all[0].act.date) + '</s></span></div>';
    return h;
  }



  /* ---------------------------------------------------------- best efforts */

  function effortsHTML(a) {
    const efforts = Calc.effortRanks(a, Store.all());
    if (!efforts.length) return '';
    const badge = e => e.rank === 1 ? '<i class="pbtag">PB</i>' : e.rank === 2 ? '<i class="rk">2nd best ever</i>'
      : e.rank === 3 ? '<i class="rk">3rd best ever</i>' : e.yearBest ? '<i class="rk">best of ' + e.year + '</i>' : '';
    const n = efforts.filter(e => e.rank <= 3 || e.yearBest).length;
    let h = '<div class="sec"><span>Best efforts</span><span>' + (n ? n + ' result' + (n === 1 ? '' : 's') : 'in this run') + '</span></div>';
    h += efforts.map(e =>
      '<div class="cmp' + (e.rank === 1 ? ' pb' : '') + '"><span class="k">' + esc(effortName(e.km)) + ' ' + badge(e) + '</span>' +
      '<span class="v">' + Calc.fmtDuration(e.seconds) + '<s>' + Calc.fmtPace(e.pace) + '/km</s></span></div>').join('');
    h += '<div class="est">' + (efforts[0].source === 'stream'
      ? 'The fastest stretch of each distance in this run, ranked against every other run. Distance is the watch\u2019s (or the phone\u2019s) GPS distance.'
      : 'This run has no track, so these are its fastest whole kilometres.') + '</div>';
    return h;
  }



  /* ------------------------------------------------------------ resting ---

     Garmin's daily resting HR as context. It moves nothing: zones come from
     the watch. Pure presentation of Calc.restingModel. */

  let restingView = 'month', restingKey = null, recoveryMetric = 'rhr', recoveryDetail = false;
  /* the two nightly measures, and which way is better for each */
  const METRICS = {
    rhr: { name: 'Resting HR', unit: 'bpm', better: 'down', data: () => Store.resting(),
           lead: 'Average of the last 7 nights. Lower is fitter.',
           meaning: 'Your heart\u2019s rate at rest overnight. It falls as aerobic fitness builds, and rises for a night or two with poor sleep, alcohol, illness or a hard session.',
           none: 'Nothing from Garmin yet. Run <b>garminRestingHistory</b> in Apps Script once (README \u2192 Resting HR).' },
    hrv: { name: 'HRV', unit: 'ms', better: 'up', data: () => Store.hrv(),
           lead: 'Average of the last 7 nights. Higher is generally better \u2014 it moves a lot night to night, so read the week, not the night.',
           meaning: 'How much your heartbeat varies overnight \u2014 a sign of how rested your body is. Higher than your normal usually means well recovered; lower, that something is taking it out of you.',
           none: 'No HRV yet. Run <b>garminHrvHistory</b> in Apps Script once (README \u2192 HRV). Only watches with overnight HRV record it.' }
  };
  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  /* one step back or forward through months or years */
  function restingStep(dir) {
    const m = Calc.restingModel(METRICS[recoveryMetric].data(), restingView, today(), restingKey);
    const P = m.period;
    if (!P || (dir < 0 && !P.hasPrev) || (dir > 0 && !P.hasNext)) return;
    if (restingView === 'month') {
      const d = new Date(Date.UTC(+P.key.slice(0, 4), +P.key.slice(5, 7) - 1 + dir, 1));
      restingKey = d.toISOString().slice(0, 7);
    } else restingKey = String(+P.key + dir);
    renderResting();
  }

  /* Recovery opens on how you're doing: one reading of both measures, then a
     card for each that taps through to its detail. */
  function renderResting() {
    if (recoveryDetail) return renderRecoveryDetail();
    const R = Calc.recoveryModel(Store.resting(), Store.hrv(), today(), Store.all(), Store.config());
    const PM = Calc.progressModel(Store.all(), Store.config(), Store.resting(), today(), Store.hrv());
    let h = '<div class="back" data-back="1">\u2190 Back</div><div class="ttl">Progress</div>';
    /* how fresh it is, and a way to make it fresher */
    const lastOf = a => a && a.length ? a[a.length - 1] : null;
    const lr = lastOf(Store.resting()), lh = lastOf(Store.hrv()), G = Store.sync.garmin;
    const hhmm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    if (lr || lh) h += '<div class="rlatest">Latest: ' + [lr ? fmtDate(lr[0]) + ' resting HR ' + lr[1] + ' bpm' : null,
        lh ? (lr && lh[0] === lr[0] ? '' : fmtDate(lh[0]) + ' ') + 'HRV ' + lh[1] + ' ms' : null].filter(Boolean).join(', ') +
      (G && G.at ? ' \u00b7 Garmin checked ' + hhmm(G.at) : '') + '</div>';

    if (!R.rhr && !R.hrv) {
      h += '<div class="sec"><span>Biometrics</span><span></span></div>';
      h += '<div class="est">Nothing from Garmin yet. Run <b>garminRestingHistory</b> and <b>garminHrvHistory</b> in Apps Script once (README \u2192 Resting HR, HRV).</div>';
    } else {
      const tag = (t, pre) => t ? '<span class="stag ' + (t.tone || '') + '">' + (pre ? '<span class="k">' + pre + ' \u00b7</span> ' : '') + esc(t.word) + '</span>' : '<span></span>';
      if (R.now || R.trend) h += '<div class="rsum ' + (R.nowTone || '') + '"><div class="stags">' + tag(R.nowTag) + tag(R.trendTag, '4 WEEKS') + '</div>' +
        (R.now ? '<p>' + esc(R.now) + '</p>' : '') + (R.trend ? '<p>' + esc(R.trend) + '</p>' : '') + '</div>';
      else h += '<div class="est">A reading needs about 30 nights of both measures.</div>';
      h += '<div class="sec"><span>Biometrics</span><span>last 7 nights</span></div>';
      [['hrv', R.hrv], ['rhr', R.rhr]].forEach(([k, M]) => {
        const MT = METRICS[k];
        if (!M) { h += '<div class="rcard" data-rd="' + k + '"><div class="rn">' + MT.name + '</div><div class="est">' + MT.none + '</div></div>'; return; }
        const r1 = v => v == null ? '\u2014' : (Math.round(v * 10) / 10).toString();
        /* the words name the number they describe: the last 3 nights, not the 7-night figure above */
        const where = !M.band ? 'Your normal range needs 30 nights.'
          : M.now3 == null ? 'Your normal range: ' + r1(M.band.lo) + '\u2013' + r1(M.band.hi) + ' ' + MT.unit + '.'
          : 'Last 3 nights: ' + r1(M.now3) + ' ' + MT.unit + ', ' + (M.pos === 'inside' ? 'inside' : M.pos) +
            ' your normal range (' + r1(M.band.lo) + '\u2013' + r1(M.band.hi) + ').';
        const T = M.trend;
        const tr = !T ? '' : T.same ? 'About the same over four weeks.'
          : '<span class="delta ' + T.tone + '">' + (T.diff > 0 ? '\u25b2 ' : '\u25bc ') + r1(Math.abs(T.diff)) + ' ' + MT.unit + '</span> over four weeks.';
        h += '<div class="rcard" data-rd="' + k + '"><div class="rn">' + MT.name + '<span>details \u2192</span></div>' +
          '<div class="rv">' + r1(M.now7) + '<s> ' + MT.unit + ' \u00b7 7 nights</s></div>' +
          '<div class="rl">' + esc(where) + ' ' + tr + '</div><div class="est">' + MT.meaning + '</div></div>';
      });
    }
    h += progressHTML(PM);
    el('view-resting').innerHTML = h;
    $('#view-resting [data-back]').onclick = () => go('home');

    document.querySelectorAll('#view-resting .wk').forEach(w => {
      w.onclick = () => w.dataset.wgo ? go(w.dataset.wgo) : w.dataset.wid ? go('detail', w.dataset.wid) : null;
    });
    document.querySelectorAll('#view-resting [data-rd]').forEach(c => {
      c.onclick = () => { recoveryMetric = c.dataset.rd; recoveryDetail = true; restingKey = null; renderResting(); window.scrollTo(0, 0); };
    });
  }

  function renderRecoveryDetail() {
    const MT = METRICS[recoveryMetric];
    const m = Calc.restingModel(MT.data(), restingView, today(), restingKey);
    const S = Calc.measureState(MT.data(), today(), recoveryMetric, MT.better, Store.all(), Store.config());
    let h = '<div class="back" data-back="1">\u2190 Progress</div><div class="ttl">' + MT.name + '</div>' +
      '<div class="sub">' + (m.count ? m.count + ' NIGHTS \u00b7 FROM ' + fmtDate(m.first).toUpperCase() : 'NO DATA YET') + '</div>';
    if (!m.count) {
      h += '<div class="est">' + MT.none + '</div>';
    } else {
      const bpm = v => v == null ? '\u2014' : (Math.round(v * 10) / 10).toFixed(Math.abs(v % 1) > 0.05 ? 1 : 0);
      const vs = (now, then, label) => {
        if (now == null || then == null) return '';
        const d = Calc.changeOf(now, then, MT.better, recoveryMetric);
        return cmp('Against ' + label, bpm(then) + ' ' + MT.unit, !d || d.same || d.dir === 'flat' ? 'about the same'
          : { html: '<span class="delta ' + d.tone + '">' + (d.dir === 'up' ? '\u25b2 ' : '\u25bc ') +
            bpm(Math.abs(d.diff)) + ' ' + MT.unit + ' ' + (d.dir === 'up' ? 'higher' : 'lower') + ' now</span>' });
      };
      h += '<div class="hero1"><div class="big">' + bpm(m.now) + '<s> ' + MT.unit + '</s></div>' +
        '<div class="est">' + MT.lead + '</div></div>';
      h += vs(m.now, m.ago3m, '3 months ago') + vs(m.now, m.ago1y, 'a year ago');
      if (m.lowestMonth) h += cmp('Lowest month', bpm(m.lowestMonth.bpm) + ' ' + MT.unit,
        MON[+m.lowestMonth.month.slice(5) - 1] + ' ' + m.lowestMonth.month.slice(0, 4));
      if (m.highestMonth && m.highestMonth.month !== (m.lowestMonth || {}).month) h += cmp('Highest month',
        bpm(m.highestMonth.bpm) + ' ' + MT.unit, MON[+m.highestMonth.month.slice(5) - 1] + ' ' + m.highestMonth.month.slice(0, 4));

      h += '<div class="bar" id="r-view">' + [['month', 'Month'], ['year', 'Year'], ['all', 'All years']].map(v =>
        '<button class="chip" type="button" data-rv="' + v[0] + '" aria-pressed="' + (v[0] === restingView) + '">' +
        v[1] + '</button>').join('') + '</div>';

      const P = m.period;
      if (P) {
        const label = restingView === 'month' ? MONTH_NAMES[+P.key.slice(5, 7) - 1] + ' ' + P.key.slice(0, 4) : P.key;
        h += '<div class="rnav"><button type="button" class="rstep" data-step="-1"' + (P.hasPrev ? '' : ' disabled') +
          ' aria-label="Earlier">\u2039</button><div class="rlab"><b>' + label + '</b><span>' +
          (P.nights ? P.nights + ' night' + (P.nights === 1 ? '' : 's') + ' \u00b7 average ' + bpm(P.avg) + ' ' + MT.unit : 'no nights') +
          '</span></div><button type="button" class="rstep" data-step="1"' + (P.hasNext ? '' : ' disabled') +
          ' aria-label="Later">\u203a</button></div>';
      }
      const chart = m.shown ? lineChart(m.segments, {
        uniform: true, height: 150, from: P ? P.from : undefined, to: P ? P.to : undefined,
        band: S && S.band ? { lo: S.band.lo, hi: S.band.hi } : null,
        format: v => bpm(v), anchorLabels: ['highest', 'lowest'],
        label: MT.name + ', ' + (restingView === 'month' ? 'each night' : restingView === 'year' ? 'weekly average' : 'monthly average') + '.',
        xax: P ? [fmtDate(P.from).toUpperCase(), '', fmtDate(P.to).toUpperCase()]
               : [m.segments[0][0].date.slice(0, 4), '', m.segments[m.segments.length - 1].slice(-1)[0].date.slice(0, 4)]
      }) : null;
      h += '<div id="r-chart">' + (chart || '<div class="est rnone">No nights in this ' + (restingView === 'month' ? 'month' : 'year') + '.</div>') + '</div>';
      h += '<div class="est">' + (restingView === 'month' ? 'Every night.' : restingView === 'year'
        ? 'Each point is a week\u2019s average, so one bad night doesn\u2019t spike the line.'
        : 'Each point is a month\u2019s average.') +
        (P ? ' Swipe the chart, or use the arrows, for ' + (restingView === 'month' ? 'other months.' : 'other years.') : '') +
        ' A break is a stretch with no readings.' + (S && S.band ? ' The shaded band is your normal range now (last 60 nights).' : '') +
        ' Context only \u2014 your zones come from your watch.</div>';
      if (S && S.patterns.length) h += '<div class="sec"><span>Patterns</span><span>last 12 months</span></div>' +
        S.patterns.map(p => '<div class="wk">' + esc(p.text) + '</div>').join('');
      if (m.bad) h += '<div class="flag"><i>!</i><div>' + m.bad + ' night' + (m.bad === 1 ? '' : 's') +
        ' couldn\u2019t be read and ' + (m.bad === 1 ? 'is' : 'are') + ' left out (for example \u201c' +
        esc(String(m.badSample).slice(0, 40)) + '\u201d). Send me this line.</div></div>';
    }
    el('view-resting').innerHTML = h;
    $('#view-resting [data-back]').onclick = () => { recoveryDetail = false; renderResting(); window.scrollTo(0, 0); };
    document.querySelectorAll('#r-view [data-rv]').forEach(b => {
      b.onclick = () => { restingView = b.dataset.rv; restingKey = null; renderResting(); };
    });

    document.querySelectorAll('#view-resting [data-step]').forEach(b => {
      b.onclick = () => restingStep(+b.dataset.step);
    });
    /* swipe: right for earlier, left for later, like turning pages back */
    const area = el('r-chart');
    if (area && m.period) {
      let x0 = null, y0 = null;
      area.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      area.addEventListener('touchend', e => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) restingStep(dx > 0 ? -1 : 1);
      }, { passive: true });
    }
  }

  /* -------------------------------------------------------------- bests ---

     All-time, from one model. Every best here comes through the same effort
     source as the year reviews and the PB tags, so the three never disagree. */


  /* Bests: the trophy room. One row per distance, per race and per
     milestone; each distance and each race opens its whole story. */
  function renderBests() {
    const m = Calc.bestOfModel(Store.all(), Store.config(), today());
    let h = '<div class="back" data-back="1">\u2190 Back</div><div class="ttl">Bests</div>' +
      '<div class="sub">' + (m.count ? m.count + ' RUNS \u00b7 ' + esc(m.years[0]) +
        (m.years.length > 1 ? '\u2013' + esc(m.years[m.years.length - 1]) : '') : 'NO RUNS YET') + '</div>';
    const fresh = {};
    Calc.newBests(Store.all(), today()).forEach(n => { fresh[n.km] = true; });
    const mon = d => MON[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4);

    if (m.board.length) {
      h += '<div class="sec"><span>Distances</span><span>all time</span></div>' + m.board.map(b =>
        '<div class="brow" data-km="' + b.km + '"><span class="bk">' + esc(effortName(b.km)) +
        (fresh[b.km] ? ' <i class="pbtag">NEW</i>' : '') + '</span><span class="bt">' + Calc.fmtDuration(b.best.seconds) +
        '</span><span class="bw">' + mon(b.best.run.date) + '</span><span class="bg">\u203a</span></div>').join('');
    }

    if (m.raceGroups.length) {
      h += '<div class="sec"><span>Races</span><span>' + m.races.length + '</span></div>' + m.raceGroups.map(g =>
        '<div class="brow race" data-race="' + esc(g.name) + '"><span class="bk">' + esc(g.name) +
        '<s>' + g.years.join(' \u00b7 ') + '</s></span><span class="bt">' + Calc.fmtDuration(g.best.seconds) + '</span>' +
        '<span class="bw">' + (g.editions.length > 1 ? 'best ' + g.best.run.date.slice(0, 4) : g.best.run.date.slice(0, 4)) +
        '</span><span class="bg">\u203a</span></div>').join('');
    }

    if (m.milestones.length) {
      h += '<div class="sec"><span>Milestones</span><span></span></div><div class="miles">' + m.milestones.map(r =>
        '<div class="mile"' + (r.id ? ' data-id="' + esc(r.id) + '"' : '') + '><span>' + esc(r.label) + '</span><b>' + esc(r.value) +
        (r.unit ? '<s> ' + esc(r.unit) + '</s>' : '') + '</b><em>' + (r.when ? (r.when.length === 4 ? r.when : r.when.length === 7 ? mon(r.when + '-01') : fmtDate(r.when)) : '') + '</em></div>').join('') + '</div>';
    }

    el('view-bests').innerHTML = h;
    $('#view-bests [data-back]').onclick = () => go('home');
    document.querySelectorAll('#view-bests [data-km]').forEach(r => { r.onclick = () => go('bestdist', r.dataset.km); });
    document.querySelectorAll('#view-bests [data-race]').forEach(r => { r.onclick = () => go('race', r.dataset.race); });
    document.querySelectorAll('#view-bests [data-id]').forEach(r => { r.onclick = () => go('detail', r.dataset.id); });
  }

  /* one distance: the best, your top five, each year's best as a bar */
  function renderBestDist(kmTxt) {
    const km = +kmTxt, D = Calc.distanceModel(Store.all(), km, today());
    let h = '<div class="back" data-back="1">\u2190 Bests</div>';
    if (!D) { el('view-bestdist').innerHTML = h + '<div class="est">No efforts at this distance yet.</div>';
      $('#view-bestdist [data-back]').onclick = () => go('bests'); return; }
    h += '<div class="ttl">' + esc(effortName(km)) + '</div><div class="sub">FROM ' + D.count + ' RUNS</div>';
    h += '<div class="hero1"><div class="big">' + Calc.fmtDuration(D.best.seconds) + '</div><div class="est">' +
      Calc.fmtPace(D.best.pace) + '/km \u00b7 ' + fmtDate(D.best.run.date) + ' \u00b7 ' + esc(D.best.run.name) + '</div></div>';
    if (D.thisYear) h += cmp(today().slice(0, 4), Calc.fmtDuration(D.thisYear.seconds),
      D.off ? (D.off < 60 ? Math.round(D.off) + ' s' : Calc.fmtDuration(Math.round(D.off))) + ' off your best' : 'your best', D.thisYear.run.id);
    h += '<div class="sec"><span>Top ' + D.top.length + '</span><span>ever</span></div>' + D.top.map((x, i) =>
      '<div class="cmp" data-id="' + esc(x.run.id) + '"><span class="k">' + (i + 1) + '. ' + fmtDate(x.run.date) + '</span><span class="v">' +
      Calc.fmtDuration(x.seconds) + '<s>' + Calc.fmtPace(x.pace) + '/km</s></span></div>').join('');
    /* each year's best: the shorter the bar, the faster */
    const P = D.perYear, lo = Math.min.apply(null, P.map(p => p.seconds)), hi = Math.max.apply(null, P.map(p => p.seconds));
    h += '<div class="sec"><span>Each year</span><span>best of the year</span></div><div class="lens">' + P.map(p =>
      '<div class="len yb" data-id="' + esc(p.run.id) + '"><span>' + p.year + '</span><span><i class="' + (p.seconds === lo ? 'top' : '') +
      '" style="width:' + (40 + 60 * (hi === lo ? 1 : (p.seconds - lo) / (hi - lo))).toFixed(1) + '%"></i></span><span>' +
      Calc.fmtDuration(p.seconds) + '</span></div>').join('') + '</div>';
    h += '<div class="est">The fastest stretch of ' + esc(effortName(km)) + ' inside any run, races included. A shorter bar is a faster year.</div>';
    el('view-bestdist').innerHTML = h;
    $('#view-bestdist [data-back]').onclick = () => go('bests');
    document.querySelectorAll('#view-bestdist [data-id]').forEach(r => { r.onclick = () => go('detail', r.dataset.id); });
  }

  /* one race, every edition side by side; best by time, with each course's length beside it */
  function renderRace(name) {
    const m = Calc.bestOfModel(Store.all(), Store.config(), today());
    const g = m.raceGroups.find(x => x.name === name);
    let h = '<div class="back" data-back="1">\u2190 Bests</div>';
    if (!g) { el('view-race').innerHTML = h + '<div class="est">That race isn\u2019t there any more.</div>';
      $('#view-race [data-back]').onclick = () => go('bests'); return; }
    h += '<div class="ttl">' + esc(g.name) + '</div><div class="sub">' + g.years.join(' \u00b7 ') + '</div>';
    h += '<div class="sec"><span>' + (g.editions.length > 1 ? 'Every edition' : 'Result') + '</span><span></span></div>' + g.editions.map(e =>
      '<div class="cmp" data-id="' + esc(e.run.id) + '"><span class="k">' + e.run.date.slice(0, 4) + (e === g.best && g.editions.length > 1 ? ' <i class="pbtag">BEST</i>' : '') +
      '</span><span class="v">' + Calc.fmtDuration(e.seconds) + '<s>' + (e.run.distance_km || 0).toFixed(2) + ' km \u00b7 ' + Calc.fmtPace(e.pace) + '/km</s></span></div>').join('');
    const lens = g.editions.map(e => e.run.distance_km).filter(Boolean);
    if (g.editions.length > 1 && lens.length && (Math.max.apply(null, lens) - Math.min.apply(null, lens)) / Math.min.apply(null, lens) > 0.03)
      h += '<div class="est">The course wasn\u2019t the same length each year, so compare the pace beside each time too.</div>';
    el('view-race').innerHTML = h;
    $('#view-race [data-back]').onclick = () => go('bests');
    document.querySelectorAll('#view-race [data-id]').forEach(r => { r.onclick = () => go('detail', r.dataset.id); });
  }

  function renderDetail(id) {
    const a = Store.byId(id);
    if (!a) { go('home'); return; }
    const cfg = Store.config();
    const bounds = Calc.zoneBounds(cfg);
    const c = Calc.aerobicCost(a);
    const d = Calc.driftOf(a);
    const tz = Calc.timeInZone(Calc.zoneLaps(a), bounds);
    const zTotal = [1,2,3,4,5].reduce((t, z) => t + tz[z], 0) + tz.unknown;

    let h = '<div class="back" data-back="1">\u2190 Back</div>';
    h += '<div class="ttl">' + esc(a.name) + '</div>';
    const sub = [DAYS[Calc.dayIndex(a.date)], fmtDate(a.date).toUpperCase()];


    if (a.temp_c != null) sub.push(a.temp_c + '\u00b0');
    if (a.rpe != null) sub.push('RPE ' + a.rpe);
    h += '<div class="sub">' + esc(sub.join(' \u00b7 ')) + '</div>';
    h += tagLineHTML(a);
    h += resultsHTML(a);

    h += noticedHTML(a);

    /* heart rate that followed cadence: said, and overridable */
    if (a.hr_lock != null && a.hr_lock !== '' && Number(a.hr_lock) >= Calc.HR_LOCK_LIMIT) {
      const out = Calc.hrLocked(a);
      h += '<div class="callout' + (out ? ' warn' : '') + '">Heart rate followed your cadence for <b>' +
        Math.round(a.hr_lock) + '%</b> of this run \u2014 a wrist sensor locked onto your stride. ' +
        (out ? 'It\u2019s left out of zones, drift, aerobic pace and load. Distance, pace and best efforts still count.'
             : 'You\u2019ve chosen to trust it, so it counts everywhere.') + '</div>' +
        '<button class="btn ghost" id="d-trust">' + (out ? 'Trust this heart rate anyway' : 'Leave it out again') + '</button>';
    }

    h += kmSplitsHTML(a, bounds);

    if (d != null) {
      const flat = Calc.driftIsFlat(d);
      h += '<div class="callout' + (flat ? '' : d > 8 ? ' warn' : '') + '">' +
        (flat
          ? 'Heart rate <b>held flat</b> across the run' +
            (d === 0 ? '.' : ' \u2014 ' + (d > 0 ? '+' : '') + d + ' bpm, inside what terrain alone can shift.')
          : 'Heart rate moved <b>' + (d >= 0 ? '+' : '') + d + ' bpm</b> across the run' +
            (d > 8 ? '. A base effort should hold closer to flat.' : '.')) +
        '</div><div class="est">Measured after the opening kilometre, and read as flat ' +
        'within ' + Calc.DRIFT_FLAT + ' bpm \u2014 a hill in the first or last third moves it ' +
        'about that much on its own.</div>';
    } else if (Calc.hasLapHr(a.laps) && !Calc.hrLocked(a)) {
      const need = Calc.driftNeeds(a.laps);
      h += '<div class="est">Drift needs ' + need + ' more full kilometre' + (need === 1 ? '' : 's') +
        ' \u2014 the opening one is dropped, and three are needed after that.</div>';
    }

    const intent = Calc.intentCheck(a, cfg);
    if (intent && !intent.ok) h += '<div class="callout warn">You called this a <b>' +
      esc(intent.session.label.toLowerCase()) + ' run</b>, and <b>' + intent.above +
      '% of it was above Z2</b>.</div>';
    else if (intent && intent.ok && !intent.hard)
      h += '<div class="callout ok">A ' + esc(intent.session.label.toLowerCase()) +
        ' run, run like one \u2014 <b>' + intent.pct + '% in Z2</b>.</div>';

    h += bandHTML(a);
    h += effortsHTML(a);

    h += '<div class="rule"></div><div class="grid2">';
    const ap = Calc.aerobicPace(a, cfg);
    h += metric('Aerobic pace', ap != null ? Calc.fmtPace(ap) : '\u2014', ap != null ? '/km' : '',
      ap != null ? 'at ' + Calc.refHr(cfg) + ' bpm' + (c && c.basis === 'gap' ? ', gradient-adjusted' : '')
                 : 'needs heart rate', ap == null);
    h += metric('Pace', Calc.fmtPace(Calc.paceSecPerKm(a.distance_km, a.elapsed_s)), '/km',
      a.gap_pace_s != null ? 'GAP ' + Calc.fmtPace(a.gap_pace_s) : '');
    h += metric('Distance', a.distance_km.toFixed(2), 'km',
      a.ascent_m != null ? '+' + a.ascent_m + ' m' : '');
    h += metric('Time', Calc.fmtDuration(a.elapsed_s), '', '');
    h += metric('Avg HR', a.avg_hr == null ? '\u2014' : a.avg_hr, a.avg_hr == null ? '' : 'bpm',
      '', a.avg_hr == null);
    const ld = Calc.load(a, cfg);
    if (ld != null) {
      const sr = Calc.sessionRpe(a);
      h += metric('Load', ld, '', sr != null ? 'session RPE ' + sr : 'from heart rate');
    }
    if (a.cadence_spm != null) h += metric('Cadence', a.cadence_spm, 'spm', '');
    h += '</div>';

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
    bindTagLine(a);
    bindResults('#view-detail');
    const trust = el('d-trust');
    if (trust) trust.onclick = () => {
      const next = Object.assign({}, a, { hr_trust: Calc.hrLocked(a) ? 'trust' : null, updated_at: new Date().toISOString() });
      Store.put(next).then(() => { renderDetail(a.id); toast(next.hr_trust ? 'Heart rate trusted' : 'Heart rate left out', 'ok'); });
    };
    $('#view-detail [data-edit]').onclick = () => go('edit', a.id);
    $('#view-detail [data-replace]').onclick = () => go('replace', a.id);
    once($('#view-detail [data-delete]'), 'Deleting\u2026', () => {
      if (!confirm('Delete "' + a.name + '"? This cannot be undone.')) return;
      return Store.remove(a.id).then(() => { go('home'); toast('Deleted', 'ok'); });
    });
  }

  /* ---------------------------------------------------------------- import */

  function renderImport() {
    draft = null;
    /* Inference is right nearly always, so it leads. The explicit chips are the
       override, not the norm. */
    let h = '<div class="back" data-back="1">\u2190 Back</div>';
    h += '<div class="ttl">Add a run</div>';
    h += pasteBoxHTML('paste', 'Paste the table',
      'Paste straight from Gemini. Pipes, commas and tabs all work.');
    h += '<button class="btn" id="read">Read it</button>';
    h += '<div class="small muted" style="margin-top:11px">Nothing is saved until you have seen the preview.</div>';
    h += '<div id="preview"></div>';
    el('view-import').innerHTML = h;

    $('#view-import [data-back]').onclick = () => go('home');

    bindPasteBox('paste',
      () => { el('preview').innerHTML = ''; draft = null; },
      () => el('read').click());

    el('read').onclick = () => {
      const text = el('paste').value;
      if (!text.trim()) return;
      const p = Parse.parse(text, { today: today() });
      draft = Parse.toActivity(p, {});
      renderPreview(p, Parse.validate(p, { today: today() }));
    };
  }

  function renderPreview(p, flags) {
    const bounds = Calc.zoneBounds(Store.config());
    const a = draft;
    const c = Calc.aerobicCost(a);
    const d = Calc.driftOf(a);
    const dup = a.date && a.distance_km ? Model.findDuplicate(a, Store.all()) : null;

    let h = '<div class="rule"></div><div class="eyebrow">Check it</div>';
    /* What the session was meant to be. More useful than a place name: it lets
       the run be judged against its own intent rather than a general rule. */
    h += '<label><span>What was it</span></label>';
    h += '<div class="bar wrap" id="p-session">' + Calc.SESSIONS.map(s =>
      '<button class="chip" type="button" data-sess="' + s.key + '" aria-pressed="' +
      (a.session === s.key) + '">' + s.label + '</button>').join('') + '</div>';
    h += '<label><span>Where</span></label>';
    h += '<div class="bar wrap" id="p-terrain">' + [['road', 'Road'], ['trail', 'Trail'], ['mixed', 'Mixed']].map(t =>
      '<button class="chip" type="button" data-terr="' + t[0] + '" aria-pressed="' +
      (Calc.terrainOf(a) === t[0]) + '">' + t[1] + '</button>').join('') + '</div>';
    h += '<label><span>Call it something else (optional)</span>' +
      '<input type="text" id="p-name" value="' + esc(a.name || '') +
      '" placeholder="Furuset loop"></label>';
    h += '<label><span>Source</span><select id="p-source">' +
      '<option value="tracked">Tracked on the watch</option>' +
      '<option value="typed">Not recorded \u2014 typed from memory</option></select></label>';

    if (Calc.fullLaps(a.laps).length) {
      h += '<div style="margin-top:16px">' +
        stripHTML(a, bounds, true) + '</div>';
      h += '<div class="rmeta" style="margin-left:0">' + Calc.fullLaps(a.laps).length + ' laps' +
        ((a.laps || []).length > Calc.fullLaps(a.laps).length ? ' + partial' : '') +
        (d != null ? ' \u00b7 <b>' + (Calc.driftIsFlat(d) ? 'drift flat'
          : 'drift ' + (d >= 0 ? '+' : '') + d + ' bpm') + '</b>' : '') + '</div>';
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
    /* The tick means "nothing to look at". It used to appear whenever there
       were no errors, so it sat directly above three warnings saying the laps
       did not add up. */
    const noteworthy = flags.filter(f => f.level === 'error' || f.level === 'warn');
    if (!noteworthy.length) h += '<div class="flag ok"><i>\u2713</i><div>Nothing inconsistent found.</div></div>';
    else if (!errors.length) h += '<div class="flag ok"><i>\u2713</i><div>Nothing blocking \u2014 ' +
      noteworthy.length + ' thing' + (noteworthy.length === 1 ? '' : 's') + ' worth a look.</div></div>';
    flags.forEach(f => {
      const cls = f.level === 'error' ? 'error' : f.level === 'info' ? 'info' : '';
      const mark = f.level === 'error' ? '\u2715' : f.level === 'info' ? 'i' : '!';
      h += '<div class="flag ' + cls + '"><i>' + mark + '</i><div>' + esc(f.msg) + '</div></div>';
    });
    if (dup) h += '<div class="flag"><i>!</i><div>Looks like a duplicate of "' + esc(dup.name) +
      '". Saving will replace it.</div></div>';

    h += '<button class="btn" id="save"' + (errors.length ? ' disabled' : '') + '>' +
      (dup ? 'Replace' : 'Save') + ' run' + '</button>';
    if (errors.length) h += '<div class="small muted" style="margin-top:9px">Fix the paste and read it again.</div>';

    el('preview').innerHTML = h;

    document.querySelectorAll('#p-session [data-sess]').forEach(b => {
      b.onclick = () => {
        const on = b.getAttribute('aria-pressed') === 'true';
        document.querySelectorAll('#p-session [data-sess]').forEach(x =>
          x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', String(!on));
        if (draft) draft.session = on ? null : b.dataset.sess;
      };
    });

    document.querySelectorAll('#p-terrain [data-terr]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('#p-terrain [data-terr]').forEach(x =>
          x.setAttribute('aria-pressed', String(x === b)));
        if (draft) draft.terrain = b.dataset.terr;
      };
    });
    const save = el('save');
    if (save && !errors.length) once(save, dup ? 'Replacing\u2026' : 'Saving\u2026', () => {
      draft.name = el('p-name').value.trim();
      draft.source = el('p-source').value;
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
      return Store.put(act).then(() => {
        periodKey = Calc.periodKey(act.date, scope);
        go('detail', act.id);
        toast(dup ? 'Replaced' : 'Saved', 'ok');
      });
    });
  }


  /* -------------------------------------------------------------- settings */

  function renderSettings() {
    const cfg = Store.config();
    const b = Calc.zoneBounds(cfg);
    const ageDays = d => d ? Math.round((Date.now() - new Date(d + 'T12:00:00')) / 86400000) : null;

    let h = '<div class="back" data-back="1">\u2190 Back</div><div class="ttl">Setup</div>';

    h += '<div class="sec"><span>Zone anchors \u00b7 Karvonen</span></div>';
    h += '<div class="field-row">' +
      '<label><span>Max HR</span><input type="number" id="c-max" value="' + cfg.max_hr + '"' +
      (cfg.zones_from === 'watch' ? ' readonly' : '') + '></label>' +
      '<label><span>Resting HR</span><input type="number" id="c-rest" value="' + cfg.resting_hr + '"' +
      (cfg.zones_from === 'watch' ? ' readonly' : '') + '></label></div>';
    if (cfg.garmin_zones) {
      const W = cfg.garmin_zones;
      h += '<div class="bar" id="c-zsrc">' +
        '<button class="chip" type="button" data-zsrc="watch" aria-pressed="' + (cfg.zones_from === 'watch') + '">From my watch</button>' +
        '<button class="chip" type="button" data-zsrc="manual" aria-pressed="' + (cfg.zones_from !== 'watch') + '">My own</button></div>';
      h += '<div class="est">' + (cfg.zones_from === 'watch'
        ? 'Zones are exactly as set on your watch, so the app never disagrees with what you run by. ' +
          'Change them on the watch and the app follows within the hour.'
        : 'Using your own anchors. Your watch\u2019s zones start Z2 at ' + W.z2 + ' and Z3 at ' + W.z3 + '.') + '</div>';
    }

    /* Equal segments, not proportional to beats. Z1 spans 79 bpm and Z2 only
       13, so a proportional bar gave three quarters of its width to the zone
       you never train in and squashed the ones you do. */
    const seg = (col, label) =>
      '<div class="zseg" style="background:' + col + '; flex:1">' + label + '</div>';
    h += '<div class="zbar" style="margin-top:14px">' +
      seg('var(--z1)', 'Z1') + seg('var(--z2)', 'Z2') + seg('var(--z3)', 'Z3') +
      seg('var(--z4)', 'Z4') + seg('var(--z5)', 'Z5') + '</div>';
    /* Six numbers describe five boundaries, so they belong ON the edges, not
       evenly spaced underneath. Laid out as a row of equal cells with the
       figure sitting on each cell's leading edge, and the last pinned right. */
    const bounds = [cfg.resting_hr, b.z2, b.z3, b.z4, b.z5, cfg.max_hr];
    h += '<div class="zbnd">' + bounds.map((v, i) =>
      '<span' + (i === bounds.length - 1 ? ' class="last"' : '') + '>' + v + '</span>'
    ).join('') + '</div>';
    h += '<div class="est">Reserve ' + b.hrr + ' beats. Base work lives in Z2, ' + b.z2 + '\u2013' + (b.z3 - 1) + '.</div>';

    if (ageDays(cfg.max_hr_dated) > 365) h += '<div class="flag"><i>!</i><div>Max HR was set ' +
      Math.round(ageDays(cfg.max_hr_dated) / 30) + ' months ago.</div></div>';
    if (cfg.zones_from !== 'watch')
      h += '<div class="small muted" style="margin-top:10px">With your own anchors, resting heart rate wants to be a ' +
        '90-day median, nudged every few weeks; the zones follow it.</div>';

    h += '<div class="sec"><span>Base work</span><span>Z2 target</span></div>';
    h += '<label><span>Share of time in Z2 you are aiming for</span>' +
      '<input type="number" id="c-z2" min="0" max="100" value="' + cfg.z2_target + '"></label>';
    h += '<div class="est">70% is the usual base-building convention, not a law. ' +
      'It sets the colour on the home screen and the count under the chart.</div>';
    h += '<button class="btn" id="c-save">Save settings</button>';

    /* ---- Sheets ---- */
    const sh = Store.sheetsSettings();
    const sy = Store.sync;
    h += '<div class="sec"><span>Sheets</span><span>' +
      (Store.sheetsConfigured()
        ? (sy.state === 'syncing' ? 'syncing'
          : sy.state === 'error' ? 'last try failed'
          : sy.at ? 'synced ' + sy.at.slice(11, 16) : 'connected')
        : 'not connected') + '</span></div>';
    if (Store.sheetsConfigured())
      h += '<div class="small muted">Connection came from <b>' +
        esc(Store.sheetsOrigin()) + '</b>.</div>';
    h += '<label><span>Web app URL</span><input type="text" id="s-url" value="' +
      esc(sh.url || '') + '" placeholder="https://script.google.com/.../exec"></label>';
    h += '<label><span>Token (blank if you didn\u2019t set one)</span>' +
      '<input type="text" id="s-token" value="' + esc(sh.token || '') + '"></label>';
    h += '<button class="btn" id="s-save">Save and sync</button>';
    if (Store.sheetsConfigured()) {
      h += '<button class="btn ghost" id="s-push">Push everything up</button>';
    }
    if (sy.pending) h += '<div class="flag"><i>!</i><div>' + sy.pending +
      ' change' + (sy.pending === 1 ? '' : 's') + ' waiting to go up.</div></div>';
    if (sy.error) h += '<div class="flag error"><i>\u2715</i><div>' + esc(sy.error) + '</div></div>';
    if (Store.sheetsConfigured() && sy.state === 'ok' && sy.outdated)
      h += '<div class="flag error"><i>!</i><div>Your Apps Script is older than this app, so session ' +
        'tags and test results are still only on this phone. Paste the new <b>Code.gs</b> into ' +
        'Apps Script and deploy a new version \u2014 the steps are under Garmin in the README.</div></div>';
    else if (Store.sheetsConfigured() && !sy.error && sy.state === 'ok')
      h += '<div class="flag ok"><i>\u2713</i><div>Your runs are in the spreadsheet as well as on this phone.</div></div>';
    h += '<div class="est">A fetch from Sheets never deletes what is on this phone. ' +
      'An empty or unreachable sheet is pushed to, not copied from.</div>';

    if (Store.sheetsOrigin() !== 'sheets.json in the repo') {
      h += '<div class="flag"><i>i</i><div>To stop retyping this after a storage clear, ' +
        'put the same URL and token in <b>sheets.json</b> in your repo. The app reads it ' +
        'on load, and a deployed file cannot be evicted. Anyone who knows your Pages ' +
        'address could read it, so only do this if that is an acceptable trade for ' +
        'run data.</div></div>';
    }

    h += garminHTML(sy);
    /* Runs arrive from Garmin, so there's no add button any more. For the odd
       run Garmin doesn't have, pasting still works from here. */
    h += '<button class="btn ghost" id="s-paste">Paste a run by hand</button>';

    /* whether the browser has actually promised to keep the data */
    h += '<div class="sec"><span>Storage</span><span id="persist-state">checking</span></div>';
    h += '<div class="small muted" id="persist-note">\u00a0</div>';

    const broken = Calc.damaged(Store.all());
    if (broken.length) {
      h += '<div class="sec"><span>Incomplete records</span><span>' + broken.length + '</span></div>';
      h += '<div class="small muted">These are missing something the screens need, so they are ' +
        'held back rather than drawn. Nothing has been deleted.</div>';
      broken.slice(0, 8).forEach(a => {
        h += '<div class="cmp"><span class="k">' + esc(a.name || a.id) +
          '</span><span class="v">no ' + Calc.whatsMissing(a).join(', ') + '</span></div>';
      });
      h += '<button class="btn ghost" id="c-fixfirst">Edit the first one</button>';
    }

    const n = Store.all().length;
    const last = Store.config().exported_at || null;
    const days = last ? Calc.daysBetween(last.slice(0, 10), today()) : null;
    /* Where the runs live is what the sync says, not whether a backup file was
       ever made: with the spreadsheet in step, this phone is not the only copy. */
    const inSheet = Store.sheetsConfigured() && Store.sync.state === 'ok' && !Store.sync.outdated;
    h += '<div class="sec"><span>Your data</span><span>' +
      (days == null ? 'never exported' : days + ' days since export') + '</span></div>';
    h += '<div class="small muted">' + n + ' activit' + (n === 1 ? 'y' : 'ies') +
      (inSheet ? ', in the spreadsheet and on this phone. An export is an extra copy you keep yourself.'
               : ', on this device only.') + '</div>';
    if (!inSheet && (days == null || days >= 14)) {
      h += '<div class="flag"><i>!</i><div>' +
        (days == null
          ? 'Nothing has been exported yet. Android can clear a browser\u2019s storage without warning.'
          : 'Last export was ' + days + ' days ago.') +
        ' Add the app to your home screen too \u2014 installed apps are far less likely to be cleared.</div></div>';
    }
    h += '<button class="btn ghost" id="c-export">Export everything</button>';
    h += '<label class="filebtn btn ghost" for="c-import" style="margin-top:8px">Import a backup' +
      '<input id="c-import" type="file" accept="application/json"></label>';

    el('view-settings').innerHTML = h;
    $('#view-settings [data-back]').onclick = () => go('home');

    Store.persisted().then(function (ok) {
      const st = el('persist-state'), note = el('persist-note');
      if (!st) return;
      st.textContent = ok === null ? 'unknown' : ok ? 'persistent' : 'evictable';
      note.innerHTML = ok
        ? 'The browser has agreed not to clear this app\u2019s data to free space.'
        : ok === null
          ? 'This browser does not report whether storage is protected.'
          : '<b>The browser may clear this app\u2019s data without warning.</b> ' +
            'Your runs are in the sheet, and the connection is recoverable, so a clear ' +
            'costs you nothing but a reload.';
    });

    const fix = el('c-fixfirst');
    if (fix) fix.onclick = () => go('edit', Calc.damaged(Store.all())[0].id);

    once(el('s-save'), 'Connecting\u2026', () => {
      const url = el('s-url').value.trim();
      if (!url) { toast('Paste the /exec URL first', 'bad'); return; }
      Store.configureSheets(url, el('s-token').value);
      return Store.pull().then(res => {
        renderSettings();
        if (res && res.error) toast('Could not reach the sheet', 'bad');
        else if (res && res.pushed != null) toast(res.pushed + ' runs sent to Sheets', 'ok');
        else toast('Connected and in sync', 'ok');
      });
    });
    const paste = el('s-paste');
    if (paste) paste.onclick = () => go('import');

    once(el('s-push'), 'Pushing\u2026', () =>
      Store.pushAll().then(count => {
        renderSettings();
        toast(count + ' activities sent to Sheets', 'ok');
      }));

    document.querySelectorAll('#c-zsrc [data-zsrc]').forEach(b => {
      b.onclick = () => Store.setConfig({ zones_source: b.dataset.zsrc }).then(() => {
        renderSettings(); toast(b.dataset.zsrc === 'watch' ? 'Zones from your watch' : 'Using your own zones', 'ok');
      });
    });

    once(el('c-save'), 'Saving\u2026', () => {
      const patch = { z2_target: Math.max(0, Math.min(100, +el('c-z2').value || 70)) };
      /* your own anchors are only saved when they're the ones in use */
      if (Store.config().zones_from !== 'watch') {
        patch.max_hr = +el('c-max').value; patch.resting_hr = +el('c-rest').value; patch.resting_hr_dated = today();
      }
      return Store.setConfig(patch).then(() => { renderSettings(); toast('Zones updated', 'ok'); });
    });

    el('c-export').onclick = () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'groundwork-' + today() + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      Store.setConfig({ exported_at: new Date().toISOString() })
        .then(() => { renderSettings(); toast('Exported', 'ok'); });
    };

    el('c-import').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          Store.importJSON(r.result).then(count => { alert(count + ' activities restored.'); go('home'); });
        } catch (err) { toast('Could not read that file', 'bad'); }
      };
      r.readAsText(f);
    };
  }


  /* ------------------------------------------------------------ editing */

  const FIELD_DEFS = [
    ['date', 'Date', 'date'], ['name', 'Name', 'text'],
    ['distance_km', 'Distance (km)', 'number'], ['elapsed_s', 'Time (m:ss)', 'duration'],
    ['gap_pace_s', 'GAP pace (m:ss)', 'duration'], ['avg_hr', 'Avg HR', 'number'],
    ['cadence_spm', 'Cadence', 'number'], ['ascent_m', 'Ascent (m)', 'number'],
    ['temp_c', 'Temperature', 'number'], ['rpe', 'RPE', 'number'], ['feel', 'Feel', 'text']
  ];

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
    const defs = FIELD_DEFS;

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
    h += '<label><span>What was it</span></label>';
    h += '<div class="bar wrap" id="e-session">' + Calc.SESSIONS.map(s =>
      '<button class="chip" type="button" data-sess="' + s.key + '" aria-pressed="' +
      (a.session === s.key) + '">' + s.label + '</button>').join('') + '</div>';
    h += '<label><span>Where</span></label>';
    h += '<div class="bar wrap" id="e-terrain">' + [['road', 'Road'], ['trail', 'Trail'], ['mixed', 'Mixed']].map(t =>
      '<button class="chip" type="button" data-terr="' + t[0] + '" aria-pressed="' +
      (Calc.terrainOf(a) === t[0]) + '">' + t[1] + '</button>').join('') + '</div>';
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

    let editSession = a.session || null;
    let editTerrain = a.terrain || null;
    document.querySelectorAll('#e-terrain [data-terr]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('#e-terrain [data-terr]').forEach(x =>
          x.setAttribute('aria-pressed', String(x === b)));
        editTerrain = b.dataset.terr;
      };
    });

    document.querySelectorAll('#e-session [data-sess]').forEach(b => {
      b.onclick = () => {
        const on = b.getAttribute('aria-pressed') === 'true';
        document.querySelectorAll('#e-session [data-sess]').forEach(x =>
          x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', String(!on));
        editSession = on ? null : b.dataset.sess;
      };
    });

    once(el('e-save'), 'Saving\u2026', () => {
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
      if (errors.length) { toast('Fix the highlighted fields', 'bad'); return; }

      next.session = editSession;
      next.terrain = editTerrain;
      next.updated_at = new Date().toISOString();
      return Store.put(next).then(() => { go('detail', next.id); toast('Saved', 'ok'); });
    });
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
    /* the same bounds the parser uses, so a value accepted by a paste can
       never be refused by an edit */
    ['avg_hr', 'resting_hr', 'cadence_spm', 'ascent_m', 'temp_c', 'rpe'].forEach(k => {
      const r = Parse.checkBounds(k, a[k]);
      if (r) add(r.level, r.msg);
    });
    (a.laps || []).forEach(l => {
      const r = Parse.checkBounds('avg_hr', l.avg_hr);
      if (r && r.level === 'error') add('error', 'Lap ' + l.n + ': ' + r.msg);
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
    h += pasteBoxHTML('r-paste', 'Paste', 'Paste the table, or only the lap rows.');
    h += '<button class="btn" id="r-read">Read it</button>';
    h += '<div id="r-preview"></div>';

    el('view-replace').innerHTML = h;
    document.querySelectorAll('#view-replace [data-back]').forEach(b => b.onclick = () => go('detail', id));

    bindPasteBox('r-paste',
      () => { el('r-preview').innerHTML = ''; },
      () => el('r-read').click());

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
      if (save && !save.disabled) once(save, 'Applying\u2026', () =>
        Store.put(merged.activity).then(() => {
          go('detail', id);
          toast(merged.changes.length + ' change' +
            (merged.changes.length === 1 ? '' : 's') + ' applied', 'ok');
        }));
    };
  }


  /* --------------------------------------------------------------- wiring */

  function bind() {
    /* Both go through render(), so a failure shows the error screen instead of
       looking like a tap that did nothing. Opening 2025 threw inside
       renderHome and, called directly, the exception escaped the boundary. */
    document.querySelectorAll('#view-home [data-scope]').forEach(b => {
      b.onclick = () => { scope = b.dataset.scope; periodKey = null; render('home'); };
    });
    /* a selection off-screen in a scrolled ribbon is a selection you cannot see */
    const wrap = el('ribbonwrap');
    const land = () => {
      if (!wrap || !wrap.classList.contains('scrolls')) return;
      const on = wrap.querySelector('.rp.on') || wrap.querySelector('.rp:last-child');
      if (!on) return;
      /* measured against the ribbon itself, after layout: offsetLeft is
         relative to whatever ancestor happens to be positioned */
      const a = wrap.getBoundingClientRect(), b = on.getBoundingClientRect();
      wrap.scrollLeft = Math.max(0, wrap.scrollLeft + (b.left - a.left) - a.width / 2 + b.width / 2);
    };
    land();
    if (window.requestAnimationFrame) requestAnimationFrame(land);

    document.querySelectorAll('#view-home [data-period]').forEach(b => {
      b.onclick = () => { periodKey = b.dataset.period; render('home'); };
    });
    document.querySelectorAll('#view-home [data-id]').forEach(r => {
      r.onclick = () => go('detail', r.dataset.id);
    });
    document.querySelectorAll('#view-home .rec[data-id]').forEach(r => {
      r.style.cursor = 'pointer';
    });
    const setup = $('#view-home [data-go="settings"]');
    if (setup) setup.onclick = () => go('settings');
    const bests = $('#view-home [data-go="bests"]');
    if (bests) bests.onclick = () => go('bests');
    const rest = $('#view-home [data-go="resting"]');
    if (rest) rest.onclick = () => go('resting');
    const hs = el('h-sync');
    if (hs) hs.onclick = () => syncGarmin();

  }

  const VIEWS = ['home', 'detail', 'import', 'settings', 'edit', 'replace', 'bests', 'resting', 'bestdist', 'race'];

  /* Navigation writes to browser history, so Android's back button and its
     edge-swipe both go back a screen instead of leaving the app. */
  let popping = false;

  function render(view, param) {
    VIEWS.forEach(v => { el('view-' + v).hidden = (v !== view); });
    window.scrollTo(0, 0);
    try {
      if (view === 'home') renderHome();
      if (view === 'detail') renderDetail(param);
      if (view === 'import') renderImport();
      if (view === 'settings') renderSettings();
      if (view === 'edit') renderEdit(param);
      if (view === 'replace') renderReplace(param);
      if (view === 'bests') renderBests();
      if (view === 'bestdist') renderBestDist(param);
      if (view === 'race') renderRace(param);

      if (view === 'resting') { if (param !== 'keep') recoveryDetail = false; renderResting(); }
    } catch (err) {
      /* Whatever went wrong, there must still be a way to Setup, an export,
         and the error itself. A blank screen tells you nothing and traps you. */
      el('view-' + view).innerHTML =
        '<div class="ttl">Something broke</div>' +
        '<div class="sub">' + esc(view.toUpperCase()) + ' COULD NOT BE DRAWN</div>' +
        '<div class="flag error"><i>\u2715</i><div>' + esc(String(err && err.message || err)) +
        '</div></div>' +
        '<div class="small muted" style="margin-top:12px">Your data is untouched. ' +
        'Export it from Setup, then tell me what this says.</div>' +
        '<button class="btn" data-recover="settings">Open Setup</button>' +
        '<button class="btn ghost" data-recover="home">Try the main screen</button>';
      document.querySelectorAll('#view-' + view + ' [data-recover]').forEach(b => {
        b.onclick = () => go(b.dataset.recover);
      });
      if (window.console) console.error('Groundwork render failed:', err);
    }
  }

  function go(view, param, replace) {
    const state = { view: view, param: param || null };
    if (!popping) {
      if (replace || !history.state) history.replaceState(state, '');
      else history.pushState(state, '');
    }
    render(view, param);
  }

  window.addEventListener('popstate', function (e) {
    const s = e.state || { view: 'home', param: null };
    popping = true;
    render(s.view, s.param);
    popping = false;
  });

  /* Android evicts localStorage from sites that aren't installed. Asking for
     persistence is usually granted once the app is on the home screen, and it
     is what stopped this data disappearing. */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }

  /* Garmin runs arrive through the Apps Script, never through this app: the
     key stays in Script properties. All this shows is how the last check went. */
  function garminHTML(sy) {
    if (!Store.sheetsConfigured() || sy.outdated || !sy.garmin) return '';
    const G = sy.garmin;
    const when = G.at ? (function (d) {
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    })(new Date(G.at)) : '';
    let h = '<div class="sec"><span>Garmin</span><span>' +
      ({ off: 'not connected', waiting: 'waiting', ok: 'checked ' + when,
         key: 'key not working', error: 'last check failed' }[G.state] || '') + '</span></div>';
    if (G.state === 'off') h += '<div class="est">Not connected. To have runs arrive by themselves, ' +
      'follow the Garmin steps in the README.</div>';
    else if (G.state === 'waiting') h += '<div class="est">Key in place \u2014 waiting for the first check.</div>';
    else if (G.state === 'ok') h += '<div class="est">New runs arrive by themselves, checked every hour. ' +
      (G.added || G.linked
        ? 'Last check: ' + (G.added ? G.added + ' new' : '') + (G.added && G.linked ? ', ' : '') +
          (G.linked ? G.linked + ' matched to runs you had pasted' : '') + '.'
        : 'Last check found nothing new.') +
      (G.zonesNote ? ' Your watch\u2019s zones didn\u2019t come through (' + esc(G.zonesNote) + '), so your own are in use.' : '') +
      (G.restingNote ? ' Resting HR didn\u2019t update: ' + esc(G.restingNote) + '.' : '') + '</div>';
    else h += '<div class="flag error"><i>\u2715</i><div>' + esc(G.message || 'The Garmin check failed.') +
      (G.state === 'error' ? ' It tries again every hour.' : '') + '</div></div>';
    return h;
  }

  /* Boot can fail before any screen renders — bad stored JSON, a failed
     migration. The render boundary doesn't cover that, so this does. */
  Store.init().then(() => {
    go('home', null, true);
    /* pull in the background — the screen is already usable from the cache */
    if (Store.sheetsConfigured()) {
      Store.onsync = () => { if (!el('view-settings').hidden) renderSettings(); };
      Store.flush().then(() => Store.pull()).then(() => {
        if (!el('view-home').hidden) render('home');
        promptNewRuns();
        /* said once per open, never silently: something has stopped syncing */
        const G = Store.sync.garmin;
        if (G && G.state === 'key') toast('Garmin key not working \u2014 see Setup', 'bad');
        else if (Store.sync.outdated && Store.sync.state === 'ok')
          toast('Apps Script needs updating \u2014 see Setup', 'bad');
      }).catch(err => { toast('Sync failed: ' + (err.message || err), 'bad'); });
    }
  }).catch(err => {
    if (window.__gwFail) window.__gwFail('startup', String(err && err.message || err));
  });

  window.Groundwork = { go: go };

})();
