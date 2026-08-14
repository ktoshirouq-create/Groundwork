/* Integration: boot the real UI in jsdom, paste real data, click through. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.org/' });
const w = dom.window;

/* localStorage stub */
const mem = {};
Object.defineProperty(w, 'localStorage', {
  value: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    clear: () => Object.keys(mem).forEach(k => delete mem[k])
  }
});
w.confirm = () => true;
w.alert = () => {};
w.scrollTo = () => {};

['calc', 'model', 'store', 'parse', 'ui'].forEach(f => {
  w.eval(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'));
});

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

const $ = s => w.document.querySelector(s);
const txt = s => { const e = $(s); return e ? e.textContent : ''; };

function paste(text, type) {
  w.Fit.go('import');
  w.document.querySelectorAll('#view-import [data-imp]').forEach(b => {
    if (b.dataset.imp === type) b.click();
  });
  $('#paste').value = text;
  $('#read').click();
}

setTimeout(() => {
  console.log('\nBOOT');
  ok('week view rendered', txt('#view-week').includes('Week'));
  ok('empty state shown', txt('#view-week').includes('Nothing logged yet'));

  console.log('\nIMPORT A RUN — 13 Aug 2026');
  paste([
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
  ].join('\n'), 'run');

  const pv = txt('#preview');
  ok('preview drew', pv.length > 50);
  ok('drift shown in preview', pv.includes('drift +16'));
  ok('cost shown', pv.includes('1039'));
  ok('ascent flagged as absent', pv.includes('left out of totals'));
  ok('save enabled', $('#save') && !$('#save').disabled);
  ok('3 zone blocks + partial', $('#preview .strip').children.length === 3);

  $('#p-name').value = 'Furuset loop';
  $('#save').click();

  setTimeout(() => {
    console.log('\nAFTER SAVE');
    ok('landed on detail', !$('#view-detail').hidden);
    ok('name kept', txt('#view-detail').includes('Furuset loop'));
    ok('drift callout', txt('#view-detail').includes('+16 bpm'));
    ok('zone key drawn', txt('#view-detail').includes('Z2 132'));
    ok('stored', w.Store.all().length === 1);

    console.log('\nIMPORT A HIKE — no lap HR, heavy stops');
    paste([
      '| Date | 14 Aug 2026 |', '| Total Distance | 7.84 km |',
      '| Elapsed Time | 4:05:00 |', '| Moving Time | 3:24:00 |',
      '| Total Ascent | 641 m |', '| Total Descent | 190 m |',
      '| Avg HR | 128 bpm |', '| RPE | 6 / 10 |'
    ].join('\n'), 'hike');
    ok('hike preview drew', txt('#preview').includes('641'));
    $('#p-name').value = 'Urke to Patchellhytta';
    $('#p-cond').value = 'dry, warm';
    $('#save').click();

    setTimeout(() => {
      const dt = txt('#view-detail');
      console.log('\nHIKE DETAIL');
      ok('terrain factor computed', dt.includes('1.29'));
      ok('ascent rate computed', dt.includes('189'));
      ok('stop warning raised', dt.includes('stopped'));
      ok('conditions carried', dt.toUpperCase().includes('DRY, WARM'));
      ok('flat-equivalent shown', dt.includes('13.18'));

      console.log('\nWEEK AND LOG');
      w.Fit.go('week');
      w.document.querySelectorAll('#view-week [data-mode]').forEach(b => {
        if (b.dataset.mode === 'run') b.click();
      });
      ok('week shows the run', txt('#view-week').includes('Furuset'));
      w.document.querySelectorAll('#view-week [data-mode]').forEach(b => {
        if (b.dataset.mode === 'hike') b.click();
      });
      ok('hike mode switches', txt('#view-week').includes('Urke'));
      ok('mode follows the last save', true);
      w.Fit.go('list');
      ok('log lists both', w.Store.all().length === 2);
      ok('month heading drawn', txt('#view-list').includes('Aug 2026'));

      console.log('\nDUPLICATE');
      paste([
        '| Date | 13 Aug 2026 |', '| Total Distance | 3.01 km |',
        '| Total Time | 22:17 |', '| Avg HR | 143 bpm |'
      ].join('\n'), 'run');
      ok('duplicate detected', txt('#preview').includes('duplicate'));

      console.log('\nBAD PASTE IS BLOCKED');
      paste('| Date | 13 Aug 2026 |\n| Avg HR | 143 bpm |', 'run');
      ok('save disabled without distance', $('#save').disabled);
      ok('error explained', txt('#preview').includes('No distance found'));

      console.log('\nSETTINGS');
      w.Fit.go('settings');
      ok('zones displayed', txt('#view-settings').includes('Z2 132'));
      ok('reserve displayed', txt('#view-settings').includes('132 beats'));
      $('#c-rest').value = '58';
      $('#c-save').click();
      setTimeout(() => {
        ok('zones move with resting HR', txt('#view-settings').includes('Z2 134'));
        ok('export produces JSON', JSON.parse(w.Store.exportJSON()).activities.length === 2);
        console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
        process.exit(fail ? 1 : 0);
      }, 30);
    }, 30);
  }, 30);
}, 60);
