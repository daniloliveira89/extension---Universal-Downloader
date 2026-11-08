'use strict';

// A detecção contínua dura apenas enquanto a página estiver aberta.
(() => {
  if (globalThis.__universalAudioMonitor) return;
  globalThis.__universalAudioMonitor = true;
  const scanner = globalThis.AudioScanner;
  if (!scanner) return;

  const networkUrls = new Set();
  for (const entry of performance.getEntriesByType('resource').slice(-800)) networkUrls.add(entry.name);
  let flushTimer = 0;
  let lastKey = '';

  function snapshot() {
    return scanner.read(document, location.href, [...networkUrls]);
  }
  function notify() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      if (!chrome.runtime?.id) return;
      const payload = snapshot();
      const key = payload.tracks.map(t => `${t.url}\t${t.title}`).join('\n');
      if (key !== lastKey) {
        lastKey = key;
        chrome.runtime.sendMessage({ type: 'UNIVERSAL_AUDIO_UPDATE', payload }).catch(() => {});
      }
    }, 550);
  }
  new MutationObserver(notify).observe(document.documentElement || document, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['href', 'src', 'data-src', 'data-audio-url']
  });
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const observer = new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) {
          if (networkUrls.size >= 1500) networkUrls.delete(networkUrls.values().next().value);
          networkUrls.add(entry.name);
        }
        notify();
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch { /* PerformanceObserver pode não estar disponível. */ }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'UNIVERSAL_AUDIO_SCAN') {
      respond(snapshot());
      return false;
    }
  });
  notify();
})();
