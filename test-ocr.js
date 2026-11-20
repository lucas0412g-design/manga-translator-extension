// Verifica com OCR de verdade (e sem rede) o Tesseract.js e os dados locais de idioma.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWorker } = require('tesseract.js');

(async () => {
  for (const [lang, wanted] of [['eng', 'HELLO'], ['spa', 'HOLA']]) {
    const worker = await createWorker(lang, 1, {
      langPath: path.join(__dirname, 'vendor', 'lang'),
      gzip: true,
      cacheMethod: 'none',
    });
    try {
      const { data } = await worker.recognize(path.join(__dirname, 'tests', `${lang}.png`), {}, { blocks: true });
      assert.ok(data.text.toUpperCase().includes(wanted), `${lang}: texto não reconhecido: ${data.text}`);
      assert.ok(Array.isArray(data.blocks) && data.blocks.some(b =>
        (b.paragraphs || []).some(p => (p.lines || []).some(l => l.bbox && l.text))
      ), `${lang}: blocos com coordenadas ausentes`);
      console.log(`[OCR] ${lang}: ${JSON.stringify(data.text.trim())} (blocos OK)`);
    } finally {
      await worker.terminate();
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
