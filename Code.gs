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
 * Garmin, once (see "Garmin" in README.md for the same steps with pictures
 * in words):
 *   5. Project Settings > Script properties > Add script property
 *        Property:  GARMIN_KEY
 *        Value:     your Garmin Connect Personal API key
 *   6. Run setupGarmin()      checks the key, writes a "Garmin check" tab,
 *                             imports recent runs and checks hourly from then on
 *   7. Deploy > Manage deployments > edit > Version: New version > Deploy
 *        (same URL and token, so nothing changes in the app)
 *
 * The key lives only in Script properties — never in this file, the sheet or
 * the repo.
 *
 * "Anyone" means anyone holding the URL can read and write, which is why the
 * token exists. Treat both as secrets — they are the only thing between your
 * data and whoever finds the link.
 */

var SHEETS = {
  activities: 'Activities',
  laps: 'Laps',
  config: 'Config',
  resting: 'Resting HR'          // one row a day, from Garmin; written only by this script
};
var RESTING_COLS = ['date', 'bpm'];

var ACT_COLS = [
  'id', 'type', 'date', 'name', 'source',
  'distance_km', 'elapsed_s', 'moving_s',
  'ascent_m', 'descent_m', 'ele_min_m', 'ele_max_m',
  'temp_c', 'avg_hr', 'gap_pace_s', 'cadence_spm',
  'rpe', 'feel', 'conditions', 'pack', 'note',
  'created_at', 'updated_at',
  /* Added Oct 2026. These lived only on the phone: a storage clear lost every
     session tag and both field-test results. Nothing the app stores on a run
     may be missing from this list — tests check it against the app's fields. */
  'resting_hr', 'session', 'subtype', 'value', 'protocol_note',
  /* written by the Garmin import only; the app never sets it */
  'garmin_id',
  /* from the watch file's second-by-second record (Oct 2026): best efforts at
     standard distances, seconds spent at each heart rate, drift, max HR.
     stream_v says which version of the reader produced them. */
  'max_hr', 'efforts', 'hr_hist', 'drift_bpm', 'stream_v',
  /* road (empty) or trail: from Garmin's activity type, or set in the app */
  'terrain'
];

/* Columns the server owns. A run sent up from the app never blanks them. */
var SERVER_COLS = ['garmin_id', 'efforts', 'hr_hist', 'drift_bpm', 'stream_v'];

var LAP_COLS = ['activity_id', 'n', 'distance_km', 'time_s', 'avg_hr', 'role'];

/* Columns that must never be coerced by Sheets. Dates stay strings — a date
   cell would come back as a Date object in the sheet's timezone and drift. */
var TEXT_COLS = ['id', 'date', 'created_at', 'updated_at', 'name', 'type',
                 'source', 'feel', 'conditions', 'pack', 'note',
                 'session', 'subtype', 'protocol_note', 'garmin_id', 'efforts', 'hr_hist', 'terrain'];

var NUM_KEYS = {
  distance_km: 1, elapsed_s: 1, moving_s: 1, ascent_m: 1, descent_m: 1,
  ele_min_m: 1, ele_max_m: 1, temp_c: 1, avg_hr: 1, gap_pace_s: 1,
  cadence_spm: 1, rpe: 1, n: 1, time_s: 1, resting_hr: 1, value: 1,
  max_hr: 1, drift_bpm: 1, stream_v: 1
};

/* ------------------------------------------------------------------ setup */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, SHEETS.activities, ACT_COLS);
  ensureSheet(ss, SHEETS.laps, LAP_COLS);
  ensureSheet(ss, SHEETS.config, ['key', 'value', 'dated']);
  ensureSheet(ss, SHEETS.resting, RESTING_COLS);
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

/* A sheet set up before a column existed has no header for it, and a column
   with no header is silently never written. Add what's missing, at the end,
   so nothing already there moves. Cheap when nothing is missing. */
function addMissingHeaders(sh, cols) {
  var m = headerMap(sh);
  var missing = cols.filter(function (c) { return !(c in m); });
  if (!missing.length) return 0;
  var at = sh.getLastColumn() + 1;
  sh.getRange(1, at, 1, missing.length).setValues([missing]).setFontWeight('bold');
  missing.forEach(function (c, i) {
    if (TEXT_COLS.indexOf(c) >= 0 && sh.getMaxRows() > 1)
      sh.getRange(2, at + i, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  return missing.length;
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
      /* A date column that lost its plain-text format comes back as a Date.
         Hand it over as YYYY-MM-DD so the client never has to guess. */
      if (v instanceof Date) {
        o[c] = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        o[c] = NUM_KEYS[c] ? Number(v) : String(v);
      }
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
    if (body.action === 'fields') return json(putFields(body.fields));
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
  addMissingHeaders(ss.getSheetByName(SHEETS.activities), ACT_COLS);
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

  /* columns: lets the app tell an up-to-date script from an old deployment.
     garmin: how the last import went, so a dead key is said, not hidden. */
  return { schema: 1, config: config, activities: acts,
           columns: ACT_COLS, garmin: garminStatus(), resting: restingRows() };
}

function putActivity(act) {
  if (!act || !act.id) return { error: 'no id' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ash = ss.getSheetByName(SHEETS.activities);
  var lsh = ss.getSheetByName(SHEETS.laps);

  addMissingHeaders(ash, ACT_COLS);
  var row = objToRow(ash, ACT_COLS, act);
  var at = findRowById(ash, 'id', act.id);
  if (at > 0) {
    /* keep what only the server writes */
    var hm0 = headerMap(ash);
    var old = ash.getRange(at, 1, 1, row.length).getValues()[0];
    SERVER_COLS.forEach(function (c) {
      if (hm0[c] != null && (row[hm0[c]] === '' || row[hm0[c]] == null)) row[hm0[c]] = old[hm0[c]];
    });
    ash.getRange(at, 1, 1, row.length).setValues([row]);
  }
  else { ash.appendRow(row); at = ash.getLastRow(); }
  /* force the text columns back to plain text on this row — a format set on
     empty rows at setup() does not survive an append */
  var hm = headerMap(ash);
  TEXT_COLS.forEach(function (c) {
    if (hm[c] == null) return;
    ash.getRange(at, hm[c] + 1).setNumberFormat('@');
  });

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
  if (at > 0) {
    /* a run deleted on purpose must not come back on the next Garmin check */
    var hm = headerMap(ash);
    if (hm.garmin_id != null) {
      var gid = String(ash.getRange(at, hm.garmin_id + 1).getValue() || '');
      if (gid) garminSkip(gid);
    }
    ash.deleteRow(at);
  }
  var removed = clearLaps(ss.getSheetByName(SHEETS.laps), id);
  return { ok: true, id: id, laps_removed: removed };
}

/* Fill fields on runs already in the sheet without touching anything else:
   no laps rewritten, no timestamps moved. Used once, to bring up the session
   tags and test results that until now lived only on the phone. Only fills —
   a value already in the sheet is never overwritten by this. */
function putFields(fields) {
  var ash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.activities);
  addMissingHeaders(ash, ACT_COLS);
  var hm = headerMap(ash);
  var last = ash.getLastRow();
  if (last < 2) return { ok: true, filled: 0 };
  var width = ash.getLastColumn();
  var range = ash.getRange(2, 1, last - 1, width);
  var rows = range.getValues();
  var filled = 0;
  rows.forEach(function (r) {
    var f = (fields || {})[String(r[hm.id])];
    if (!f) return;
    Object.keys(f).forEach(function (c) {
      if (hm[c] == null || ACT_COLS.indexOf(c) < 0 || SERVER_COLS.indexOf(c) >= 0) return;
      if (f[c] === null || f[c] === undefined || f[c] === '') return;
      if (r[hm[c]] !== '' && r[hm[c]] != null) return;
      r[hm[c]] = f[c];
      filled++;
    });
  });
  range.setValues(rows);
  return { ok: true, filled: filled };
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

/* ================================================================= Garmin ===

   Runs come in from Garmin Connect's Personal API on an hourly trigger and are
   written to the sheet like any other run; the app picks them up on its normal
   sync. The key never leaves Script properties.

   Where each figure comes from:
   - the activity list (JSON) decides which activities are runs, gives the
     local date and Garmin's grade-adjusted pace;
   - the original .FIT file gives everything else — distance, time, heart
     rate, cadence, ascent, temperature and every lap. The FIT format is
     published and fixed, so the import does not depend on guessed JSON names.
   Only laps are kept from the file. The GPS track is never stored.

   A run you already pasted is matched (same day, same distance within 2% or
   time within a minute) and linked rather than imported twice. Linking only
   records the Garmin id; your pasted figures are left exactly as they are. */

var GARMIN_BASE = 'https://personal.connectapi.garmin.com';
var GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
var GARMIN_FIRST_DAYS = 14;     // how far back the first import looks
var GARMIN_OVERLAP_DAYS = 3;    // each check re-reads a few days, for late watch syncs

function garminProps() { return PropertiesService.getScriptProperties(); }

function garminStatus() {
  var props = garminProps();
  if (!props.getProperty('GARMIN_KEY')) return { state: 'off' };
  var st;
  try { st = JSON.parse(props.getProperty('GARMIN_STATUS') || '{"state":"waiting"}'); }
  catch (e) { st = { state: 'waiting' }; }
  /* your watch's zones ride along with the status: the app reads them on every sync */
  try { var z = JSON.parse(props.getProperty('GARMIN_ZONES') || 'null'); if (z) st.zones = z; } catch (e) {}
  return st;
}

function garminSetStatus(st) {
  st.at = new Date().toISOString();
  garminProps().setProperty('GARMIN_STATUS', JSON.stringify(st));
  return st;
}

function garminSkip(gid) {
  var props = garminProps();
  var list = (props.getProperty('GARMIN_SKIP') || '').split(',').filter(String);
  if (list.indexOf(gid) < 0) list.push(gid);
  props.setProperty('GARMIN_SKIP', list.slice(-500).join(','));
}

/* A real Error, so Apps Script's log shows the message instead of
   "[object Object]"; .kind says which sort of failure it was. */
function GarminError(kind, message, code) {
  var e = new Error(message);
  e.name = 'GarminError'; e.kind = kind; e.code = code || null;
  return e;
}

function garminToken() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('GARMIN_BEARER');
  if (hit) return hit;
  var key = garminProps().getProperty('GARMIN_KEY');
  if (!key) throw new GarminError('key', 'No GARMIN_KEY in Script properties.');
  var res = UrlFetchApp.fetch(GARMIN_BASE + GARMIN_TOKEN_PATH, {
    method: 'post', muteHttpExceptions: true,
    headers: { 'Authorization': 'ApiKey ' + key.trim(), 'Accept': '*/*' }
  });
  var code = res.getResponseCode();
  if (code === 401 || code === 403)
    throw new GarminError('key', 'Garmin refused the key \u2014 it has probably expired. ' +
      'Make a new one in Garmin Connect and replace GARMIN_KEY in Script properties.');
  if (code >= 300) throw new GarminError('http', 'Garmin did not hand out a token (HTTP ' + code + ').');
  var token = res.getContentText().trim();
  /* tokens last 24 hours; keep it for 20 */
  cache.put('GARMIN_BEARER', token, 20 * 3600);
  return token;
}

function garminGet(path, params, raw) {
  var q = params ? '?' + Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&') : '';
  var res = UrlFetchApp.fetch(GARMIN_BASE + path + q, {
    muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + garminToken(),
               'Accept': raw ? 'application/zip, application/x-zip-compressed, application/octet-stream' : 'application/json' }
  });
  var code = res.getResponseCode();
  if (code === 401 || code === 403) {
    CacheService.getScriptCache().remove('GARMIN_BEARER');
    throw new GarminError('key', 'Garmin refused the key \u2014 it has probably expired. ' +
      'Make a new one in Garmin Connect and replace GARMIN_KEY in Script properties.');
  }
  if (code >= 300) throw new GarminError('http', 'Garmin did not answer (HTTP ' + code + ' on ' +
    path.split('/')[1] + ')' + (raw ? '' : ': ' + String(res.getContentText() || '').slice(0, 160)) + '.', code);
  return raw ? res.getBlob() : JSON.parse(res.getContentText() || 'null');
}

/* The list comes back either bare or wrapped, depending on the endpoint version. */
function garminList(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.activities)) return v.activities;
  if (v && Array.isArray(v.activityList)) return v.activityList;
  return [];
}

function garminSearch(from, to) {
  var all = [], start = 0, page;
  do {
    page = garminList(garminGet('/activitylist-service/activities/search/activities',
      { start: start, limit: 100, startDate: from, endDate: to }));
    all = all.concat(page);
    start += page.length;
  } while (page.length === 100 && start < 2000);
  return all;
}

/* Running of any kind by Garmin's own type key; anything else is not ours. */
function garminIsRun(j) {
  var t = j && j.activityType && (j.activityType.typeKey || j.activityType.key) || '';
  return /run/i.test(String(t));
}

function garminFit(gid) {
  var blob = garminGet('/download-service/files/activity/' + gid, null, true);
  var bytes;
  try {
    var parts = Utilities.unzip(blob);
    var fit = parts.filter(function (b) { return /\.fit$/i.test(b.getName()); })[0] || parts[0];
    bytes = fit.getBytes();
  } catch (e) {
    bytes = blob.getBytes();         // not zipped
  }
  return fitDecode(bytes);
}

/* ------------------------------------------------------------- FIT reader ---
   Just enough of the published FIT format for sessions and laps. Handles
   both byte orders, developer fields (skipped) and compressed timestamps. */

function fitDecode(input) {
  var b = [];
  for (var i = 0; i < input.length; i++) b.push(input[i] & 0xff);
  var hdr = b[0];
  if (b.length < 12 || String.fromCharCode(b[8], b[9], b[10], b[11]) !== '.FIT')
    throw new GarminError('fit', 'Not a FIT file.');
  var dataSize = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] * 16777216);
  var p = hdr, end = Math.min(b.length, hdr + dataSize);
  var defs = {}, out = { sessions: [], laps: [], records: [] }, lastTs = null;
  var SIZES = { 0: 1, 1: 1, 2: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x07: 1, 0x88: 4,
                0x89: 8, 0x0a: 1, 0x8b: 2, 0x8c: 4, 0x0d: 1, 0x8e: 8, 0x8f: 8, 0x90: 8 };
  function uint(off, size, le) {
    var v = 0;
    for (var k = 0; k < size; k++) v += b[off + (le ? k : size - 1 - k)] * Math.pow(256, k);
    return v;
  }
  while (p < end) {
    var h = b[p++];
    if (h & 0x80) {                                   // compressed timestamp
      var d = defs[(h >> 5) & 0x03];
      if (!d) throw new GarminError('fit', 'FIT data before its definition.');
      p = readData(d, p, h & 0x1f);
      continue;
    }
    var local = h & 0x0f;
    if (h & 0x40) {                                   // definition
      var le = b[p + 1] === 0;
      var gnum = uint(p + 2, 2, le);
      var nf = b[p + 4];
      p += 5;
      var fields = [];
      for (var f = 0; f < nf; f++) { fields.push({ num: b[p], size: b[p + 1], base: b[p + 2] }); p += 3; }
      var devSize = 0;
      if (h & 0x20) { var nd = b[p++]; for (var g = 0; g < nd; g++) { devSize += b[p + 1]; p += 3; } }
      defs[local] = { gnum: gnum, le: le, fields: fields, devSize: devSize };
    } else {
      var dd = defs[local];
      if (!dd) throw new GarminError('fit', 'FIT data before its definition.');
      p = readData(dd, p);
    }
  }
  function readData(d, at, offset) {
    var rec = {};
    d.fields.forEach(function (fd) {
      var bt = fd.base & 0x9f, unit = SIZES[fd.base] || SIZES[bt] || 1;
      if (fd.size === unit && unit <= 4) {
        var v = uint(at, unit, d.le);
        var invalid = unit === 1 ? (bt === 0x01 ? 0x7f : 0xff) : unit === 2 ? (fd.base === 0x83 ? 0x7fff : 0xffff)
                    : (fd.base === 0x85 ? 0x7fffffff : 0xffffffff);
        if (v !== invalid) {
          if (fd.base === 0x01 && v > 127) v -= 256;           // sint8
          if (fd.base === 0x83 && v > 32767) v -= 65536;       // sint16
          if (fd.base === 0x85 && v > 2147483647) v -= 4294967296;
          rec[fd.num] = v;
        }
      }
      at += fd.size;
    });
    at += d.devSize;
    if (offset != null && lastTs != null)                       // compressed timestamp
      rec[253] = lastTs + ((offset - (lastTs & 0x1f)) & 0x1f);
    if (rec[253] != null) lastTs = rec[253];
    if (d.gnum === 18) out.sessions.push(rec);
    if (d.gnum === 19) out.laps.push(rec);
    if (d.gnum === 20 && rec[253] != null)
      out.records.push({ t: rec[253], d: rec[5] != null ? rec[5] / 100 : null, hr: rec[3] != null ? rec[3] : null });
    return at;
  }
  return out;
}

/* ------------------------------------------------- the second-by-second --

   From the file's records: distance and heart rate, once a second or so.
   - Best efforts: the fastest stretch of exactly each distance, starting
     anywhere — not tied to lap boundaries. Interpolated at the start so a
     window covers the distance exactly. A window faster than 2:00/km is a
     GPS jump, not running, and is ignored.
   - Seconds at each heart rate, so the app can work out time in zone exactly
     for whatever zones you set, now or later.
   - Drift, the app's own definition (last third against first third, opening
     kilometre dropped), measured on the stream rather than on lap averages.
   Gaps over 10 s are pauses and count as no time. */

/* v2 (Oct 2026): v1 treated every gap over 10 s as a pause and dropped its
   time but kept its distance. Older watches record "smart", a point every few
   seconds and sometimes 15-20 s apart, so hundreds of metres took no time at
   all and 2017 showed a 1 km in 2:16. A gap is now a pause only if you barely
   moved during it; otherwise it is running time however long it is. And a
   step between two points faster than any runner (a GPS jump) adds no
   distance. */
var STREAM_V = 2;
var EFFORT_M = [400, 1000, 1609, 5000, 10000, 21097, 42195];
var FASTEST_S_PER_KM = 120;
var PAUSE_S = 10;            // a gap longer than this might be a pause...
var PAUSE_MPS = 0.5;         // ...and is one if you moved slower than this during it
var JUMP_MPS = 8;            // faster than this between two points is GPS, not legs

/* Clean the record into running time and trustworthy distance. */
function streamClean(records) {
  var r = (records || []).filter(function (x) { return x.t != null; });
  var out = [];
  var time = 0, dist = null, prevD = null;
  for (var i = 0; i < r.length; i++) {
    var hasD = r[i].d != null;
    if (i) {
      var dt = r[i].t - r[i - 1].t;
      var step = hasD && prevD != null ? r[i].d - prevD : null;
      var paused = dt > PAUSE_S && (step == null || step < PAUSE_MPS * dt);
      var run = dt > 0 && !paused ? dt : 0;
      time += run;
      if (step != null && dist != null) {
        var jump = step < 0 || (dt > 0 ? step / dt > JUMP_MPS : step > 0);
        if (!jump) dist += step;
      }
      out.push({ t: time, d: dist, hr: r[i].hr, dt: run, hrPrev: r[i - 1].hr });
    } else {
      dist = hasD ? 0 : null;
      out.push({ t: 0, d: dist, hr: r[i].hr, dt: 0, hrPrev: null });
    }
    if (hasD) { prevD = r[i].d; if (dist == null) dist = 0; }
  }
  return out;
}

function streamFigures(records) {
  var c = streamClean(records);
  if (c.length < 10) return null;

  var efforts = {};
  var di = [], ti = [];
  c.forEach(function (x) { if (x.d != null) { di.push(x.d); ti.push(x.t); } });
  EFFORT_M.forEach(function (D) {
    if (!di.length || di[di.length - 1] - di[0] < D) return;
    var best = null, a = 0;
    for (var j = 1; j < di.length; j++) {
      if (di[j] - di[0] < D) continue;
      while (a + 1 < j && di[j] - di[a + 1] >= D) a++;
      /* start part-way between a and a+1 so the window is exactly D */
      var over = di[j] - di[a] - D, seg = di[a + 1] - di[a];
      var start = ti[a] + (seg > 0 ? over / seg * (ti[a + 1] - ti[a]) : 0);
      var sec = ti[j] - start;
      if (sec > 0 && sec / (D / 1000) >= FASTEST_S_PER_KM && (best == null || sec < best)) best = sec;
    }
    if (best != null) efforts[D] = Math.round(best);
  });

  var hist = {};
  c.forEach(function (x) {
    if (x.dt > 0 && x.hrPrev != null) hist[x.hrPrev] = (hist[x.hrPrev] || 0) + x.dt;
  });
  var histStr = Object.keys(hist).map(Number).sort(function (x, y) { return x - y; })
    .map(function (b) { return b + ':' + hist[b]; }).join(',');

  /* drift: drop the first kilometre, compare the last third with the first */
  var driftBpm = null;
  var endD = di.length ? di[di.length - 1] : null, startD = 1000;
  if (endD != null && endD - startD >= 3000) {
    var third = (endD - startD) / 3, sums = [0, 0], secs = [0, 0];
    c.forEach(function (x) {
      if (!(x.dt > 0) || x.hr == null || x.d == null || x.d < startD) return;
      var part = x.d < startD + third ? 0 : x.d >= endD - third ? 1 : -1;
      if (part < 0) return;
      sums[part] += x.hr * x.dt; secs[part] += x.dt;
    });
    if (secs[0] && secs[1]) driftBpm = Math.round(sums[1] / secs[1] - sums[0] / secs[0]);
  }
  return { efforts: Object.keys(efforts).length ? JSON.stringify(efforts) : '',
           hr_hist: histStr, drift_bpm: driftBpm };
}

/* Trail by Garmin's own activity type; anything else is left for you. */
function garminTerrain(j) {
  var t = String(j && j.activityType && (j.activityType.typeKey || j.activityType.key) || '');
  return /trail/i.test(t) ? 'trail' : '';
}

/* ---------------------------------------------------- one Garmin run → row */

var MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function r2(x) { return Math.round(x * 100) / 100; }

/* A name you gave the run in Garmin Connect ("Oslo Marathon") is kept, so
   races are easy to find and tag. Garmin's automatic names ("Oslo Running",
   "Treadmill Running") are not — the app's own format reads better. */
function garminName(n) {
  n = String(n || '').trim();
  if (!n || /(^|\s)(trail |treadmill |track |indoor |virtual )?(running|run)$/i.test(n)) return '';
  return n.slice(0, 80);
}

function garminActivity(j, fit) {
  var gid = String(j.activityId);
  var date = String(j.startTimeLocal || j.startTimeGMT || '').slice(0, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return null;           // no date, no run
  var s = (fit && fit.sessions && fit.sessions[0]) || {};
  if (s[5] != null && s[5] !== 1) return null;                 // FIT says not running
  var dist = s[9] != null ? r2(s[9] / 100000) : (j.distance != null ? r2(j.distance / 1000) : null);
  var timer = s[8] != null ? Math.round(s[8] / 1000)
            : (j.duration != null ? Math.round(j.duration) : null);
  var cad = s[18] != null ? Math.round((s[18] + (s[92] || 0) / 128) * 2) : null;
  var gapSpeed = j.avgGradeAdjustedSpeed;
  var st = streamFigures(fit && fit.records);
  var laps = ((fit && fit.laps) || []).map(function (l, i) {
    return { n: i + 1,
             distance_km: l[9] != null ? r2(l[9] / 100000) : null,
             time_s: l[8] != null ? Math.round(l[8] / 1000) : null,
             avg_hr: l[15] != null ? l[15] : null,
             role: 'main' };
  }).filter(function (l) { return l.distance_km > 0 && l.time_s > 0; });
  var now = new Date().toISOString();
  return {
    id: 'run-' + date + '-g' + gid,
    type: 'run', date: date,
    name: garminName(j.activityName) || 'Run \u00b7 ' + (+date.slice(8)) + ' ' + MON3[+date.slice(5, 7) - 1],
    source: 'tracked',
    distance_km: dist,
    elapsed_s: timer,
    moving_s: j.movingDuration != null ? Math.round(j.movingDuration) : null,
    ascent_m: s[22] != null ? s[22] : (j.elevationGain != null ? Math.round(j.elevationGain) : null),
    descent_m: s[23] != null ? s[23] : (j.elevationLoss != null ? Math.round(j.elevationLoss) : null),
    /* the watch's own sensor sits against your wrist and reads warm; your
       pasted runs hold the weather, so the two must not share a column */
    temp_c: null,
    avg_hr: s[16] != null ? s[16] : (j.averageHR != null ? Math.round(j.averageHR) : null),
    gap_pace_s: gapSpeed > 0 ? Math.round(1000 / gapSpeed) : null,
    cadence_spm: cad,
    garmin_id: gid,
    max_hr: s[17] != null ? s[17] : null,
    efforts: st ? st.efforts : '',
    hr_hist: st ? st.hr_hist : '',
    drift_bpm: st ? st.drift_bpm : null,
    stream_v: STREAM_V,
    terrain: garminTerrain(j),
    laps: laps,
    created_at: now, updated_at: now
  };
}

/* Same day, and the same distance within 2% or the same time within a
   minute — the app's own duplicate rule, so a pasted run is recognised. */
function garminMatch(act, rows) {
  return rows.filter(function (r) {
    if (r.date !== act.date || (r.type && r.type !== 'run')) return false;
    var dOk = r.distance_km != null && act.distance_km != null &&
      Math.abs(r.distance_km - act.distance_km) <= Math.max(0.05, act.distance_km * 0.02);
    var tOk = r.elapsed_s != null && act.elapsed_s != null &&
      Math.abs(r.elapsed_s - act.elapsed_s) <= 60;
    return dOk || tOk;
  })[0] || null;
}

function isoDay(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/* ------------------------------------------------------------ the import -- */

/* Everything both the hourly check and the history import need to decide,
   for one activity, whether it is new, already known, or a run you pasted. */
function garminContext(ash) {
  var rows = readAll(ash, ACT_COLS);
  var known = {};
  rows.forEach(function (r) { if (r.garmin_id) known[String(r.garmin_id)] = true; });
  (garminProps().getProperty('GARMIN_SKIP') || '').split(',').forEach(function (g) { if (g) known[g] = true; });
  return { ash: ash, rows: rows, known: known, hm: headerMap(ash), added: 0, linked: 0 };
}

function garminHandle(j, cx) {
  var gid = String(j.activityId);
  if (cx.known[gid]) return 'known';
  /* match on the list's own figures first — no download for a run you pasted */
  var probe = { date: String(j.startTimeLocal || '').slice(0, 10),
                distance_km: j.distance != null ? r2(j.distance / 1000) : null,
                elapsed_s: j.duration != null ? Math.round(j.duration) : null };
  var mine = garminMatch(probe, cx.rows);
  var act = null;
  if (!mine) {
    act = garminActivity(j, garminFit(gid));
    if (!act) {
      /* the file says it isn't a run: never download it again */
      garminSkip(gid); cx.known[gid] = true;
      return 'skip';
    }
    mine = garminMatch(act, cx.rows);
  }
  if (mine && mine.garmin_id && String(mine.garmin_id) !== gid) {
    /* the same run uploaded twice to Garmin: keep the first link */
    garminSkip(gid); cx.known[gid] = true;
    return 'skip';
  }
  if (mine) {
    /* link only: your figures and timestamps stay as they are */
    var at = findRowById(cx.ash, 'id', mine.id);
    if (at > 0) cx.ash.getRange(at, cx.hm.garmin_id + 1).setNumberFormat('@').setValue(gid);
    mine.garmin_id = gid;
    cx.linked++;
  } else {
    putActivity(act);
    cx.rows.push(act);
    cx.added++;
  }
  cx.known[gid] = true;
  return mine ? 'linked' : 'added';
}

/** Hourly. Also safe to run by hand from the editor. */
function garminSync() {
  if (!garminProps().getProperty('GARMIN_KEY')) return garminSetStatus({ state: 'off' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return garminStatus();
  try {
    var props = garminProps();
    var ash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.activities);
    addMissingHeaders(ash, ACT_COLS);
    var today = new Date();
    var since = props.getProperty('GARMIN_SINCE') ||
      isoDay(new Date(today.getTime() - GARMIN_FIRST_DAYS * 864e5));
    var found = garminSearch(since, isoDay(today)).filter(garminIsRun);
    var cx = garminContext(ash);
    found.forEach(function (j) { garminHandle(j, cx); });
    props.setProperty('GARMIN_SINCE',
      isoDay(new Date(today.getTime() - GARMIN_OVERLAP_DAYS * 864e5)));
    /* resting HR and zones each on their own: neither failing may look like a failed import */
    var st = { state: 'ok', added: cx.added, linked: cx.linked, seen: found.length };
    try { garminResting(); } catch (e) { st.restingNote = String(e.message || e); }
    try { if (!garminZones()) st.zonesNote = 'Garmin sent no zones the app could read'; }
    catch (e) { st.zonesNote = String(e.message || e); }
    return garminSetStatus(st);
  } catch (e) {
    var kind = e && e.kind ? e.kind : 'error';
    return garminSetStatus({ state: kind === 'key' ? 'key' : 'error',
                             message: String(e.message || e) });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------- resting HR --

   Garmin measures resting heart rate every day. It is kept, one row a day,
   in the "Resting HR" tab, and shown in the app as context: how it has moved
   over weeks, months and years. It does NOT move your zones. Those come from
   your watch (below), because they are the numbers you actually run by.

   The hourly check adds the last fortnight (Garmin sometimes settles a day's
   value late); garminRestingHistory() fills in everything before that, once. */

var RESTING_CHUNK_DAYS = 28;
var RESTING_FROM_YEAR = 2010;

/* The value from one day's summary, whatever Garmin names it. */
function restingOfDay(e) {
  if (!e) return null;
  var v = e.restingHeartRate != null ? e.restingHeartRate
        : e.restingHeartRateValue != null ? e.restingHeartRateValue
        : e.restingHR != null ? e.restingHR : null;
  v = Number(v);
  return v >= 25 && v <= 120 ? Math.round(v) : null;
}

/* Pure: a summary list as [date, bpm] rows, days without a value left out. */
function restingDays(list) {
  return (list || []).map(function (e) {
    return [String(e.calendarDate || e.date || '').slice(0, 10), restingOfDay(e)];
  }).filter(function (d) { return d[1] != null && /^\d{4}-\d\d-\d\d$/.test(d[0]); });
}

function restingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEETS.resting);
  if (!sh) { sh = ss.insertSheet(SHEETS.resting); sh.appendRow(RESTING_COLS); sh.getRange('A:A').setNumberFormat('@'); }
  return sh;
}

/* Write days in, replacing a date already there. Kept in date order. */
function restingUpsert(rows) {
  if (!rows.length) return 0;
  var sh = restingSheet();
  var last = sh.getLastRow();
  var have = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    var d = r[0] instanceof Date ? isoDay(r[0]) : String(r[0]).slice(0, 10);
    if (d) have[d] = Number(r[1]);
  });
  var changed = 0;
  rows.forEach(function (r) { if (have[r[0]] !== r[1]) { have[r[0]] = r[1]; changed++; } });
  if (!changed) return 0;
  var all = Object.keys(have).sort().map(function (d) { return [d, have[d]]; });
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  sh.getRange(2, 1, all.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, all.length, 2).setValues(all);
  return changed;
}

function restingRows() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.resting);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().map(function (r) {
    return [r[0] instanceof Date ? isoDay(r[0]) : String(r[0]).slice(0, 10), Number(r[1])];
  }).filter(function (r) { return r[0] && r[1] > 0; });
}

function garminRestingRange(from, to) {
  var res = garminGet('/usersummary-service/v2/dailysummaries', { startDate: from, endDate: to });
  return restingDays(Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []));
}

function garminResting() {
  var today = new Date();
  return restingUpsert(garminRestingRange(isoDay(new Date(today.getTime() - 13 * 864e5)), isoDay(today)));
}

/** Once, from the editor: every day Garmin has. Press Run until it says done.
    Starts at your first run (there is no resting HR before you had a watch).
    A stretch Garmin refuses is skipped and named in the log, not fatal. */
function garminRestingHistory() {
  var started = Date.now(), props = garminProps();
  var cursor = props.getProperty('GARMIN_RESTING_CURSOR');
  if (!cursor) {
    var dates = readAll(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.activities), ACT_COLS)
      .map(function (a) { return String(a.date || ''); }).filter(function (d) { return /^\d{4}-\d\d-\d\d$/.test(d); }).sort();
    cursor = dates.length ? dates[0].slice(0, 7) + '-01' : RESTING_FROM_YEAR + '-01-01';
  }
  var today = isoDay(new Date()), added = 0, cut = false, refused = [];
  while (cursor <= today) {
    if (Date.now() - started > HISTORY_BUDGET_MS) { cut = true; break; }
    var end = isoDay(new Date(new Date(cursor + 'T12:00:00Z').getTime() + (RESTING_CHUNK_DAYS - 1) * 864e5));
    if (end > today) end = today;
    try { added += restingUpsert(garminRestingRange(cursor, end)); }
    catch (e) {
      if (e && e.kind === 'key') throw e;                 // a dead key stops everything, and says so
      refused.push(cursor + '\u2013' + end + ': ' + (e && e.message || e));
    }
    cursor = isoDay(new Date(new Date(end + 'T12:00:00Z').getTime() + 864e5));
    props.setProperty('GARMIN_RESTING_CURSOR', cursor);
  }
  var rows = restingRows();
  var msg = (cut ? 'Resting HR: ' + added + ' days added this run, up to ' + cursor + '. Press Run again to carry on.'
    : 'Resting HR history complete: ' + rows.length + ' days' + (rows.length ? ', from ' + rows[0][0] : '') + '.') +
    (refused.length ? ' Garmin refused ' + refused.length + ' stretch' + (refused.length === 1 ? '' : 'es') +
      '; first: ' + refused[0] : '');
  if (!cut) props.deleteProperty('GARMIN_RESTING_CURSOR');
  Logger.log(msg);
  return { complete: !cut, days: rows.length, refused: refused, message: msg };
}

/* --------------------------------------------------------- watch zones --

   Your heart-rate zones exactly as they are set on your watch, so the app
   never disagrees with the numbers you run by. Garmin keeps a set per sport;
   running's is used, else the default. Kept in Script properties and sent
   with the Garmin status. Change them on the watch and the app follows on the
   next hourly check. */

function zonesFrom(list) {
  var arr = Array.isArray(list) ? list : (list && Array.isArray(list.data) ? list.data : []);
  var pick = arr.filter(function (z) { return /run/i.test(String(z.sport || '')); })[0] ||
             arr.filter(function (z) { return /default/i.test(String(z.sport || '')); })[0] || arr[0];
  if (!pick) return null;
  var f = [1, 2, 3, 4, 5].map(function (n) { return Number(pick['zone' + n + 'Floor']); });
  var ok = f.every(function (v) { return v > 0; }) && f[1] > f[0] && f[2] > f[1] && f[3] > f[2] && f[4] > f[3];
  if (!ok) return null;
  return { z1: f[0], z2: f[1], z3: f[2], z4: f[3], z5: f[4],
           max: Number(pick.maxHeartRateUsed) || null, rest: Number(pick.restingHeartRateUsed) || null,
           method: String(pick.trainingMethod || ''), sport: String(pick.sport || '') };
}

function garminZones() {
  var z = zonesFrom(garminGet('/biometric-service/heartRateZones/v2'));
  if (z) { z.at = new Date().toISOString(); garminProps().setProperty('GARMIN_ZONES', JSON.stringify(z)); }
  return z;
}

/* ------------------------------------------------------- history import --

   Run garminImportHistory() from the editor. It walks every year Garmin can
   see, oldest first, through the same rules as the hourly check: pasted runs
   are linked, never overwritten; nothing doubles; deleted runs stay deleted.

   Google stops any run after six minutes, so it stops itself well before
   that and says how far it got. Press Run again and it carries on — finished
   years are skipped, and runs already in the sheet are never downloaded
   twice. When it says "History complete", it's done. */

var HISTORY_FROM_YEAR = 2010;
var HISTORY_BUDGET_MS = 4.5 * 60 * 1000;

function garminImportHistory() {
  var started = Date.now();
  var props = garminProps();
  if (!props.getProperty('GARMIN_KEY')) throw new Error('Put GARMIN_KEY in Script properties first.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('The hourly check is running \u2014 try again in a minute.');
  try {
    var ash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.activities);
    addMissingHeaders(ash, ACT_COLS);
    var cx = garminContext(ash);
    var done = (props.getProperty('GARMIN_HISTORY_DONE') || '').split(',').filter(String);
    var thisYear = new Date().getFullYear();
    var stoppedAt = null;

    for (var y = HISTORY_FROM_YEAR; y <= thisYear && !stoppedAt; y++) {
      if (done.indexOf(String(y)) >= 0) continue;
      var runs = garminSearch(y + '-01-01', y + '-12-31').filter(garminIsRun)
        .sort(function (a, b) { return String(a.startTimeLocal).localeCompare(String(b.startTimeLocal)); });
      for (var i = 0; i < runs.length; i++) {
        if (Date.now() - started > HISTORY_BUDGET_MS) { stoppedAt = y; break; }
        garminHandle(runs[i], cx);
      }
      /* the current year stays open: the hourly check owns it */
      if (!stoppedAt && y < thisYear) { done.push(String(y)); props.setProperty('GARMIN_HISTORY_DONE', done.join(',')); }
    }

    var msg = stoppedAt
      ? 'Stopped in ' + stoppedAt + ' to stay inside Google\u2019s time limit. This run: ' +
        cx.added + ' added, ' + cx.linked + ' linked. Press Run again to carry on.'
      : 'History complete. This run: ' + cx.added + ' added, ' + cx.linked + ' linked to runs you had pasted.';
    Logger.log(msg);
    return { complete: !stoppedAt, added: cx.added, linked: cx.linked, message: msg };
  } finally {
    lock.releaseLock();
  }
}

/** One-off report, written to a "Garmin check" tab: how far back the key
    reaches, and which figures arrive. Changes nothing else. */
function garminCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Garmin check') || ss.insertSheet('Garmin check');
  sh.clear();
  var out = [['Garmin check', new Date().toISOString()], ['', '']];
  var thisYear = new Date().getFullYear(), oldest = null;
  for (var y = thisYear - 12; y <= thisYear; y++) {
    var runs = [];
    try { runs = garminSearch(y + '-01-01', y + '-12-31').filter(garminIsRun); }
    catch (e) { out.push([String(y), 'error: ' + e.message]); continue; }
    if (runs.length) {
      out.push([String(y), runs.length + ' runs']);
      runs.forEach(function (r) {
        var d = String(r.startTimeLocal || '').slice(0, 10);
        if (d && (!oldest || d < oldest)) oldest = d;
      });
    }
  }
  out.push(['Oldest run reachable', oldest || 'none found']);
  var recent = garminSearch(isoDay(new Date(Date.now() - 60 * 864e5)), isoDay(new Date()))
    .filter(garminIsRun)[0];
  if (recent) {
    out.push(['', ''], ['Newest run', String(recent.startTimeLocal) + ' \u00b7 id ' + recent.activityId]);
    out.push(['Grade-adjusted pace (GAP)', recent.avgGradeAdjustedSpeed > 0
      ? 'yes \u2014 ' + Math.floor(1000 / recent.avgGradeAdjustedSpeed / 60) + ':' +
        ('0' + Math.round(1000 / recent.avgGradeAdjustedSpeed % 60)).slice(-2) + '/km'
      : 'not provided']);
    try {
      var act = garminActivity(recent, garminFit(String(recent.activityId)));
      out.push(['FIT file', 'read OK']);
      out.push(['Distance / time', act.distance_km + ' km \u00b7 ' + act.elapsed_s + ' s']);
      out.push(['Heart rate / cadence', act.avg_hr + ' bpm \u00b7 ' + act.cadence_spm + ' spm']);
      out.push(['Ascent / temperature', act.ascent_m + ' m \u00b7 ' + act.temp_c + '\u00b0']);
      out.push(['Laps', act.laps.length + (act.laps[0] ? ' \u2014 first ' + act.laps[0].distance_km +
        ' km in ' + act.laps[0].time_s + ' s at ' + act.laps[0].avg_hr + ' bpm' : '')]);
    } catch (e) { out.push(['FIT file', 'could not read: ' + e.message]); }
    out.push(['Fields in the list', Object.keys(recent).sort().join(', ')]);
  } else {
    out.push(['Newest run', 'no run in the last 60 days']);
  }
  sh.getRange(1, 1, out.length, 2).setValues(out);
  sh.setColumnWidth(1, 220);
  return out;
}

/** Run once after putting GARMIN_KEY in Script properties. */
function setupGarmin() {
  garminToken();                     // fails loudly here if the key is wrong
  garminCheck();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'garminSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('garminSync').timeBased().everyHours(1).create();
  var st = garminSync();
  Logger.log('Garmin: ' + JSON.stringify(st) + '. See the "Garmin check" tab.');
  return st;
}

/* ============================================================ Gemini check ===

   Run garminCompare() from the editor. For every run you pasted that is linked
   to its Garmin original, it compares what Gemini transcribed against
   Garmin's own file, field by field and lap by lap, and writes the result to a
   "Gemini check" tab. It changes nothing else.

   Each difference gets one verdict:
   - exact            the same figure
   - rounding         one unit in the last shown digit; Garmin's screen rounds
   - different measure the paste holds a real Garmin figure, just not the one
                      the app stores (e.g. elapsed time instead of timer time,
                      or Connect's corrected ascent instead of the watch's)
   - not pasted       Garmin has it, the paste left it out
   - misread          none of the above: a wrong digit, a swapped or missing lap */

var CMP_RULES = {
  distance_km: { label: 'distance', eq: 0.005, round: 0.015, unit: ' km' },
  elapsed_s:   { label: 'time', eq: 0.5, round: 1.5, unit: ' s' },
  avg_hr:      { label: 'heart rate', eq: 0, round: 1, unit: ' bpm' },
  cadence_spm: { label: 'cadence', eq: 0, round: 1, unit: ' spm' },
  ascent_m:    { label: 'ascent', eq: 0, round: 1, unit: ' m' },
  gap_pace_s:  { label: 'GAP', eq: 0, round: 1, unit: ' s/km' },
  temp_c:      { label: 'temperature', eq: 0, round: 1, unit: '\u00b0' }
};
var LAP_RULES = {
  distance_km: { label: 'lap distance', eq: 0.005, round: 0.015, unit: ' km' },
  time_s:      { label: 'lap time', eq: 0.5, round: 1.5, unit: ' s' },
  avg_hr:      { label: 'lap heart rate', eq: 0, round: 1, unit: ' bpm' }
};

function cmpVerdict(mine, theirs, rule, alts) {
  if (mine == null || mine === '') return theirs == null ? null : { verdict: 'not pasted' };
  if (theirs == null) return null;
  var d = Math.abs(Number(mine) - Number(theirs));
  if (d <= rule.eq + 1e-9) return { verdict: 'exact' };
  if (d <= rule.round + 1e-9) return { verdict: 'rounding' };
  var hit = (alts || []).filter(function (a) {
    return a.value != null && Math.abs(Number(mine) - a.value) <= rule.round + 1e-9;
  })[0];
  if (hit) return { verdict: 'different measure', note: hit.label };
  return { verdict: 'misread' };
}

/* One pasted run against Garmin's version of it. Pure: tested on its own. */
function compareRun(mine, g) {
  var out = [];
  Object.keys(CMP_RULES).forEach(function (k) {
    var v = cmpVerdict(mine[k], g.act[k], CMP_RULES[k], g.alts[k]);
    if (v) out.push({ field: CMP_RULES[k].label, mine: mine[k], theirs: g.act[k],
                      verdict: v.verdict, note: v.note || '', unit: CMP_RULES[k].unit });
  });
  var a = mine.laps || [], b = g.act.laps || [];
  if (b.length && !a.length) {
    out.push({ field: 'laps', mine: 0, theirs: b.length, verdict: 'not pasted', note: '', unit: '' });
    return out;
  }
  if (a.length !== b.length)
    out.push({ field: 'laps', mine: a.length, theirs: b.length, verdict: 'misread',
               note: a.length < b.length ? 'laps missing' : 'extra laps', unit: '' });
  var n = Math.min(a.length, b.length);
  var timeOk = function (i, j) { return a[i] && b[j] && Math.abs(a[i].time_s - b[j].time_s) <= LAP_RULES.time_s.round; };
  for (var i = 0; i < n; i++) {
    Object.keys(LAP_RULES).forEach(function (k) {
      var v = cmpVerdict(a[i][k], b[i][k], LAP_RULES[k]);
      if (!v) return;
      var note = 'lap ' + (i + 1);
      if (v.verdict === 'misread' && k === 'time_s' &&
          ((timeOk(i, i + 1) && timeOk(i + 1, i)) || (timeOk(i, i - 1) && timeOk(i - 1, i))))
        note += ', swapped with a neighbour';
      out.push({ field: LAP_RULES[k].label, mine: a[i][k], theirs: b[i][k], verdict: v.verdict,
                 note: note, unit: LAP_RULES[k].unit });
    });
  }
  return out;
}

var CMP_BUDGET_MS = 5 * 60 * 1000;

function garminCompare() {
  var started = Date.now();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var acts = readAll(ss.getSheetByName(SHEETS.activities), ACT_COLS);
  var laps = readAll(ss.getSheetByName(SHEETS.laps), LAP_COLS);
  var byAct = {};
  laps.forEach(function (l) { (byAct[l.activity_id] = byAct[l.activity_id] || []).push(l); });
  /* pasted, and linked: the imported ones have the Garmin id in their own id */
  var pasted = acts.filter(function (a) {
    return a.garmin_id && String(a.id).indexOf('-g' + a.garmin_id) < 0;
  }).sort(function (x, y) { return String(x.date).localeCompare(String(y.date)); });

  var lists = {};
  function listFor(date) {
    var y = String(date).slice(0, 4);
    if (!lists[y]) {
      lists[y] = {};
      garminSearch(y + '-01-01', y + '-12-31').forEach(function (j) { lists[y][String(j.activityId)] = j; });
    }
    return lists[y];
  }

  var rows = [], tally = {}, compared = 0, clean = 0, cut = false;
  pasted.forEach(function (m) {
    if (cut || Date.now() - started > CMP_BUDGET_MS) { cut = true; return; }
    var j = listFor(m.date)[String(m.garmin_id)] ||
            { activityId: m.garmin_id, startTimeLocal: m.date + ' 00:00:00' };
    var fit = garminFit(String(m.garmin_id));
    var act = garminActivity(j, fit);
    if (!act) return;
    var s = fit.sessions[0] || {};
    var g = { act: act, alts: {
      elapsed_s: [{ label: 'elapsed time, pauses included', value: s[7] != null ? Math.round(s[7] / 1000) : null },
                  { label: 'moving time', value: j.movingDuration != null ? Math.round(j.movingDuration) : null }],
      ascent_m:  [{ label: 'Connect\u2019s corrected ascent', value: j.elevationGain != null ? Math.round(j.elevationGain) : null }],
      distance_km: [{ label: 'Connect\u2019s distance', value: j.distance != null ? r2(j.distance / 1000) : null }]
    } };
    m.laps = (byAct[m.id] || []).sort(function (x, y) { return x.n - y.n; });
    var found = compareRun(m, g);
    compared++;
    var bad = found.filter(function (f) { return f.verdict !== 'exact'; });
    if (!bad.length) clean++;
    found.forEach(function (f) {
      var t = tally[f.field] = tally[f.field] || { exact: 0, rounding: 0, 'different measure': 0, 'not pasted': 0, misread: 0 };
      t[f.verdict]++;
    });
    bad.forEach(function (f) {
      rows.push([m.date, m.name, f.field, String(f.mine) + f.unit, String(f.theirs) + f.unit,
                 f.verdict, f.note]);
    });
  });

  var sh = ss.getSheetByName('Gemini check') || ss.insertSheet('Gemini check');
  sh.clear();
  var all = 0, misread = 0;
  var order = ['distance', 'time', 'heart rate', 'cadence', 'ascent', 'GAP', 'temperature',
               'laps', 'lap distance', 'lap time', 'lap heart rate'];
  var summary = order.filter(function (k) { return tally[k]; }).map(function (k) {
    var t = tally[k], n = t.exact + t.rounding + t['different measure'] + t['not pasted'] + t.misread;
    all += n; misread += t.misread;
    return [k, n, t.exact, t.rounding, t['different measure'], t['not pasted'], t.misread];
  });
  var out = [
    ['Gemini check', new Date().toISOString(), '', '', '', '', ''],
    [cut ? 'Stopped early (time limit) \u2014 press Run again for the rest.' :
      compared + ' pasted runs compared with Garmin\u2019s file. ' + clean + ' matched on every figure.', '', '', '', '', '', ''],
    ['Real misreads: ' + misread + ' of ' + all + ' figures' +
      (all ? ' (' + Math.round(misread / all * 1000) / 10 + '%)' : ''), '', '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['Figure', 'Compared', 'Exact', 'Rounding', 'Different measure', 'Not pasted', 'Misread']
  ].concat(summary).concat([['', '', '', '', '', '', ''],
    ['Date', 'Run', 'Figure', 'Pasted', 'Garmin', 'Verdict', 'Note']]).concat(rows);
  sh.getRange(1, 1, out.length, 7).setValues(out);
  Logger.log(out[1][0] + ' ' + out[2][0] + ' See the "Gemini check" tab.');
  return { compared: compared, clean: clean, misread: misread, figures: all, cut: cut };
}

/* ================================================================ enrich ===

   Run garminEnrich() from the editor, once. Every run linked to Garmin gets
   what its file offers:
   - laps from the file, replacing transcribed ones on pasted runs;
   - best efforts, seconds at each heart rate, drift and max HR from the
     second-by-second record;
   - any figure the paste left out (moving time, ascent, descent, cadence,
     GAP, heart rate) — filled only where empty, never overwritten.
   Yours stays yours: name, tags, RPE, feel, notes, and the weather
   temperatures you pasted. Imported runs lose the wrist-sensor temperature
   the first import stored.

   It stops itself before Google's six-minute limit; press Run again until it
   says it's done. A run already enriched is skipped. Each enriched run gets a
   new updated_at, which is how the app knows to take the new version. */

var ENRICH_BUDGET_MS = 4.5 * 60 * 1000;
var FILL_IF_EMPTY = ['moving_s', 'ascent_m', 'descent_m', 'cadence_spm', 'gap_pace_s', 'avg_hr', 'max_hr'];

function garminEnrich() {
  var started = Date.now();
  if (!garminProps().getProperty('GARMIN_KEY')) throw new Error('Put GARMIN_KEY in Script properties first.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('The hourly check is running \u2014 try again in a minute.');
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ash = ss.getSheetByName(SHEETS.activities), lsh = ss.getSheetByName(SHEETS.laps);
    addMissingHeaders(ash, ACT_COLS);
    var hm = headerMap(ash);
    var todo = readAll(ash, ACT_COLS).filter(function (a) {
      return a.garmin_id && !(Number(a.stream_v) >= STREAM_V);
    });
    var lists = {}, done = 0, cut = false;
    function listed(a) {
      var y = String(a.date).slice(0, 4);
      if (!lists[y]) {
        lists[y] = {};
        garminSearch(y + '-01-01', y + '-12-31').forEach(function (j) { lists[y][String(j.activityId)] = j; });
      }
      return lists[y][String(a.garmin_id)] || { activityId: a.garmin_id, startTimeLocal: a.date + ' 00:00:00' };
    }
    for (var i = 0; i < todo.length; i++) {
      if (Date.now() - started > ENRICH_BUDGET_MS) { cut = true; break; }
      var a = todo[i];
      var g = garminActivity(listed(a), garminFit(String(a.garmin_id)));
      var at = findRowById(ash, 'id', a.id);
      if (at < 0) continue;
      var row = ash.getRange(at, 1, 1, ash.getLastColumn()).getValues()[0];
      var put = function (c, v) { if (hm[c] != null) row[hm[c]] = v == null ? '' : v; };
      var empty = function (c) { return hm[c] == null || row[hm[c]] === '' || row[hm[c]] == null; };
      if (g) {
        FILL_IF_EMPTY.forEach(function (c) { if (empty(c) && g[c] != null) put(c, g[c]); });
        /* Garmin's trail type only where you haven't said road or trail yourself */
        if (empty('terrain') && g.terrain) put('terrain', g.terrain);
        put('efforts', g.efforts); put('hr_hist', g.hr_hist); put('drift_bpm', g.drift_bpm);
        if (String(a.id).indexOf('-g' + a.garmin_id) >= 0) put('temp_c', null);   // imported: wrist sensor out
        if (g.laps.length) {
          clearLaps(lsh, a.id);
          var rows = g.laps.map(function (l) {
            return objToRow(lsh, LAP_COLS, { activity_id: a.id, n: l.n, distance_km: l.distance_km,
              time_s: l.time_s, avg_hr: l.avg_hr, role: 'main' });
          });
          lsh.getRange(lsh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        }
      }
      put('stream_v', STREAM_V);
      put('updated_at', new Date().toISOString());
      ash.getRange(at, 1, 1, row.length).setValues([row]);
      done++;
    }
    var left = todo.length - done;
    var msg = cut ? 'Enriched ' + done + ' runs; ' + left + ' to go. Press Run again to carry on.'
                  : 'Enrich complete: ' + done + ' runs. Open the app to see them.';
    Logger.log(msg);
    return { done: done, left: left, complete: !cut, message: msg };
  } finally {
    lock.releaseLock();
  }
}
