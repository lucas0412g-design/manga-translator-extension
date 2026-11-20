'use strict';
/*
 * lib.js — funções puras (sem navegador) usadas pelo background.js.
 * Ficam separadas para poderem ser testadas com `node test.js`.
 */
(function (root) {
  const countLetters = (s) => (s.match(/\p{L}/gu) || []).length;

  // Texto com cara de fala de verdade (e não ruído do OCR)?
  function goodText(s) {
    const t = (s || '').trim();
    if (t.length < 2) return false;
    const L = countLetters(t);
    if (L < 2) return false;
    return L / t.replace(/\s/g, '').length >= 0.6;
  }

  // Texto em CAIXA ALTA (padrão de balões de quadrinhos)?
  function isCaps(s) {
    const L = s.match(/\p{L}/gu) || [];
    if (L.length < 3) return false;
    const up = L.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
    return up / L.length >= 0.8;
  }

  // Corrige confusões típicas do OCR (I/l/|, O/0).
  function cleanText(text) {
    let s = (text || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/\|(?=['’]?[A-Za-z])/g, 'I'); // "|'M" -> "I'M"
    s = s.replace(/^[\s|_~`^*]+|[\s|_~`^]+$/g, ''); // lixo nas pontas
    s = s.replace(/(?<=\p{Lu})l(?=\p{Lu})/gu, 'I'); // HELlO -> HELIO (l entre maiúsculas)
    s = s.replace(/(?<=\p{Lu})0(?=\p{Lu}|(?![\p{L}\p{N}]))/gu, 'O'); // também no fim da palavra // HELL0 -> HELLO
    s = s.replace(/(?<=\p{Lu})1(?=\p{Lu})/gu, 'I');
    s = s.replace(/(^|[\s"'(¿¡])l(?=[\s',.!?’]|$)/g, '$1I'); // "l am" -> "I am"
    s = s.replace(/(\p{L})- (\p{Ll})/gu, '$1$2'); // hifenização de fim de linha
    return s.replace(/\s+/g, ' ').trim();
  }

  // Prepara o texto para o tradutor: caixa alta vira frase normal.
  function prepare(text, lang) {
    const caps = isCaps(text);
    let t = text;
    if (caps) {
      t = t.toLowerCase();
      if (lang === 'eng') t = t.replace(/\bi\b/g, 'I');
      t = t.replace(/(^|[.!?…]\s+|[¿¡])(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
    }
    return { text: t, caps };
  }

  // Junta linhas do OCR em blocos (balões). Linha = {text, conf, x0,y0,x1,y1}.
  function groupLines(lines) {
    const sorted = lines.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const blocks = [];
    for (const l of sorted) {
      const lh = l.y1 - l.y0;
      let target = null;
      for (const b of blocks) {
        const last = b.lines[b.lines.length - 1];
        const lastH = last.y1 - last.y0;
        const ratio = lh / lastH;
        const gap = l.y0 - last.y1;
        const overlap = Math.min(l.x1, b.x1) - Math.max(l.x0, b.x0);
        const minW = Math.min(l.x1 - l.x0, b.x1 - b.x0);
        if (gap <= Math.max(lh, lastH) && gap >= -0.3 * lh && overlap >= 0.3 * minW && ratio > 0.6 && ratio < 1.67) {
          target = b;
          break;
        }
      }
      if (target) {
        target.lines.push(l);
        target.x0 = Math.min(target.x0, l.x0);
        target.y0 = Math.min(target.y0, l.y0);
        target.x1 = Math.max(target.x1, l.x1);
        target.y1 = Math.max(target.y1, l.y1);
      } else {
        blocks.push({ lines: [l], x0: l.x0, y0: l.y0, x1: l.x1, y1: l.y1 });
      }
    }
    return blocks;
  }

  // Confiança média ponderada pelo tamanho do texto de cada linha.
  function weightedConf(lines) {
    let sum = 0;
    let n = 0;
    for (const l of lines) {
      const w = Math.max(1, l.text.length);
      sum += l.conf * w;
      n += w;
    }
    return n ? sum / n : 0;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  }

  function iou(a, b) {
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  }

  // Remove blocos repetidos (as faixas de imagem se sobrepõem um pouco).
  function dedupe(blocks) {
    const kept = [];
    for (const b of blocks.slice().sort((p, q) => q.conf - p.conf)) {
      if (!kept.some((k) => iou(k, b) > 0.4)) kept.push(b);
    }
    return kept;
  }

  // Endereço -> nome do site (ou '' se inválido).
  function hostOf(u) {
    try { return new URL(u).hostname; } catch (e) { return ''; }
  }

  // O usuário aceitou o aviso E ativou este site? (checado antes de qualquer envio externo)
  function isAllowed(settings, pageUrl) {
    const h = hostOf(pageUrl);
    return !!(settings && settings.consent && h && settings.enabledSites && settings.enabledSites[h]);
  }

  // Referer mínimo (só a origem), como o navegador já faria entre sites diferentes.
  function refererFor(pageUrl) {
    try {
      const o = new URL(pageUrl).origin;
      return o && o !== 'null' ? o + '/' : null;
    } catch (e) { return null; }
  }

  const api = { hostOf, isAllowed, refererFor, goodText, isCaps, cleanText, prepare, groupLines, weightedConf, median, iou, dedupe };
  root.MT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
