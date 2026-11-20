'use strict';
// Edge / Chromium MV3 coordinator. OCR stays in an offscreen extension document
// because an extension service worker cannot create a Tesseract Worker/DOM canvas.
const OFFSCREEN_PAGE = 'edge-offscreen.html';
let creatingOffscreen = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_PAGE);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url]
  });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PAGE,
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'Executar OCR local em Web Worker e preparar imagens de quadrinhos.'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

function fromOffscreen(sender) {
  return sender.url === chrome.runtime.getURL(OFFSCREEN_PAGE);
}

function senderMatchesPage(sender, msg) {
  try {
    return sender.tab && sender.url &&
      /^https?:$/.test(new URL(sender.url).protocol) &&
      new URL(sender.url).origin === new URL(msg.pageUrl).origin &&
      /^https?:$/.test(new URL(msg.url).protocol);
  } catch (_) { return false; }
}

// The listener must be registered synchronously to work after a worker restart.
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.target === 'edge-offscreen') return false;

  // The offscreen document has access only to chrome.runtime. Mediate a narrow,
  // explicit allowlist of storage and language-detection operations for it.
  if (msg.target === 'edge-api') {
    if (!fromOffscreen(sender)) { respond({ ok: false, error: 'remetente inválido' }); return false; }
    let task;
    if (msg.op === 'storageGet') {
      task = chrome.storage.local.get(msg.defaults);
    } else if (msg.op === 'detectLanguage') {
      task = new Promise((resolve) => {
        chrome.i18n.detectLanguage(String(msg.text || ''), (r) => {
          resolve(r || { isReliable: false, languages: [] });
        });
      });
    } else {
      respond({ ok: false, error: 'operação inválida' });
      return false;
    }
    Promise.resolve(task).then(respond, (e) => respond({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type !== 'ocr' && msg.type !== 'clearCache') return false;
  if (msg.type === 'ocr' && !senderMatchesPage(sender, msg)) {
    respond({ ok: false, error: 'origem da página não corresponde ao pedido' });
    return false;
  }
  if (msg.type === 'clearCache' && !(sender.url || '').startsWith(chrome.runtime.getURL(''))) {
    respond({ ok: false, error: 'origem inválida' });
    return false;
  }

  ensureOffscreen()
    .then(() => chrome.runtime.sendMessage({ ...msg, target: 'edge-offscreen' }))
    .then(respond, (e) => respond({ ok: false, error: String(e && e.message || e) }));
  return true;
});
