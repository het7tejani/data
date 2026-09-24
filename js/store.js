/* Storage: one shared data file in a PRIVATE GitHub repo (source of truth), with a local cache.
   Data file: orders.json  |  PDFs: pdfs/<id>.pdf  |  Works from any computer after connecting once. */
(function () {
  'use strict';
  const LS = { token: 'ob_token', repo: 'ob_repo', api: 'ob_api' };
  const DATA_PATH = 'orders.json';
  const api = () => localStorage.getItem(LS.api) || 'https://api.github.com';

  let doc = null;          // { version, shops, orders:{key:order}, pdfs:{id:meta}, meta:{} }
  let sha = null;          // sha of orders.json in the repo (null = file not created yet)
  const dirtyOrders = new Set(), dirtyPdfs = new Set(), deletedPdfs = new Set();
  let dirtyMeta = false, saveTimer = null, saving = null, lastLoad = 0;
  const listeners = [];
  let status = 'idle';     // idle | saving | saved | error | offline

  const emptyDoc = () => ({ version: 1, shops: null, orders: {}, pdfs: {}, meta: {} });
  const setStatus = s => { status = s; listeners.forEach(f => f(s)); };

  // ---- config ----
  const cfg = () => ({ token: localStorage.getItem(LS.token) || '', repo: localStorage.getItem(LS.repo) || '' });
  const configured = () => { const c = cfg(); return !!(c.token && c.repo); };

  async function gh(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ Authorization: 'token ' + cfg().token, Accept: 'application/vnd.github+json' }, opts.headers || {});
    if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
    const r = await fetch(api() + path, Object.assign({}, opts, { headers, cache: 'no-store' }));
    return r;
  }
  async function ghJSON(path, opts) {
    const r = await gh(path, opts);
    let j = null; try { j = await r.json(); } catch (e) { /* empty */ }
    return { ok: r.ok, status: r.status, data: j };
  }

  // ---- base64 helpers (UTF-8 safe, chunked) ----
  function bytesToB64(bytes) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  const textToB64 = t => bytesToB64(new TextEncoder().encode(t));

  // ---- local cache (IndexedDB) ----
  let cdb = null;
  function cacheDB() {
    if (cdb) return cdb;
    cdb = new Promise((res, rej) => {
      const q = indexedDB.open('order-book-cache', 1);
      q.onupgradeneeded = () => { q.result.createObjectStore('kv'); q.result.createObjectStore('pdf'); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    return cdb;
  }
  async function cacheGet(store, k) {
    try { const db = await cacheDB(); return await new Promise(res => { const r = db.transaction(store).objectStore(store).get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch (e) { return null; }
  }
  async function cacheSet(store, k, v) {
    try { const db = await cacheDB(); await new Promise(res => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) { /* cache is optional */ }
  }
  const cacheKey = () => 'doc:' + cfg().repo;

  // ---- connect / setup ----
  async function checkToken(token) {
    const r = await fetch(api() + '/user', { headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' } });
    if (!r.ok) return { ok: false, error: r.status === 401 ? 'This token is not valid. Please check it.' : 'GitHub error ' + r.status };
    return { ok: true, login: (await r.json()).login };
  }
  async function checkRepo(token, repo) {
    const r = await fetch(api() + '/repos/' + repo, { headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return { exists: false };
    if (!r.ok) return { exists: false, error: 'GitHub error ' + r.status };
    const j = await r.json();
    return { exists: true, private: !!j.private, canWrite: !!(j.permissions && j.permissions.push), url: j.html_url };
  }
  async function createRepo(token, name) {
    const r = await fetch(api() + '/user/repos', { method: 'POST', headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, private: true, auto_init: true, description: 'Private data for Order Book (Etsy orders). Do not make public.' }) });
    let j = null; try { j = await r.json(); } catch (e) { /* */ }
    if (!r.ok) return { ok: false, error: (j && j.message) || ('GitHub error ' + r.status) };
    return { ok: true, url: j.html_url, full: j.full_name };
  }
  function connect(token, repo) { localStorage.setItem(LS.token, token); localStorage.setItem(LS.repo, repo); doc = null; sha = null; }
  function disconnect() { localStorage.removeItem(LS.token); localStorage.removeItem(LS.repo); doc = null; sha = null; }

  // ---- load ----
  async function fetchRemote() {
    const meta = await ghJSON('/repos/' + cfg().repo + '/contents/' + DATA_PATH);
    if (meta.status === 404) return { doc: emptyDoc(), sha: null };
    if (!meta.ok) throw new Error((meta.data && meta.data.message) || ('GitHub error ' + meta.status));
    const raw = await gh('/repos/' + cfg().repo + '/contents/' + DATA_PATH, { headers: { Accept: 'application/vnd.github.raw' } });
    if (!raw.ok) throw new Error('GitHub error ' + raw.status);
    const d = JSON.parse(await raw.text());
    return { doc: Object.assign(emptyDoc(), d), sha: meta.data.sha };
  }

  async function init() {
    const cached = await cacheGet('kv', cacheKey());
    try {
      const r = await fetchRemote();
      doc = r.doc; sha = r.sha; lastLoad = Date.now();
      cacheSet('kv', cacheKey(), { doc, sha });
      setStatus(sha ? 'saved' : 'idle');
      return { source: 'github' };
    } catch (e) {
      if (cached && cached.doc) { doc = cached.doc; sha = cached.sha; setStatus('offline'); return { source: 'cache', error: e.message }; }
      throw e;
    }
  }

  // Pull the latest from GitHub if nothing is waiting to be saved. Returns true if data changed.
  async function refresh() {
    if (!doc || saving || saveTimer || dirtyOrders.size || dirtyPdfs.size || deletedPdfs.size || dirtyMeta) return false;
    try {
      const meta = await ghJSON('/repos/' + cfg().repo + '/contents/' + DATA_PATH);
      lastLoad = Date.now();
      if (!meta.ok || !meta.data || meta.data.sha === sha) { if (status === 'offline' && meta.ok) setStatus('saved'); return false; }
      const r = await fetchRemote(); doc = r.doc; sha = r.sha; cacheSet('kv', cacheKey(), { doc, sha }); setStatus('saved');
      return true;
    } catch (e) { return false; }
  }

  // ---- save ----
  function schedule(delay) {
    clearTimeout(saveTimer);
    setStatus('pending');
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, delay == null ? 1200 : delay);
  }

  function mergeInto(remote) {
    dirtyOrders.forEach(k => { if (doc.orders[k]) remote.orders[k] = doc.orders[k]; else delete remote.orders[k]; });
    dirtyPdfs.forEach(id => { if (doc.pdfs[id]) remote.pdfs[id] = doc.pdfs[id]; });
    deletedPdfs.forEach(id => { delete remote.pdfs[id]; });
    if (dirtyMeta) { remote.meta = Object.assign({}, remote.meta, doc.meta); remote.shops = doc.shops; }
    return remote;
  }

  async function save() {
    if (saving) { await saving; if (dirtyOrders.size || dirtyPdfs.size || deletedPdfs.size || dirtyMeta) return save(); return; }
    saving = (async () => {
      setStatus('saving');
      for (let attempt = 0; attempt < 3; attempt++) {
        const snap = { o: new Set(dirtyOrders), p: new Set(dirtyPdfs), d: new Set(deletedPdfs), m: dirtyMeta };
        dirtyOrders.clear(); dirtyPdfs.clear(); deletedPdfs.clear(); dirtyMeta = false;
        doc.updatedAt = new Date().toISOString();
        const body = { message: 'Update orders (' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ')', content: textToB64(JSON.stringify(doc)) };
        if (sha) body.sha = sha;
        let r;
        try { r = await ghJSON('/repos/' + cfg().repo + '/contents/' + DATA_PATH, { method: 'PUT', body: JSON.stringify(body) }); }
        catch (e) { r = { ok: false, status: 0 }; }
        if (r.ok) { sha = r.data.content.sha; cacheSet('kv', cacheKey(), { doc, sha }); setStatus('saved'); return true; }
        // put back what we tried to save
        snap.o.forEach(k => dirtyOrders.add(k)); snap.p.forEach(k => dirtyPdfs.add(k)); snap.d.forEach(k => deletedPdfs.add(k)); if (snap.m) dirtyMeta = true;
        if (r.status === 409 || r.status === 422) {          // changed on another computer: merge and retry
          try { const rem = await fetchRemote(); doc = mergeInto(rem.doc); sha = rem.sha; continue; } catch (e) { break; }
        }
        break;
      }
      setStatus('error');
      return false;
    })();
    try { return await saving; } finally { saving = null; }
  }

  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (dirtyOrders.size || dirtyPdfs.size || deletedPdfs.size || dirtyMeta || saving) {
      const ok = await save();
      if (ok === false) throw new Error('Could not save to GitHub. Check internet and try again.');
    }
  }
  const pending = () => !!(saveTimer || saving || dirtyOrders.size || dirtyPdfs.size || deletedPdfs.size || dirtyMeta);

  // ---- public API (same shape the app used before) ----
  const clone = o => o ? JSON.parse(JSON.stringify(o)) : o;
  const DB = {
    orderKey: (shop, orderId) => shop + '|' + orderId,
    configured, cfg, connect, disconnect, checkToken, checkRepo, createRepo, init, refresh, flush, save, pending,
    status: () => status, onStatus: f => listeners.push(f), lastLoad: () => lastLoad,

    allOrders: async () => Object.values(doc.orders).map(clone),
    getOrder: async key => clone(doc.orders[key]),
    putOrder: async o => { doc.orders[o.key] = clone(o); dirtyOrders.add(o.key); schedule(); },
    putOrders: async list => { list.forEach(o => { doc.orders[o.key] = clone(o); dirtyOrders.add(o.key); }); schedule(); },

    async addPdf(rec) {
      const path = 'pdfs/' + rec.id + '.pdf';
      const content = bytesToB64(new Uint8Array(await rec.blob.arrayBuffer()));
      const r = await ghJSON('/repos/' + cfg().repo + '/contents/' + path, { method: 'PUT', body: JSON.stringify({ message: 'Add PDF ' + rec.name, content }) });
      if (!r.ok) throw new Error('PDF upload failed: ' + ((r.data && r.data.message) || r.status));
      doc.pdfs[rec.id] = { id: rec.id, orderKey: rec.orderKey, name: rec.name, size: rec.size, addedAt: rec.addedAt, path, sha: r.data.content.sha };
      dirtyPdfs.add(rec.id);
      cacheSet('pdf', rec.id, rec.blob);
      schedule();
    },
    async getPdf(id) {
      const m = doc.pdfs[id]; if (!m) return null;
      let blob = await cacheGet('pdf', id);
      if (!blob) {
        const r = await gh('/repos/' + cfg().repo + '/contents/' + m.path, { headers: { Accept: 'application/vnd.github.raw' } });
        if (!r.ok) throw new Error('Could not open PDF (' + r.status + ')');
        blob = new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
        cacheSet('pdf', id, blob);
      }
      return Object.assign({}, m, { blob });
    },
    pdfsForOrder: async key => Object.values(doc.pdfs).filter(p => p.orderKey === key).sort((a, b) => a.addedAt - b.addedAt).map(clone),
    allPdfs: async () => Object.values(doc.pdfs).map(clone),
    async deletePdf(id) {
      const m = doc.pdfs[id]; if (!m) return;
      const r = await ghJSON('/repos/' + cfg().repo + '/contents/' + m.path, { method: 'DELETE', body: JSON.stringify({ message: 'Remove PDF ' + m.name, sha: m.sha }) });
      if (!r.ok && r.status !== 404) throw new Error('Could not remove PDF: ' + ((r.data && r.data.message) || r.status));
      delete doc.pdfs[id]; deletedPdfs.add(id); schedule();
    },

    async deleteOrder(key) {
      const pdfs = Object.values(doc.pdfs).filter(p => p.orderKey === key);
      for (const p of pdfs) await DB.deletePdf(p.id);
      delete doc.orders[key]; dirtyOrders.add(key); schedule();
    },

    getMeta: async (k, dflt) => k === 'shops' ? (doc.shops ? doc.shops.slice() : dflt) : (k in doc.meta ? doc.meta[k] : dflt),
    setMeta: async (k, v) => { if (k === 'shops') doc.shops = v; else doc.meta[k] = v; dirtyMeta = true; schedule(); },

    async clearAll() {
      Object.keys(doc.orders).forEach(k => dirtyOrders.add(k));
      doc.orders = {}; Object.keys(doc.pdfs).forEach(id => deletedPdfs.add(id)); doc.pdfs = {};
      dirtyMeta = true; await flush();
    }
  };
  window.DB = DB;
})();
