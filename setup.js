'use strict';
// Copia o Tesseract.js e os dados de idioma (inglês/espanhol) de node_modules para ./vendor
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'vendor');
const langOut = path.join(out, 'lang');
fs.mkdirSync(langOut, { recursive: true });

const copy = (from, to) => {
  fs.copyFileSync(from, to);
  console.log('ok  ', path.relative(root, to));
};
const must = (p) => {
  if (!fs.existsSync(p)) {
    console.error('Arquivo não encontrado:', p, '\nRode "npm install" antes.');
    process.exit(1);
  }
  return p;
};

copy(must(path.join(nm, 'tesseract.js/dist/tesseract.min.js')), path.join(out, 'tesseract.min.js'));
copy(must(path.join(nm, 'tesseract.js/dist/worker.min.js')), path.join(out, 'worker.min.js'));

const coreDir = must(path.join(nm, 'tesseract.js-core'));
for (const f of fs.readdirSync(coreDir)) {
  if (f.startsWith('tesseract-core')) copy(path.join(coreDir, f), path.join(out, f));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

function findTrained(lang) {
  const base = must(path.join(nm, '@tesseract.js-data', lang));
  for (const d of ['4.0.0_best_int', '4.0.0_fast', '4.0.0']) {
    for (const ext of ['.traineddata.gz', '.traineddata']) {
      const p = path.join(base, d, lang + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  const any = walk(base).find((f) => /\.traineddata(\.gz)?$/.test(f) && path.basename(f).startsWith(lang + '.'));
  if (!any) {
    console.error('Dados de idioma não encontrados para', lang);
    process.exit(1);
  }
  return any;
}

const found = ['eng', 'spa'].map((l) => ({ lang: l, file: findTrained(l) }));
const allGz = found.every((f) => f.file.endsWith('.gz'));
for (const { lang, file } of found) {
  const dest = path.join(langOut, lang + '.traineddata' + (allGz ? '.gz' : ''));
  if (file.endsWith('.gz') && !allGz) {
    fs.writeFileSync(dest, zlib.gunzipSync(fs.readFileSync(file))); // mistura de formatos: descompacta
    console.log('ok  ', path.relative(root, dest), '(descompactado)');
  } else {
    copy(file, dest);
  }
}
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ gzip: allGz }));
console.log('\nPronto. Pasta vendor/ preenchida (gzip =', allGz + ').');
