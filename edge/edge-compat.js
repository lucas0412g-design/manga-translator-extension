'use strict';
// Shared content.js and popup.js use browser.* Promise APIs.
// Modern Edge exposes equivalent chrome.* Promise APIs for these methods.
if (typeof browser === 'undefined') globalThis.browser = chrome;
