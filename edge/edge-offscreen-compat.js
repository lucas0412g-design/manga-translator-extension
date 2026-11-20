'use strict';
// An offscreen document has chrome.runtime only. Let the shared OCR pipeline
// request narrowly scoped services from the extension service worker.
const browser = {
  runtime: {
    getURL: (path) => chrome.runtime.getURL(path),
    onMessage: {
      addListener(fn) {
        chrome.runtime.onMessage.addListener((msg, sender, respond) => {
          if (!msg || msg.target !== 'edge-offscreen') return false;
          Promise.resolve().then(() => fn(msg, sender))
            .then(respond, (e) => respond({ ok: false, error: String(e && e.message || e) }));
          return true;
        });
      }
    }
  },
  storage: {
    local: {
      async get(defaults) {
        const result = await chrome.runtime.sendMessage({
          target: 'edge-api', op: 'storageGet', defaults
        });
        if (result && result.ok === false) throw new Error(result.error);
        return result;
      }
    }
  },
  i18n: {
    async detectLanguage(text) {
      const result = await chrome.runtime.sendMessage({
        target: 'edge-api', op: 'detectLanguage', text
      });
      if (result && result.ok === false) throw new Error(result.error);
      return result;
    }
  }
};
