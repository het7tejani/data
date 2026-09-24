/* Order Book - Etsy orders manager. All data stays in this browser (IndexedDB). */
(function () {
  'use strict';
  const { ico, esc, money, int, date, monthLabel, bytes, toast, confirmBox, drawer, barChart, shortNum, hydrateIcons } = UI;
  const P = EtsyParser;
  const ST = EtsyStatement;

  const DEFAULT_SHOPS = ['PsychicEra', 'PsychicSutra', 'DaisyMediumStudio', 'RosyMediumStudio', 'ladygeorgia'];
  const COLORS = ['#6d5dfc', '#e8590c', '#f59f00', '#e64980', '#12b886', '#228be6', '#7950f2', '#fa5252'];

  const S = {
    orders: [], shops: DEFAULT_SHOPS.slice(), currency: 'USD',
    dash: { shop: 'all', period: 'all' },
    list: { shop: 'all', month: 'all', pdf: 'all', q: '', page: 1 },
    cl: { q: '', sort: 'spent' },
    up: { tab: 'orders', shop: null, parsed: null, files: [], pdfs: [] },
    statements: {}
  };

  const shopColor = shop => { const i = S.shops.indexOf(shop); return COLORS[(i < 0 ? S.shops.length : i) % COLORS.length]; };
  const shopDot = shop => '<span class="dot" style="background:' + shopColor(shop) + '"></span>';
  const clientKey = o => P.norm(o.buyerName) || P.norm(o.buyerUser) || ('order' + o.orderId);
  const place = o => [o.city, o.country].filter(Boolean).join(', ');
  const firstTitle = o => o.items && o.items.length ? o.items[0].title : (o.sku ? 'SKU ' + o.sku : '(listing name not in file)');
  const isPrimary = o => !!(o.rev && !o.rev.pending);
  const net = o => isPrimary(o) ? o.rev.net : 0;
  // amount in the order's own currency -> INR (null while the exchange rate is not loaded)
  const toINR = (o, amt) => { if (amt == null) return null; const c = (o.currency || 'INR').toUpperCase(); if (c === 'INR') return amt; const r = (o.rev && o.rev.rate) || o.fxRate; return r ? amt * r : null; };
  const isForeign = o => (o.currency || 'INR').toUpperCase() !== 'INR';
  const paidOf = o => o.orderTotal != null ? o.orderTotal : o.total;
  const inrOr = (o, amt, dash) => { const v = toINR(o, amt); return v == null ? (dash || '-') : money(v, 'INR'); };
  const itemNet = (o, it) => { const base = o.subtotal || (o.items || []).reduce((s, x) => s + (x.total || 0), 0); return base ? net(o) * (it.total || 0) / base : 0; };
  const MONEY_FIELDS = ['subtotal', 'discount', 'shipping', 'shipDiscount', 'tax', 'orderTotal', 'gross', 'total', 'moneySrc'];
  const stripRev = o => { const c = Object.assign({}, o); delete c.rev; delete c._renew; return c; };

  // ---------- data ----------
  async function load() {
    if (!DB.configured()) return;
    S.orders = await DB.allOrders();
    S.shops = await DB.getMeta('shops', DEFAULT_SHOPS.slice());
    const counts = {};
    S.orders.forEach(o => { if (o.currency) counts[o.currency] = (counts[o.currency] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    S.currency = 'INR'; S.shopCurrency = top || 'USD';
    S.fees = Object.assign({}, Revenue.DEFAULT_FEES, await DB.getMeta('fees', {}));
    S.statements = await DB.getMeta('statements', {});
    S.stmtPending = await DB.getMeta('stmtPending', {});
    try { if (await Revenue.ensureFx(S.orders)) await DB.putOrders(S.orders.filter(o => o.fxRate || (o.stmt && o.stmt.fx)).map(stripRev)); } catch (e) { console.warn(e); }
    assignStatementLines();
    S.orders.forEach(o => { o.rev = Revenue.compute(o, S.fees); });
    S.pendingFx = S.orders.filter(o => !isPrimary(o)).length;
    S.orders.forEach(o => { if (o.shop && S.shops.indexOf(o.shop) < 0) S.shops.push(o.shop); });
    renderSidebarFoot();
  }
  const cur = n => money(n, S.currency);

  // Statement lines without an order number: auto-renew fees are matched to the sale by listing ID (charged on every sale);
  // the rest (new listing fees, Etsy Ads, other charges) are shop costs and never touch order revenue.
  function assignStatementLines() {
    S.orders.forEach(o => { delete o._renew; });
    const byListing = {};
    S.orders.forEach(o => (o.items || []).forEach(it => {
      if (!it.listingId) return;
      const k = o.shop + '|' + it.listingId;
      (byListing[k] = byListing[k] || []).push({ o, qty: it.qty || 1, used: 0 });
    }));
    Object.values(byListing).forEach(a => a.sort((x, y) => (y.o.date || '').localeCompare(x.o.date || '')));
    const plus2 = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 2); return t.toISOString().slice(0, 10); };
    S.shopCostLines = [];
    Object.values(S.statements || {}).forEach(rec => (rec.otherKeys || []).forEach(k => {
      const l = ST.lineFromKey(k); if (!l) return;
      const g = ST.costGroup(l); if (!g) return;
      if (g === 'renew' && l.listingId) {
        const lim = l.date ? plus2(l.date) : '9999';
        const c = (byListing[rec.shop + '|' + l.listingId] || []).find(x => x.used < x.qty && (x.o.date || '') <= lim);
        if (c) { c.used++; (c.o._renew = c.o._renew || []).push(l); return; }
      }
      S.shopCostLines.push(Object.assign({ shop: rec.shop, group: g === 'renew' ? 'other' : g }, l));
    }));
  }
  // shop cost line -> INR (rate: average of that shop's orders in the same currency and month)
  function costINR(l) {
    const c = (l.currency || 'INR').toUpperCase();
    if (c === 'INR') return -l.net;
    const m = (l.date || '').slice(0, 7);
    const same = S.orders.filter(o => (o.currency || '').toUpperCase() === c && o.fxRate);
    const pool = same.filter(o => (o.date || '').slice(0, 7) === m);
    const use = pool.length ? pool : same;
    if (!use.length) return null;
    return -l.net * use.reduce((s, o) => s + o.fxRate, 0) / use.length;
  }
  function shopCostsCard(shop, from, to, revenue) {
    const lines = (S.shopCostLines || []).filter(l => (shop === 'all' || l.shop === shop) && (l.date || '') >= from && (l.date || '0000') <= to);
    const head = '<div class="card mt"><div class="card-head"><div><h3>Shop costs</h3><div class="sub">From uploaded monthly statements. Not part of any order: new listing fees, Etsy Ads, other charges.</div></div></div><div class="card-body">';
    if (!Object.keys(S.statements || {}).length) return head + '<div class="muted small">Upload a monthly statement (Upload page) to see shop costs.</div></div></div>';
    const g = {}; let total = 0, missing = 0;
    lines.forEach(l => {
      const v = costINR(l); if (v == null) { missing++; return; }
      const k = (l.date || '').slice(0, 7) + '|' + l.shop;
      const r = g[k] = g[k] || { month: (l.date || '').slice(0, 7), shop: l.shop, listing: 0, ads: 0, other: 0, total: 0 };
      r[l.group] += v; r.total += v; total += v;
    });
    const rows = Object.values(g).sort((a, b) => b.month.localeCompare(a.month) || a.shop.localeCompare(b.shop));
    return head + (rows.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Month</th><th>Shop</th><th class="num">New listing fees</th><th class="num">Etsy Ads</th><th class="num">Other</th><th class="num">Total</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td class="cell-strong">' + esc(monthLabel(r.month)) + '</td><td><span class="row" style="gap:6px">' + shopDot(r.shop) + esc(r.shop) + '</span></td><td class="num">' + cur(r.listing) + '</td><td class="num">' + cur(r.ads) + '</td><td class="num">' + cur(r.other) + '</td><td class="num cell-strong">' + cur(r.total) + '</td></tr>').join('') +
      '</tbody></table></div>' : '<div class="muted small">No shop costs in this period.</div>') +
      '<div class="row between wrap mt" style="gap:12px"><span class="muted">Net revenue ' + cur(revenue) + ' - shop costs ' + cur(total) + '</span><span class="cell-strong" style="font-size:16px">Net after shop costs: ' + cur(revenue - total) + '</span></div>' +
      (missing ? '<div class="help small">' + int(missing) + ' line(s) not counted: no exchange rate for their currency yet.</div>' : '') +
      '<div class="help small">Only months with an uploaded statement have shop costs.</div></div></div>';
  }
  const isActual = o => !!(o.rev && o.rev.actual && !o.rev.pending);
  const srcBadge = o => isActual(o) ? '<span class="badge badge-green">Actual (from statement)</span>' : '<span class="badge badge-amber">Estimated</span>';

  function renderSidebarFoot() {
    const pdfs = S.orders.reduce((s, o) => s + (o.pdfCount || 0), 0);
    document.getElementById('sidebarFoot').innerHTML =
      '<div class="stat"><span>Orders</span><b>' + int(S.orders.length) + '</b></div>' +
      '<div class="stat"><span>Reading PDFs</span><b>' + int(pdfs) + '</b></div>' +
      '<div class="row small sync-status" id="syncStatus" style="margin-top:10px;gap:6px"></div>';
    renderSync();
  }
  const SYNC = { idle: ['shield', 'Connected to GitHub', ''], pending: ['repeat', 'Saving soon...', ''], saving: ['repeat', 'Saving to GitHub...', ''], saved: ['check', 'Saved to GitHub', 'ok'], error: ['alert', 'Not saved - click to retry', 'err'], offline: ['alert', 'Offline - showing last copy', 'err'] };
  function renderSync() {
    const el = document.getElementById('syncStatus'); if (!el) return;
    const st = DB.configured() ? (SYNC[DB.status()] || SYNC.idle) : ['alert', 'Not connected', ''];
    el.className = 'row small sync-status ' + st[2];
    el.innerHTML = ico(st[0]) + '<span>' + st[1] + '</span>';
    el.onclick = DB.status() === 'error' ? () => DB.save() : null;
  }

  // ---------- router ----------
  const TITLES = { dashboard: 'Dashboard', orders: 'Orders', clients: 'Clients', upload: 'Upload', settings: 'Backup & Settings' };
  function route() {
    const r = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    const name = TITLES[r] ? r : 'dashboard';
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    document.getElementById('pageTitle').textContent = TITLES[name];
    document.getElementById('sidebar').classList.remove('open');
    drawer.close();
    const view = document.getElementById('view');
    ({ dashboard: viewDashboard, orders: viewOrders, clients: viewClients, upload: viewUpload, settings: viewSettings })[name](view);
    window.scrollTo(0, 0);
  }

  // ---------- filters ----------
  function periodRange(period) {
    const now = new Date();
    const iso = d => d.toISOString().slice(0, 10);
    const y = now.getFullYear(), m = now.getMonth();
    switch (period) {
      case 'month': return [iso(new Date(Date.UTC(y, m, 1))), '9999'];
      case '3m': return [iso(new Date(Date.UTC(y, m - 2, 1))), '9999'];
      case '12m': return [iso(new Date(Date.UTC(y, m - 11, 1))), '9999'];
      case 'year': return [y + '-01-01', '9999'];
      case 'lastyear': return [(y - 1) + '-01-01', (y - 1) + '-12-31'];
      default: return ['0000', '9999'];
    }
  }

  // ---------- dashboard ----------
  function viewDashboard(v) {
    if (!S.orders.length) { v.innerHTML = welcome(); hydrateIcons(v); return; }
    const f = S.dash;
    const [from, to] = periodRange(f.period);
    const list = S.orders.filter(o => (f.shop === 'all' || o.shop === f.shop) && (o.date || '') >= from && (o.date || '0000') <= to);
    const money_ = list.filter(isPrimary);
    const revenue = money_.reduce((s, o) => s + net(o), 0);
    const grossINR = money_.reduce((s, o) => s + o.rev.grossINR, 0), feesINR = money_.reduce((s, o) => s + o.rev.fees, 0);
    const clients = new Map();
    list.forEach(o => { const k = clientKey(o); const c = clients.get(k) || { name: o.buyerName || o.buyerUser, n: 0, spent: 0, shops: new Set(), last: '' }; c.n++; c.spent += net(o); c.shops.add(o.shop); if ((o.date || '') > c.last) c.last = o.date; clients.set(k, c); });
    const repeat = [...clients.values()].filter(c => c.n > 1);
    const otherCur = list.length - money_.length;
    const nActual = money_.filter(isActual).length;

    // monthly
    const byMonth = {};
    money_.forEach(o => { if (!o.date) return; const k = o.date.slice(0, 7); byMonth[k] = byMonth[k] || { v: 0, n: 0 }; byMonth[k].v += net(o); byMonth[k].n++; });
    const months = fillMonths(Object.keys(byMonth).sort(), f.period);
    // shops
    const byShop = {};
    list.forEach(o => { byShop[o.shop] = byShop[o.shop] || { v: 0, n: 0 }; byShop[o.shop].n++; byShop[o.shop].v += net(o); });
    const shopRows = Object.keys(byShop).sort((a, b) => byShop[b].v - byShop[a].v);
    const maxShop = Math.max(1, ...shopRows.map(s => byShop[s].v));
    // listings
    const byList = {};
    list.forEach(o => (o.items || []).forEach(it => { const k = it.title; byList[k] = byList[k] || { n: 0, v: 0, shops: new Set() }; byList[k].n += it.qty || 1; byList[k].v += itemNet(o, it); byList[k].shops.add(o.shop); }));
    const topList = Object.keys(byList).sort((a, b) => byList[b].n - byList[a].n || byList[b].v - byList[a].v).slice(0, 8);
    // countries
    const byCountry = {};
    list.forEach(o => { const c = o.country || 'Unknown'; byCountry[c] = (byCountry[c] || 0) + 1; });
    const topCountry = Object.keys(byCountry).sort((a, b) => byCountry[b] - byCountry[a]).slice(0, 6);
    const topClients = repeat.sort((a, b) => b.n - a.n || b.spent - a.spent).slice(0, 6);
    const noPdf = list.filter(o => !o.pdfCount).length;

    v.innerHTML =
      backupNotice() +
      '<div class="toolbar">' + shopChips(f.shop, 'dash-shop') + '<div class="spacer"></div>' +
      '<div class="seg" id="periodSeg">' + [['all', 'All time'], ['month', 'This month'], ['3m', '3 months'], ['12m', '12 months'], ['year', 'This year'], ['lastyear', 'Last year']]
        .map(p => '<button data-p="' + p[0] + '" class="' + (f.period === p[0] ? 'active' : '') + '">' + p[1] + '</button>').join('') + '</div></div>' +
      '<div class="grid kpis">' +
        kpi('money', 'Net revenue', cur(revenue), (otherCur ? otherCur + ' order(s) waiting for exchange rate' : 'Sales ' + cur(grossINR) + ' - Etsy fees ' + cur(feesINR)) + '<br>' + (money_.length ? int(nActual) + ' actual from statement · ' + int(money_.length - nActual) + ' estimated' : '')) +
        kpi('bag', 'Orders', int(list.length), list.length ? 'Avg ' + cur(money_.length ? revenue / money_.length : 0) + ' per order' : '') +
        kpi('users', 'Clients', int(clients.size), 'Unique buyers') +
        kpi('repeat', 'Repeat clients', int(repeat.length), clients.size ? Math.round(repeat.length / clients.size * 100) + '% came back' : '') +
        kpi('file', 'PDF missing', int(noPdf), noPdf ? '<a href="#/orders" data-nopdf="1" style="text-decoration:underline">See orders</a>' : 'All orders have PDF') +
      '</div>' +
      shopCostsCard(f.shop, from, to, revenue) +
      '<div class="grid two mt">' +
        '<div class="card"><div class="card-head"><div><h3>Sales by month</h3><div class="sub">Net revenue in ₹ (after discount, tax &amp; Etsy fees) · hover a bar</div></div></div><div class="card-body"><div class="chart" id="monthChart"></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>Sales by shop</h3></div><div class="card-body"><ul class="rank-list">' +
          (shopRows.map(s => '<li><div class="rank-main"><div class="row between"><div class="rank-title row" style="gap:8px">' + shopDot(s) + esc(s) + '</div><div class="rank-val">' + cur(byShop[s].v) + '</div></div>' +
            '<div class="rank-sub">' + int(byShop[s].n) + ' orders</div><div class="bar-track"><div class="bar-fill" style="width:' + (byShop[s].v / maxShop * 100) + '%;background:' + shopColor(s) + '"></div></div></div></li>').join('') || '<li class="muted">No data</li>') +
        '</ul></div></div>' +
      '</div>' +
      '<div class="grid two mt">' +
        '<div class="card"><div class="card-head"><h3>Best-selling listings</h3><span class="sub">By number sold</span></div><div class="card-body"><ul class="rank-list">' +
          (topList.map((t, i) => '<li><span class="rank-n">' + (i + 1) + '</span><div class="rank-main"><div class="rank-title" title="' + esc(t) + '">' + esc(t) + '</div><div class="rank-sub">' + [...byList[t].shops].map(esc).join(', ') + '</div></div><div style="text-align:right"><div class="rank-val">' + int(byList[t].n) + ' sold</div><div class="rank-sub">' + cur(byList[t].v) + '</div></div></li>').join('') ||
            '<li class="muted">No listing names yet. Upload the "Order Items" file from Etsy.</li>') +
        '</ul></div></div>' +
        '<div class="card"><div class="card-head"><h3>Top repeat clients</h3><a class="sub" href="#/clients">See all</a></div><div class="card-body"><ul class="rank-list">' +
          (topClients.map(c => '<li><div class="rank-main"><div class="rank-title">' + esc(c.name || '-') + '</div><div class="rank-sub">' + [...c.shops].map(esc).join(', ') + '</div></div><div style="text-align:right"><div class="rank-val">' + c.n + ' orders</div><div class="rank-sub">' + cur(c.spent) + '</div></div></li>').join('') ||
            '<li class="muted">No repeat clients yet.</li>') +
        '</ul>' +
        '<div class="section-title" style="margin-top:18px">Where clients are from</div><ul class="rank-list">' +
          topCountry.map(c => '<li><div class="rank-main"><div class="rank-title">' + esc(c) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + (byCountry[c] / list.length * 100) + '%"></div></div></div><div class="rank-val">' + int(byCountry[c]) + '</div></li>').join('') +
        '</ul></div></div>' +
      '</div>';

    barChart(document.getElementById('monthChart'), months.map(m => ({
      label: monthLabel(m, true), value: byMonth[m] ? byMonth[m].v : 0,
      tip: '<b>' + monthLabel(m) + '</b><br>' + cur(byMonth[m] ? byMonth[m].v : 0) + ' · ' + (byMonth[m] ? byMonth[m].n : 0) + ' orders'
    })), { fmtAxis: shortNum });

    v.querySelectorAll('[data-shopchip]').forEach(b => b.addEventListener('click', () => { S.dash.shop = b.dataset.shopchip; viewDashboard(v); }));
    v.querySelectorAll('#periodSeg button').forEach(b => b.addEventListener('click', () => { S.dash.period = b.dataset.p; viewDashboard(v); }));
    const np = v.querySelector('[data-nopdf]');
    if (np) np.addEventListener('click', () => { S.list = { shop: S.dash.shop, month: 'all', pdf: 'no', q: '', page: 1 }; });
    hydrateIcons(v);
  }

  function fillMonths(keys, period) {
    if (!keys.length) return [];
    let start = keys[0], end = keys[keys.length - 1];
    const now = new Date(); const nowK = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    if (period !== 'all' && period !== 'lastyear') { end = nowK > end ? nowK : end; const r = periodRange(period)[0].slice(0, 7); start = r; }
    const out = []; let [y, m] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) { out.push(y + '-' + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } if (out.length > 120) break; }
    return out.length > 36 ? out.slice(-36) : out;
  }

  const kpi = (icon, label, value, note) => '<div class="card kpi"><div class="kpi-label">' + ico(icon) + esc(label) + '</div><div class="kpi-value">' + value + '</div><div class="kpi-note">' + (note || '&nbsp;') + '</div></div>';

  function shopChips(active, attr) {
    return '<div class="chips"><button class="chip ' + (active === 'all' ? 'active' : '') + '" data-shopchip="all">All shops</button>' +
      S.shops.map(s => '<button class="chip ' + (active === s ? 'active' : '') + '" data-shopchip="' + esc(s) + '">' + shopDot(s) + esc(s) + '</button>').join('') + '</div>';
  }

  function backupNotice() {
    if (S.pendingFx) return '<div class="notice" style="margin-bottom:18px">' + ico('info') + '<div>' + S.pendingFx + ' order(s) are waiting for the exchange rate and are not in revenue yet. Reload the page with internet.</div></div>';
    if (DB.status() === 'offline') return '<div class="notice" style="margin-bottom:18px">' + ico('alert') + '<div>Could not reach GitHub. You are seeing the last saved copy. Check internet and reload.</div></div>';
    if (DB.status() === 'error') return '<div class="notice" style="margin-bottom:18px">' + ico('alert') + '<div>Last change was not saved to GitHub. Check internet, then click "Not saved - click to retry" at the bottom left.</div></div>';
    return '';
  }

  function welcome() {
    return '<div class="card"><div class="empty">' +
      '<div class="e-icon">' + ico('upload') + '</div>' +
      '<h2>Welcome to your Order Book</h2>' +
      '<p>Keep all orders from your Etsy shops in one place. Upload the Etsy file, add the reading PDF, and see your sales.</p>' +
      '<a class="btn btn-primary btn-lg" href="#/upload">' + ico('upload') + 'Upload first Etsy file</a>' +
      '<div class="welcome-steps">' +
        '<div class="card"><div class="n">1</div><h4>Download from Etsy</h4><p>Shop Manager → Settings → Options → Download Data → Orders. Choose "Order Items" and the year. Click Download CSV.</p></div>' +
        '<div class="card"><div class="n">2</div><h4>Upload here</h4><p>Pick the shop, drop the file. Names, listings, dates and prices fill in by themselves.</p></div>' +
        '<div class="card"><div class="n">3</div><h4>Add PDFs &amp; notes</h4><p>Drop the reading PDFs. They match to orders by order number or client name.</p></div>' +
      '</div></div></div>';
  }

  // ---------- orders ----------
  function filteredOrders() {
    const f = S.list; const q = P.norm(f.q);
    return S.orders.filter(o => {
      if (f.shop !== 'all' && o.shop !== f.shop) return false;
      if (f.month !== 'all' && (o.date || '').slice(0, 7) !== f.month) return false;
      if (f.pdf === 'yes' && !o.pdfCount) return false;
      if (f.pdf === 'no' && o.pdfCount) return false;
      if (q) {
        const hay = P.norm([o.buyerName, o.buyerUser, o.orderId, o.phone, o.country, o.city, o.note, (o.items || []).map(i => i.title).join(' ')].join(' '));
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.orderId).localeCompare(String(a.orderId)));
  }

  function viewOrders(v) {
    if (!S.orders.length) { v.innerHTML = welcome(); hydrateIcons(v); return; }
    const f = S.list;
    const months = [...new Set(S.orders.map(o => (o.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
    v.innerHTML =
      '<div class="toolbar">' + shopChips(f.shop) + '</div>' +
      '<div class="toolbar">' +
        '<div class="search-wrap">' + ico('search') + '<input id="ordSearch" type="search" placeholder="Search client, listing, order #, phone" value="' + esc(f.q) + '"></div>' +
        '<select class="select" id="ordMonth"><option value="all">All months</option>' + months.map(m => '<option value="' + m + '"' + (f.month === m ? ' selected' : '') + '>' + monthLabel(m) + '</option>').join('') + '</select>' +
        '<select class="select" id="ordPdf"><option value="all">PDF: all</option><option value="yes"' + (f.pdf === 'yes' ? ' selected' : '') + '>PDF added</option><option value="no"' + (f.pdf === 'no' ? ' selected' : '') + '>PDF missing</option></select>' +
        '<div class="spacer"></div><button class="btn" id="ordExport">' + ico('download') + 'Export to Excel</button>' +
      '</div>' +
      '<div class="card" id="ordCard"></div>';
    const draw = () => {
      const list = filteredOrders();
      const per = 50, pages = Math.max(1, Math.ceil(list.length / per));
      if (f.page > pages) f.page = pages;
      const rows = list.slice((f.page - 1) * per, f.page * per);
      const total = list.reduce((s, o) => s + net(o), 0);
      document.getElementById('ordCard').innerHTML =
        '<div class="card-head"><h3>' + int(list.length) + ' orders</h3><span class="sub">Net revenue ' + cur(total) + '</span></div>' +
        (rows.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Client</th><th>Listing</th><th>Shop</th><th class="num">Net revenue</th><th>PDF</th><th>Note</th></tr></thead><tbody>' +
          rows.map(o => '<tr class="clickable" data-key="' + esc(o.key) + '">' +
            '<td class="muted" style="white-space:nowrap">' + date(o.date) + '</td>' +
            '<td><div class="cell-strong">' + esc(o.buyerName || o.buyerUser || '-') + '</div><div class="cell-sub">' + esc(place(o) || '#' + o.orderId) + '</div></td>' +
            '<td><div class="cell-title" title="' + esc(firstTitle(o)) + '">' + esc(firstTitle(o)) + '</div>' + ((o.items || []).length > 1 ? '<div class="cell-sub">+' + (o.items.length - 1) + ' more</div>' : '') + '</td>' +
            '<td><span class="row" style="gap:6px;white-space:nowrap">' + shopDot(o.shop) + esc(o.shop) + '</span></td>' +
            '<td class="num"><div class="cell-strong">' + (isPrimary(o) ? cur(net(o)) : '<span class="badge badge-amber">Rate pending</span>') + '</div><div class="cell-sub">Paid ' + inrOr(o, paidOf(o)) + ' · ' + (isActual(o) ? '<span style="color:var(--green)">actual</span>' : 'est.') + '</div></td>' +
            '<td>' + (o.pdfCount ? '<span class="badge badge-green">' + ico('check') + 'Added</span>' : '<span class="badge badge-amber">Missing</span>') + '</td>' +
            '<td class="muted">' + (o.note ? '<span class="cell-title" style="max-width:160px;display:block">' + esc(o.note) + '</span>' : '-') + '</td></tr>').join('') +
          '</tbody></table></div>' +
          '<div class="pager"><span>Page ' + f.page + ' of ' + pages + '</span><div class="row"><button class="btn btn-sm" data-pg="-1"' + (f.page <= 1 ? ' disabled' : '') + '>Previous</button><button class="btn btn-sm" data-pg="1"' + (f.page >= pages ? ' disabled' : '') + '>Next</button></div></div>'
          : '<div class="empty"><h2>No orders found</h2><p>Try another search or filter.</p></div>');
      document.querySelectorAll('#ordCard tr[data-key]').forEach(tr => tr.addEventListener('click', () => openOrder(tr.dataset.key)));
      document.querySelectorAll('#ordCard [data-pg]').forEach(b => b.addEventListener('click', () => { f.page += +b.dataset.pg; draw(); window.scrollTo(0, 0); }));
      hydrateIcons(document.getElementById('ordCard'));
    };
    v.querySelectorAll('[data-shopchip]').forEach(b => b.addEventListener('click', () => { f.shop = b.dataset.shopchip; f.page = 1; viewOrders(v); }));
    let t; document.getElementById('ordSearch').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; f.page = 1; draw(); }, 150); });
    document.getElementById('ordMonth').addEventListener('change', e => { f.month = e.target.value; f.page = 1; draw(); });
    document.getElementById('ordPdf').addEventListener('change', e => { f.pdf = e.target.value; f.page = 1; draw(); });
    document.getElementById('ordExport').addEventListener('click', () => exportOrders(filteredOrders()));
    draw(); hydrateIcons(v);
  }

  function exportOrders(list) {
    const rows = [];
    list.forEach(o => {
      const items = o.items && o.items.length ? o.items : [{ title: firstTitle(o), qty: o.itemCount || '', total: o.subtotal || o.total }];
      const rv = o.rev || {};
      items.forEach(it => rows.push({
        'Shop': o.shop, 'Order #': o.orderId, 'Date': o.date, 'Client': o.buyerName, 'Username': o.buyerUser || '',
        'Listing': it.title, 'Qty': it.qty, 'Item amount': it.total, 'Currency': o.currency || '',
        'Order items': o.subtotal, 'Discount': o.discount, 'Postage': (o.shipping || 0) - (o.shipDiscount || 0), 'Tax (not revenue)': o.tax, 'Buyer paid': o.orderTotal,
        'Rate to INR': rv.rate || '', 'Sales INR': rv.grossINR, 'Transaction fee INR': rv.txFee, 'Processing fee INR': rv.procFee, 'Regulatory fee INR': rv.regFee || 0, 'Other fees INR': rv.otherFee || 0, 'Listing fee INR': rv.listFee || 0, 'Net revenue INR': rv.net,
        'Revenue source': rv.actual ? 'Actual (statement)' : 'Estimated',
        'Domestic': rv.domestic ? 'Yes' : 'No', 'Item net INR': Math.round(itemNet(o, it) * 100) / 100,
        'Phone': o.phone || '', 'City': o.city || '', 'State': o.state || '', 'Country': o.country || '',
        'PDFs': o.pdfCount || 0, 'Note': o.note || ''
      }));
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    XLSX.writeFile(wb, 'orders-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    toast('Excel file downloaded');
  }

  // ---------- order drawer ----------
  async function openOrder(key) {
    const o = await DB.getOrder(key);
    if (!o) return;
    const pdfs = await DB.pdfsForOrder(key);
    const others = S.orders.filter(x => clientKey(x) === clientKey(o) && x.key !== o.key).length;
    const mem0 = S.orders.find(x => x.key === key) || Object.assign({}, o, { rev: Revenue.compute(o, S.fees) });
    const d = drawer.open(
      '<div class="drawer-head"><div style="flex:1;min-width:0"><div class="row" style="gap:8px;margin-bottom:4px"><span class="badge">' + shopDot(o.shop) + esc(o.shop) + '</span>' +
        (others ? '<span class="badge badge-violet">' + ico('repeat') + (others + 1) + ' orders from this client</span>' : '') + '</div>' +
        '<h2>' + esc(o.buyerName || o.buyerUser || 'Order') + '</h2><div class="muted small">Order #' + esc(o.orderId) + ' · ' + date(o.date) + '</div></div>' +
        '<button class="icon-btn" data-close>' + ico('x') + '</button></div>' +
      '<div class="drawer-body">' +
        '<div class="kv">' +
          '<div class="k">Net revenue</div><div class="cell-strong">' + (isPrimary(mem0) ? cur(net(mem0)) + ' ' + srcBadge(mem0) : 'Waiting for exchange rate') + '</div>' +
          '<div class="k">Username</div><div>' + esc(o.buyerUser || '-') + '</div>' +
          '<div class="k">From</div><div>' + esc([o.city, o.state, o.country].filter(Boolean).join(', ') || '-') + '</div>' +
          '<div class="k">Phone</div><div><input class="input" id="phoneIn" style="padding:5px 9px;width:100%" placeholder="Not in Etsy file - add if you have it" value="' + esc(o.phone || '') + '"></div>' +
          (o.status ? '<div class="k">Status</div><div>' + esc(o.status) + '</div>' : '') +
        '</div>' +
        moneyBreakdown(o, mem0) +
        '<div class="section-title">Listing</div>' +
        ((o.items || []).length ? o.items.map(it => '<div class="item-row"><div style="min-width:0"><div class="cell-strong">' + esc(it.title) + '</div>' + (it.variations ? '<div class="cell-sub">' + esc(it.variations) + '</div>' : '') + '<div class="cell-sub">Qty ' + it.qty + (it.discount && o.items.length === 1 ? ' · discount ' + inrOr(o, it.discount) + ' off' : '') + '</div></div><div style="text-align:right"><div class="cell-strong" style="white-space:nowrap">' + inrOr(o, it.total != null ? it.total - (o.items.length === 1 ? (it.discount || 0) : 0) : null) + '</div>' + (isForeign(o) ? '<div class="cell-sub">' + money(it.total, o.currency) + '</div>' : '') + '</div></div>').join('')
          : '<div class="muted">Listing name not in this file. Upload the "Order Items" file for this shop.</div>') +
        '<div class="section-title">Reading PDF</div>' +
        '<div id="pdfList">' + pdfRows(pdfs) + '</div>' +
        '<div class="dropzone small mt" id="pdfDrop"><div class="dz-title" style="font-size:14px">' + ico('upload') + ' Drop PDF here or click</div><div class="dz-sub">The reading you sent to this client</div><input type="file" accept="application/pdf,.pdf" multiple hidden></div>' +
        '<div class="section-title">Notes</div>' +
        '<textarea class="notes" id="noteIn" placeholder="Write anything about this order or client...">' + esc(o.note || '') + '</textarea>' +
        '<div class="saved-hint" id="savedHint"></div>' +
        '<div class="section-title">Delete</div>' +
        '<div class="row between wrap" style="gap:10px"><span class="muted small">Removes this order, its notes and its PDF' + (pdfs.length > 1 ? 's' : '') + ' for good.</span><button class="btn btn-danger" id="ordDel">' + ico('trash') + 'Delete this order</button></div>' +
      '</div>');
    hydrateIcons(d);
    d.querySelector('[data-close]').addEventListener('click', drawer.close);

    let t;
    const save = async (field, val) => {
      const fresh = await DB.getOrder(key); fresh[field] = val; await DB.putOrder(fresh);
      const mem = S.orders.find(x => x.key === key); if (mem) mem[field] = val;
      document.getElementById('savedHint').textContent = 'Saved';
      setTimeout(() => { const h = document.getElementById('savedHint'); if (h) h.textContent = ''; }, 1500);
    };
    d.querySelector('#noteIn').addEventListener('input', e => { clearTimeout(t); const val = e.target.value; t = setTimeout(() => save('note', val), 400); });
    d.querySelector('#phoneIn').addEventListener('change', e => save('phone', e.target.value.trim()));
    drawer.onClose = () => { if (location.hash.indexOf('orders') >= 0 || location.hash.indexOf('clients') >= 0 || location.hash === '' || location.hash.indexOf('dashboard') >= 0) softRefresh(); };

    const dz = d.querySelector('#pdfDrop'); const fi = dz.querySelector('input');
    const add = async files => {
      const list = [...files].filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
      if (!list.length) return toast('Please choose a PDF file', 'err');
      toast('Uploading ' + (list.length > 1 ? list.length + ' PDFs' : 'PDF') + '...');
      try { for (const f of list) await attachPdf(key, f); await DB.flush(); } catch (err) { toast(err.message, 'err'); }
      const fresh = await DB.pdfsForOrder(key);
      document.getElementById('pdfList').innerHTML = pdfRows(fresh); bindPdfRows(key); hydrateIcons(d);
      toast(list.length > 1 ? list.length + ' PDFs added' : 'PDF added');
    };
    bindDrop(dz, fi, add);
    bindPdfRows(key);

    d.querySelector('#ordDel').addEventListener('click', async () => {
      const n = (await DB.pdfsForOrder(key)).length;
      const who = o.buyerName || o.buyerUser || 'this client';
      if (!await confirmBox({ title: 'Delete this order?', text: 'Order #' + o.orderId + ' (' + who + ') will be removed with its notes' + (n ? ' and ' + n + ' PDF' + (n > 1 ? 's' : '') : '') + '. This cannot be undone. If you upload the same Etsy file again, the order comes back (without notes and PDF).', ok: 'Delete', danger: true })) return;
      toast('Deleting...');
      try { await DB.deleteOrder(key); await DB.flush(); } catch (err) { return toast(err.message, 'err'); }
      S.orders = S.orders.filter(x => x.key !== key);
      renderSidebarFoot();
      drawer.onClose = null;
      drawer.close();
      softRefresh();
      toast('Order deleted');
    });
  }

  function moneyBreakdown(o, m) {
    const c = o.currency || S.shopCurrency, r = m.rev || {};
    const line = (k, v, cls) => '<div class="item-row" style="padding:6px 0"><span class="' + (cls || 'muted') + '">' + k + '</span><span class="' + (cls || '') + '" style="white-space:nowrap">' + v + '</span></div>';
    const foreign = c.toUpperCase() !== 'INR';
    const amt = (a, minus) => { const v = toINR(o, a); const main = v == null ? money(a, c) : money(v, 'INR'); return (minus ? '- ' : '') + main + (foreign && v != null ? ' <span class="muted small">(' + money(a, c) + ')</span>' : ''); };
    let h = '<div class="section-title">Money</div>' +
      line('Items', amt(o.subtotal != null ? o.subtotal : o.total)) +
      (o.discount ? line('Discount', amt(o.discount, true)) : '') +
      ((o.shipping || 0) - (o.shipDiscount || 0) ? line('Postage', amt((o.shipping || 0) - (o.shipDiscount || 0))) : '') +
      (o.tax ? line('Tax paid by buyer (not revenue)', amt(o.tax)) : '') +
      line('Buyer paid', amt(paidOf(o)));
    if (r.pending) return h + '<div class="notice mt">' + ico('info') + '<div>Exchange rate not loaded yet. Open the app with internet and it fills in.</div></div>';
    if (r.actual) return h + actualBreakdown(o, r, line);
    h += '<div class="row between" style="margin-top:12px"><span class="section-sub">Fees</span><span class="badge badge-amber">Estimated</span></div>' +
      (c.toUpperCase() !== 'INR' ? line('Rate', '1 ' + esc(c) + ' = ₹' + r.rate.toFixed(2) + (o.fxSource ? ' (' + esc(o.fxSource) + ')' : '')) : '') +
      line('Sales (after discount, no tax)', cur(r.grossINR)) +
      line('Transaction fee ' + S.fees.transactionPct + '%', '- ' + cur(r.txFee)) +
      line('Payment processing (' + (r.domestic ? 'India ' + S.fees.domesticPct + '% + ₹' + S.fees.domesticFixed : 'international ' + S.fees.internationalPct + '% + ₹' + S.fees.internationalFixed) + ')', '- ' + cur(r.procFee)) +
      (r.regFee ? line('Regulatory operating fee ' + S.fees.regulatoryPct + '%', '- ' + cur(r.regFee)) : '') +
      (r.listFee ? line('Listing fee (auto-renew)', '- ' + cur(r.listFee)) : '') +
      line('Net revenue', cur(r.net), 'cell-strong') +
      '<div class="help small">Fees are worked out with your revenue rules. Upload the Etsy monthly statement for this month to get the exact numbers.</div>';
    return h;
  }

  function actualBreakdown(o, r, line) {
    const sc = r.stmtCurrency, fx = sc && sc !== 'INR';
    const v = (inr, k, minus) => (minus ? '- ' : '') + cur(Math.abs(inr)) + (fx && r.orig && r.orig[k] != null ? ' <span class="muted small">(' + money(Math.abs(r.orig[k]), sc) + ')</span>' : '');
    const periods = [...new Set((o.stmt.lines || []).map(l => (l.date || '').slice(0, 7)).filter(Boolean))].sort().map(monthLabel).join(', ');
    return '<div class="row between" style="margin-top:12px"><span class="section-sub">Etsy statement</span><span class="badge badge-green">Actual (from statement)</span></div>' +
      (fx ? line('Rate', '1 ' + esc(sc) + ' = ₹' + (r.stmtRate || 0).toFixed(2) + (sc === (o.currency || '').toUpperCase() && o.fxSource ? ' (' + esc(o.fxSource) + ')' : '')) : '') +
      line('Sale (buyer paid)', v(r.saleINR, 'sale')) +
      (r.taxINR ? line('Tax paid by buyer (Etsy keeps it)', v(r.taxINR, 'tax', true)) : '') +
      (r.refundINR ? line('Refund', v(r.refundINR, 'refund', true)) : '') +
      line('Transaction fee', v(r.txFee, 'tx', true)) +
      line('Payment processing fee', v(r.procFee, 'proc', true)) +
      (r.regFee ? line('Regulatory operating fee', v(r.regFee, 'reg', true)) : '') +
      (r.otherFee ? line('Other Etsy fees', v(r.otherFee, 'other', r.otherFee > 0)) : '') +
      (r.listFee ? line('Listing fee (auto-renew)' + (r.listFeeSrc === 'rule' ? ' <span class="muted small">(rule - not in statement)</span>' : ''), r.listFeeSrc === 'rule' ? '- ' + cur(r.listFee) : v(r.listFee, 'renew', true)) : '') +
      line('Net revenue', cur(r.net), 'cell-strong') +
      '<div class="help small">From ' + int(r.lineCount) + ' lines in the Etsy monthly statement' + (periods ? ' (' + esc(periods) + ')' : '') + '.</div>';
  }

  function pdfRows(pdfs) {
    if (!pdfs.length) return '<div class="muted small">No PDF added yet.</div>';
    return pdfs.map(p => '<div class="file-row" data-pdf="' + esc(p.id) + '"><div class="file-ico">PDF</div><div class="file-main"><div class="file-name">' + esc(p.name) + '</div><div class="file-sub">' + bytes(p.size) + ' · added ' + date(new Date(p.addedAt).toISOString().slice(0, 10)) + '</div></div>' +
      '<button class="btn btn-sm" data-act="open">' + ico('eye') + 'Open</button><button class="icon-btn" data-act="del" title="Remove">' + ico('trash') + '</button></div>').join('');
  }
  function bindPdfRows(orderKey) {
    document.querySelectorAll('#pdfList [data-pdf]').forEach(row => {
      const id = row.dataset.pdf;
      row.querySelector('[data-act=open]').addEventListener('click', async () => {
        let p; try { p = await DB.getPdf(id); } catch (err) { return toast(err.message, 'err'); }
        const url = URL.createObjectURL(p.blob);
        const w = window.open(url, '_blank');
        if (!w) { const a = document.createElement('a'); a.href = url; a.download = p.name; a.click(); }
      });
      row.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!await confirmBox({ title: 'Remove this PDF?', text: 'The PDF will be deleted from this order.', ok: 'Remove', danger: true })) return;
        try { await DB.deletePdf(id); await bumpPdfCount(orderKey, -1); } catch (err) { return toast(err.message, 'err'); }
        document.getElementById('pdfList').innerHTML = pdfRows(await DB.pdfsForOrder(orderKey)); bindPdfRows(orderKey); hydrateIcons(document.getElementById('drawer'));
        toast('PDF removed');
      });
    });
  }

  async function attachPdf(orderKey, file) {
    const id = 'pdf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const blob = new Blob([await file.arrayBuffer()], { type: 'application/pdf' });
    await DB.addPdf({ id, orderKey, name: file.name, size: file.size, blob, addedAt: Date.now() });
    await bumpPdfCount(orderKey, 1);
  }
  async function bumpPdfCount(orderKey, delta) {
    const o = await DB.getOrder(orderKey); if (!o) return;
    o.pdfCount = Math.max(0, (o.pdfCount || 0) + delta); await DB.putOrder(o);
    const mem = S.orders.find(x => x.key === orderKey); if (mem) mem.pdfCount = o.pdfCount;
    renderSidebarFoot();
  }

  function softRefresh() {
    const r = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    const v = document.getElementById('view');
    if (r === 'orders') viewOrders(v); else if (r === 'clients') viewClients(v); else if (r === 'dashboard') viewDashboard(v);
  }

  function bindDrop(dz, input, onFiles) {
    dz.addEventListener('click', e => { if (e.target.closest('button,a,input,select')) return; input.click(); });
    input.addEventListener('change', () => { if (input.files.length) onFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
  }

  // ---------- clients ----------
  function buildClients() {
    const map = new Map();
    S.orders.forEach(o => {
      const k = clientKey(o);
      const c = map.get(k) || { key: k, name: '', user: '', orders: [], spent: 0, shops: new Set(), first: '9999', last: '', country: '', phone: '' };
      c.orders.push(o); c.spent += net(o); c.shops.add(o.shop);
      if (!c.name && o.buyerName) c.name = o.buyerName; if (!c.user && o.buyerUser) c.user = o.buyerUser;
      if (o.date && o.date < c.first) c.first = o.date; if ((o.date || '') > c.last) c.last = o.date;
      if (!c.country && o.country) c.country = o.country; if (!c.phone && o.phone) c.phone = o.phone;
      map.set(k, c);
    });
    return [...map.values()];
  }

  function viewClients(v) {
    if (!S.orders.length) { v.innerHTML = welcome(); hydrateIcons(v); return; }
    const f = S.cl;
    v.innerHTML = '<div class="toolbar"><div class="search-wrap">' + ico('search') + '<input id="clSearch" type="search" placeholder="Search client name, phone, country" value="' + esc(f.q) + '"></div>' +
      '<select class="select" id="clSort"><option value="spent">Most spent</option><option value="orders">Most orders</option><option value="recent">Recent first</option><option value="name">Name A-Z</option></select>' +
      '<div class="spacer"></div><span class="muted small" id="clCount"></span></div><div class="card" id="clCard"></div>';
    document.getElementById('clSort').value = f.sort;
    const all = buildClients();
    const draw = () => {
      const q = P.norm(f.q);
      let list = all.filter(c => !q || P.norm([c.name, c.user, c.phone, c.country].join(' ')).indexOf(q) >= 0);
      const sorters = { spent: (a, b) => b.spent - a.spent, orders: (a, b) => b.orders.length - a.orders.length || b.spent - a.spent, recent: (a, b) => b.last.localeCompare(a.last), name: (a, b) => (a.name || '').localeCompare(b.name || '') };
      list.sort(sorters[f.sort]);
      const rep = all.filter(c => c.orders.length > 1).length;
      document.getElementById('clCount').textContent = int(all.length) + ' clients · ' + int(rep) + ' repeat';
      const rows = list.slice(0, 300);
      document.getElementById('clCard').innerHTML = rows.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th class="num">Orders</th><th class="num">Spent</th><th>Shops</th><th>Last order</th><th>Phone</th></tr></thead><tbody>' +
        rows.map(c => '<tr class="clickable" data-ck="' + esc(c.key) + '"><td><div class="cell-strong row" style="gap:8px">' + esc(c.name || c.user || '-') + (c.orders.length > 1 ? '<span class="badge badge-violet">Repeat</span>' : '') + '</div><div class="cell-sub">' + esc([c.user, c.country].filter(Boolean).join(' · ')) + '</div></td>' +
          '<td class="num cell-strong">' + c.orders.length + '</td><td class="num">' + cur(c.spent) + '</td>' +
          '<td>' + [...c.shops].map(s => '<span class="row" style="gap:6px;display:inline-flex;margin-right:10px;white-space:nowrap">' + shopDot(s) + esc(s) + '</span>').join('') + '</td>' +
          '<td class="muted" style="white-space:nowrap">' + date(c.last) + '</td><td class="muted">' + esc(c.phone || '-') + '</td></tr>').join('') +
        '</tbody></table></div>' + (list.length > 300 ? '<div class="pager">Showing first 300. Use search to find a client.</div>' : '')
        : '<div class="empty"><h2>No clients found</h2><p>Try another search.</p></div>';
      document.querySelectorAll('#clCard tr[data-ck]').forEach(tr => tr.addEventListener('click', () => openClient(all.find(c => c.key === tr.dataset.ck))));
    };
    let t; document.getElementById('clSearch').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; draw(); }, 150); });
    document.getElementById('clSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
    draw(); hydrateIcons(v);
  }

  function openClient(c) {
    const orders = c.orders.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const d = drawer.open('<div class="drawer-head"><div style="flex:1"><h2>' + esc(c.name || c.user) + '</h2><div class="muted small">' + esc([c.user, c.country, c.phone].filter(Boolean).join(' · ')) + '</div></div><button class="icon-btn" data-close>' + ico('x') + '</button></div>' +
      '<div class="drawer-body"><div class="grid half">' +
        '<div class="card kpi"><div class="kpi-label">Orders</div><div class="kpi-value">' + orders.length + '</div></div>' +
        '<div class="card kpi"><div class="kpi-label">Total spent</div><div class="kpi-value">' + cur(c.spent) + '</div></div></div>' +
      '<div class="kv mt"><div class="k">First order</div><div>' + date(c.first === '9999' ? '' : c.first) + '</div><div class="k">Last order</div><div>' + date(c.last) + '</div><div class="k">Shops</div><div>' + [...c.shops].map(esc).join(', ') + '</div></div>' +
      '<div class="section-title">All orders</div>' +
      orders.map(o => '<div class="file-row clickable" style="cursor:pointer" data-key="' + esc(o.key) + '"><div class="file-main"><div class="file-name">' + esc(firstTitle(o)) + '</div><div class="file-sub">' + date(o.date) + ' · ' + esc(o.shop) + ' · #' + esc(o.orderId) + '</div></div><div class="cell-strong">' + (isPrimary(o) ? cur(net(o)) : '-') + '</div>' +
        (o.pdfCount ? '<span class="badge badge-green">PDF</span>' : '<span class="badge badge-amber">No PDF</span>') + '</div>').join('') +
      '</div>');
    hydrateIcons(d);
    d.querySelector('[data-close]').addEventListener('click', drawer.close);
    d.querySelectorAll('[data-key]').forEach(r => r.addEventListener('click', () => openOrder(r.dataset.key)));
  }

  // ---------- upload ----------
  function viewUpload(v) {
    const u = S.up;
    v.innerHTML = '<div class="toolbar"><div class="seg" id="upTabs"><button data-t="orders" class="' + (u.tab === 'orders' ? 'active' : '') + '">Etsy orders file</button><button data-t="pdfs" class="' + (u.tab === 'pdfs' ? 'active' : '') + '">Reading PDFs</button></div></div><div id="upBody"></div>';
    v.querySelectorAll('#upTabs button').forEach(b => b.addEventListener('click', () => { u.tab = b.dataset.t; viewUpload(v); }));
    if (u.tab === 'orders') uploadOrders(document.getElementById('upBody')); else uploadPdfs(document.getElementById('upBody'));
    hydrateIcons(v);
  }

  function stepper(n) {
    const names = ['Choose shop', 'Upload file', 'Check & save'];
    return '<div class="steps">' + names.map((s, i) => (i ? '<div class="step-line"></div>' : '') + '<div class="step ' + (i + 1 < n ? 'done' : i + 1 === n ? 'active' : '') + '"><span class="n">' + (i + 1 < n ? '✓' : i + 1) + '</span>' + s + '</div>').join('') + '</div>';
  }

  function uploadOrders(box) {
    const u = S.up;
    if (u.parsed) return reviewImport(box);
    const step = u.shop ? 2 : 1;
    box.innerHTML = '<div class="card card-pad">' + stepper(step) +
      '<label class="label">1. Which shop is this file from?</label><div class="shop-pick">' +
        S.shops.map(s => '<div class="shop-opt ' + (u.shop === s ? 'active' : '') + '" data-shop="' + esc(s) + '">' + shopDot(s) + esc(s) + '</div>').join('') + '</div>' +
      '<label class="label mt-lg">2. Drop the Etsy file</label>' +
      '<div class="dropzone" id="ordDrop"><div class="dz-icon">' + ico('sheet') + '</div><div class="dz-title">Drop CSV or Excel files here</div><div class="dz-sub">or click to choose · add the orders file and the monthly statement together</div><input type="file" accept=".csv,.xlsx,.xls,text/csv" multiple hidden></div>' +
      '<div class="help mt"><b>How to get the file from Etsy</b><ol><li>Open Etsy <b>Shop Manager</b> → <b>Settings</b> → <b>Options</b></li><li>Open the <b>Download Data</b> tab, go to <b>Orders</b></li><li>CSV Type: choose <b>Order Items</b> (has listing names). Choose the year (leave month empty for full year)</li><li>Click <b>Download CSV</b>. Also download <b>Orders</b> type if you want city and country</li></ol><div class="mt small">Uploading the same file again is safe. Old orders are updated, not doubled.</div></div>' +
      '<div class="help mt"><b>Monthly statement (exact fees and tax)</b><ol><li>Open Etsy <b>Shop Manager</b> → <b>Finances</b> → <b>Payment account</b></li><li>Open the <b>monthly statement</b> for the month you want</li><li>Click <b>Download CSV</b> and drop it here with the orders file</li></ol><div class="mt small">With a statement, the app uses Etsy\'s real fees and tax for those orders. Orders without a statement stay "Estimated". Uploading the same statement again is safe - lines already saved are skipped.</div></div>' +
      '<div class="label mt-lg">Statements already uploaded</div>' + statementsTable() +
      '</div>';
    box.querySelectorAll('[data-shop]').forEach(el => el.addEventListener('click', () => { u.shop = el.dataset.shop; uploadOrders(box); hydrateIcons(box); }));
    const dz = box.querySelector('#ordDrop');
    bindDrop(dz, dz.querySelector('input'), files => handleOrderFiles([...files], box));
    hydrateIcons(box);
  }

  async function readSheetFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      const text = await file.text();
      return P.rowsToObjects(P.parseCSV(text));
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    rows.forEach((r, i) => { r._n = i + 1; });
    return P.rowsToObjects(rows.filter(r => r.some(c => String(c).trim() !== '')));
  }

  async function handleOrderFiles(files, box) {
    const u = S.up;
    const guessed = files.map(f => P.guessShop(f.name, S.shops)).find(Boolean);
    if (!u.shop && guessed) u.shop = guessed;
    if (!u.shop) { toast('First choose the shop', 'err'); return; }
    const results = [], stmts = [];
    for (const f of files) {
      try {
        const { headers, records } = await readSheetFile(f);
        if (ST.detect(headers)) {
          const st = ST.parse(headers, records); st.file = f.name;
          if (st.lines.length) stmts.push(st); else toast(f.name + ': statement has no lines', 'err');
          continue;
        }
        const res = P.normalize(headers, records);
        res.file = f.name; results.push(res);
      } catch (e) { console.error(e); toast('Could not read ' + f.name, 'err'); }
    }
    const good = results.filter(r => r.type !== 'unknown' && r.orders.length);
    if (!good.length && !stmts.length) { toast(results[0] && results[0].warnings[0] || 'No orders found in this file', 'err'); return; }
    // merge results of several files (items + orders) by order id; items files last so their items win
    const merged = new Map();
    good.sort((a, b) => (a.type === 'orders' ? 0 : 1) - (b.type === 'orders' ? 0 : 1)).forEach(r => r.orders.forEach(o => {
      o._src = r.type; const prev = merged.get(o.orderId); merged.set(o.orderId, prev ? mergeOrder(prev, o) : o);
    }));
    const incoming = [...merged.values()];
    let fxError = '';
    try { await Revenue.ensureFx(incoming); } catch (e) { fxError = 'Could not load exchange rates (' + e.message + '). Orders will be saved; revenue fills in when the app is online.'; }
    // preview with the statement lines (already saved + in this upload), so the review shows the exact numbers
    const stLines = {};
    S.orders.forEach(o => { if (o.stmt && o.stmt.lines) stLines[o.orderId] = o.stmt.lines.slice(); });
    Object.keys(S.stmtPending || {}).forEach(id => { stLines[id] = (stLines[id] || []).concat(S.stmtPending[id]); });
    stmts.forEach(st => st.lines.forEach(l => { if (!l.orderId) return; const a = stLines[l.orderId] = stLines[l.orderId] || []; if (!a.some(x => x.k === l.k)) a.push(l); }));
    incoming.forEach(o => { const ls = stLines[o.orderId]; o.rev = Revenue.compute(ls ? Object.assign({}, o, { stmt: { lines: ls } }) : o, S.fees); });
    const existing = new Set(S.orders.map(o => o.key));
    const keys = incoming.map(o => DB.orderKey(u.shop, o.orderId));
    const warnings = [...new Set(good.flatMap(r => r.warnings))];
    if (good.some(r => r.type === 'items' || r.type === 'combined')) {
      for (let i = warnings.length - 1; i >= 0; i--) if (/no listing names/.test(warnings[i])) warnings.splice(i, 1);
    }
    const otherShop = files.map(f => P.guessShop(f.name, S.shops)).find(g => g && g !== u.shop);
    if (fxError) warnings.unshift(fxError);
    results.filter(r => r.type === 'unknown').forEach(r => warnings.unshift(r.file + ': not an Etsy orders file or monthly statement, skipped.'));
    const noCountry = incoming.filter(o => !o.country).length;
    if (noCountry) warnings.push(noCountry + ' order(s) have no country in the file, so they are counted as international (' + S.fees.internationalPct + '% + ₹' + S.fees.internationalFixed + '). Upload the "Orders" file too - it has the buyer country.');
    if (otherShop) warnings.unshift('The file name says "' + otherShop + '" but you chose "' + u.shop + '". Please check the shop.');
    const rowInfo = good.concat(results.filter(r => r.type === 'unknown')).map(r => {
      const merged = r.mergedRows || [], dups = r.dupRows || [], skip = r.skippedRows || [];
      const byOrder = {};
      merged.forEach(m => { (byOrder[m.orderId] = byOrder[m.orderId] || { first: m.firstRow, rows: [] }).rows.push(m.row); });
      return {
        file: r.file, rows: r.rows || 0, orders: r.orders.length, merged: merged.length, dups: dups.length, skipped: skip.length,
        mergedText: Object.keys(byOrder).map(id => 'order #' + id + ': rows ' + [byOrder[id].first].concat(byOrder[id].rows).join(' + ')),
        dupText: dups.map(d => 'row ' + d.row + ' is a copy of row ' + d.firstRow + ' (order #' + d.orderId + ')'),
        skipText: r.type === 'unknown' ? ['whole file (not an Etsy orders file)'] : skip.map(x => 'row ' + x.row + ': ' + x.reason)
      };
    });
    u.parsed = {
      rowInfo,
      statements: stmts,
      files: good.map(r => r.file + ' (' + ({ items: 'Order Items', orders: 'Orders', combined: 'Orders + Items' })[r.type] + ')').concat(stmts.map(st => st.file + ' (Monthly statement)')),
      orders: incoming, newCount: keys.filter(k => !existing.has(k)).length, updCount: keys.filter(k => existing.has(k)).length, warnings
    };
    reviewImport(box);
  }

  // "40 rows -> 37 orders" explained per file: extra items of the same order, copied rows, skipped rows
  function rowMath(info) {
    if (!info || !info.length) return '';
    return '<div class="help mt-lg">' + info.map(r => {
      const parts = [];
      if (r.merged) parts.push('<div class="mt small"><b>' + int(r.merged) + (r.merged === 1 ? ' row is an extra item' : ' rows are extra items') + ' in an order already counted</b> (one order with more than one listing): ' + esc(r.mergedText.join('; ')) + '</div>');
      if (r.dups) parts.push('<div class="mt small"><b>' + int(r.dups) + (r.dups === 1 ? ' row is an exact copy' : ' rows are exact copies') + '</b> (same Transaction ID), counted once: ' + esc(r.dupText.join('; ')) + '</div>');
      if (r.skipped) parts.push('<div class="mt small" style="color:var(--red)"><b>' + int(r.skipped) + (r.skipped === 1 ? ' row skipped' : ' rows skipped') + ':</b> ' + esc(r.skipText.join('; ')) + '</div>');
      return '<div><b>' + esc(r.file) + ':</b> ' + int(r.rows) + ' rows → ' + int(r.orders) + ' orders' + (!parts.length ? ' (every row is its own order)' : '') + parts.join('') + '</div>';
    }).join('<div class="mt"></div>') + '</div>';
  }

  function mergeOrder(a, b) {
    const out = Object.assign({}, a);
    ['date', 'buyerName', 'buyerUser', 'phone', 'city', 'state', 'country', 'currency', 'status', 'sku', 'itemCount'].forEach(k => {
      if (b[k] && (!out[k] || (k === 'date' && b[k] < out[k]))) out[k] = b[k];
    });
    if (b.items && b.items.length) out.items = b.items;
    if (b.moneySrc === 'orders' || a.moneySrc !== 'orders') MONEY_FIELDS.forEach(k => { out[k] = b[k]; });
    return out;
  }

  function reviewImport(box) {
    const u = S.up, p = u.parsed;
    const dates = p.orders.map(o => o.date).filter(Boolean).sort();
    const total = p.orders.reduce((s, o) => s + (toINR(o, paidOf(o) || 0) || 0), 0);
    const curr = (p.orders.find(o => o.currency) || {}).currency || S.shopCurrency;
    const netTotal = p.orders.reduce((s, o) => s + (o.rev && !o.rev.pending ? o.rev.net : 0), 0);
    const discTotal = p.orders.reduce((s, o) => s + (toINR(o, o.discount || 0) || 0), 0);
    const withPhone = p.orders.filter(o => o.phone).length;
    const sample = p.orders.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
    const hasOrders = p.orders.length > 0, stmts = p.statements || [];
    const sp = stmts.length ? previewStatements(u.shop, stmts, p.orders) : [];
    const stmtHtml = sp.length ? '<div class="section-title">Monthly statement</div>' + sp.map(x =>
        '<div class="item-row"><div><div class="cell-strong">' + shopDot(u.shop) + ' ' + esc(u.shop) + ' · ' + esc(x.period ? monthLabel(x.period) : 'Unknown month') + ' <span class="muted small">(' + esc(x.currency || '-') + ')</span></div>' +
          '<div class="cell-sub">' + int(x.total) + ' lines: ' + int(x.newCount) + ' new' + (x.dupCount ? ', ' + int(x.dupCount) + ' already saved (skipped)' : '') + ' · ' + int(x.matched) + (x.matched === 1 ? ' order gets' : ' orders get') + ' exact numbers' + (x.unmatched ? ', ' + int(x.unmatched) + (x.unmatched === 1 ? ' order' : ' orders') + ' not in the app yet (kept, matched when you upload their orders file)' : '') + '</div></div>' +
          (x.already ? '<span class="badge">Uploaded before</span>' : '<span class="badge badge-green">New month</span>') + '</div>').join('') : '';
    const saveLabel = hasOrders ? 'Save ' + int(p.orders.length) + ' orders' + (stmts.length ? ' + statement' : '') : 'Save statement';
    if (!hasOrders) {
      box.innerHTML = '<div class="card card-pad">' + stepper(3) +
        '<div class="row between wrap"><div><div class="label" style="margin:0">Ready to save to <span class="row" style="display:inline-flex;gap:6px">' + shopDot(u.shop) + esc(u.shop) + '</span></div><div class="muted small">' + p.files.map(esc).join(' · ') + '</div></div></div>' +
        (p.warnings.length ? '<div class="mt-lg">' + p.warnings.map(w => '<div class="notice" style="margin-top:8px">' + ico('info') + '<div>' + esc(w) + '</div></div>').join('') + '</div>' : '') +
        stmtHtml +
        '<div class="row mt-lg" style="justify-content:flex-end"><button class="btn" id="impCancel">Cancel</button><button class="btn btn-primary btn-lg" id="impSave">' + ico('check') + saveLabel + '</button></div></div>';
    } else
    box.innerHTML = '<div class="card card-pad">' + stepper(3) +
      '<div class="row between wrap"><div><div class="label" style="margin:0">Ready to save to <span class="row" style="display:inline-flex;gap:6px">' + shopDot(u.shop) + esc(u.shop) + '</span></div><div class="muted small">' + p.files.map(esc).join(' · ') + '</div></div></div>' +
      '<div class="summary-row mt-lg">' +
        '<div class="s"><div class="s-n">' + int(p.orders.length) + '</div><div class="s-l">Orders found</div></div>' +
        '<div class="s"><div class="s-n" style="color:var(--green)">' + int(p.newCount) + '</div><div class="s-l">New</div></div>' +
        '<div class="s"><div class="s-n">' + int(p.updCount) + '</div><div class="s-l">Already saved (will update)</div></div>' +
        '<div class="s"><div class="s-n">' + cur(total) + '</div><div class="s-l">Buyers paid' + (discTotal ? ' (discount ' + cur(discTotal) + ')' : '') + '</div></div>' +
        '<div class="s"><div class="s-n" style="color:var(--green)">' + cur(netTotal) + '</div><div class="s-l">Net revenue (after fees)</div></div>' +
        '<div class="s"><div class="s-n" style="font-size:16px;padding-top:5px">' + (dates.length ? date(dates[0]) + ' - ' + date(dates[dates.length - 1]) : '-') + '</div><div class="s-l">Dates</div></div>' +
        '<div class="s"><div class="s-n">' + int(withPhone) + '</div><div class="s-l">With phone</div></div>' +
      '</div>' +
      rowMath(p.rowInfo) +
      (p.warnings.length ? '<div class="mt-lg">' + p.warnings.map(w => '<div class="notice" style="margin-top:8px">' + ico('info') + '<div>' + esc(w) + '</div></div>').join('') + '</div>' : '') +
      '<div class="card mt-lg" style="box-shadow:none"><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Client</th><th>Listing</th><th class="num">Paid</th><th class="num">Net revenue</th></tr></thead><tbody>' +
        sample.map(o => '<tr><td class="muted" style="white-space:nowrap">' + date(o.date) + '</td><td class="cell-strong">' + esc(o.buyerName || o.buyerUser || '-') + '</td><td><div class="cell-title">' + esc(firstTitle(o)) + '</div></td><td class="num">' + inrOr(o, paidOf(o)) + '</td><td class="num cell-strong">' + (o.rev && !o.rev.pending ? cur(o.rev.net) : '-') + '</td></tr>').join('') +
      '</tbody></table></div>' + (p.orders.length > sample.length ? '<div class="pager">+ ' + int(p.orders.length - sample.length) + ' more orders</div>' : '') + '</div>' +
      stmtHtml +
      '<div class="row mt-lg" style="justify-content:flex-end"><button class="btn" id="impCancel">Cancel</button><button class="btn btn-primary btn-lg" id="impSave">' + ico('check') + saveLabel + '</button></div>' +
      '</div>';
    hydrateIcons(box);
    box.querySelector('#impCancel').addEventListener('click', () => { u.parsed = null; uploadOrders(box); });
    box.querySelector('#impSave').addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = 'Saving...';
      let res = null, sres = null;
      try {
        if (hasOrders) res = await saveImport(u.shop, p.orders);
        if (stmts.length) sres = await applyStatements(u.shop, stmts);
      } catch (err) { e.target.disabled = false; e.target.textContent = 'Try again'; return toast(err.message, 'err'); }
      u.parsed = null; const savedShop = u.shop; u.shop = null;
      const sMsg = sres ? 'Statement: ' + int(sres.added) + ' new lines' + (sres.dup ? ', ' + int(sres.dup) + ' already saved' : '') + '. ' + int(sres.actual) + (sres.actual === 1 ? ' order now uses' : ' orders now use') + ' exact Etsy numbers' + (sres.waiting ? ', ' + int(sres.waiting) + (sres.waiting === 1 ? ' order' : ' orders') + ' waiting for their orders file' : '') + '.' : '';
      box.innerHTML = '<div class="card"><div class="empty"><div class="e-icon" style="background:var(--green-bg);color:var(--green)">' + ico('check') + '</div><h2>' + (res ? 'Saved ' + int(res.total) + ' orders' : 'Statement saved') + '</h2>' +
        (res ? '<p>' + int(res.added) + ' new and ' + int(res.updated) + ' updated in ' + esc(savedShop) + '. Your notes and PDFs are kept.</p>' : '') + (sMsg ? '<p>' + esc(sMsg) + '</p>' : '') +
        '<div class="row" style="justify-content:center"><button class="btn" id="upMore">Upload another file</button><button class="btn" id="upPdfs">' + ico('file') + 'Add reading PDFs</button><a class="btn btn-primary" href="#/dashboard">See dashboard</a></div></div></div>';
      hydrateIcons(box);
      box.querySelector('#upMore').addEventListener('click', () => uploadOrders(box));
      box.querySelector('#upPdfs').addEventListener('click', () => { S.up.tab = 'pdfs'; viewUpload(document.getElementById('view')); });
    });
  }

  async function saveImport(shop, incoming) {
    const byKey = new Map(S.orders.map(o => [o.key, o]));
    const out = []; let added = 0, updated = 0;
    const now = Date.now();
    incoming.forEach(n => {
      const key = DB.orderKey(shop, n.orderId);
      const old = byKey.get(key);
      const clean = Object.assign({}, n); delete clean._src; delete clean.rev;
      if (old) {
        const m = Object.assign({}, old);
        ['date', 'buyerName', 'buyerUser', 'city', 'state', 'country', 'currency', 'status', 'sku', 'itemCount'].forEach(k => { if (clean[k]) m[k] = clean[k]; });
        if (clean.phone && !old.phone) m.phone = clean.phone;
        if (clean.items && clean.items.length) m.items = clean.items;
        if (clean.moneySrc === 'orders' || old.moneySrc !== 'orders') MONEY_FIELDS.forEach(k => { m[k] = clean[k]; });
        if (clean.fxRate && (m.currency !== old.currency || m.date !== old.date || !old.fxRate)) { m.fxRate = clean.fxRate; m.fxSource = clean.fxSource; }
        else if (m.currency !== old.currency || m.date !== old.date) { delete m.fxRate; delete m.fxSource; }
        delete m.rev; delete m._totalSrc; delete m._renew;
        m.updatedAt = now; out.push(m); updated++;
      } else {
        clean.key = key; clean.shop = shop; clean.note = ''; clean.pdfCount = 0; clean.importedAt = now;
        out.push(clean); added++;
      }
    });
    const pend = Object.assign({}, S.stmtPending || {}); let pendUsed = false;
    out.forEach(m => {
      const pl = pend[m.orderId]; if (!pl) return;
      const have = new Set(((m.stmt && m.stmt.lines) || []).map(l => l.k));
      m.stmt = { fx: m.stmt && m.stmt.fx, lines: ((m.stmt && m.stmt.lines) || []).concat(pl.filter(l => !have.has(l.k))) };
      delete pend[m.orderId]; pendUsed = true;
    });
    if (pendUsed) await DB.setMeta('stmtPending', pend);
    await DB.putOrders(out);
    await DB.flush();
    await load();
    return { added, updated, total: out.length };
  }

  // ---------- monthly statements ----------
  function knownStmtKeys() {
    const k = new Set();
    S.orders.forEach(o => ((o.stmt && o.stmt.lines) || []).forEach(l => k.add(l.k)));
    Object.values(S.stmtPending || {}).forEach(ls => ls.forEach(l => k.add(l.k)));
    Object.values(S.statements || {}).forEach(r => (r.otherKeys || []).forEach(x => k.add(x)));
    return k;
  }
  function previewStatements(shop, stmts, incoming) {
    const known = knownStmtKeys();
    const ids = new Set(S.orders.map(o => o.orderId).concat((incoming || []).map(o => o.orderId)));
    return stmts.map(st => {
      let newCount = 0, dupCount = 0;
      st.lines.forEach(l => { if (known.has(l.k)) dupCount++; else { known.add(l.k); newCount++; } });
      const matched = st.orderIds.filter(id => ids.has(id)).length;
      return { period: st.period, currency: st.currency, total: st.lines.length, newCount, dupCount, matched, unmatched: st.orderIds.length - matched, already: !!(S.statements || {})[shop + '|' + (st.period || 'unknown')] };
    });
  }
  async function applyStatements(shop, stmts) {
    const known = knownStmtKeys();
    const pend = JSON.parse(JSON.stringify(S.stmtPending || {}));
    const recs = JSON.parse(JSON.stringify(S.statements || {}));
    const byId = new Map(); S.orders.forEach(o => { if (!byId.has(o.orderId) || o.shop === shop) byId.set(o.orderId, o); });
    const changed = new Map(); let added = 0, dup = 0; const waitIds = new Set();
    stmts.forEach(st => {
      const id = shop + '|' + (st.period || 'unknown');
      const rec = recs[id] = Object.assign({ id, shop, period: st.period, currency: st.currency, files: [], lines: 0, orders: [], otherKeys: [], otherNet: 0 }, recs[id]);
      if (rec.files.indexOf(st.file) < 0) rec.files.push(st.file);
      rec.importedAt = Date.now();
      st.lines.forEach(l => {
        if (known.has(l.k)) { dup++; return; }
        known.add(l.k); added++; rec.lines++;
        const line = { k: l.k, date: l.date, type: l.type, title: l.title, currency: l.currency, amount: l.amount, fees: l.fees, net: l.net, cat: l.cat };
        if (!l.orderId) { rec.otherKeys.push(l.k); rec.otherNet = Math.round((rec.otherNet + l.net) * 100) / 100; return; }
        if (rec.orders.indexOf(l.orderId) < 0) rec.orders.push(l.orderId);
        const o = byId.get(l.orderId);
        if (!o) { (pend[l.orderId] = pend[l.orderId] || []).push(line); waitIds.add(l.orderId); return; }
        let c = changed.get(o.key);
        if (!c) { c = stripRev(o); c.stmt = { fx: o.stmt && o.stmt.fx, lines: ((o.stmt && o.stmt.lines) || []).slice() }; changed.set(o.key, c); }
        c.stmt.lines.push(line);
      });
    });
    const list = [...changed.values()];
    try { await Revenue.ensureFx(list); } catch (e) { console.warn(e); }
    if (list.length) await DB.putOrders(list);
    await DB.setMeta('statements', recs);
    await DB.setMeta('stmtPending', pend);
    await DB.flush();
    await load();
    const actual = list.filter(c => Revenue.hasActual(c)).length;
    return { added, dup, actual, waiting: waitIds.size };
  }
  function statementsTable() {
    const recs = Object.values(S.statements || {}).sort((a, b) => (b.period || '').localeCompare(a.period || '') || a.shop.localeCompare(b.shop));
    if (!recs.length) return '<div class="muted small">No monthly statement uploaded yet.</div>';
    return '<div class="table-wrap"><table class="table"><thead><tr><th>Month</th><th>Shop</th><th class="num">Lines</th><th class="num">Orders</th><th>Uploaded</th></tr></thead><tbody>' +
      recs.map(r => '<tr><td class="cell-strong">' + esc(r.period ? monthLabel(r.period) : 'Unknown') + '</td><td><span class="row" style="gap:6px">' + shopDot(r.shop) + esc(r.shop) + '</span></td><td class="num">' + int(r.lines) + '</td><td class="num">' + int((r.orders || []).length) + '</td><td class="muted">' + (r.importedAt ? date(new Date(r.importedAt).toISOString().slice(0, 10)) : '-') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  // ---------- PDF bulk upload ----------
  function orderLabel(o) { return '#' + o.orderId + ' · ' + (o.buyerName || o.buyerUser || '-') + ' · ' + o.shop + ' · ' + date(o.date); }

  function matchPdf(filename) {
    const base = filename.replace(/\.pdf$/i, '');
    const nums = base.match(/\d{6,}/g) || [];
    for (const n of nums) { const o = S.orders.find(x => String(x.orderId) === n); if (o) return { order: o, how: 'order number' }; }
    const nb = P.norm(base);
    const words = base.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3);
    let cands = S.orders.filter(o => { const n = P.norm(o.buyerName); return n.length >= 4 && nb.indexOf(n) >= 0; });
    if (!cands.length) cands = S.orders.filter(o => { const t = (o.buyerName || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3); return t.length >= 2 && t.every(w => words.indexOf(w) >= 0); });
    if (!cands.length) return null;
    const names = new Set(cands.map(o => P.norm(o.buyerName)));
    if (names.size > 1) return null;
    cands.sort((a, b) => ((a.pdfCount ? 1 : 0) - (b.pdfCount ? 1 : 0)) || (b.date || '').localeCompare(a.date || ''));
    return { order: cands[0], how: 'client name' + (cands.length > 1 ? ' (latest order without PDF)' : '') };
  }

  function uploadPdfs(box) {
    const u = S.up;
    if (!S.orders.length) {
      box.innerHTML = '<div class="card"><div class="empty"><div class="e-icon">' + ico('sheet') + '</div><h2>Upload orders first</h2><p>PDFs are matched to orders. First upload the Etsy orders file.</p><button class="btn btn-primary" id="goOrders">Upload Etsy file</button></div></div>';
      hydrateIcons(box); box.querySelector('#goOrders').addEventListener('click', () => { u.tab = 'orders'; viewUpload(document.getElementById('view')); });
      return;
    }
    box.innerHTML = '<div class="card card-pad"><label class="label">Drop the reading PDFs you sent to clients</label>' +
      '<div class="dropzone" id="pdfBulk"><div class="dz-icon">' + ico('file') + '</div><div class="dz-title">Drop PDF files here</div><div class="dz-sub">Many files at once is fine. Tip: put the order number or client name in the file name - it matches by itself.</div><input type="file" accept="application/pdf,.pdf" multiple hidden></div>' +
      '<div id="pdfMatches"></div></div><datalist id="orderOptions">' + S.orders.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(o => '<option value="' + esc(orderLabel(o)) + '">').join('') + '</datalist>';
    const dz = box.querySelector('#pdfBulk');
    bindDrop(dz, dz.querySelector('input'), files => {
      [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf').forEach(f => {
        const m = matchPdf(f.name);
        u.pdfs.push({ file: f, order: m ? m.order : null, how: m ? m.how : '' });
      });
      drawMatches(box);
    });
    drawMatches(box); hydrateIcons(box);
  }

  function drawMatches(box) {
    const u = S.up; const el = box.querySelector('#pdfMatches');
    if (!u.pdfs.length) { el.innerHTML = ''; return; }
    const ok = u.pdfs.filter(p => p.order).length;
    el.innerHTML = '<div class="row between mt-lg"><div class="label" style="margin:0">' + ok + ' of ' + u.pdfs.length + ' PDFs matched</div><button class="btn btn-sm" id="pdfClear">Clear list</button></div>' +
      u.pdfs.map((p, i) => '<div class="file-row"><div class="file-ico">PDF</div><div class="file-main"><div class="file-name">' + esc(p.file.name) + '</div><div class="file-sub">' +
        (p.order ? '<span style="color:var(--green)">Matched by ' + esc(p.how) + '</span>' : '<span style="color:var(--amber)">Not matched - choose the order</span>') + '</div></div>' +
        '<input class="input" list="orderOptions" data-i="' + i + '" placeholder="Type client name or order #" value="' + esc(p.order ? orderLabel(p.order) : '') + '">' +
        '<button class="icon-btn" data-rm="' + i + '" title="Remove">' + ico('x') + '</button></div>').join('') +
      '<div class="row mt-lg" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" id="pdfSave"' + (ok ? '' : ' disabled') + '>' + ico('check') + 'Save ' + ok + ' PDF' + (ok === 1 ? '' : 's') + '</button></div>';
    el.querySelectorAll('input[data-i]').forEach(inp => inp.addEventListener('change', () => {
      const p = u.pdfs[+inp.dataset.i]; const o = S.orders.find(x => orderLabel(x) === inp.value);
      p.order = o || null; p.how = o ? 'your choice' : ''; drawMatches(box);
    }));
    el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { u.pdfs.splice(+b.dataset.rm, 1); drawMatches(box); }));
    el.querySelector('#pdfClear').addEventListener('click', () => { u.pdfs = []; drawMatches(box); });
    el.querySelector('#pdfSave').addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = 'Saving...';
      const todo = u.pdfs.filter(p => p.order);
      let done = 0;
      try {
        for (const p of todo) { e.target.textContent = 'Uploading ' + (done + 1) + ' of ' + todo.length + '...'; await attachPdf(p.order.key, p.file); p.saved = true; done++; }
        await DB.flush();
      } catch (err) { toast(err.message, 'err'); }
      u.pdfs = u.pdfs.filter(p => !p.saved);
      if (done) toast(done + ' PDF' + (done === 1 ? '' : 's') + ' saved to GitHub');
      drawMatches(box);
    });
    hydrateIcons(el);
  }

  // ---------- settings / backup ----------
  async function viewSettings(v) {
    const c = DB.cfg();
    const pdfCount = S.orders.reduce((s, o) => s + (o.pdfCount || 0), 0);
    const repoUrl = 'https://github.com/' + c.repo;
    v.innerHTML =
      '<div class="grid half">' +
        '<div class="card"><div class="card-head"><div><h3>Where your data is saved</h3><div class="sub">One private GitHub repo. Every computer sees the same data.</div></div></div><div class="card-body">' +
          '<div class="kv"><div class="k">Data repo</div><div><a href="' + esc(repoUrl) + '" target="_blank" rel="noopener" style="text-decoration:underline">' + esc(c.repo) + '</a> <span class="badge badge-green">Private</span></div>' +
          '<div class="k">Orders</div><div>' + int(S.orders.length) + '</div><div class="k">PDFs</div><div>' + int(pdfCount) + '</div>' +
          '<div class="k">Status</div><div>' + esc((SYNC[DB.status()] || SYNC.idle)[1]) + '</div></div>' +
          '<div class="row mt-lg wrap"><button class="btn" id="syncNow">' + ico('repeat') + 'Get latest data</button><button class="btn btn-danger" id="disc">Disconnect this computer</button></div>' +
          '<div class="help mt small">Disconnect removes the token from this computer only. Your data stays safe in GitHub.</div>' +
        '</div></div>' +
        '<div class="card"><div class="card-head"><div><h3>Extra backup</h3><div class="sub">Optional. Download all orders and notes as one file.</div></div></div><div class="card-body">' +
          '<div class="row wrap"><button class="btn btn-primary" id="bkDown">' + ico('download') + 'Download backup</button><button class="btn" id="bkUp">' + ico('upload') + 'Restore backup</button><input type="file" id="bkFile" accept=".json,application/json" hidden></div>' +
          '<div class="help mt small">The backup file has orders, notes and the PDF list. The PDF files themselves stay in the GitHub repo (pdfs folder). Last backup: ' + (S.lastBackup ? date(new Date(S.lastBackup).toISOString().slice(0, 10)) : 'never') + '</div>' +
        '</div></div>' +
      '</div>' +
      '<div class="card mt"><div class="card-head"><div><h3>Revenue rules (Etsy fees)</h3><div class="sub">Used for orders without a monthly statement ("Estimated"). Net revenue = (items - discount + postage) in ₹ - transaction fee - payment processing - regulatory fee - listing fee (auto-renew). Tax paid by buyer is not counted. Orders with a statement use Etsy\'s exact numbers.</div></div></div><div class="card-body">' +
        '<div class="grid three">' +
          feeInput('transactionPct', 'Transaction fee %', 'Of order total without tax, incl. postage') +
          feeInput('domesticPct', 'Processing % - India buyers', '') + feeInput('domesticFixed', 'Processing fixed ₹ - India buyers', '') +
          feeInput('internationalPct', 'Processing % - other countries', '') + feeInput('internationalFixed', 'Processing fixed ₹ - other countries', '') +
          feeInput('listingFeeUSD', 'Listing fee (auto-renew) $ - USD orders', 'Charged on every sale. Changed to ₹ at the order-date rate') +
          feeInput('listingFeeINR', 'Listing fee (auto-renew) ₹ - INR orders', 'Same fee for ₹ shops (and other currencies)') +
          feeInput('regulatoryPct', 'Regulatory operating fee %', 'Of order total without tax. Etsy adds it on some orders (e.g. $0.01). 0 = not counted') +
          '<div><label class="label">Your country</label><input class="input" data-fee="homeCountry" style="width:100%" value="' + esc(S.fees.homeCountry) + '"><div class="help small" style="margin-top:4px">Buyers from here are "domestic"</div></div>' +
        '</div>' +
        '<div class="row mt-lg wrap"><button class="btn btn-primary" id="feeSave">Save rules</button><button class="btn" id="feeReset">Use Etsy default</button><span class="help small">Money in other currencies is changed to ₹ with the ECB exchange rate of the order date.</span></div>' +
      '</div></div>' +
      '<div class="card mt"><div class="card-head"><div><h3>Monthly statements uploaded</h3><div class="sub">One per shop per month. Upload them on the Upload page.</div></div></div><div class="card-body">' + statementsTable() + '</div></div>' +
      '<div class="grid half mt">' +
        '<div class="card"><div class="card-head"><h3>Shops</h3></div><div class="card-body"><ul class="rank-list">' +
          S.shops.map(s => '<li><div class="rank-main row" style="gap:8px">' + shopDot(s) + esc(s) + '</div><div class="rank-sub">' + int(S.orders.filter(o => o.shop === s).length) + ' orders</div></li>').join('') +
          '</ul><div class="row mt"><input class="input" id="newShop" placeholder="New shop name" style="flex:1"><button class="btn" id="addShop">' + ico('plus') + 'Add shop</button></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>Delete all orders</h3></div><div class="card-body"><p class="muted" style="margin-top:0">Removes every order and note from the data file (for all computers). Old versions stay in the repo history.</p><button class="btn btn-danger" id="wipe">' + ico('trash') + 'Delete all orders</button></div></div>' +
      '</div>';
    hydrateIcons(v);
    const saveFees = async (vals) => {
      await DB.setMeta('fees', vals); try { await DB.flush(); } catch (e) { return toast(e.message, 'err'); }
      await load(); toast('Revenue rules saved'); viewSettings(v);
    };
    v.querySelector('#feeSave').addEventListener('click', () => {
      const vals = {};
      v.querySelectorAll('[data-fee]').forEach(i => { const k = i.dataset.fee; vals[k] = k === 'homeCountry' ? i.value.trim() || 'India' : (parseFloat(i.value) || 0); });
      saveFees(Object.assign({}, Revenue.DEFAULT_FEES, vals));
    });
    v.querySelector('#feeReset').addEventListener('click', () => saveFees(Object.assign({}, Revenue.DEFAULT_FEES)));
    v.querySelector('#bkDown').addEventListener('click', downloadBackup);
    v.querySelector('#bkUp').addEventListener('click', () => v.querySelector('#bkFile').click());
    v.querySelector('#bkFile').addEventListener('change', e => { if (e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = ''; });
    v.querySelector('#syncNow').addEventListener('click', async () => { const ch = await DB.refresh(); if (ch) await load(); toast(ch ? 'Updated with latest data' : 'Already up to date'); viewSettings(v); });
    v.querySelector('#disc').addEventListener('click', async () => {
      if (DB.pending()) { try { await DB.flush(); } catch (e) { return toast('Save first - ' + e.message, 'err'); } }
      if (!await confirmBox({ title: 'Disconnect this computer?', text: 'The token is removed from this browser. Your data stays in GitHub. You can connect again any time.', ok: 'Disconnect', danger: true })) return;
      DB.disconnect(); location.hash = '#/dashboard'; location.reload();
    });
    v.querySelector('#addShop').addEventListener('click', async () => {
      const n = v.querySelector('#newShop').value.trim(); if (!n) return;
      if (S.shops.indexOf(n) >= 0) return toast('Shop already exists', 'err');
      S.shops.push(n); await DB.setMeta('shops', S.shops); toast('Shop added'); viewSettings(v);
    });
    v.querySelector('#wipe').addEventListener('click', async () => {
      if (!await confirmBox({ title: 'Delete all orders?', text: 'All orders and notes will be removed for every computer.', ok: 'Delete', danger: true, typeWord: 'DELETE' })) return;
      try { await DB.clearAll(); await DB.setMeta('statements', {}); await DB.setMeta('stmtPending', {}); await DB.flush(); } catch (e) { return toast(e.message, 'err'); }
      await load(); toast('All orders deleted'); viewSettings(v);
    });
  }

  function feeInput(k, label, help) {
    return '<div><label class="label">' + esc(label) + '</label><input class="input" type="number" step="0.01" min="0" data-fee="' + k + '" style="width:100%" value="' + esc(S.fees[k]) + '">' + (help ? '<div class="help small" style="margin-top:4px">' + esc(help) + '</div>' : '') + '</div>';
  }

  function b64ToBlob(b64, type) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type }); }

  async function downloadBackup() {
    const data = { app: 'order-book', version: 2, createdAt: new Date().toISOString(), repo: DB.cfg().repo, shops: S.shops, orders: await DB.allOrders(), pdfList: await DB.allPdfs() };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'order-book-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    S.lastBackup = Date.now(); await DB.setMeta('lastBackup', S.lastBackup);
    toast('Backup downloaded'); if (/settings/.test(location.hash)) viewSettings(document.getElementById('view'));
  }

  async function restoreBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return toast('This is not a backup file', 'err'); }
    if (!data || data.app !== 'order-book' || !Array.isArray(data.orders)) return toast('This is not a backup file', 'err');
    const withPdf = (data.pdfs || []).filter(p => p.data);
    if (!await confirmBox({ title: 'Restore backup?', text: data.orders.length + ' orders' + (withPdf.length ? ' and ' + withPdf.length + ' PDFs' : '') + ' will be added. Same orders are replaced by the backup version.', ok: 'Restore' })) return;
    try {
      const orders = data.orders.map(o => Object.assign({}, o, { pdfCount: 0 }));
      const existing = new Map(S.orders.map(o => [o.key, o]));
      orders.forEach(o => { const ex = existing.get(o.key); o.pdfCount = ex ? ex.pdfCount || 0 : 0; });
      (data.pdfList || []).forEach(p => { const o = orders.find(x => x.key === p.orderKey); if (o && !existing.has(o.key)) o.pdfCount++; });
      await DB.putOrders(orders);
      for (const p of withPdf) {
        await DB.addPdf({ id: p.id, orderKey: p.orderKey, name: p.name, size: p.size, addedAt: p.addedAt, blob: b64ToBlob(p.data, 'application/pdf') });
        const o = orders.find(x => x.key === p.orderKey); if (o) { o.pdfCount = (o.pdfCount || 0) + 1; await DB.putOrder(o); }
      }
      const shops = S.shops.slice(); (data.shops || []).forEach(s => { if (shops.indexOf(s) < 0) shops.push(s); }); await DB.setMeta('shops', shops);
      await DB.flush();
    } catch (e) { return toast(e.message, 'err'); }
    await load(); toast('Backup restored'); viewSettings(document.getElementById('view'));
  }

  // ---------- connect GitHub (first time on each computer) ----------
  function viewSetup(v, prefill) {
    document.getElementById('pageTitle').textContent = 'Connect GitHub';
    document.querySelectorAll('#nav a').forEach(a => a.classList.remove('active'));
    v.innerHTML = '<div class="card" style="max-width:640px"><div class="card-pad">' +
      '<div class="e-icon" style="width:48px;height:48px;border-radius:14px;background:#f5f5f5;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px">' + ico('shield') + '</div>' +
      '<h2 style="font-size:20px">Connect your GitHub</h2>' +
      '<p class="muted" style="margin:6px 0 20px">Do this one time on each computer. Your orders are saved in a <b>private</b> GitHub repo, so every computer shows the same data.</p>' +
      '<label class="label">GitHub token</label><input class="input" id="suToken" type="password" autocomplete="off" placeholder="ghp_..." style="width:100%">' +
      '<label class="label mt">Data repo (private)</label><input class="input" id="suRepo" placeholder="your-name/orderbook-data" style="width:100%" value="' + esc(prefill || '') + '">' +
      '<div class="help small" style="margin-top:6px">Leave as it is. If it does not exist, the app makes it for you (private).</div>' +
      '<div id="suMsg" class="mt"></div>' +
      '<div class="row mt-lg" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" id="suGo">Connect</button></div>' +
      '<div class="help mt-lg"><b>How to make a token</b><ol><li>github.com → your photo → <b>Settings</b> → <b>Developer settings</b></li><li><b>Personal access tokens</b> → <b>Tokens (classic)</b> → <b>Generate new token (classic)</b></li><li>Tick <b>repo</b>. Expiration: <b>No expiration</b> (or a long time)</li><li>Click <b>Generate token</b>, copy the code (starts with ghp_), paste above</li></ol><div class="small mt">The token is saved only in this browser. Never share it.</div></div>' +
      '</div></div>';
    hydrateIcons(v);
    const msg = (html, kind) => { v.querySelector('#suMsg').innerHTML = html ? '<div class="notice ' + (kind || '') + '">' + ico(kind === 'ok' ? 'check' : 'alert') + '<div style="flex:1">' + html + '</div></div>' : ''; hydrateIcons(v.querySelector('#suMsg')); };
    const go = v.querySelector('#suGo');
    go.addEventListener('click', async () => {
      const token = v.querySelector('#suToken').value.trim();
      if (!token) return msg('Please paste your GitHub token.');
      go.disabled = true; go.textContent = 'Checking...'; msg('');
      try {
        const t = await DB.checkToken(token);
        if (!t.ok) return msg(esc(t.error));
        let repo = v.querySelector('#suRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
        if (!repo) repo = t.login + '/orderbook-data';
        if (repo.indexOf('/') < 0) repo = t.login + '/' + repo;
        v.querySelector('#suRepo').value = repo;
        const r = await DB.checkRepo(token, repo);
        if (r.error) return msg(esc(r.error));
        if (r.exists && !r.private) return msg('<b>' + esc(repo) + ' is public.</b> Anyone could see client names. Please use a private repo: change the name above (for example ' + esc(t.login) + '/orderbook-data), or make this repo private on GitHub.');
        if (r.exists && !r.canWrite) return msg('This token cannot save to ' + esc(repo) + '. Make a token with the <b>repo</b> box ticked.');
        if (!r.exists) {
          if (repo.split('/')[0].toLowerCase() !== t.login.toLowerCase()) return msg('Repo ' + esc(repo) + ' not found.');
          go.textContent = 'Creating private repo...';
          const c = await DB.createRepo(token, repo.split('/')[1]);
          if (!c.ok) return msg('Could not create the repo: ' + esc(c.error) + '.<br>Make it yourself on github.com (New repository → name <b>' + esc(repo.split('/')[1]) + '</b> → <b>Private</b> → Create), then click Connect again.');
          await new Promise(res => setTimeout(res, 1500));
        }
        DB.connect(token, repo);
        go.textContent = 'Loading your data...';
        await start();
        toast('Connected. Data is saved in ' + repo);
      } catch (e) { msg('Could not reach GitHub: ' + esc(e.message)); }
      finally { go.disabled = false; if (go.isConnected) go.textContent = 'Connect'; }
    });
  }

  // ---------- boot ----------
  async function start() {
    const v = document.getElementById('view');
    v.innerHTML = '<div class="card card-pad muted">Loading your data from GitHub...</div>';
    try { await DB.init(); }
    catch (e) {
      v.innerHTML = '<div class="card card-pad" style="max-width:640px"><div class="notice">' + ico('alert') + '<div>Could not load data from GitHub: ' + esc(e.message) + '</div></div><div class="row mt-lg"><button class="btn btn-primary" id="retry">Try again</button><button class="btn" id="reconn">Connect again</button></div></div>';
      hydrateIcons(v);
      v.querySelector('#retry').addEventListener('click', start);
      v.querySelector('#reconn').addEventListener('click', () => { const r = DB.cfg().repo; DB.disconnect(); viewSetup(v, r); });
      return;
    }
    await load();
    S.lastBackup = await DB.getMeta('lastBackup', null);
    started = true;
    route();
  }
  let started = false;

  async function boot() {
    hydrateIcons(document);
    document.getElementById('drawerBackdrop').addEventListener('click', drawer.close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') drawer.close(); });
    document.getElementById('menuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    DB.onStatus(() => renderSync());
    window.addEventListener('beforeunload', e => { if (DB.configured() && DB.pending()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('focus', async () => {
      if (!started || Date.now() - DB.lastLoad() < 30000 || document.getElementById('drawer').classList.contains('show')) return;
      if (await DB.refresh()) { await load(); softRefresh(); }
    });
    const gs = document.getElementById('globalSearch');
    let t;
    gs.addEventListener('input', () => {
      if (!started) return;
      clearTimeout(t);
      t = setTimeout(() => {
        S.list.q = gs.value; S.list.page = 1;
        if (!/orders/.test(location.hash)) location.hash = '#/orders'; else viewOrders(document.getElementById('view'));
        setTimeout(() => { const i = document.getElementById('ordSearch'); if (i) i.value = gs.value; }, 0);
      }, 250);
    });
    window.addEventListener('hashchange', () => { if (started) route(); });
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#/"]');
      if (started && a && a.getAttribute('href') === location.hash) { e.preventDefault(); if (/upload/.test(location.hash)) { S.up.parsed = null; } route(); }
    });
    renderSidebarFoot();
    if (!DB.configured()) { viewSetup(document.getElementById('view'), ''); return; }
    await start();
  }
  window.OrderBook = { S, load, saveImport, matchPdf };
  boot().catch(e => { console.error(e); document.getElementById('view').innerHTML = '<div class="notice">Something went wrong: ' + esc(e.message) + '</div>'; });
})();
