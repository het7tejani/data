/* Device-to-device chat. The private data repository stores the thread and file bytes. */
(function () {
  'use strict';
  const THREAD = 'chat/messages.json';
  const MAX_FILE = 5 * 1024 * 1024;
  const MAX_THREAD = 900 * 1024; // GitHub's Contents API stops returning inline content above 1 MB.
  const TTL = 24 * 60 * 60 * 1000;
  const client = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  const text = s => new TextEncoder().encode(s);
  const encode = bytes => {
    let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
  };
  const decode = s => {
    const bytes = Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };
  const base = () => (localStorage.getItem('ob_api') || 'https://api.github.com') + '/repos/' + DB.cfg().repo + '/contents/';
  async function request(path, options = {}) {
    const response = await fetch(base() + path, {
      ...options, cache: 'no-store', headers: {
        Authorization: 'token ' + DB.cfg().token,
        Accept: 'application/vnd.github+json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    if (response.status === 404 && options.allowMissing) return null;
    if (!response.ok) {
      let reason = ''; try { reason = (await response.json()).message || ''; } catch (e) { /* ignored */ }
      throw new Error('GitHub ' + response.status + (reason ? ': ' + reason : ''));
    }
    return response;
  }
  function isFresh(m, now = Date.now()) {
    const at = Date.parse(m.at);
    return Number.isFinite(at) && at <= now && now - at < TTL;
  }
  function normalize(data) {
    const parsed = JSON.parse(decode(data.content));
    const messages = Array.isArray(parsed) ? parsed : parsed.messages;
    if (!Array.isArray(messages)) throw new Error('Chat data is not a message list. No messages were changed.');
    return { sha: data.sha, messages, pendingDeletes: Array.isArray(parsed.pendingDeletes) ? parsed.pendingDeletes : [] };
  }
  async function snapshot() {
    const response = await request(THREAD, { allowMissing: true });
    if (!response) return { sha: null, messages: [], pendingDeletes: [] };
    const data = await response.json();
    if (!data.content || data.encoding !== 'base64') throw new Error('Chat is too large for GitHub. No messages were changed.');
    return normalize(data);
  }
  const validPath = path => /^chat\/files\/[a-z0-9-]+\.(pdf|txt)$/.test(path || '');
  const payload = doc => text(JSON.stringify({ messages: doc.messages, pendingDeletes: doc.pendingDeletes }));
  async function saveThread(doc, message) {
    const data = payload(doc);
    if (data.length > MAX_THREAD) throw new Error('Chat is full. No messages were changed.');
    return write(THREAD, data, message, doc.sha);
  }
  // An attachment stays in the pendingDeletes queue until its GitHub path is confirmed deleted.
  // Git history can still retain its bytes; this removes only current-branch access.
  async function prune() {
    let doc;
    for (let attempt = 0; attempt < 6; attempt++) {
      doc = await snapshot();
      const expired = doc.messages.filter(m => !isFresh(m));
      if (!expired.length) break;
      doc.messages = doc.messages.filter(m => isFresh(m));
      doc.pendingDeletes = [...new Set([...doc.pendingDeletes, ...expired.map(m => m.file && m.file.path).filter(validPath)])];
      try { doc.sha = await saveThread(doc, 'Expire chat entries older than 24h'); break; }
      catch (e) {
        if (!/GitHub (409|422)\b/.test(e.message) || attempt === 5) throw e;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    if (!doc.pendingDeletes.length) return { messages: doc.messages.filter(m => isFresh(m)), pending: 0 };
    const removed = [];
    const stillUsed = new Set(doc.messages.filter(m => isFresh(m)).map(m => m.file && m.file.path).filter(validPath));
    for (const path of doc.pendingDeletes) {
      if (stillUsed.has(path)) { removed.push(path); continue; }
      if (!validPath(path)) continue; // never delete an arbitrary path from untrusted chat data
      try {
        const meta = await request(path, { allowMissing: true });
        if (meta) {
          const { sha } = await meta.json();
          await request(path, { method: 'DELETE', body: JSON.stringify({ message: 'Expire chat attachment', sha, branch: 'main' }) });
        }
        removed.push(path);
      } catch (e) { /* retain for the next refresh */ }
    }
    if (removed.length) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const latest = await snapshot();
        const remaining = latest.pendingDeletes.filter(p => !removed.includes(p));
        if (remaining.length === latest.pendingDeletes.length) break;
        latest.pendingDeletes = remaining;
        try { await saveThread(latest, 'Finish expired attachment cleanup'); break; }
        catch (e) {
          if (!/GitHub (409|422)\b/.test(e.message) || attempt === 5) throw e;
        }
      }
    }
    return { messages: doc.messages.filter(m => isFresh(m)), pending: doc.pendingDeletes.length - removed.length };
  }
  async function read() {
    return prune();
  }
  async function write(path, data, message, sha) {
    const body = { message, content: encode(data), branch: 'main' };
    if (sha) body.sha = sha;
    const r = await request(path, { method: 'PUT', body: JSON.stringify(body) });
    return (await r.json()).content.sha;
  }
  const id = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  function safeName(name) { return (name || 'file').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120) || 'file'; }
  function validate(file) {
    if (!file) return;
    if (!/\.(pdf|txt)$/i.test(file.name)) throw new Error('Choose a PDF or .txt file.');
    if (file.size > MAX_FILE) throw new Error('Files must be 5 MB or smaller.');
    if (!file.size) throw new Error('This file is empty.');
  }
  // The file has a unique path, so two devices cannot overwrite one another's attachments.
  async function upload(file) {
    validate(file);
    const name = safeName(file.name), ext = /\.pdf$/i.test(name) ? 'pdf' : 'txt';
    const path = 'chat/files/' + id() + '.' + ext;
    await write(path, new Uint8Array(await file.arrayBuffer()), 'Chat attachment: ' + name);
    return { name, path, size: file.size, type: ext === 'pdf' ? 'application/pdf' : 'text/plain' };
  }
  async function send(body, file, onStep) {
    const message = { id: id(), at: new Date().toISOString(), from: client, body: body.trim().slice(0, 4000) };
    if (!message.body && !file) throw new Error('Write a message or choose a file.');
    validate(file);
    if (file) { if (onStep) onStep('Uploading file...'); message.file = await upload(file); }
    if (onStep) onStep('Sending...');
    await prune();
    for (let attempt = 0; attempt < 6; attempt++) {
      const doc = await snapshot();
      if (doc.messages.some(m => m.id === message.id)) return message;
      doc.messages = [...doc.messages.filter(m => isFresh(m)), message];
      try { await saveThread(doc, 'Chat message'); return message; }
      catch (e) {
        if (!/GitHub (409|422)\b/.test(e.message) || attempt === 5) throw e;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  async function download(file) {
    if (!file || !validPath(file.path)) throw new Error('Invalid attachment path.');
    const response = await request(file.path, { headers: { Accept: 'application/vnd.github.raw' } });
    const blob = new Blob([await response.arrayBuffer()], { type: file.type === 'application/pdf' ? 'application/pdf' : 'text/plain' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = safeName(file.name); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  window.Chat = { read, send, download, validate, client };
})();
