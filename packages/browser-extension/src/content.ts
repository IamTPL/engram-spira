/**
 * Content script — injected into every page.
 * Listens for messages from the background/popup and provides selected text.
 */
export {};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_SELECTION') {
    const text = window.getSelection()?.toString()?.trim() ?? '';
    sendResponse({ text });
  }
});
