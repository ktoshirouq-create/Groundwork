/* model.js — shape, ids, defaults, migrations. */

(function (root) {
  'use strict';

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

  const api = { SCHEMA, BLANK, make, newId, findDuplicate, migrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Model = api;

})(typeof self !== 'undefined' ? self : this);
