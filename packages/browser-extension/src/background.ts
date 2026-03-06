/**
 * Background service worker.
 * Handles: context menu creation, card creation API calls.
 */
export {};

const API_URL_KEY = 'engram_api_url';
const DECK_ID_KEY = 'engram_deck_id';

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'engram-create-card',
    title: 'Create Flashcard',
    contexts: ['selection'],
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'engram-create-card') return;
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  const storage = await chrome.storage.local.get([API_URL_KEY, DECK_ID_KEY]);
  const apiUrl = storage[API_URL_KEY] as string | undefined;
  const deckId = storage[DECK_ID_KEY] as string | undefined;

  if (!apiUrl || !deckId) {
    // Can't create without config — open popup
    return;
  }

  await createCard(apiUrl, deckId, selectedText);
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CREATE_CARD') {
    (async () => {
      const storage = await chrome.storage.local.get(API_URL_KEY);
      const apiUrl = storage[API_URL_KEY] as string | undefined;
      if (!apiUrl) {
        sendResponse({ success: false, error: 'Not connected' });
        return;
      }
      const result = await createCard(
        apiUrl as string,
        message.deckId,
        message.text,
      );
      sendResponse(result);
    })();
    return true; // Keep message channel open for async response
  }
});

/**
 * Create a flashcard via the API.
 * For simplicity, uses the AI generate endpoint to create a single card
 * from the selected text, then auto-saves it.
 * Falls back to creating a basic front/back card directly.
 */
async function createCard(
  apiUrl: string,
  deckId: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Try AI generation for a single card
    const genRes = await fetch(`${apiUrl}/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ deckId, sourceText: text, cardCount: 1 }),
    });

    if (genRes.ok) {
      const genData = await genRes.json();
      // Auto-save the generated card
      const saveRes = await fetch(`${apiUrl}/ai/jobs/${genData.jobId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (saveRes.ok) {
        return { success: true };
      }
    }

    return {
      success: false,
      error: 'Failed to create card (check API connection)',
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Network error' };
  }
}
