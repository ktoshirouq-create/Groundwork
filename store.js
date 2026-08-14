/* store.js — storage behind an adapter.
   LocalAdapter is what runs today. SheetsAdapter slots in later without any
   other file changing: same five methods, same shapes, returns promises. */

(function (root) {
  'use strict';

  const KEY = {
    acts: 'groundwork:activities',
    config: 'groundwork:config',
    schema: 'groundwork:schema',
    queue: 'groundwork:queue'
  };

  function LocalAdapter() {
    this.name = 'local';
  }

  LocalAdapter.prototype.load = function () {
    let acts = [], config = {};
    try { acts = JSON.parse(localStorage.getItem(KEY.acts) || '[]'); } catch (e) { acts = []; }
    try { config = JSON.parse(localStorage.getItem(KEY.config) || '{}'); } catch (e) { config = {}; }
    const schema = parseInt(localStorage.getItem(KEY.schema) || '0', 10) || 0;
    return Promise.resolve(Model.migrate({ activities: acts, config: config, schema: schema }));
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

  /* ------------------------------------------------------------------
     SheetsAdapter — not wired yet. Deploy the Apps Script, set ENDPOINT,
     and swap the adapter in Store.init. Everything else stays as it is.
     Reads still come from the local cache; writes go to both.
  ------------------------------------------------------------------ */
  function SheetsAdapter(endpoint) {
    this.name = 'sheets';
    this.endpoint = endpoint;
    this.local = new LocalAdapter();
  }
  SheetsAdapter.prototype.load = function () {
    const local = this.local;
    return fetch(this.endpoint + '?action=list')
      .then(r => r.json())
      .then(data => {
        const bundle = Model.migrate(data);
        return local.saveAll(bundle).then(() => bundle);
      })
      .catch(() => local.load());          // offline: cache wins, nothing is lost
  };
  SheetsAdapter.prototype.saveAll = function (bundle) { return this.local.saveAll(bundle); };
  SheetsAdapter.prototype.put = function (bundle, act) {
    const local = this.local;
    return local.put(bundle, act).then(() =>
      fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'put', activity: act })
      }).then(() => act).catch(() => { Store.queue(act); return act; })
    );
  };
  SheetsAdapter.prototype.remove = function (bundle, id) { return this.local.remove(bundle, id); };

  /* ---------- public ---------- */

  const Store = {
    adapter: null,
    bundle: null,

    init: function () {
      this.adapter = new LocalAdapter();
      return this.adapter.load().then(b => { this.bundle = b; return b; });
    },

    all: function () { return (this.bundle && this.bundle.activities) || []; },

    config: function () {
      return Object.assign({}, Calc.DEFAULT_CONFIG, (this.bundle && this.bundle.config) || {});
    },

    setConfig: function (patch) {
      this.bundle.config = Object.assign({}, this.bundle.config, patch);
      return this.adapter.saveAll(this.bundle);
    },

    put: function (act) { return this.adapter.put(this.bundle, act); },
    remove: function (id) { return this.adapter.remove(this.bundle, id); },
    byId: function (id) { return this.all().find(a => a.id === id) || null; },

    queue: function (act) {
      let q = [];
      try { q = JSON.parse(localStorage.getItem(KEY.queue) || '[]'); } catch (e) {}
      q.push(act);
      localStorage.setItem(KEY.queue, JSON.stringify(q));
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
  root._Adapters = { LocalAdapter, SheetsAdapter };

})(typeof self !== 'undefined' ? self : this);
