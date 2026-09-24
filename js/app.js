/* Order Book - Etsy orders manager. All data stays in this browser (IndexedDB). */
(function () {
  'use strict';
  const { ico, esc, money, int, date, monthLabel, bytes, toast, confirmBox, drawer, barChart, shortNum, hydrateIcons } = UI;
  const P = EtsyParser;

  const DEFAULT_SHOPS = ['PsychicEra', 'PsychicSutra', 'DaisyMediumStudio', 'RosyMediumStudio', 'ladygeorgia'];
  const COLORS = ['#6d5dfc', '#e8590c', '#f59f00', '#e64980', '#12b886', '#228be6', '#7950f2', '#fa5252'];

  const S = {
    orders: [], shops: DEFAULT_SHOPS.slice(), currency: 'USD',
    dash: { shop: 'all', period: 'all' },
    list: { shop: 'all', month: 'all', pdf: 'all', q: '', page: 1 },
    cl: { q: '', sort: 'spent' },
    up: { tab: 'orders', shop: null, parsed: null, files: [], pdfs: [] }
  };

  const shopColor = shop => { const i = S.shops.indexOf(shop); return COLORS[(i < 0 ? S.shops.length : i) % COLORS.length]; };
  const shopDot = shop => '<span class="dot" style="background:' + shopColor(shop) + '"></span>';
  const clientKey = o => P.norm(o.buyerName) || P.norm(o.buyerUser) || ('order' + o.orderId);
  const place = o => [o.city, o.country].filter(Boolean).join(', ');
  const firstTitle = o => o.items && o.items.length ? o.items[0].title : (o.sku ? 'SKU ' + o.sku : '(listing name not in file)');
  const isPrimary = o => !o.currency || o.currency === S.currency;

  // ---------- data ----------
  async function load() {
    if (!DB.configured()) return;
    S.orders = await DB.allOrders();
    S.shops = await DB.getMeta('shops', DEFAULT_SHOPS.slice());
    const counts = {};
    S.orders.forEach(o => { if (o.currency) counts[o.currency] = (counts[o.currency] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    S.currency = top || 'USD';
    S.orders.forEach(o => { if (o.shop && S.shops.indexOf(o.shop) < 0) S.shops.push(o.shop); });
    renderSidebarFoot();
  }
  const cur = n => money(n, S.currency);

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
    const revenue = money_.reduce((s, o) => s + (o.total || 0), 0);
    const clients = new Map();
    list.forEach(o => { const k = clientKey(o); const c = clients.get(k) || { name: o.buyerName || o.buyerUser, n: 0, spent: 0, shops: new Set(), last: '' }; c.n++; if (isPrimary(o)) c.spent += o.total || 0; c.shops.add(o.shop); if ((o.date || '') > c.last) c.last = o.date; clients.set(k, c); });
    const repeat = [...clients.values()].filter(c => c.n > 1);
    const otherCur = list.length - money_.length;

    // monthly
    const byMonth = {};
    money_.forEach(o => { if (!o.date) return; const k = o.date.slice(0, 7); byMonth[k] = byMonth[k] || { v: 0, n: 0 }; byMonth[k].v += o.total || 0; byMonth[k].n++; });
    const months = fillMonths(Object.keys(byMonth).sort(), f.period);
    // shops
    const byShop = {};
    list.forEach(o => { byShop[o.shop] = byShop[o.shop] || { v: 0, n: 0 }; byShop[o.shop].n++; if (isPrimary(o)) byShop[o.shop].v += o.total || 0; });
    const shopRows = Object.keys(byShop).sort((a, b) => byShop[b].v - byShop[a].v);
    const maxShop = Math.max(1, ...shopRows.map(s => byShop[s].v));
    // listings
    const byList = {};
    list.forEach(o => (o.items || []).forEach(it => { const k = it.title; byList[k] = byList[k] || { n: 0, v: 0, shops: new Set() }; byList[k].n += it.qty || 1; if (isPrimary(o)) byList[k].v += it.total || 0; byList[k].shops.add(o.shop); }));
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
        kpi('money', 'Total sales', cur(revenue), otherCur ? otherCur + ' order(s) in other currency not added' : 'Order totals from Etsy') +
        kpi('bag', 'Orders', int(list.length), list.length ? 'Avg ' + cur(money_.length ? revenue / money_.length : 0) + ' per order' : '') +
        kpi('users', 'Clients', int(clients.size), 'Unique buyers') +
        kpi('repeat', 'Repeat clients', int(repeat.length), clients.size ? Math.round(repeat.length / clients.size * 100) + '% came back' : '') +
        kpi('file', 'PDF missing', int(noPdf), noPdf ? '<a href="#/orders" data-nopdf="1" style="text-decoration:underline">See orders</a>' : 'All orders have PDF') +
      '</div>' +
      '<div class="grid two mt">' +
        '<div class="card"><div class="card-head"><div><h3>Sales by month</h3><div class="sub">' + esc(S.currency) + ' · hover a bar for details</div></div></div><div class="card-body"><div class="chart" id="monthChart"></div></div></div>' +
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
      const total = list.filter(isPrimary).reduce((s, o) => s + (o.total || 0), 0);
      document.getElementById('ordCard').innerHTML =
        '<div class="card-head"><h3>' + int(list.length) + ' orders</h3><span class="sub">Total ' + cur(total) + '</span></div>' +
        (rows.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Client</th><th>Listing</th><th>Shop</th><th class="num">Amount</th><th>PDF</th><th>Note</th></tr></thead><tbody>' +
          rows.map(o => '<tr class="clickable" data-key="' + esc(o.key) + '">' +
            '<td class="muted" style="white-space:nowrap">' + date(o.date) + '</td>' +
            '<td><div class="cell-strong">' + esc(o.buyerName || o.buyerUser || '-') + '</div><div class="cell-sub">' + esc(place(o) || '#' + o.orderId) + '</div></td>' +
            '<td><div class="cell-title" title="' + esc(firstTitle(o)) + '">' + esc(firstTitle(o)) + '</div>' + ((o.items || []).length > 1 ? '<div class="cell-sub">+' + (o.items.length - 1) + ' more</div>' : '') + '</td>' +
            '<td><span class="row" style="gap:6px;white-space:nowrap">' + shopDot(o.shop) + esc(o.shop) + '</span></td>' +
            '<td class="num cell-strong">' + money(o.total, o.currency || S.currency) + '</td>' +
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
      const items = o.items && o.items.length ? o.items : [{ title: firstTitle(o), qty: o.itemCount || '', total: o.total }];
      items.forEach(it => rows.push({
        'Shop': o.shop, 'Order #': o.orderId, 'Date': o.date, 'Client': o.buyerName, 'Username': o.buyerUser || '',
        'Listing': it.title, 'Qty': it.qty, 'Item amount': it.total, 'Order total': o.total, 'Currency': o.currency || S.currency,
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
    const d = drawer.open(
      '<div class="drawer-head"><div style="flex:1;min-width:0"><div class="row" style="gap:8px;margin-bottom:4px"><span class="badge">' + shopDot(o.shop) + esc(o.shop) + '</span>' +
        (others ? '<span class="badge badge-violet">' + ico('repeat') + (others + 1) + ' orders from this client</span>' : '') + '</div>' +
        '<h2>' + esc(o.buyerName || o.buyerUser || 'Order') + '</h2><div class="muted small">Order #' + esc(o.orderId) + ' · ' + date(o.date) + '</div></div>' +
        '<button class="icon-btn" data-close>' + ico('x') + '</button></div>' +
      '<div class="drawer-body">' +
        '<div class="kv">' +
          '<div class="k">Amount</div><div class="cell-strong">' + money(o.total, o.currency || S.currency) + '</div>' +
          '<div class="k">Username</div><div>' + esc(o.buyerUser || '-') + '</div>' +
          '<div class="k">From</div><div>' + esc([o.city, o.state, o.country].filter(Boolean).join(', ') || '-') + '</div>' +
          '<div class="k">Phone</div><div><input class="input" id="phoneIn" style="padding:5px 9px;width:100%" placeholder="Not in Etsy file - add if you have it" value="' + esc(o.phone || '') + '"></div>' +
          (o.status ? '<div class="k">Status</div><div>' + esc(o.status) + '</div>' : '') +
        '</div>' +
        '<div class="section-title">Listing</div>' +
        ((o.items || []).length ? o.items.map(it => '<div class="item-row"><div style="min-width:0"><div class="cell-strong">' + esc(it.title) + '</div>' + (it.variations ? '<div class="cell-sub">' + esc(it.variations) + '</div>' : '') + '<div class="cell-sub">Qty ' + it.qty + '</div></div><div class="cell-strong" style="white-space:nowrap">' + money(it.total, o.currency || S.currency) + '</div></div>').join('')
          : '<div class="muted">Listing name not in this file. Upload the "Order Items" file for this shop.</div>') +
        '<div class="section-title">Reading PDF</div>' +
        '<div id="pdfList">' + pdfRows(pdfs) + '</div>' +
        '<div class="dropzone small mt" id="pdfDrop"><div class="dz-title" style="font-size:14px">' + ico('upload') + ' Drop PDF here or click</div><div class="dz-sub">The reading you sent to this client</div><input type="file" accept="application/pdf,.pdf" multiple hidden></div>' +
        '<div class="section-title">Notes</div>' +
        '<textarea class="notes" id="noteIn" placeholder="Write anything about this order or client...">' + esc(o.note || '') + '</textarea>' +
        '<div class="saved-hint" id="savedHint"></div>' +
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
      c.orders.push(o); if (isPrimary(o)) c.spent += o.total || 0; c.shops.add(o.shop);
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
      orders.map(o => '<div class="file-row clickable" style="cursor:pointer" data-key="' + esc(o.key) + '"><div class="file-main"><div class="file-name">' + esc(firstTitle(o)) + '</div><div class="file-sub">' + date(o.date) + ' · ' + esc(o.shop) + ' · #' + esc(o.orderId) + '</div></div><div class="cell-strong">' + money(o.total, o.currency || S.currency) + '</div>' +
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
      '<div class="dropzone" id="ordDrop"><div class="dz-icon">' + ico('sheet') + '</div><div class="dz-title">Drop CSV or Excel file here</div><div class="dz-sub">or click to choose · you can add the "Order Items" and "Orders" files together</div><input type="file" accept=".csv,.xlsx,.xls,text/csv" multiple hidden></div>' +
      '<div class="help mt"><b>How to get the file from Etsy</b><ol><li>Open Etsy <b>Shop Manager</b> → <b>Settings</b> → <b>Options</b></li><li>Open the <b>Download Data</b> tab, go to <b>Orders</b></li><li>CSV Type: choose <b>Order Items</b> (has listing names). Choose the year (leave month empty for full year)</li><li>Click <b>Download CSV</b>. Also download <b>Orders</b> type if you want city and country</li></ol><div class="mt small">Uploading the same file again is safe. Old orders are updated, not doubled.</div></div>' +
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
    return P.rowsToObjects(rows.filter(r => r.some(c => String(c).trim() !== '')));
  }

  async function handleOrderFiles(files, box) {
    const u = S.up;
    const guessed = files.map(f => P.guessShop(f.name, S.shops)).find(Boolean);
    if (!u.shop && guessed) u.shop = guessed;
    if (!u.shop) { toast('First choose the shop', 'err'); return; }
    const results = [];
    for (const f of files) {
      try {
        const { headers, records } = await readSheetFile(f);
        const res = P.normalize(headers, records);
        res.file = f.name; results.push(res);
      } catch (e) { console.error(e); toast('Could not read ' + f.name, 'err'); }
    }
    const good = results.filter(r => r.type !== 'unknown' && r.orders.length);
    if (!good.length) { toast(results[0] && results[0].warnings[0] || 'No orders found in this file', 'err'); return; }
    // merge results of several files (items + orders) by order id; items files last so their items win
    const merged = new Map();
    good.sort((a, b) => (a.type === 'orders' ? 0 : 1) - (b.type === 'orders' ? 0 : 1)).forEach(r => r.orders.forEach(o => {
      o._src = r.type; const prev = merged.get(o.orderId); merged.set(o.orderId, prev ? mergeOrder(prev, o) : o);
    }));
    const incoming = [...merged.values()];
    const existing = new Set(S.orders.map(o => o.key));
    const keys = incoming.map(o => DB.orderKey(u.shop, o.orderId));
    const warnings = [...new Set(good.flatMap(r => r.warnings))];
    if (good.some(r => r.type === 'items' || r.type === 'combined')) {
      for (let i = warnings.length - 1; i >= 0; i--) if (/no listing names/.test(warnings[i])) warnings.splice(i, 1);
    }
    const otherShop = files.map(f => P.guessShop(f.name, S.shops)).find(g => g && g !== u.shop);
    if (otherShop) warnings.unshift('The file name says "' + otherShop + '" but you chose "' + u.shop + '". Please check the shop.');
    u.parsed = {
      files: good.map(r => r.file + ' (' + ({ items: 'Order Items', orders: 'Orders', combined: 'Orders + Items' })[r.type] + ')'),
      orders: incoming, newCount: keys.filter(k => !existing.has(k)).length, updCount: keys.filter(k => existing.has(k)).length, warnings
    };
    reviewImport(box);
  }

  function mergeOrder(a, b) {
    const out = Object.assign({}, a);
    ['date', 'buyerName', 'buyerUser', 'phone', 'city', 'state', 'country', 'currency', 'status', 'sku', 'itemCount'].forEach(k => {
      if (b[k] && (!out[k] || (k === 'date' && b[k] < out[k]))) out[k] = b[k];
    });
    if (b.items && b.items.length) out.items = b.items;
    if (b._src === 'orders' || b._src === 'combined') { out.total = b.total; out._totalSrc = 'orders'; }
    else if (!out._totalSrc || out._totalSrc !== 'orders') { out.total = b.total || out.total; }
    if (b._src === 'orders' || b._src === 'combined') out._totalSrc = 'orders';
    if (a._src === 'orders' || a._src === 'combined') out._totalSrc = 'orders';
    return out;
  }

  function reviewImport(box) {
    const u = S.up, p = u.parsed;
    const dates = p.orders.map(o => o.date).filter(Boolean).sort();
    const total = p.orders.reduce((s, o) => s + (o.total || 0), 0);
    const curr = (p.orders.find(o => o.currency) || {}).currency || S.currency;
    const withPhone = p.orders.filter(o => o.phone).length;
    const sample = p.orders.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
    box.innerHTML = '<div class="card card-pad">' + stepper(3) +
      '<div class="row between wrap"><div><div class="label" style="margin:0">Ready to save to <span class="row" style="display:inline-flex;gap:6px">' + shopDot(u.shop) + esc(u.shop) + '</span></div><div class="muted small">' + p.files.map(esc).join(' · ') + '</div></div></div>' +
      '<div class="summary-row mt-lg">' +
        '<div class="s"><div class="s-n">' + int(p.orders.length) + '</div><div class="s-l">Orders found</div></div>' +
        '<div class="s"><div class="s-n" style="color:var(--green)">' + int(p.newCount) + '</div><div class="s-l">New</div></div>' +
        '<div class="s"><div class="s-n">' + int(p.updCount) + '</div><div class="s-l">Already saved (will update)</div></div>' +
        '<div class="s"><div class="s-n">' + money(total, curr) + '</div><div class="s-l">Total</div></div>' +
        '<div class="s"><div class="s-n" style="font-size:16px;padding-top:5px">' + (dates.length ? date(dates[0]) + ' - ' + date(dates[dates.length - 1]) : '-') + '</div><div class="s-l">Dates</div></div>' +
        '<div class="s"><div class="s-n">' + int(withPhone) + '</div><div class="s-l">With phone</div></div>' +
      '</div>' +
      (p.warnings.length ? '<div class="mt-lg">' + p.warnings.map(w => '<div class="notice" style="margin-top:8px">' + ico('info') + '<div>' + esc(w) + '</div></div>').join('') + '</div>' : '') +
      '<div class="card mt-lg" style="box-shadow:none"><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Client</th><th>Listing</th><th class="num">Amount</th></tr></thead><tbody>' +
        sample.map(o => '<tr><td class="muted" style="white-space:nowrap">' + date(o.date) + '</td><td class="cell-strong">' + esc(o.buyerName || o.buyerUser || '-') + '</td><td><div class="cell-title">' + esc(firstTitle(o)) + '</div></td><td class="num">' + money(o.total, o.currency || curr) + '</td></tr>').join('') +
      '</tbody></table></div>' + (p.orders.length > sample.length ? '<div class="pager">+ ' + int(p.orders.length - sample.length) + ' more orders</div>' : '') + '</div>' +
      '<div class="row mt-lg" style="justify-content:flex-end"><button class="btn" id="impCancel">Cancel</button><button class="btn btn-primary btn-lg" id="impSave">' + ico('check') + 'Save ' + int(p.orders.length) + ' orders</button></div>' +
      '</div>';
    hydrateIcons(box);
    box.querySelector('#impCancel').addEventListener('click', () => { u.parsed = null; uploadOrders(box); });
    box.querySelector('#impSave').addEventListener('click', async e => {
      e.target.disabled = true; e.target.textContent = 'Saving...';
      let res;
      try { res = await saveImport(u.shop, p.orders); } catch (err) { e.target.disabled = false; e.target.textContent = 'Try again'; return toast(err.message, 'err'); }
      u.parsed = null; const savedShop = u.shop; u.shop = null;
      box.innerHTML = '<div class="card"><div class="empty"><div class="e-icon" style="background:var(--green-bg);color:var(--green)">' + ico('check') + '</div><h2>Saved ' + int(res.total) + ' orders</h2>' +
        '<p>' + int(res.added) + ' new and ' + int(res.updated) + ' updated in ' + esc(savedShop) + '. Your notes and PDFs are kept.</p>' +
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
      const clean = Object.assign({}, n); delete clean._src;
      if (old) {
        const m = Object.assign({}, old);
        ['date', 'buyerName', 'buyerUser', 'city', 'state', 'country', 'currency', 'status', 'sku', 'itemCount'].forEach(k => { if (clean[k]) m[k] = clean[k]; });
        if (clean.phone && !old.phone) m.phone = clean.phone;
        if (clean.items && clean.items.length) m.items = clean.items;
        const newIsOrders = n._src === 'orders' || n._src === 'combined' || clean._totalSrc === 'orders';
        if (newIsOrders || old._totalSrc !== 'orders') { m.total = clean.total; m._totalSrc = newIsOrders ? 'orders' : (old._totalSrc || 'items'); }
        m.updatedAt = now; out.push(m); updated++;
      } else {
        clean.key = key; clean.shop = shop; clean.note = ''; clean.pdfCount = 0; clean.importedAt = now;
        clean._totalSrc = (n._src === 'orders' || n._src === 'combined' || clean._totalSrc === 'orders') ? 'orders' : 'items';
        out.push(clean); added++;
      }
    });
    await DB.putOrders(out);
    await DB.flush();
    await load();
    return { added, updated, total: out.length };
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
      '<div class="grid half mt">' +
        '<div class="card"><div class="card-head"><h3>Shops</h3></div><div class="card-body"><ul class="rank-list">' +
          S.shops.map(s => '<li><div class="rank-main row" style="gap:8px">' + shopDot(s) + esc(s) + '</div><div class="rank-sub">' + int(S.orders.filter(o => o.shop === s).length) + ' orders</div></li>').join('') +
          '</ul><div class="row mt"><input class="input" id="newShop" placeholder="New shop name" style="flex:1"><button class="btn" id="addShop">' + ico('plus') + 'Add shop</button></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>Delete all orders</h3></div><div class="card-body"><p class="muted" style="margin-top:0">Removes every order and note from the data file (for all computers). Old versions stay in the repo history.</p><button class="btn btn-danger" id="wipe">' + ico('trash') + 'Delete all orders</button></div></div>' +
      '</div>';
    hydrateIcons(v);
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
      try { await DB.clearAll(); } catch (e) { return toast(e.message, 'err'); }
      await load(); toast('All orders deleted'); viewSettings(v);
    });
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
