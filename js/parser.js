/* Etsy order file parser. Works in the browser (window.EtsyParser) and in Node (module.exports). */
(function (root) {
  'use strict';

  // ---- CSV (RFC 4180) ----
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [], field = '', i = 0, inQuotes = false;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  function rowsToObjects(rows) {
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map(h => String(h == null ? '' : h).trim());
    const records = rows.slice(1).map(r => {
      const o = {};
      headers.forEach((h, idx) => { o[h] = r[idx] == null ? '' : r[idx]; });
      return o;
    });
    return { headers, records };
  }

  // ---- helpers ----
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

  function makeGetter(headers) {
    const map = {};
    headers.forEach(h => { const k = norm(h); if (!(k in map)) map[k] = h; });
    return function get(rec, names) {
      for (const name of names) {
        const h = map[norm(name)];
        if (h !== undefined) {
          const v = rec[h];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
      }
      return '';
    };
  }

  function findHeader(headers, test) {
    return headers.find(h => test(norm(h))) || null;
  }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    s = s.replace(/[^0-9.,]/g, '');
    // "1.234,56" -> european; "1,234.56" -> us
    if (/,\d{1,2}$/.test(s) && s.indexOf('.') !== -1 && s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^\d+,\d{1,2}$/.test(s)) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    const num = parseFloat(s);
    return isNaN(num) ? 0 : (neg ? -num : num);
  }

  const pad = n => String(n).padStart(2, '0');
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  // Returns 'YYYY-MM-DD' or ''. Etsy uses MM/DD/YY.
  function toISODate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      let mo = a, d = b;           // Etsy default: month first
      if (a > 12 && b <= 12) { mo = b; d = a; }
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + pad(mo) + '-' + pad(d);
    }
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].toLowerCase()]) return m[3] + '-' + pad(MONTHS[m[1].toLowerCase()]) + '-' + pad(m[2]);
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
    if (m && MONTHS[m[2].toLowerCase()]) return m[3] + '-' + pad(MONTHS[m[2].toLowerCase()]) + '-' + pad(m[1]);
    const d = new Date(s);
    if (!isNaN(d)) return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return '';
  }

  const round2 = n => Math.round((n || 0) * 100) / 100;

  // Money breakdown in the order's own currency.
  // gross = items - discount + shipping - shipping discount (tax NOT included). tax = what buyer paid on top.
  function moneyFor(o) {
    let subtotal, discount, shipping, shipDiscount, tax, orderTotal, moneySrc;
    if (o._orderMoney) {
      const m = o._orderMoney; moneySrc = 'orders';
      subtotal = m.subtotal || o.items.reduce((s, it) => s + it.total, 0);
      discount = m.discount; shipping = m.shipping; shipDiscount = m.shipDiscount;
      const gross = subtotal - discount + shipping - shipDiscount;
      orderTotal = m.orderTotal || gross + m.salesTax;
      tax = Math.max(m.salesTax || 0, orderTotal - gross);   // Order Total also hides VAT
    } else {
      const m = o._itemsMoney || { shipping: 0, shipDiscount: 0, tax: 0 }; moneySrc = 'items';
      subtotal = o.items.reduce((s, it) => s + it.total, 0);
      discount = o.items.reduce((s, it) => s + (it.discount || 0), 0);
      shipping = m.shipping; shipDiscount = m.shipDiscount; tax = m.tax;
      orderTotal = subtotal - discount + shipping - shipDiscount + tax;
    }
    const gross = subtotal - discount + shipping - shipDiscount;
    return { subtotal: round2(subtotal), discount: round2(discount), shipping: round2(shipping), shipDiscount: round2(shipDiscount),
             tax: round2(Math.max(0, tax)), orderTotal: round2(orderTotal), gross: round2(gross), total: round2(orderTotal), moneySrc };
  }

  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const cleanId = v => {
    if (typeof v === 'number') return String(Math.round(v));
    return clean(v).replace(/\.0+$/, '');
  };

  // ---- Etsy detection + normalisation ----
  function detectType(headers) {
    const H = new Set(headers.map(norm));
    const hasTx = H.has('transactionid');
    const hasItem = H.has('itemname') || H.has('title') || H.has('listingtitle');
    const hasFull = H.has('fullname');
    const hasOrder = H.has('orderid') || H.has('ordernumber');
    if (hasTx && hasFull) return 'combined';
    if (hasTx || (hasItem && hasOrder)) return 'items';
    if (hasFull && hasOrder) return 'orders';
    if (hasOrder) return 'orders';
    return 'unknown';
  }

  /**
   * Turn raw records into order objects.
   * Returns { type, orders: [ {orderId, date, buyerName, buyerUser, phone, city, state, country,
   *            currency, total, status, items:[{title, qty, price, total, transactionId, listingId, variations}] } ],
   *           skipped, warnings }
   */
  function normalize(headers, records) {
    const type = detectType(headers);
    const get = makeGetter(headers);
    const phoneHeader = findHeader(headers, k => k.indexOf('phone') !== -1);
    const warnings = [];
    const byId = new Map();
    let skipped = 0;

    if (type === 'unknown') {
      return { type, orders: [], skipped: records.length, warnings: ['This file does not look like an Etsy orders file.'] };
    }

    records.forEach((r, idx) => {
      let orderId = cleanId(get(r, ['Order ID', 'Order Number', 'Order #', 'Receipt ID']));
      const txId = cleanId(get(r, ['Transaction ID']));
      if (!orderId && txId) orderId = 'T' + txId;
      if (!orderId) { skipped++; return; }

      let o = byId.get(orderId);
      if (!o) {
        o = { orderId, date: '', buyerName: '', buyerUser: '', phone: '', city: '', state: '', country: '',
              currency: '', total: 0, orderTotalFromFile: 0, status: '', items: [] };
        byId.set(orderId, o);
      }
      const setIf = (key, val) => { val = clean(val); if (val && !o[key]) o[key] = val; };

      const date = toISODate(get(r, ['Sale Date', 'Order Date', 'Date Paid', 'Date']));
      if (date && (!o.date || date < o.date)) o.date = date;

      setIf('buyerName', get(r, ['Full Name', 'Ship Name', 'Buyer Name', 'Name', 'Buyer']));
      setIf('buyerUser', get(r, ['Buyer User ID', 'Buyer Username', type === 'orders' || type === 'combined' ? 'Buyer' : '__none__']));
      if (phoneHeader) setIf('phone', r[phoneHeader]);
      setIf('city', get(r, ['Ship City', 'City']));
      setIf('state', get(r, ['Ship State', 'State']));
      setIf('country', get(r, ['Ship Country', 'Country']));
      setIf('currency', get(r, ['Currency']));
      setIf('status', get(r, ['Status', 'Order Status']));

      const money = (names) => toNumber(get(r, names));
      if (type === 'items' || type === 'combined') {
        const title = clean(get(r, ['Item Name', 'Listing Title', 'Title', 'Item']));
        const qty = toNumber(get(r, ['Quantity', 'Qty'])) || 1;
        const price = money(['Price', 'Item Price']);
        let total = money(['Item Total']);
        if (!total) total = price * qty;
        const disc = money(['Discount Amount']);
        o.items.push({
          title: title || '(no title)', qty, price, total: round2(total), discount: round2(disc),
          transactionId: txId, listingId: cleanId(get(r, ['Listing ID'])),
          variations: clean(get(r, ['Variations']))
        });
        if (!o._itemsMoney) o._itemsMoney = { shipping: 0, shipDiscount: 0, tax: 0 };
        // order-level values repeat on every row of the order: keep the first non-zero
        const sh = money(['Order Shipping', 'Order Delivery', 'Shipping']);
        const sd = money(['Shipping Discount', 'Delivery Discount']);
        const tx = money(['Order Sales Tax', 'Sales Tax']);
        if (sh && !o._itemsMoney.shipping) o._itemsMoney.shipping = sh;
        if (sd && !o._itemsMoney.shipDiscount) o._itemsMoney.shipDiscount = sd;
        if (tx && !o._itemsMoney.tax) o._itemsMoney.tax = tx;
      }
      if (type === 'orders' || type === 'combined') {
        if (!o._orderMoney) {
          const subtotal = money(['Order Value']);
          const discount = money(['Discount Amount']);
          const shipping = money(['Shipping', 'Delivery']);
          const shipDiscount = money(['Shipping Discount', 'Delivery Discount']);
          const salesTax = money(['Sales Tax']);
          const orderTotal = money(['Order Total', 'Adjusted Order Total', 'Total']);
          if (subtotal || orderTotal) o._orderMoney = { subtotal, discount, shipping, shipDiscount, salesTax, orderTotal };
        }
        if (type === 'orders') {
          const n = toNumber(get(r, ['Number of Items'])) || 0;
          o.itemCount = n;
          const sku = clean(get(r, ['SKU']));
          if (sku) o.sku = sku;
        }
      }
    });

    const orders = [];
    byId.forEach(o => {
      const m = moneyFor(o);
      Object.assign(o, m);
      delete o._itemsMoney; delete o._orderMoney;
      orders.push(o);
    });
    if (type === 'orders') warnings.push('This is the "Orders" file. It has no listing names. For listing names, also upload the "Order Items" file.');
    if (!phoneHeader) warnings.push('No phone column in this file. Phone numbers will stay empty.');
    if (skipped) warnings.push(skipped + ' row(s) had no order number and were skipped.');
    return { type, orders, skipped, warnings };
  }

  function guessShop(filename, shops) {
    const f = norm(filename);
    let best = null;
    shops.forEach(s => { const k = norm(s); if (k && f.indexOf(k) !== -1 && (!best || k.length > norm(best).length)) best = s; });
    return best;
  }

  const api = { moneyFor, parseCSV, rowsToObjects, normalize, detectType, toISODate, toNumber, guessShop, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EtsyParser = api;
})(typeof window !== 'undefined' ? window : this);
