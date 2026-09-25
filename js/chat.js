/* Device-to-device chat. The private data repository stores the thread and file bytes. */
(function () {
  'use strict';
  const THREAD = 'chat/messages.json';
  const MAX_FILE = 5 * 1024 * 1024;
  const MAX_THREAD = 900 * 1024; // GitHub's Contents API stops returning inline content above 1 MB.
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
  async function read() {
    const response = await request(THREAD, { allowMissing: true });
    if (!response) return { sha: null, messages: [] };
    const data = await response.json();
    if (!data.content || data.encoding !== 'base64') throw new Error('Chat is too large for GitHub. No messages were changed.');
    const messages = JSON.parse(decode(data.content));
    if (!Array.isArray(messages)) throw new Error('Chat file is not a message list. No messages were changed.');
    return { sha: data.sha, messages };
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
    for (let attempt = 0; attempt < 6; attempt++) {
      const { sha, messages } = await read();
      if (messages.some(m => m.id === message.id)) return message;
      const next = [...messages, message];
      if (text(JSON.stringify(next)).length > MAX_THREAD) throw new Error('Chat is full. The file was uploaded, but the message was not sent.');
      try { await write(THREAD, text(JSON.stringify(next)), 'Chat message', sha); return message; }
      catch (e) {
        if (!/GitHub (409|422)\b/.test(e.message) || attempt === 5) throw e;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  async function download(file) {
    if (!file || !/^chat\/files\/[a-z0-9-]+\.(pdf|txt)$/.test(file.path)) throw new Error('Invalid attachment path.');
    const response = await request(file.path, { headers: { Accept: 'application/vnd.github.raw' } });
    const blob = new Blob([await response.arrayBuffer()], { type: file.type === 'application/pdf' ? 'application/pdf' : 'text/plain' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = safeName(file.name); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  window.Chat = { read, send, download, validate, client };
})();
