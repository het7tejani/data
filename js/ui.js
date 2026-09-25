/* Small UI helpers: icons, formatting, toasts, modal, drawer, charts. */
(function () {
  'use strict';
  const P = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"/><path d="M8 11h9M8 14h6"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    sheet: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M10 9h-2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    money: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
    repeat: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16V11M12 16V7M17 16v-3"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
  };
  const icon = (name) => '<svg viewBox="0 0 24 24" ' + P + '>' + (ICONS[name] || '') + '</svg>';
  const ico = (name, cls) => '<span class="ico ' + (cls || '') + '">' + icon(name) + '</span>';

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(el => { if (!el.innerHTML) el.innerHTML = icon(el.dataset.icon); });
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SYMBOLS = { USD: '$', INR: '₹', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' };
  function money(n, cur) {
    const sym = SYMBOLS[cur] || (cur ? cur + ' ' : '');
    const v = Number(n || 0);
    return sym + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  const int = n => Number(n || 0).toLocaleString('en-US');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function date(iso) {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-');
    return +d + ' ' + MON[+m - 1] + ' ' + y;
  }
  function monthLabel(ym, short) {
    const [y, m] = ym.split('-');
    return MON[+m - 1] + (short ? " '" + y.slice(2) : ' ' + y);
  }
  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'err' ? ' err' : '');
    t.innerHTML = ico(kind === 'err' ? 'alert' : 'check') + '<span>' + esc(msg) + '</span>';
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
    setTimeout(() => t.remove(), 3600);
  }

  function confirmBox({ title, text, ok = 'Yes', danger = false, typeWord = null }) {
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = '<div class="modal"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
        (typeWord ? '<input class="input" style="width:100%" placeholder="Type ' + esc(typeWord) + '">' : '') +
        '<div class="modal-actions"><button class="btn" data-a="no">Cancel</button><button class="btn ' +
        (danger ? 'btn-danger' : 'btn-primary') + '" data-a="yes">' + esc(ok) + '</button></div></div>';
      document.body.appendChild(back);
      const inp = back.querySelector('input');
      const yes = back.querySelector('[data-a=yes]');
      if (inp) { yes.disabled = true; inp.addEventListener('input', () => { yes.disabled = inp.value.trim().toUpperCase() !== typeWord; }); inp.focus(); }
      back.addEventListener('click', e => {
        const a = e.target.closest('[data-a]');
        if (e.target === back || (a && a.dataset.a === 'no')) { back.remove(); resolve(false); }
        else if (a && a.dataset.a === 'yes') { back.remove(); resolve(true); }
      });
    });
  }

  const drawer = {
    open(html) {
      const d = document.getElementById('drawer');
      d.innerHTML = html; d.classList.add('show'); d.setAttribute('aria-hidden', 'false');
      document.getElementById('drawerBackdrop').classList.add('show');
      return d;
    },
    close() {
      const d = document.getElementById('drawer');
      d.classList.remove('show'); d.setAttribute('aria-hidden', 'true');
      document.getElementById('drawerBackdrop').classList.remove('show');
      if (drawer.onClose) { const f = drawer.onClose; drawer.onClose = null; f(); }
    },
    onClose: null
  };

  // Vertical bar chart. data: [{label, value, tip}]
  function barChart(container, data, opts) {
    opts = opts || {};
    const W = 800, H = 260, padL = 48, padB = 28, padT = 10, padR = 8;
    const max = Math.max(1, ...data.map(d => d.value));
    const nice = niceMax(max);
    const iw = W - padL - padR, ih = H - padT - padB;
    const bw = data.length ? Math.min(46, iw / data.length * 0.62) : 0;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    for (let i = 0; i <= 4; i++) {
      const y = padT + ih - ih * i / 4;
      s += '<line class="gridline" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="axis" x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(opts.fmtAxis ? opts.fmtAxis(nice * i / 4) : Math.round(nice * i / 4)) + '</text>';
    }
    const step = Math.ceil(data.length / 12);
    data.forEach((d, i) => {
      const cx = padL + iw * (i + 0.5) / data.length;
      const h = ih * d.value / nice;
      s += '<rect class="bar" data-i="' + i + '" x="' + (cx - bw / 2) + '" y="' + (padT + ih - h) + '" width="' + bw + '" height="' + Math.max(h, d.value ? 2 : 0) + '" rx="4"/>';
      if (i % step === 0) s += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(d.label) + '</text>';
    });
    s += '</svg><div class="chart-tip"></div>';
    container.innerHTML = s;
    const tip = container.querySelector('.chart-tip');
    container.querySelectorAll('.bar').forEach(b => {
      b.addEventListener('mouseenter', () => {
        const d = data[+b.dataset.i];
        const r = b.getBoundingClientRect(), c = container.getBoundingClientRect();
        tip.innerHTML = d.tip; tip.style.left = (r.left - c.left + r.width / 2) + 'px'; tip.style.top = (r.top - c.top) + 'px';
        tip.classList.add('show');
      });
      b.addEventListener('mouseleave', () => tip.classList.remove('show'));
    });
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function shortNum(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  window.UI = { icon, ico, hydrateIcons, esc, money, int, date, monthLabel, bytes, toast, confirmBox, drawer, barChart, shortNum };
})();
