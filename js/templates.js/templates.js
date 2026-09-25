/* Buyer message templates - copy-ready English messages for Etsy conversations.
   Review requests follow Etsy policy: no incentives, discounts or pressure. */
(function () {
  'use strict';
  const { ico, esc, toast, hydrateIcons } = UI;

  const TEMPLATES = [
    {
      title: 'Thank you - order received',
      when: 'Send right after a new order comes in, to confirm you have started.',
      text: 'Hi [Buyer name],\n\nThank you so much for your order, and for trusting me with your reading. I have received everything I need and I have already begun tuning into your energy.\n\nYour reading will be delivered within the timeframe shown on the listing. If there is anything specific on your mind that you would like me to focus on, just reply here - I am happy to help.\n\nWarmly,\n[Reader name]'
    },
    {
      title: 'Reading delivered',
      when: 'Send together with the finished reading PDF.',
      text: 'Hi [Buyer name],\n\nYour reading is ready and I have just sent it over. Please take your time with it - many people like to read it once, sit with it, and come back to it again later.\n\nIf any part is unclear or you would like me to explain something further, just reply here and I will gladly clarify.\n\nThank you again for letting me read for you.\n\nWarmly,\n[Reader name]'
    },
    {
      title: 'Review request',
      when: 'A day or two after delivery. A plain, friendly ask - no discounts or gifts, so it stays within Etsy rules.',
      text: 'Hi [Buyer name],\n\nI hope your reading brought you the clarity you were looking for.\n\nIf you have a moment, an honest review on Etsy would mean a lot to me - it helps other people find the right reader for them. No pressure at all, and thank you either way for your order.\n\nWarmly,\n[Reader name]'
    },
    {
      title: 'Follow-up after a few days',
      when: 'Three to five days after delivery, to check in and invite questions.',
      text: 'Hi [Buyer name],\n\nI just wanted to check in now that you have had a few days with your reading. Sometimes things settle, and sometimes new questions come up after sitting with it.\n\nIf there is anything you would like me to clarify or expand on, I am right here.\n\nWishing you all the best,\n[Reader name]'
    },
    {
      title: 'Running late - delay update',
      when: 'If a reading will be later than promised. Send it before the deadline, not after.',
      text: 'Hi [Buyer name],\n\nI want to be upfront with you: your reading is taking a little longer than expected. I never rush a reading, and I would rather give you something thorough and true than something fast.\n\nYour new delivery date is [new date]. I am sorry for the wait, and I truly appreciate your patience.\n\nWarmly,\n[Reader name]'
    },
    {
      title: 'Missing details for the reading',
      when: 'When an order arrives without the information you need to start.',
      text: 'Hi [Buyer name],\n\nThank you for your order! Before I begin your reading, I just need a few details from you:\n\n[what you need - for example: your full name and date of birth]\n\nAs soon as you send them over, I will get started right away.\n\nWarmly,\n[Reader name]'
    }
  ];

  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function allAsTxt() {
    const line = '----------------------------------------';
    return 'BUYER MESSAGE TEMPLATES\nEtsy readings - copy, replace the [bracketed] parts, send.\nThe review request offers no discounts or gifts, so it stays within Etsy rules.\n\n' +
      TEMPLATES.map((t, i) => (i + 1) + '. ' + t.title.toUpperCase() + '\nWhen to use: ' + t.when + '\n' + line + '\n' + t.text + '\n' + line).join('\n\n') + '\n';
  }

  function downloadTxt() {
    const blob = new Blob([allAsTxt()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'buyer-message-templates.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function view(v) {
    v.innerHTML =
      '<div class="notice" style="margin-bottom:18px">' + ico('info') + '<div>Tap <b>Copy</b>, paste into the Etsy conversation, and replace the [bracketed] parts before sending. The review request is a plain friendly ask - no discounts or gifts - so it stays inside Etsy\'s rules.</div></div>' +
      '<div style="margin-bottom:14px"><button class="btn" id="tplDownload">' + ico('download') + 'Download all as .txt</button></div>' +
      TEMPLATES.map((t, i) =>
        '<div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>' + esc(t.title) + '</h3><div class="sub">' + esc(t.when) + '</div></div>' +
        '<button class="btn btn-primary btn-sm" data-tpl="' + i + '">' + ico('copy') + 'Copy</button></div>' +
        '<div class="card-body" style="padding-top:14px"><div class="tpl-text">' + esc(t.text) + '</div></div></div>').join('');
    document.getElementById('tplDownload').addEventListener('click', downloadTxt);
    v.querySelectorAll('[data-tpl]').forEach(b => b.addEventListener('click', () => {
      const t = TEMPLATES[+b.dataset.tpl];
      copyText(t.text).then(ok => toast(ok ? 'Copied "' + t.title + '" - paste it in Etsy' : 'Copy failed. Long-press the text and copy by hand.', ok ? '' : 'err'));
    }));
    hydrateIcons(v);
  }

  window.Templates = { TEMPLATES, view, allAsTxt };
})();
