'use strict';
/*
 * Tradutor de Mangás v0.1 — background
 * Fluxo: baixa a imagem -> fatia -> OCR (Tesseract.js) -> traduz -> devolve os blocos.
 * Tudo com fila (1 imagem por vez) e cache em IndexedDB.
 */

const CFG = {
  version: 'v1', // mude para invalidar o cache quando o algoritmo mudar
  maxTileMP: 2.0, // megapixels máximos por fatia no OCR
  minLineConf: 45, // linhas abaixo disso são descartadas
  refineBelow: 75, // blocos abaixo disso ganham uma segunda leitura
  minBlockConf: 55, // blocos abaixo disso ficam sem tradução (mantém o original)
  cacheDays: 14,
  providers: ['gtx', 'mymemory', 'lingva'], // ordem de tentativa
  lingvaHost: 'https://lingva.ml',
  minGapMs: 150, // intervalo mínimo entre pedidos de rede ao tradutor
};

/* ---------------------------- Cache (IndexedDB) ---------------------------- */
const db = (() => {
  let opened;
  const open = () =>
    opened ||
    (opened = new Promise((res, rej) => {
      const r = indexedDB.open('mangatr', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('tr');
        r.result.createObjectStore('img');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  const run = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const rq = fn(t.objectStore(store));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
    put: (s, k, v) => run(s, 'readwrite', (st) => st.put({ t: Date.now(), v }, k)),
    async clear() {
      await run('tr', 'readwrite', (st) => st.clear());
      await run('img', 'readwrite', (st) => st.clear());
    },
    async purgeOld() {
      const cutoff = Date.now() - CFG.cacheDays * 864e5;
      for (const s of ['tr', 'img']) {
        const d = await open();
        await new Promise((res) => {
          const t = d.transaction(s, 'readwrite');
          t.objectStore(s).openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (!c) return;
            if (c.value && c.value.t < cutoff) c.delete();
            c.continue();
          };
          t.oncomplete = res;
          t.onerror = res;
        });
      }
    },
  };
})();

/* ----------------- Referer (alguns sites bloqueiam hotlink) ---------------- */
const referers = new Map(); // url da imagem -> url da página
try {
  browser.webRequest.onBeforeSendHeaders.addListener(
    (d) => {
      const ref = referers.get(d.url);
      if (!ref) return {};
      if (!d.originUrl || !d.originUrl.startsWith(browser.runtime.getURL(''))) return {}; // só pedidos nossos
      const headers = d.requestHeaders.filter((h) => h.name.toLowerCase() !== 'referer');
      headers.push({ name: 'Referer', value: ref });
      return { requestHeaders: headers };
    },
    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'image', 'imageset'] },
    ['blocking', 'requestHeaders']
  );
} catch (e) {
  console.warn('webRequest indisponível; imagens com proteção de hotlink serão puladas', e);
}

async function loadBitmap(url, pageUrl) {
  const ref = MT.refererFor(pageUrl);
  if (ref) referers.set(url, ref);
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await createImageBitmap(await r.blob());
  } finally {
    referers.delete(url);
  }
}

/* ------------------------------- Imagem / OCR ------------------------------ */
function* tiles(w, h) {
  const scale = w < 700 ? 2 : 1; // imagens pequenas são ampliadas
  const tileH = Math.max(600, Math.min(2200, Math.floor((CFG.maxTileMP * 1e6) / (w * scale))));
  const overlap = 120;
  for (let y = 0; y < h; y += tileH - overlap) {
    const th = Math.min(tileH, h - y);
    yield { y, h: th, scale };
    if (y + th >= h) break;
  }
}

function renderTile(bmp, t) {
  const cw = Math.round(bmp.width * t.scale);
  const ch = Math.round(t.h * t.scale);
  const c = new OffscreenCanvas(cw, ch);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, t.y, bmp.width, t.h, 0, 0, cw, ch);
  return c;
}

// Tons de cinza com contraste esticado (ajuda o OCR em páginas desbotadas).
function toGrayStretched(src) {
  const id = src.getContext('2d').getImageData(0, 0, src.width, src.height);
  const d = id.data;
  const n = d.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    d[i] = v;
    hist[v]++;
  }
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.01) { lo = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= n * 0.01) { hi = v; break; }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let v = ((d[i] - lo) * 255) / range;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  const out = new OffscreenCanvas(src.width, src.height);
  out.getContext('2d').putImageData(id, 0, 0);
  return out;
}

// Cor de fundo ao redor da caixa (mediana de uma moldura fina fora dela).
function sampleBg(canvas, box) {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(W, Math.ceil(box.x1));
  const y1 = Math.min(H, Math.ceil(box.y1));
  const t = 3;
  const strips = [
    [x0, Math.max(0, y0 - t), x1 - x0, Math.min(t, y0)], // cima
    [x0, y1, x1 - x0, Math.min(t, H - y1)], // baixo
    [Math.max(0, x0 - t), y0, Math.min(t, x0), y1 - y0], // esquerda
    [x1, y0, Math.min(t, W - x1), y1 - y0], // direita
  ];
  const R = [];
  const G = [];
  const B = [];
  for (const [x, y, w, h] of strips) {
    if (w < 1 || h < 1) continue;
    const d = g.getImageData(x, y, w, h).data;
    const step = Math.max(1, Math.floor(d.length / 4 / 60)) * 4;
    for (let i = 0; i < d.length; i += step) {
      R.push(d[i]);
      G.push(d[i + 1]);
      B.push(d[i + 2]);
    }
  }
  if (!R.length) return { bg: '#ffffff', fg: '#111111' };
  const r = MT.median(R);
  const gg = MT.median(G);
  const b = MT.median(B);
  const lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
  return { bg: `rgb(${r},${gg},${b})`, fg: lum < 0.5 ? '#ffffff' : '#111111' };
}

const workers = {};
function getWorker(lang) {
  if (!workers[lang]) {
    workers[lang] = (async () => {
      const cfg = await (await fetch(browser.runtime.getURL('vendor/config.json'))).json();
      return Tesseract.createWorker(lang, 1, {
        workerPath: browser.runtime.getURL('vendor/worker.min.js'),
        corePath: browser.runtime.getURL('vendor'),
        langPath: browser.runtime.getURL('vendor/lang'),
        gzip: cfg.gzip,
        workerBlobURL: false,
      });
    })().catch((e) => {
      delete workers[lang];
      throw e;
    });
  }
  return workers[lang];
}

function extractLines(data) {
  let lines = data.lines;
  if (!lines && data.blocks) lines = data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  return (lines || []).map((l) => ({
    text: (l.text || '').replace(/\s+/g, ' ').trim(),
    conf: l.confidence,
    x0: l.bbox.x0,
    y0: l.bbox.y0,
    x1: l.bbox.x1,
    y1: l.bbox.y1,
  }));
}

// Segunda leitura de um bloco de baixa confiança: recorta, amplia e lê como bloco único.
async function refine(gray, b, worker) {
  const pad = 10;
  const x = Math.max(0, Math.floor(b.x0 - pad));
  const y = Math.max(0, Math.floor(b.y0 - pad));
  const w = Math.min(gray.width - x, Math.ceil(b.x1 - b.x0 + pad * 2));
  const h = Math.min(gray.height - y, Math.ceil(b.y1 - b.y0 + pad * 2));
  if (w < 10 || h < 10) return null;
  const up = h < 160 ? 2 : 1;
  const c = new OffscreenCanvas(w * up, h * up);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(gray, x, y, w, h, 0, 0, w * up, h * up);
  await worker.setParameters({ tessedit_pageseg_mode: '6' });
  const { data } = await worker.recognize(await c.convertToBlob({ type: 'image/png' }));
  return { text: (data.text || '').replace(/\s+/g, ' ').trim(), conf: data.confidence };
}

async function ocrTile(bmp, t, worker) {
  const color = renderTile(bmp, t);
  const gray = toGrayStretched(color);
  await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(await gray.convertToBlob({ type: 'image/png' }));
  const lines = extractLines(data).filter((l) => l.conf >= CFG.minLineConf && MT.goodText(l.text));
  const out = [];
  for (const b of MT.groupLines(lines)) {
    let text = b.lines.map((l) => l.text).join(' ');
    let conf = MT.weightedConf(b.lines);
    if (conf < CFG.refineBelow) {
      const r = await refine(gray, b, worker);
      if (r && r.conf > conf) { text = r.text; conf = r.conf; }
    }
    text = MT.cleanText(text);
    if (conf < CFG.minBlockConf || !MT.goodText(text)) continue;
    const lh = MT.median(b.lines.map((l) => l.y1 - l.y0));
    const pad = Math.max(4, lh * 0.12);
    const box = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
    const { bg, fg } = sampleBg(color, box);
    // volta para as coordenadas da imagem original
    const x = Math.max(0, box.x0 / t.scale);
    const y = Math.max(0, box.y0 / t.scale) + t.y;
    out.push({
      text,
      conf,
      x,
      y,
      w: Math.min(bmp.width - x, (box.x1 - box.x0) / t.scale),
      h: Math.min(bmp.height - y, (box.y1 - box.y0) / t.scale),
      bg,
      fg,
    });
  }
  return out;
}

/* -------------------------------- Tradução -------------------------------- */
const cooldown = {};
let lastNet = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) {
      const e = new Error('HTTP ' + r.status);
      e.status = r.status;
      throw e;
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS = {
  // Interface não oficial do Google Tradutor: boa, mas sem garantia de funcionamento.
  async gtx(text, sl) {
    const d = await fetchJSON(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=pt&dt=t&q=${encodeURIComponent(text)}`
    );
    return d[0].map((x) => x[0]).join('');
  },
  // API gratuita com cota diária.
  async mymemory(text, sl) {
    const d = await fetchJSON(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=${sl}|pt-BR`
    );
    const t = d.responseData && d.responseData.translatedText;
    if (!t || Number(d.responseStatus) !== 200 || /^MYMEMORY WARNING/i.test(t)) throw new Error('mymemory');
    return t;
  },
  // Instância pública do Lingva (pode estar fora do ar).
  async lingva(text, sl) {
    const d = await fetchJSON(`${CFG.lingvaHost}/api/v1/${sl}/pt/${encodeURIComponent(text)}`);
    if (!d.translation) throw new Error('lingva');
    return d.translation;
  },
};

async function looksPortuguese(text) {
  try {
    const r = await browser.i18n.detectLanguage(text);
    return !!(r.isReliable && r.languages[0] && r.languages[0].language === 'pt');
  } catch (e) {
    return false;
  }
}

// Devolve a tradução, ou null se todos os provedores falharem (não guarda falhas no cache).
async function translate(text, sl) {
  const key = `${CFG.version}|${sl}|${text}`;
  const hit = await db.get('tr', key);
  if (hit) return hit.v;
  for (const name of CFG.providers) {
    if ((cooldown[name] || 0) > Date.now()) continue;
    try {
      const wait = lastNet + CFG.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastNet = Date.now();
      const out = (await PROVIDERS[name](text, sl) || '').trim();
      if (out) {
        await db.put('tr', key, out);
        return out;
      }
    } catch (e) {
      const minutes = e.status === 429 || e.status === 403 ? 10 : 2;
      cooldown[name] = Date.now() + minutes * 60000;
      console.warn('Provedor falhou:', name, e.message);
    }
  }
  return null;
}

async function translateBlocks(blocks, lang, pageUrl) {
  const sl = lang === 'spa' ? 'es' : 'en';
  for (const b of blocks) {
    if (b.pt || b.skip) continue;
    await ensureAllowed(pageUrl); // nada vai para fora se o usuário desativou
    const p = MT.prepare(b.text, lang);
    b.caps = p.caps;
    if (await looksPortuguese(p.text)) { b.pt = null; b.skip = true; continue; }
    b.pt = await translate(p.text, sl);
  }
  return blocks;
}

/* --------------------- Consentimento / cancelamento ------------------------ */
// Lê as configurações a cada checagem: desativar o site ou revogar o aviso para o trabalho na hora.
async function ensureAllowed(pageUrl) {
  const s = await browser.storage.local.get({ consent: false, enabledSites: {} });
  if (!MT.isAllowed(s, pageUrl)) throw new Error('cancelado');
}

/* ------------------------------- Pipeline ---------------------------------- */
async function processImage(url, pageUrl, lang) {
  await ensureAllowed(pageUrl);
  const key = `${CFG.version}|${lang}|${url}`;
  const hit = await db.get('img', key);
  if (hit) {
    const res = hit.v;
    // Se algum bloco ficou sem tradução (provedores fora do ar), tenta de novo.
    if (res.blocks.some((b) => !b.pt && !b.skip)) {
      await translateBlocks(res.blocks, lang, pageUrl);
      await db.put('img', key, res);
    }
    return res;
  }
  const bmp = await loadBitmap(url, pageUrl);
  const W = bmp.width;
  const H = bmp.height;
  if (W < 300 || H < 200) {
    bmp.close();
    return { w: W, h: H, blocks: [] };
  }
  const worker = await getWorker(lang);
  let found = [];
  try {
    for (const t of tiles(W, H)) {
      await ensureAllowed(pageUrl);
      found = found.concat(await ocrTile(bmp, t, worker));
    }
  } finally {
    bmp.close();
  }
  const blocks = MT.dedupe(found);
  await translateBlocks(blocks, lang, pageUrl);
  const res = { w: W, h: H, blocks };
  await db.put('img', key, res);
  return res;
}

// Fila: uma imagem por vez para não sobrecarregar o celular.
let chain = Promise.resolve();
const inflight = new Map();
function enqueue(url, pageUrl, lang) {
  const k = lang + '|' + url;
  if (inflight.has(k)) return inflight.get(k);
  const job = chain.then(() => processImage(url, pageUrl, lang));
  chain = job.catch(() => {});
  inflight.set(k, job);
  job.then(() => inflight.delete(k), () => inflight.delete(k));
  return job;
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'ocr') {
    return enqueue(msg.url, msg.pageUrl, msg.lang).then(
      (r) => ({ ok: true, r }),
      (e) => ({ ok: false, error: String((e && e.message) || e) })
    );
  }
  if (msg.type === 'clearCache') return db.clear().then(() => ({ ok: true }));
});

db.purgeOld().catch(() => {});
