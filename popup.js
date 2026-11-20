'use strict';
const $ = (id) => document.getElementById(id);
let host = '';

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try { host = new URL(tab.url).hostname; } catch (e) { host = ''; }
  $('host').textContent = host || 'Página sem endereço válido';
  const s = await browser.storage.local.get({ enabledSites: {}, lang: 'eng', showOriginal: false, consent: false });
  $('consent').checked = s.consent;
  $('consentBox').hidden = s.consent;
  $('site').checked = !!s.enabledSites[host];
  $('site').disabled = !s.consent || !host;
  $('lang').value = s.lang;
  $('orig').checked = s.showOriginal;
}

$('consent').addEventListener('change', async () => {
  await browser.storage.local.set({ consent: $('consent').checked });
  $('site').disabled = !$('consent').checked || !host;
});

$('site').addEventListener('change', async () => {
  const { enabledSites = {} } = await browser.storage.local.get('enabledSites');
  if ($('site').checked) enabledSites[host] = true; else delete enabledSites[host];
  await browser.storage.local.set({ enabledSites });
});

$('lang').addEventListener('change', () => browser.storage.local.set({ lang: $('lang').value }));
$('orig').addEventListener('change', () => browser.storage.local.set({ showOriginal: $('orig').checked }));

$('clear').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'clearCache' });
  $('status').textContent = 'Cache limpo.';
});

init();
