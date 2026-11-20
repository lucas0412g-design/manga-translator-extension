'use strict';
// Rode com: node test.js
const assert = require('assert');
const MT = require('./lib.js');

// goodText
assert.strictEqual(MT.goodText('HELLO!'), true);
assert.strictEqual(MT.goodText('..'), false);
assert.strictEqual(MT.goodText('~~ ;; 1'), false);
assert.strictEqual(MT.goodText('I'), false);

// isCaps
assert.strictEqual(MT.isCaps("WHERE ARE YOU GOING?"), true);
assert.strictEqual(MT.isCaps('Where are you going?'), false);

// cleanText: confusões do OCR
assert.strictEqual(MT.cleanText('HELL0 THERE'), 'HELLO THERE');
assert.strictEqual(MT.cleanText("l am fine"), 'I am fine');
assert.strictEqual(MT.cleanText("l'm here"), "I'm here");
assert.strictEqual(MT.cleanText("|'M HERE"), "I'M HERE");
assert.strictEqual(MT.cleanText('  hello   world  '), 'hello world');
assert.strictEqual(MT.cleanText('some- thing'), 'something');

// prepare: caixa alta vira frase normal
assert.deepStrictEqual(MT.prepare("I DON'T KNOW. WHERE IS HE?", 'eng'), { text: "I don't know. Where is he?", caps: true });
assert.deepStrictEqual(MT.prepare('Already normal.', 'eng'), { text: 'Already normal.', caps: false });
assert.strictEqual(MT.prepare('¿DÓNDE ESTÁ ÉL?', 'spa').text, '¿Dónde está él?');

// groupLines: duas linhas do mesmo balão + um balão separado
const lines = [
  { text: 'I DONT KNOW', conf: 90, x0: 100, y0: 100, x1: 300, y1: 130 },
  { text: 'WHERE HE IS', conf: 88, x0: 105, y0: 135, x1: 295, y1: 165 },
  { text: 'SHUT UP!', conf: 92, x0: 600, y0: 120, x1: 760, y1: 150 },
];
const blocks = MT.groupLines(lines);
assert.strictEqual(blocks.length, 2);
const first = blocks.find((b) => b.x0 === 100);
assert.strictEqual(first.lines.length, 2);
assert.strictEqual(first.y1, 165);

// linhas empilhadas mas muito distantes não juntam
const far = MT.groupLines([
  { text: 'ONE', conf: 90, x0: 100, y0: 100, x1: 200, y1: 130 },
  { text: 'TWO', conf: 90, x0: 100, y0: 400, x1: 200, y1: 430 },
]);
assert.strictEqual(far.length, 2);

// weightedConf
assert.ok(Math.abs(MT.weightedConf([{ text: 'aaaa', conf: 100 }, { text: 'a', conf: 50 }]) - 90) < 1e-9);

// dedupe: mantém o de maior confiança
const d = MT.dedupe([
  { x: 0, y: 0, w: 100, h: 50, conf: 70 },
  { x: 5, y: 2, w: 100, h: 50, conf: 85 },
  { x: 500, y: 500, w: 80, h: 40, conf: 60 },
]);
assert.strictEqual(d.length, 2);
assert.strictEqual(d[0].conf, 85);

// permissões: só envia se aceitou o aviso E ativou o site
const on = { consent: true, enabledSites: { 'manga.example': true } };
assert.strictEqual(MT.isAllowed(on, 'https://manga.example/'), true);
assert.strictEqual(MT.isAllowed(on, 'https://outro.example/'), false);
assert.strictEqual(MT.isAllowed({ consent: false, enabledSites: { 'manga.example': true } }, 'https://manga.example/'), false);
assert.strictEqual(MT.isAllowed({ consent: true, enabledSites: {} }, 'https://manga.example/'), false);
assert.strictEqual(MT.isAllowed(on, 'lixo'), false);
assert.strictEqual(MT.isAllowed(null, 'https://manga.example/'), false);

// Referer: só a origem, sem caminho nem parâmetros
assert.strictEqual(MT.refererFor('https://manga.example/cap/1?token=segredo#x'), 'https://manga.example/');
assert.strictEqual(MT.refererFor('lixo'), null);

console.log('Todos os testes passaram.');
