/* Net revenue in INR: (items - discount + postage) converted to INR, minus Etsy fees. Tax paid by buyer is not revenue. */
(function () {
  'use strict';
  const DEFAULT_FEES = {
    homeCountry: 'India',
    transactionPct: 6.5,          // of order total excluding tax, incl. postage & gift wrap
    domesticPct: 3.0, domesticFixed: 10,        // payment processing, INR
    internationalPct: 5.0, internationalFixed: 25,
    processingOnTax: true,        // Etsy charges processing on the total the buyer paid (incl. tax)
    regulatoryPct: 0              // Regulatory operating fee, % of order total without tax (0 = not charged)
  };
  const r2 = n => Math.round(n * 100) / 100;
  const isDomestic = (o, fees) => !!o.country && o.country.trim().toLowerCase() === String(fees.homeCountry || 'India').toLowerCase();

  const hasActual = o => !!(o.stmt && o.stmt.lines && o.stmt.lines.some(l => l.cat === 'sale'));
  const orderRate = o => { const c = (o.currency || 'INR').toUpperCase(); return c === 'INR' ? 1 : o.fxRate; };
  function lineRate(o, c) {
    c = (c || o.currency || 'INR').toUpperCase();
    if (c === 'INR') return 1;
    if (c === (o.currency || '').toUpperCase()) return o.fxRate;
    return o.stmt && o.stmt.fx ? o.stmt.fx[c] : null;
  }

  // Exact numbers from Etsy monthly statement lines (Net column of every line for this order).
  function computeActual(o, fees) {
    const dom = isDomestic(o, fees);
    const lines = o.stmt.lines;
    const sum = { sale: 0, refund: 0, tax: 0, tx: 0, proc: 0, reg: 0, other: 0 }, orig = { sale: 0, refund: 0, tax: 0, tx: 0, proc: 0, reg: 0, other: 0 };
    const curs = new Set();
    for (const l of lines) {
      const r = lineRate(o, l.currency);
      if (!r) return { pending: true, actual: true, domestic: dom, currency: (o.currency || 'INR').toUpperCase() };
      sum[l.cat] = (sum[l.cat] || 0) + l.net * r; orig[l.cat] = (orig[l.cat] || 0) + l.net; curs.add((l.currency || o.currency || 'INR').toUpperCase());
    }
    const txFee = -sum.tx, procFee = -sum.proc, regFee = -sum.reg, otherFee = -sum.other;
    const grossINR = sum.sale + sum.tax + sum.refund;
    const feesT = txFee + procFee + regFee + otherFee;
    const O = {}; Object.keys(orig).forEach(k => { O[k] = r2(orig[k]); });
    return { pending: false, actual: true, domestic: dom, currency: (o.currency || 'INR').toUpperCase(), rate: orderRate(o),
      stmtCurrency: curs.size === 1 ? [...curs][0] : '', stmtRate: curs.size === 1 ? lineRate(o, [...curs][0]) : null, orig: O,
      saleINR: r2(sum.sale), taxINR: r2(-sum.tax), refundINR: r2(sum.refund), grossINR: r2(grossINR),
      txFee: r2(txFee), procFee: r2(procFee), regFee: r2(regFee), otherFee: r2(otherFee), fees: r2(feesT), net: r2(grossINR - feesT), lineCount: lines.length };
  }

  function compute(o, fees) {
    fees = Object.assign({}, DEFAULT_FEES, fees || {});
    if (hasActual(o)) return computeActual(o, fees);
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
    const regFee = grossINR * (fees.regulatoryPct || 0) / 100;
    return { pending: false, actual: false, domestic: dom, currency: curr, rate, grossCur: gross,
      discountINR: r2((o.discount || 0) * rate), grossINR: r2(grossINR), taxINR: r2(taxINR),
      txFee: r2(txFee), procFee: r2(procFee), regFee: r2(regFee), fees: r2(txFee + procFee + regFee), net: r2(grossINR - txFee - procFee - regFee) };
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
  // Fills o.fxRate (order currency) and o.stmt.fx[CUR] (statement currency, when different) with the ECB rate of the order date.
  // Returns number of rates filled. Throws on network error.
  async function ensureFx(orders) {
    const reqs = [];   // {c, date, set}
    orders.forEach(o => {
      if (!o.date) return;
      const oc = (o.currency || '').toUpperCase();
      if (oc && oc !== 'INR' && !o.fxRate) reqs.push({ c: oc, date: o.date, set: v => { o.fxRate = v; o.fxSource = 'ECB rate for ' + o.date; } });
      if (o.stmt && o.stmt.lines) {
        const need = new Set(o.stmt.lines.map(l => (l.currency || '').toUpperCase()).filter(c => c && c !== 'INR' && c !== oc && !(o.stmt.fx && o.stmt.fx[c])));
        need.forEach(c => reqs.push({ c, date: o.date, set: v => { o.stmt.fx = Object.assign({}, o.stmt.fx, { [c]: v }); } }));
      }
    });
    if (!reqs.length) return 0;
    const byCur = {};
    reqs.forEach(q => { (byCur[q.c] = byCur[q.c] || []).push(q); });
    let n = 0;
    for (const c of Object.keys(byCur)) {
      const list = byCur[c];
      const dates = list.map(q => q.date).sort();
      const start = new Date(dates[0] + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 7);
      const today = iso(new Date());
      const end = dates[dates.length - 1] > today ? today : dates[dates.length - 1];
      const r = await fetch(FX_API + iso(start) + '..' + end + '?base=' + encodeURIComponent(c) + '&symbols=INR');
      if (!r.ok) throw new Error('Exchange rate not found for ' + c);
      const j = await r.json();
      const series = {}; Object.keys(j.rates || {}).forEach(d => { if (j.rates[d].INR) series[d] = j.rates[d].INR; });
      if (list.some(q => q.date > (Object.keys(series).sort().pop() || ''))) {
        const l = await fetch(FX_API + 'latest?base=' + encodeURIComponent(c) + '&symbols=INR');
        if (l.ok) { const lj = await l.json(); if (lj.rates && lj.rates.INR) series[lj.date] = lj.rates.INR; }
      }
      list.forEach(q => { const v = pickRate(series, q.date); if (v) { q.set(v); n++; } });
    }
    return n;
  }

  const api = { DEFAULT_FEES, compute, computeActual, hasActual, ensureFx, isDomestic, pickRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.Revenue = api;
})();
