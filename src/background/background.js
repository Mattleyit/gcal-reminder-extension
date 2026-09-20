// Service worker dell'estensione (Manifest V3).
// In questa fase contiene solo il ciclo di vita e il router dei messaggi:
// auth, polling del calendario e popup arrivano nelle fasi successive.

import { DEFAULT_SETTINGS, MESSAGES, STORAGE_KEYS } from './constants.js';

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[gcal-reminder] installato:', details.reason);
  await ensureSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[gcal-reminder] avvio browser');
  await ensureSettings();
});

// Scrive le impostazioni di default solo se non esistono gia',
// cosi' un aggiornamento dell'estensione non sovrascrive le scelte dell'utente.
async function ensureSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  const current = stored[STORAGE_KEYS.settings] || {};
  await chrome.storage.sync.set({
    [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, ...current }
  });
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.settings] || {}) };
}

// Router dei messaggi. Risponde in modo asincrono, quindi il listener
// ritorna true per tenere aperto il canale verso il mittente.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error('[gcal-reminder] errore nel messaggio', message?.type, error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case MESSAGES.getStatus: {
      const settings = await getSettings();
      return {
        ok: true,
        version: chrome.runtime.getManifest().version,
        authenticated: false, // implementato nella fase OAuth
        settings
      };
    }
    default:
      return { ok: false, error: `Messaggio non gestito: ${message?.type}` };
  }
}
