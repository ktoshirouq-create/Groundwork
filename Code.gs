/**
 * Groundwork — Apps Script backend.
 *
 * Setup, once, from the script editor:
 *   1. Run setup()            creates the three tabs with their headers
 *   2. Run makeToken()        prints a token; copy it
 *   3. Deploy > New deployment > Web app
 *        Execute as:  Me
 *        Who has access:  Anyone
 *   4. Copy the /exec URL and the token into js/store.js
 *
 * "Anyone" means anyone holding the URL can read and write, which is why the
 * token exists. Treat both as secrets — they are the only thing between your
 * data and whoever finds the link.
 */

var SHEETS = {
  activities: 'Activities',
  laps: 'Laps',
  config: 'Config'
};

var ACT_COLS = [
  'id', 'type', 'date', 'name', 'source',
  'distance_km', 'elapsed_s', 'moving_s',
  'ascent_m', 'descent_m', 'ele_min_m', 'ele_max_m',
  'temp_c', 'avg_hr', 'gap_pace_s', 'cadence_spm',
  'rpe', 'feel', 'conditions', 'pack', 'note',
  'created_at', 'updated_at'
];

var LAP_COLS = ['activity_id', 'n', 'distance_km', 'time_s', 'avg_hr', 'role'];

/* Columns that must never be coerced by Sheets. Dates stay strings — a date
   cell would come back as a Date object in the sheet's timezone and drift. */
var TEXT_COLS = ['id', 'date', 'created_at', 'updated_at', 'name', 'type',
                 'source', 'feel', 'conditions', 'pack', 'note'];

var NUM_KEYS = {
  distance_km: 1, elapsed_s: 1, moving_s: 1, ascent_m: 1, descent_m: 1,
  ele_min_m: 1, ele_max_m: 1, temp_c: 1, avg_hr: 1, gap_pace_s: 1,
  cadence_spm: 1, rpe: 1, n: 1, time_s: 1
};

/* ------------------------------------------------------------------ setup */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, SHEETS.activities, ACT_COLS);
  ensureSheet(ss, SHEETS.laps, LAP_COLS);
  ensureSheet(ss, SHEETS.config, ['key', 'value', 'dated']);
  Logger.log('Tabs ready.');
}

function ensureSheet(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
  var blank = head.every(function (v) { return v === '' || v == null; });
  if (blank) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  /* force plain text on the columns that must not be coerced */
  cols.forEach(function (c, i) {
    if (TEXT_COLS.indexOf(c) >= 0) {
      sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    }
  });
  return sh;
}

function makeToken() {
  var t = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
  PropertiesService.getScriptProperties().setProperty('TOKEN', t);
  Logger.log('Token: ' + t);
  return t;
}

function checkToken(given) {
  var want = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!want) return true;               // no token set: open, for first-run testing
  return given === want;
}

/* ------------------------------------------------- header-mapped row access */

/** Map header name -> zero-based column index. Never assume an order. */
function headerMap(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var m = {};
  head.forEach(function (h, i) { if (h !== '') m[String(h).trim()] = i; });
  return m;
}

function readAll(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var m = headerMap(sh);
  var rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  return rows.filter(function (r) {
    return String(r[m[cols[0]]] || '') !== '';
  }).map(function (r) {
    var o = {};
    cols.forEach(function (c) {
      if (!(c in m)) { o[c] = null; return; }
      var v = r[m[c]];
      if (v === '' || v == null) { o[c] = null; return; }
      o[c] = NUM_KEYS[c] ? Number(v) : String(v);
    });
    return o;
  });
}

function objToRow(sh, cols, obj) {
  var m = headerMap(sh);
  var width = sh.getLastColumn();
  var row = new Array(width).fill('');
  cols.forEach(function (c) {
    if (!(c in m)) return;
    var v = obj[c];
    row[m[c]] = (v === null || v === undefined) ? '' : v;
  });
  return row;
}

function findRowById(sh, idCol, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var m = headerMap(sh);
  var col = m[idCol];
  if (col == null) return -1;
  var vals = sh.getRange(2, col + 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

/* --------------------------------------------------------------- endpoints */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkToken(p.token)) return json({ error: 'bad token' });
  if (p.action === 'list') return json(listAll());
  return json({ ok: true, hint: 'use ?action=list&token=...' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ error: 'bad json' }); }

  if (!checkToken(body.token)) return json({ error: 'bad token' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return json({ error: 'busy' }); }

  try {
    if (body.action === 'put') return json(putActivity(body.activity));
    if (body.action === 'delete') return json(deleteActivity(body.id));
    if (body.action === 'config') return json(putConfig(body.config));
    return json({ error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ actions */

function listAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var acts = readAll(ss.getSheetByName(SHEETS.activities), ACT_COLS);
  var laps = readAll(ss.getSheetByName(SHEETS.laps), LAP_COLS);

  var byAct = {};
  laps.forEach(function (l) {
    (byAct[l.activity_id] = byAct[l.activity_id] || []).push({
      n: l.n, distance_km: l.distance_km, time_s: l.time_s,
      avg_hr: l.avg_hr, role: l.role || 'main'
    });
  });

  acts.forEach(function (a) {
    a.laps = (byAct[a.id] || []).sort(function (x, y) { return x.n - y.n; });
  });

  var cfgRows = readAll(ss.getSheetByName(SHEETS.config), ['key', 'value', 'dated']);
  var config = {};
  cfgRows.forEach(function (r) {
    var v = r.value;
    config[r.key] = (v !== null && v !== '' && !isNaN(Number(v))) ? Number(v) : v;
  });

  return { schema: 1, config: config, activities: acts };
}

function putActivity(act) {
  if (!act || !act.id) return { error: 'no id' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ash = ss.getSheetByName(SHEETS.activities);
  var lsh = ss.getSheetByName(SHEETS.laps);

  var row = objToRow(ash, ACT_COLS, act);
  var at = findRowById(ash, 'id', act.id);
  if (at > 0) ash.getRange(at, 1, 1, row.length).setValues([row]);
  else ash.appendRow(row);

  clearLaps(lsh, act.id);
  var laps = act.laps || [];
  if (laps.length) {
    var rows = laps.map(function (l) {
      return objToRow(lsh, LAP_COLS, {
        activity_id: act.id, n: l.n, distance_km: l.distance_km,
        time_s: l.time_s, avg_hr: l.avg_hr, role: l.role || 'main'
      });
    });
    lsh.getRange(lsh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  return { ok: true, id: act.id, laps: laps.length };
}

/** Delete every lap row for one activity, bottom-up so indices stay valid. */
function clearLaps(lsh, activityId) {
  var last = lsh.getLastRow();
  if (last < 2) return 0;
  var m = headerMap(lsh);
  var col = m.activity_id;
  if (col == null) return 0;
  var vals = lsh.getRange(2, col + 1, last - 1, 1).getValues();
  var n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(activityId)) { lsh.deleteRow(i + 2); n++; }
  }
  return n;
}

function deleteActivity(id) {
  if (!id) return { error: 'no id' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ash = ss.getSheetByName(SHEETS.activities);
  var at = findRowById(ash, 'id', id);
  if (at > 0) ash.deleteRow(at);
  var removed = clearLaps(ss.getSheetByName(SHEETS.laps), id);
  return { ok: true, id: id, laps_removed: removed };
}

function putConfig(config) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.config);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  Object.keys(config || {}).forEach(function (k) {
    var at = findRowById(sh, 'key', k);
    if (at > 0) sh.getRange(at, 2, 1, 2).setValues([[config[k], today]]);
    else sh.appendRow([k, config[k], today]);
  });
  return { ok: true, keys: Object.keys(config || {}).length };
}
