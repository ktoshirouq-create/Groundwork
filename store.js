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
    sheets: 'groundwork:sheets'      /* endpoint + token, deliberately not synced */
  };

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

  const Sheets = {
    settings: function () { return readJSON(KEY.sheets, {}); },

    configured: function () { return !!(Sheets.settings().url || '').length; },

    save: function (url, token) {
      localStorage.setItem(KEY.sheets, JSON.stringify({
        url: (url || '').trim(), token: (token || '').trim()
      }));
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
    sync: { state: 'off', at: null, error: null, pending: 0 },
    onsync: null,

    init: function () {
      this.adapter = new LocalAdapter();
      return this.adapter.load().then(b => {
        this.bundle = b;
        this.sync.pending = queued().length;
        this.sync.state = Sheets.configured() ? 'idle' : 'off';
        return b;
      });
    },

    all: function () { return (this.bundle && this.bundle.activities) || []; },

    config: function () {
      return Object.assign({}, Calc.DEFAULT_CONFIG, (this.bundle && this.bundle.config) || {});
    },

    setConfig: function (patch) {
      this.bundle.config = Object.assign({}, this.bundle.config, patch);
      const done = this.adapter.saveAll(this.bundle);
      if (Sheets.configured()) {
        Sheets.post({ action: 'config', config: this.bundle.config }).catch(() => {});
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
        const remote = data.activities || [];
        const local = self.all();

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
        return self.adapter.saveAll(self.bundle).then(() => ({ merged: remote.length }));
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
