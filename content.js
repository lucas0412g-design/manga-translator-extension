'use strict';
/*
 * Tradutor de Mangás v0.1 — content script
 * - Observa as imagens da página (inclusive as que carregam depois)
 * - Pede ao background as que estão perto da tela (pré-carregamento)
 * - Desenha a tradução numa camada separada, sem alterar a imagem original
 */
(() => {
  const HOST = location.hostname;
  const MAX_INFLIGHT = 2; // imagens pedidas ao mesmo tempo
  const PRELOAD_MARGIN = '3000px 0px 3000px 0px'; // ~2-3 páginas para cima e para baixo

  const S = { enabled: false, lang: 'eng', showOriginal: false };
  const cand = new Map(); // img -> {st:'idle'|'busy'|'done'|'fail', url, lang, tries, nextAt}
  const groups = new Map(); // img -> {el, res, lastW}
  let running = false;
  let io, mo, ro, timer, host, root, btn, rafPending = false;

  /* ------------------------------ Configurações ------------------------------ */
  async function loadSettings() {
    const s = await browser.storage.local.get({ enabledSites: {}, lang: 'eng', showOriginal: false, consent: false });
    return { enabled: !!(s.consent && s.enabledSites[HOST]), lang: s.lang, showOriginal: s.showOriginal };
  }

  async function apply() {
    const next = await loadSettings();
    const langChanged = next.lang !== S.lang;
    Object.assign(S, next);
    if (!S.enabled) return stop();
    if (langChanged && running) resetAll();
    start();
    root.classList.toggle('hide-all', S.showOriginal);
    btn.classList.toggle('dim', S.showOriginal);
  }

  /* ---------------------------------- Camada --------------------------------- */
  function ensureLayer() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('translate', 'no'); // evita o tradutor do Firefox mexer no que já é português
    host.lang = 'pt-BR';
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;pointer-events:none;';
    const sh = host.attachShadow({ mode: 'closed' });
    sh.innerHTML = `
      <style>
        .g{position:absolute;display:none;pointer-events:none}
        .b{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
           text-align:center;overflow:hidden;pointer-events:auto;border-radius:12px;padding:1.5%;
           font-family:'Comic Neue','Comic Sans MS','Segoe UI',Arial,sans-serif;font-weight:700;line-height:1.1;
           word-break:break-word;transition:opacity .12s}
        .b span{display:block;max-width:100%}
        .b.off{opacity:0}
        .hide-all .g{display:none !important}
        #btn{position:fixed;right:10px;bottom:90px;width:42px;height:42px;border-radius:50%;border:0;
             background:#1f6feb;color:#fff;font:700 14px Arial,sans-serif;opacity:.85;pointer-events:auto;
             box-shadow:0 2px 8px rgba(0,0,0,.4)}
        #btn.dim{background:#555;opacity:.6}
      </style>
      <div id="root"><button id="btn" title="Alternar tradução / original">PT</button></div>`;
    root = sh.getElementById('root');
    btn = sh.getElementById('btn');
    btn.addEventListener('click', () => browser.storage.local.set({ showOriginal: !S.showOriginal }));
    document.documentElement.appendChild(host);
  }

  function removeLayer() {
    if (host) host.remove();
    host = root = btn = null;
    groups.clear();
  }

  /* --------------------------- Posição e tamanho da fonte --------------------------- */
  function fit(d) {
    const span = d.firstChild;
    const w = d.clientWidth;
    const h = d.clientHeight;
    let fs = Math.max(7, Math.min(h * 0.6, 42));
    d.style.fontSize = fs + 'px';
    while (fs > 7 && (span.offsetHeight > h || span.scrollWidth > w)) {
      fs -= 1;
      d.style.fontSize = fs + 'px';
    }
  }

  function scheduleReposition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      repositionAll();
    });
  }

  function repositionAll() {
    if (!groups.size) return;
    const reads = [];
    for (const [img, g] of groups) reads.push([img, g, img.getBoundingClientRect()]); // leituras primeiro
    for (const [img, g, r] of reads) {
      const far = r.bottom < -2500 || r.top > innerHeight + 2500;
      const veryFar = r.bottom < -4000 || r.top > innerHeight + 4000;
      if (!img.isConnected || veryFar) { // fora da página ou muito longe: libera a memória
        g.el.remove();
        groups.delete(img);
        const s = cand.get(img);
        if (s && s.st === 'done') cand.delete(img); // volta pelo cache quando chegar perto de novo
        continue;
      }
      if (!r.width || far) {
        g.el.style.display = 'none';
        continue;
      }
      g.el.style.cssText = `display:block;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px`;
      if (Math.abs(r.width - g.lastW) > 1) {
        g.lastW = r.width;
        for (const d of g.el.children) fit(d);
      }
    }
  }

  /* --------------------------------- Desenho --------------------------------- */
  function render(img, res) {
    if (!root) return;
    const old = groups.get(img);
    if (old) old.el.remove();
    const el = document.createElement('div');
    el.className = 'g';
    for (const b of res.blocks) {
      if (!b.pt) continue; // sem tradução: mantém o original
      const d = document.createElement('div');
      d.className = 'b';
      const span = document.createElement('span');
      span.textContent = b.pt; // textContent: nunca HTML vindo de fora
      d.appendChild(span);
      d.style.cssText =
        `left:${(b.x / res.w) * 100}%;top:${(b.y / res.h) * 100}%;` +
        `width:${(b.w / res.w) * 100}%;height:${(b.h / res.h) * 100}%;` +
        `background:${b.bg};color:${b.fg};box-shadow:0 0 4px 3px ${b.bg};` +
        (b.caps ? 'text-transform:uppercase;' : '');
      d.addEventListener('click', () => d.classList.toggle('off')); // toque = ver o original
      el.appendChild(d);
    }
    root.appendChild(el);
    groups.set(img, { el, res, lastW: 0 });
    scheduleReposition();
  }

  /* ----------------------------- Agendador / fila ----------------------------- */
  function eligible(img) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('blob:')) return false;
    const r = img.getBoundingClientRect();
    return img.complete && img.naturalWidth >= 300 && img.naturalHeight >= 200 && r.width >= 200 && r.height >= 120;
  }

  async function run(img, s) {
    s.st = 'busy';
    s.url = img.currentSrc || img.src;
    s.lang = S.lang;
    try {
      const res = await browser.runtime.sendMessage({ type: 'ocr', url: s.url, pageUrl: location.origin, lang: s.lang });
      if (!S.enabled || !cand.has(img) || s.lang !== S.lang || (img.currentSrc || img.src) !== s.url) {
        s.st = 'idle';
        return;
      }
      if (!res || !res.ok) throw new Error(res && res.error);
      render(img, res.r);
      s.st = 'done';
    } catch (e) {
      s.st = 'fail';
      s.tries = (s.tries || 0) + 1;
      s.nextAt = Date.now() + 30000 * s.tries;
    }
  }

  function tick() {
    if (!S.enabled) return;
    let busy = 0;
    const now = Date.now();
    const list = [];
    const mid = innerHeight / 2;
    for (const [img, s] of cand) {
      if (!img.isConnected) {
        cand.delete(img);
        const g0 = groups.get(img);
        if (g0) { g0.el.remove(); groups.delete(img); }
        continue;
      }
      const cur = img.currentSrc || img.src;
      if (s.st === 'done' && cur !== s.url) { // a página trocou a imagem
        const g = groups.get(img);
        if (g) { g.el.remove(); groups.delete(img); }
        s.st = 'idle';
      }
      if (s.st === 'busy') busy++;
      else if ((s.st === 'idle' || (s.st === 'fail' && s.tries < 3 && now >= s.nextAt)) && eligible(img)) {
        const r = img.getBoundingClientRect();
        list.push([Math.abs((r.top + r.bottom) / 2 - mid), img, s]); // mais perto da tela primeiro
      }
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [, img, s] of list.slice(0, Math.max(0, MAX_INFLIGHT - busy))) run(img, s);
    scheduleReposition();
  }

  /* ------------------------------- Observadores ------------------------------- */
  function onIntersect(entries) {
    for (const e of entries) {
      const s = cand.get(e.target);
      if (e.isIntersecting) {
        if (!s) cand.set(e.target, { st: 'idle' });
      } else if (s && s.st !== 'busy') { // saiu da faixa de pré-carregamento
        cand.delete(e.target);
        const g = groups.get(e.target);
        if (g) { g.el.remove(); groups.delete(e.target); }
      }
    }
  }

  function watch(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') io.observe(node);
    else node.querySelectorAll && node.querySelectorAll('img').forEach((i) => io.observe(i));
  }

  function onMutation(muts) {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(watch);
      else if (m.target.tagName === 'IMG') io.observe(m.target);
    }
  }

  function onLoadCapture(e) {
    if (io && e.target && e.target.tagName === 'IMG') io.observe(e.target);
  }

  function resetAll() {
    for (const g of groups.values()) g.el.remove();
    groups.clear();
    for (const s of cand.values()) if (s.st !== 'busy') Object.assign(s, { st: 'idle', tries: 0 });
  }

  function start() {
    if (running) return;
    running = true;
    ensureLayer();
    io = new IntersectionObserver(onIntersect, { rootMargin: PRELOAD_MARGIN });
    watch(document.documentElement);
    mo = new MutationObserver(onMutation);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
    ro = new ResizeObserver(scheduleReposition); // a página cresceu: reposiciona as camadas
    ro.observe(document.documentElement);
    addEventListener('resize', scheduleReposition);
    document.addEventListener('scroll', scheduleReposition, { capture: true, passive: true }); // leitores com rolagem interna
    document.addEventListener('load', onLoadCapture, true); // imagens que terminam de carregar depois
    timer = setInterval(tick, 1000);
  }

  function stop() {
    if (!running) { if (host) removeLayer(); return; }
    running = false;
    clearInterval(timer);
    io && io.disconnect();
    mo && mo.disconnect();
    ro && ro.disconnect();
    removeEventListener('resize', scheduleReposition);
    document.removeEventListener('scroll', scheduleReposition, true);
    document.removeEventListener('load', onLoadCapture, true);
    cand.clear();
    removeLayer();
  }

  browser.storage.onChanged.addListener(apply);
  apply();
})();
