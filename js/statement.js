/* Etsy payment-account monthly statement CSV (Shop Manager -> Finances -> Payment account -> monthly statement -> CSV).
   Columns: Date, Type, Title, Info, Currency, Amount, Fees & Taxes, Net (+ Tax Details in some countries).
   Works in the browser (window.EtsyStatement) and in Node (module.exports). */
(function (root) {
  'use strict';
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  function detect(headers) {
    const H = new Set(headers.map(norm));
    return H.has('type') && H.has('net') && (H.has('feestaxes') || H.has('fees') || H.has('info')) && !H.has('transactionid') && !H.has('saledate');
  }

  // "$1.37", "-$1.37", "$-1.37", "US$24.15", "₹1,234.50", "(1.37)", "--" -> number or null
  function money(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = clean(v);
    if (!s || /^-+$/.test(s) || s === '—') return null;
    const neg = /-\s*[^\d]*\d/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/[^0-9.,]/g, '');
    if (!s) return null;
    if (/,\d{1,2}$/.test(s) && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : (neg ? -n : n);
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');
  function isoDate(v) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    let s = clean(v).replace(/^(\d{1,2})\.\s*/, '$1 ');
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); if (m && MONTHS[m[1].toLowerCase()]) return m[3] + '-' + pad(MONTHS[m[1].toLowerCase()]) + '-' + pad(m[2]);
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/); if (m && MONTHS[m[2].toLowerCase()]) return m[3] + '-' + pad(MONTHS[m[2].toLowerCase()]) + '-' + pad(m[1]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad(m[1]) + '-' + pad(m[2]); }
    return '';
  }

  function orderRef(title, info) {
    const t = title + ' | ' + info;
    let m = t.match(/(?:order|bestellung|commande|pedido|ordine|bestelling)\s*(?:no\.?|number|nr\.?)?\s*[:#]?\s*#?\s*(\d{6,})/i);
    if (m) return m[1];
    if (!/listing|artikel|annonce/i.test(t)) { m = t.match(/#\s*(\d{8,})/); if (m) return m[1]; }
    return '';
  }

  // cat: sale | refund | tax (tax paid by buyer, withheld by Etsy) | tx | proc | reg | other
  function category(type, title) {
    const ty = type.toLowerCase(), ti = title.toLowerCase();
    if (ty === 'sale' || /^payment for order/.test(ti)) return 'sale';
    if (ty === 'refund' || /^refund/.test(ti)) return 'refund';
    if (/regulatory operating fee/.test(ti)) return 'reg';
    if (/processing fee/.test(ti)) return 'proc';
    if (/transaction fee/.test(ti) && !/(vat|gst|tax)\s*:/.test(ti)) return 'tx';
    if ((ty === 'tax' || /tax/.test(ti)) && !/fee/.test(ti)) return 'tax';
    return 'other';
  }

  function parse(headers, records) {
    const map = {}; headers.forEach(h => { const k = norm(h); if (!(k in map)) map[k] = h; });
    const col = (r, ...names) => { for (const n of names) { const h = map[n]; if (h !== undefined && r[h] != null && clean(r[h]) !== '') return r[h]; } return ''; };
    const lines = [], seen = {}, months = {}, curCount = {};
    records.forEach(r => {
      const type = clean(col(r, 'type')), title = clean(col(r, 'title', 'description')), info = clean(col(r, 'info'));
      if (!type && !title) return;
      const date = isoDate(col(r, 'date'));
      const currency = clean(col(r, 'currency')).toUpperCase();
      const amount = money(col(r, 'amount')), fees = money(col(r, 'feestaxes', 'fees'));
      let net = money(col(r, 'net'));
      if (net == null) net = (amount || 0) + (fees || 0);
      const base = [date, type, title, info, currency, amount, fees, net].join('|');
      seen[base] = (seen[base] || 0) + 1;              // identical rows in one file stay separate
      const k = base + '#' + seen[base];
      if (date) months[date.slice(0, 7)] = (months[date.slice(0, 7)] || 0) + 1;
      if (currency) curCount[currency] = (curCount[currency] || 0) + 1;
      lines.push({ k, date, type, title, info, currency, amount, fees, net: Math.round(net * 100) / 100, orderId: orderRef(title, info), cat: category(type, title) });
    });
    const period = Object.keys(months).sort((a, b) => months[b] - months[a])[0] || '';
    const currency = Object.keys(curCount).sort((a, b) => curCount[b] - curCount[a])[0] || '';
    const orderIds = [...new Set(lines.filter(l => l.orderId).map(l => l.orderId))];
    return { period, currency, lines, orderIds };
  }

  const api = { detect, parse, money, isoDate, orderRef, category };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EtsyStatement = api;
})(typeof window !== 'undefined' ? window : this);
