(() => {
  const VERSION = 1;
  const PAGE_SOURCE = 'karaoke-hub-page';
  const EXTENSION_SOURCE = 'karaoke-hub-vocal-cut-extension';

  function postToPage(type, payload, requestId) {
    window.postMessage({
      source: EXTENSION_SOURCE,
      version: VERSION,
      type,
      payload,
      requestId,
    }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (
      !message
      || message.source !== PAGE_SOURCE
      || message.version !== VERSION
      || typeof message.type !== 'string'
    ) return;

    void chrome.runtime.sendMessage({
      target: 'service-worker',
      type: message.type,
      payload: message.payload,
    }).then((response) => {
      postToPage('EXTENSION_RESPONSE', response, message.requestId);
    }).catch((error) => {
      postToPage('EXTENSION_RESPONSE', {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, message.requestId);
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target !== 'content-script') return;
    postToPage(message.type, message.payload);
  });

  postToPage('EXTENSION_READY', { installed: true });
})();
