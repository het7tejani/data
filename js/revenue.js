/* Net revenue in INR: (items - discount + postage) converted to INR, minus Etsy fees. Tax paid by buyer is not revenue. */
(function () {
  'use strict';
  const DEFAULT_FEES = {
    homeCountry: 'India',
    transactionPct: 6.5,          // of order total excluding tax, incl. postage & gift wrap
    domesticPct: 3.0, domesticFixed: 10,        // payment processing, INR
    internationalPct: 5.0, internationalFixed: 25,
    processingOnTax: true         // Etsy charges processing on the total the buyer paid (incl. tax)
  };
  const r2 = n => Math.round(n * 100) / 100;
  const isDomestic = (o, fees) => !!o.country && o.country.trim().toLowerCase() === String(fees.homeCountry || 'India').toLowerCase();

  function compute(o, fees) {
    fees = Object.assign({}, DEFAULT_FEES, fees || {});
    const curr = (o.currency || 'INR').toUpperCase();
    const rate = curr === 'INR' ? 1 : o.fxRate;
    const gross = o.gross != null ? o.gross : (o.total || 0);
    const tax = o.tax || 0;
    const dom = isDomestic(o, fees);
    if (!rate) return { pending: true, domestic: dom, currency: curr, grossCur: gross };
    const grossINR = gross * rate, taxINR = tax * rate;
    const txFee = grossINR * fees.transactionPct / 100;
    const base = grossINR + (fees.processingOnTax ? taxINR : 0);
    const procFee = base > 0 ? base * (dom ? fees.domesticPct : fees.internationalPct) / 100 + (dom ? fees.domesticFixed : fees.internationalFixed) : 0;
    return { pending: false, domestic: dom, currency: curr, rate, grossCur: gross,
      discountINR: r2((o.discount || 0) * rate), grossINR: r2(grossINR), taxINR: r2(taxINR),
      txFee: r2(txFee), procFee: r2(procFee), fees: r2(txFee + procFee), net: r2(grossINR - txFee - procFee) };
  }

  // ---- exchange rates (Frankfurter / ECB, free, no key) ----
  const FX_API = 'https://api.frankfurter.dev/v1/';
  const iso = d => d.toISOString().slice(0, 10);
  function pickRate(series, date) {
    const days = Object.keys(series).sort();
    if (!days.length) return null;
    let best = null;
    for (const d of days) { if (d <= date) best = d; else break; }
    return series[best || days[0]];
  }
  // Fills o.fxRate / o.fxDate on orders that need it. Returns number of orders updated. Throws on network error.
  async function ensureFx(orders) {
    const need = orders.filter(o => o.currency && o.currency.toUpperCase() !== 'INR' && !o.fxRate && o.date);
    if (!need.length) return 0;
    const byCur = {};
    need.forEach(o => { const c = o.currency.toUpperCase(); (byCur[c] = byCur[c] || []).push(o); });
    let n = 0;
    for (const c of Object.keys(byCur)) {
      const list = byCur[c];
      const dates = list.map(o => o.date).sort();
      const start = new Date(dates[0] + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 7);
      const today = iso(new Date());
      const end = dates[dates.length - 1] > today ? today : dates[dates.length - 1];
      const r = await fetch(FX_API + iso(start) + '..' + end + '?base=' + encodeURIComponent(c) + '&symbols=INR');
      if (!r.ok) throw new Error('Exchange rate not found for ' + c);
      const j = await r.json();
      const series = {}; Object.keys(j.rates || {}).forEach(d => { if (j.rates[d].INR) series[d] = j.rates[d].INR; });
      let latest = null;
      if (list.some(o => o.date > (Object.keys(series).sort().pop() || ''))) {
        const l = await fetch(FX_API + 'latest?base=' + encodeURIComponent(c) + '&symbols=INR');
        if (l.ok) { const lj = await l.json(); if (lj.rates && lj.rates.INR) { latest = lj.rates.INR; series[lj.date] = latest; } }
      }
      list.forEach(o => { const v = pickRate(series, o.date); if (v) { o.fxRate = v; o.fxSource = 'ECB rate for ' + o.date; n++; } });
    }
    return n;
  }

  const api = { DEFAULT_FEES, compute, ensureFx, isDomestic, pickRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.Revenue = api;
})();
