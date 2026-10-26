/* store.js — storage behind an adapter.

   Local is always the working copy: reads are instant and the app works with
   no signal. Sheets, when configured, is the durable copy — the one that
   survives a browser clearing its storage, which is what happened once.

   The rule that matters: a remote fetch NEVER deletes local data. An empty or
   unreachable sheet leaves the phone's copy alone and pushes up instead. */

(function (root) {
  'use strict';

  const KEY = {
    acts: 'groundwork:activities',
    config: 'groundwork:config',
    schema: 'groundwork:schema',
    queue: 'groundwork:queue',
    sheets: 'groundwork:sheets',     /* endpoint + token, deliberately not synced */
    fieldsUp: 'groundwork:fields-up', /* the one-time fill of the new sheet columns */
    resting: 'groundwork:resting',    /* a copy of the sheet's Resting HR tab */
    hrv: 'groundwork:hrv'             /* and of its HRV tab */
  };

  /* Fields that until Oct 2026 lived only on the phone, because the sheet had
     no column for them. Sent up once, as a fill, when the script has them. */
  const FILL_FIELDS = ['session', 'subtype', 'value', 'protocol_note', 'resting_hr', 'terrain', 'hr_trust'];

  function readJSON(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(fallback)); }
    catch (e) { return fallback; }
  }

  /* ------------------------------------------------------------- local ---- */

  function LocalAdapter() { this.name = 'local'; }

  LocalAdapter.prototype.load = function () {
    return Promise.resolve(Model.migrate({
      activities: readJSON(KEY.acts, []),
      config: readJSON(KEY.config, {}),
      schema: parseInt(localStorage.getItem(KEY.schema) || '0', 10) || 0
    }));
  };

  LocalAdapter.prototype.saveAll = function (bundle) {
    localStorage.setItem(KEY.acts, JSON.stringify(bundle.activities));
    localStorage.setItem(KEY.config, JSON.stringify(bundle.config));
    localStorage.setItem(KEY.schema, String(bundle.schema));
    return Promise.resolve(true);
  };

  LocalAdapter.prototype.put = function (bundle, act) {
    const i = bundle.activities.findIndex(a => a.id === act.id);
    if (i >= 0) bundle.activities[i] = act; else bundle.activities.push(act);
    return this.saveAll(bundle).then(() => act);
  };

  LocalAdapter.prototype.remove = function (bundle, id) {
    bundle.activities = bundle.activities.filter(a => a.id !== id);
    return this.saveAll(bundle);
  };

  /* ------------------------------------------------------------ sheets ---- */

  /* A tiny IndexedDB box for the things that must outlive a storage clear.
     localStorage is evicted first and hardest; IndexedDB survives more. */
  const IDB = {
    db: null,
    open: function () {
      if (IDB.db) return Promise.resolve(IDB.db);
      return new Promise(function (res, rej) {
        if (!self.indexedDB) return rej(new Error('no indexedDB'));
        const r = self.indexedDB.open('groundwork', 1);
        r.onupgradeneeded = function () {
          if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv');
        };
        r.onsuccess = function () { IDB.db = r.result; res(IDB.db); };
        r.onerror = function () { rej(r.error); };
      });
    },
    get: function (k) {
      return IDB.open().then(db => new Promise(function (res, rej) {
        const t = db.transaction('kv', 'readonly').objectStore('kv').get(k);
        t.onsuccess = function () { res(t.result); };
        t.onerror = function () { rej(t.error); };
      })).catch(() => null);
    },
    set: function (k, v) {
      return IDB.open().then(db => new Promise(function (res, rej) {
        const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
        t.onsuccess = function () { res(true); };
        t.onerror = function () { rej(t.error); };
      })).catch(() => false);
    }
  };

  /* Where the connection details came from, so Setup can say. */
  let sheetsOrigin = 'none';

  const Sheets = {
    settings: function () { return readJSON(KEY.sheets, {}); },

    configured: function () { return !!(Sheets.settings().url || '').length; },

    origin: function () { return sheetsOrigin; },

    /* Three places, in order of how well they survive:
         1. a sheets.json deployed with the site — cannot be evicted at all
         2. IndexedDB — survives most clears
         3. localStorage — the working copy, evicted first
       Whichever answers first wins, and the answer is written back to the
       other two. This is why the URL and token no longer have to be retyped
       after the browser clears its storage. */
    restore: function () {
      /* This runs before the first render, so it must never reject. A boot
         that fails here shows nothing at all. */
      const local = readJSON(KEY.sheets, {});
      if (local.url) {
        sheetsOrigin = 'this device';
        /* mirror it into IndexedDB every boot — a copy only written at setup
           time is no copy at all once localStorage is cleared */
        IDB.set('sheets', local);
        return Promise.resolve(local);
      }

      const fromFile = function () {
        if (typeof fetch !== 'function') return Promise.resolve({});
        return Promise.resolve()
          .then(() => fetch('./sheets.json', { cache: 'no-store' }))
          .then(r => (r && r.ok ? r.json() : null))
          .then(function (file) {
            if (!file || !file.url) return {};
            sheetsOrigin = 'sheets.json in the repo';
            Sheets.save(file.url, file.token || '');
            return file;
          })
          .catch(() => ({}));
      };

      return IDB.get('sheets').then(function (fromIdb) {
        if (fromIdb && fromIdb.url) {
          sheetsOrigin = 'recovered from this device';
          localStorage.setItem(KEY.sheets, JSON.stringify(fromIdb));
          return fromIdb;
        }
        return fromFile();
      }).catch(fromFile).catch(() => ({}));
    },

    save: function (url, token) {
      const cfg = { url: (url || '').trim(), token: (token || '').trim() };
      localStorage.setItem(KEY.sheets, JSON.stringify(cfg));
      IDB.set('sheets', cfg);
      if (sheetsOrigin === 'none') sheetsOrigin = 'this device';
      return cfg;
    },

    get: function (action) {
      const s = Sheets.settings();
      const q = '?action=' + encodeURIComponent(action) +
        (s.token ? '&token=' + encodeURIComponent(s.token) : '');
      return fetch(s.url + q, { method: 'GET', redirect: 'follow' })
        .then(r => r.json());
    },

    post: function (payload) {
      const s = Sheets.settings();
      const body = Object.assign({}, payload, s.token ? { token: s.token } : {});
      /* text/plain keeps this a simple request — no CORS preflight, which an
         Apps Script web app would reject */
      return fetch(s.url, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }
  };

  /* ------------------------------------------------------------- queue ---- */

  function queued() { return readJSON(KEY.queue, []); }
  function setQueue(q) { localStorage.setItem(KEY.queue, JSON.stringify(q)); }

  function enqueue(op) {
    const q = queued().filter(x => !(x.action === op.action && x.id === op.id));
    q.push(op);
    setQueue(q);
  }

  /* ------------------------------------------------------------- public --- */

  const Store = {
    adapter: null,
    bundle: null,
    sync: { state: 'off', at: null, error: null, pending: 0,
            garmin: null, outdated: false },
    onsync: null,

    init: function () {
      const self = this;
      self.adapter = new LocalAdapter();
      return self.adapter.load().then(function (b) {
        self.bundle = b;
        self.sync.pending = queued().length;
        /* find the connection wherever it survived */
        return Sheets.restore().then(function () {
          self.sync.state = Sheets.configured() ? 'idle' : 'off';
          return b;
        });
      });
    },

    /* Whether the browser has promised not to evict this app's storage. */
    persisted: function () {
      if (!navigator.storage || !navigator.storage.persisted) return Promise.resolve(null);
      return navigator.storage.persisted().catch(() => null);
    },

    sheetsOrigin: function () { return Sheets.origin(); },

    all: function () { return (this.bundle && this.bundle.activities) || []; },

    /* Zones come from your watch when Garmin sends them, unless you've chosen
       your own: the app must never disagree with the numbers you run by. The
       watch's max and resting HR come with them, so load is worked out on the
       same anchors. Decided here, once, so every figure in the app sees the
       same zones. */
    config: function () {
      const c = Object.assign({}, Calc.DEFAULT_CONFIG, (this.bundle && this.bundle.config) || {});
      const z = c.garmin_zones;
      if (z && z.z2 && c.zones_source !== 'manual') {
        c.watch_zones = { z1: z.z1, z2: z.z2, z3: z.z3, z4: z.z4, z5: z.z5 };
        if (z.max) c.max_hr = z.max;
        if (z.rest) c.resting_hr = z.rest;
        c.zones_from = 'watch';
      } else c.zones_from = 'manual';
      return c;
    },

    /* Garmin's daily resting HR, [date, bpm], oldest first. Context only. */
    resting: function () { return readJSON(KEY.resting, []); },
    /* "Check Garmin now": run the Apps Script's hourly check immediately,
       then pull, so a value your watch just synced shows straight away. */
    checkGarmin: function () {
      if (!Sheets.configured()) return Promise.resolve({ error: 'no sheet' });
      const self = this;
      return Sheets.post({ action: 'garminSync' }).then(st => self.pull().then(() => st));
    },

    /* Garmin's nightly HRV, [date, ms], oldest first. Context only. */
    hrv: function () { return readJSON(KEY.hrv, []); },

    setConfig: function (patch) {
      this.bundle.config = Object.assign({}, this.bundle.config, patch);
      const done = this.adapter.saveAll(this.bundle);
      if (Sheets.configured()) {
        /* what the Apps Script owns is never sent back */
        const send = Object.assign({}, this.bundle.config);
        delete send.garmin_zones;
        Sheets.post({ action: 'config', config: send }).catch(() => {});
      }
      return done;
    },

    put: function (act) {
      const self = this;
      return this.adapter.put(this.bundle, act).then(saved => {
        if (!Sheets.configured()) return saved;
        return Sheets.post({ action: 'put', activity: saved })
          .then(r => {
            if (r && r.error) throw new Error(r.error);
            self.sync.at = new Date().toISOString();
            self.sync.error = null;
            return saved;
          })
          .catch(err => {
            enqueue({ action: 'put', id: saved.id });
            self.sync.pending = queued().length;
            self.sync.error = String(err.message || err);
            return saved;
          });
      });
    },

    remove: function (id) {
      const self = this;
      return this.adapter.remove(this.bundle, id).then(() => {
        if (!Sheets.configured()) return true;
        return Sheets.post({ action: 'delete', id: id })
          .catch(() => { enqueue({ action: 'delete', id: id });
                         self.sync.pending = queued().length; });
      });
    },

    byId: function (id) { return this.all().find(a => a.id === id) || null; },

    /* ---- sheets wiring ---- */

    sheetsSettings: function () { return Sheets.settings(); },
    configureSheets: function (url, token) { Sheets.save(url, token); this.sync.state = Sheets.configured() ? 'idle' : 'off'; },
    sheetsConfigured: function () { return Sheets.configured(); },

    /* Pull, but never destructively. An empty or unreachable sheet leaves the
       local copy alone; a sheet with data is merged by id, newest wins. */
    pull: function () {
      const self = this;
      if (!Sheets.configured()) return Promise.resolve({ skipped: true });
      self.sync.state = 'syncing';
      if (self.onsync) self.onsync();

      return Sheets.get('list').then(data => {
        if (!data || data.error) throw new Error((data && data.error) || 'no response');
        /* Repair the shapes Sheets hands back before anything touches them —
           a date column that lost its text format arrives as a timestamp. */
        const remote = (data.activities || []).map(r => Calc.normalise(r) || r);
        const local = self.all();

        /* what the script owns arrives whatever the state of the runs: the
           Garmin status, zones, resting HR and HRV are not activities */
        self.sync.garmin = data.garmin || null;
        /* kept, so zones and the resting chart work offline */
        if (data.garmin && data.garmin.zones && data.garmin.zones.z2)
          self.bundle.config.garmin_zones = data.garmin.zones;
        if (Array.isArray(data.resting) && data.resting.length)
          localStorage.setItem(KEY.resting, JSON.stringify(data.resting));
        if (Array.isArray(data.hrv) && data.hrv.length)
          localStorage.setItem(KEY.hrv, JSON.stringify(data.hrv));
        /* an Apps Script deployed before the new columns can't keep tags */
        /* out of date if the sheet lacks a column for anything this app stores */
        self.sync.columns = data.columns || [];
        self.sync.outdated = FILL_FIELDS.some(k => self.sync.columns.indexOf(k) < 0);
        if (!remote.length && local.length) {
          /* first run against an empty sheet — push, don't wipe */
          return self.pushAll().then(n => ({ pushed: n }));
        }

        const byId = {};
        local.forEach(a => { byId[a.id] = a; });
        remote.forEach(r => {
          const mine = byId[r.id];
          if (!mine) { byId[r.id] = r; return; }
          const rt = r.updated_at || '', mt = mine.updated_at || '';
          byId[r.id] = rt > mt ? r : mine;
        });
        self.bundle.activities = Object.keys(byId).map(k => byId[k]);
        if (data.config && Object.keys(data.config).length) {
          self.bundle.config = Object.assign({}, data.config, self.bundle.config);
        }
        return self.adapter.saveAll(self.bundle)
          .then(() => self.fillFields())
          .then(() => ({ merged: remote.length }));
      })
      .then(res => {
        self.sync.state = 'ok';
        self.sync.at = new Date().toISOString();
        self.sync.error = null;
        if (self.onsync) self.onsync();
        return res;
      })
      .catch(err => {
        self.sync.state = 'error';
        self.sync.error = String(err.message || err);
        if (self.onsync) self.onsync();
        return { error: self.sync.error };
      });
    },

    /* Once, after the script gains the new columns: send up what only this
       phone knew — session tags, test results — as a fill. It changes no
       laps and moves no timestamps, and never overwrites a value already in
       the sheet. Retried on every sync until it succeeds. */
    fillFields: function () {
      /* The fill is remembered per field, so a column added later (terrain)
         gets its own fill without resending the ones already done. */
      let done = [];
      try { const v = JSON.parse(localStorage.getItem(KEY.fieldsUp) || '[]'); done = Array.isArray(v) ? v : FILL_FIELDS.filter(k => k !== 'terrain'); }
      catch (e) { done = FILL_FIELDS.filter(k => k !== 'terrain'); }   // an old date stamp: everything but terrain went up
      const todo = FILL_FIELDS.filter(k => done.indexOf(k) < 0 && (this.sync.columns || []).indexOf(k) >= 0);
      if (this.sync.outdated && !todo.length) return Promise.resolve(0);
      if (!todo.length) return Promise.resolve(0);
      const mark = () => localStorage.setItem(KEY.fieldsUp, JSON.stringify(done.concat(todo)));
      const fields = {};
      this.all().forEach(a => {
        const f = {};
        todo.forEach(k => { if (a[k] != null && a[k] !== '') f[k] = a[k]; });
        if (Object.keys(f).length) fields[a.id] = f;
      });
      if (!Object.keys(fields).length) { mark(); return Promise.resolve(0); }
      return Sheets.post({ action: 'fields', fields: fields }).then(r => {
        if (!r || r.error) return 0;
        mark();
        return r.filled || 0;
      }).catch(() => 0);
    },

    /* Send everything up, one at a time — the deployed script takes one
       activity per call. Slow, but it only happens once. */
    pushAll: function () {
      const self = this;
      const list = self.all();
      let n = 0;
      return list.reduce((chain, a) => chain.then(() =>
        Sheets.post({ action: 'put', activity: a }).then(r => {
          if (r && r.error) throw new Error(r.error);
          n++;
          self.sync.pending = Math.max(0, list.length - n);
          if (self.onsync) self.onsync();
        })
      ), Promise.resolve()).then(() => {
        setQueue([]);
        self.sync.pending = 0;
        return n;
      });
    },

    /* Anything that failed while offline. */
    flush: function () {
      const self = this;
      const q = queued();
      if (!q.length || !Sheets.configured()) return Promise.resolve(0);
      let n = 0;
      return q.reduce((chain, op) => chain.then(() => {
        const act = op.action === 'put' ? self.byId(op.id) : null;
        const payload = op.action === 'put'
          ? (act ? { action: 'put', activity: act } : null)
          : { action: 'delete', id: op.id };
        if (!payload) { n++; return; }
        return Sheets.post(payload).then(() => { n++; });
      }), Promise.resolve()).then(() => {
        setQueue([]);
        self.sync.pending = 0;
        if (self.onsync) self.onsync();
        return n;
      }).catch(() => queued().length);
    },

    exportJSON: function () {
      return JSON.stringify({
        exported_at: new Date().toISOString(),
        schema: this.bundle.schema,
        config: this.bundle.config,
        activities: this.bundle.activities
      }, null, 2);
    },

    importJSON: function (text) {
      const data = JSON.parse(text);
      if (!data.activities) throw new Error('No activities in that file.');
      const b = Model.migrate(data);
      this.bundle = b;
      return this.adapter.saveAll(b).then(() => b.activities.length);
    }
  };

  root.Store = Store;

})(typeof self !== 'undefined' ? self : this);
