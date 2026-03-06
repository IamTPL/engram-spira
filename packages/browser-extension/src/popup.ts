/**
 * Extension popup script.
 * Handles: login/connect, deck selection, manual card creation from selection.
 */
export {};

const API_URL_KEY = 'engram_api_url';
const DECK_ID_KEY = 'engram_deck_id';

const loginSection = document.getElementById('login-section') as HTMLDivElement;
const mainSection = document.getElementById('main-section') as HTMLDivElement;
const apiUrlInput = document.getElementById('api-url') as HTMLInputElement;
const btnConnect = document.getElementById('btn-connect') as HTMLButtonElement;
const deckSelect = document.getElementById('deck-select') as HTMLSelectElement;
const btnCreate = document.getElementById('btn-create') as HTMLButtonElement;
const btnLogout = document.getElementById('btn-logout') as HTMLButtonElement;
const statusMsg = document.getElementById('status-msg') as HTMLDivElement;

async function getApiUrl(): Promise<string | null> {
  const result = await chrome.storage.local.get(API_URL_KEY);
  return (result[API_URL_KEY] as string) ?? null;
}

async function init() {
  const apiUrl = await getApiUrl();
  if (!apiUrl) {
    loginSection.style.display = 'block';
    mainSection.style.display = 'none';
    return;
  }

  // Check connection
  try {
    const res = await fetch(`${apiUrl}/health`);
    if (!res.ok) throw new Error('API unreachable');
    loginSection.style.display = 'none';
    mainSection.style.display = 'block';
    await loadDecks(apiUrl);
  } catch {
    loginSection.style.display = 'block';
    mainSection.style.display = 'none';
  }
}

async function loadDecks(apiUrl: string) {
  try {
    const res = await fetch(`${apiUrl}/folders`, { credentials: 'include' });
    if (!res.ok) {
      statusMsg.textContent = 'Auth required — log in via the web app first';
      statusMsg.className = 'status warn';
      return;
    }
    const data = await res.json();
    // Extract decks from folder tree
    const decks: { id: string; name: string }[] = [];
    function extractDecks(items: any[]) {
      for (const item of items) {
        if (item.decks) {
          for (const d of item.decks) {
            decks.push({ id: d.id, name: d.name });
          }
        }
        if (item.children) extractDecks(item.children);
      }
    }
    if (Array.isArray(data)) extractDecks(data);

    deckSelect.innerHTML = '';
    if (decks.length === 0) {
      deckSelect.innerHTML = '<option value="">No decks found</option>';
      return;
    }

    const savedDeckId = (await chrome.storage.local.get(DECK_ID_KEY))[
      DECK_ID_KEY
    ];
    for (const deck of decks) {
      const opt = document.createElement('option');
      opt.value = deck.id;
      opt.textContent = deck.name;
      if (deck.id === savedDeckId) opt.selected = true;
      deckSelect.appendChild(opt);
    }
    btnCreate.disabled = false;
    statusMsg.textContent = `Connected · ${decks.length} decks`;
    statusMsg.className = 'status ok';
  } catch {
    statusMsg.textContent = 'Failed to load decks';
    statusMsg.className = 'status error';
  }
}

btnConnect.addEventListener('click', async () => {
  const url = apiUrlInput.value.trim().replace(/\/$/, '');
  if (!url) return;
  try {
    const res = await fetch(`${url}/health`);
    if (!res.ok) throw new Error();
    await chrome.storage.local.set({ [API_URL_KEY]: url });
    init();
  } catch {
    alert('Cannot reach API at ' + url);
  }
});

btnLogout.addEventListener('click', async () => {
  await chrome.storage.local.remove([API_URL_KEY, DECK_ID_KEY]);
  init();
});

deckSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ [DECK_ID_KEY]: deckSelect.value });
});

btnCreate.addEventListener('click', async () => {
  const deckId = deckSelect.value;
  if (!deckId) return;

  await chrome.storage.local.set({ [DECK_ID_KEY]: deckId });

  // Get selected text from the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.getSelection()?.toString() ?? '',
  });

  const selectedText = result?.result?.trim();
  if (!selectedText) {
    statusMsg.textContent = 'No text selected on the page';
    statusMsg.className = 'status warn';
    return;
  }

  // Send to background for card creation
  btnCreate.disabled = true;
  btnCreate.textContent = 'Creating...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CREATE_CARD',
      deckId,
      text: selectedText,
    });
    if (response?.success) {
      statusMsg.textContent = 'Card created!';
      statusMsg.className = 'status ok';
    } else {
      statusMsg.textContent = response?.error ?? 'Failed to create card';
      statusMsg.className = 'status error';
    }
  } catch (err: any) {
    statusMsg.textContent = err?.message ?? 'Error';
    statusMsg.className = 'status error';
  } finally {
    btnCreate.disabled = false;
    btnCreate.textContent = 'Create Card from Selection';
  }
});

init();
