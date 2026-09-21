// Service worker dell'estensione (Manifest V3).
// Ciclo di vita, router dei messaggi e gestione degli alarm.
// Il polling del calendario arriva nella fase successiva.

import { getAuthState, signIn, signOut } from './auth.js';
import { ALARM_SNOOZE_PREFIX, DEFAULT_SETTINGS, MESSAGES, SNOOZE_MINUTES, STORAGE_KEYS } from './constants.js';
import {
  buildTestEvent,
  clearReminderState,
  closeReminderWindow,
  getReminderWindowId,
  handleSnoozeAlarm,
  openReminderWindow,
  pruneOrphanReminderWindows,
  snoozeReminder
} from './reminders.js';

// Eseguito a ogni avvio del service worker (installazione, riavvio del
// browser, risveglio dopo terminazione): chiude eventuali finestre di
// reminder rimaste in giro da sessioni precedenti.
pruneOrphanReminderWindows().catch((error) => {
  console.warn('[gcal-reminder] pulizia finestre orfane fallita', error);
});

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
      const [settings, auth] = await Promise.all([getSettings(), getAuthState()]);
      return {
        ok: true,
        version: chrome.runtime.getManifest().version,
        authenticated: auth.authenticated,
        email: auth.email,
        expired: auth.expired,
        settings
      };
    }

    case MESSAGES.signIn: {
      const authState = await signIn();
      return { ok: true, ...authState, authenticated: true };
    }

    case MESSAGES.signOut: {
      await signOut();
      return { ok: true, authenticated: false };
    }

    case MESSAGES.testReminder: {
      const settings = await getSettings();
      const minutes = Number(message.minutesBefore ?? settings.minutesBefore) || 1;
      // forceNew: un test deve sempre produrre una finestra nuova,
      // altrimenti al secondo click sembra che non funzioni nulla.
      const windowId = await openReminderWindow(buildTestEvent(minutes), { forceNew: true });
      return { ok: true, windowId };
    }

    case MESSAGES.dismissReminder: {
      await closeReminderWindow();
      return { ok: true };
    }

    case MESSAGES.snoozeReminder: {
      const minutes = Number(message.minutes) || SNOOZE_MINUTES;
      return snoozeReminder(minutes);
    }

    default:
      return { ok: false, error: `Messaggio non gestito: ${message?.type}` };
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith(ALARM_SNOOZE_PREFIX)) {
    await handleSnoozeAlarm(alarm.name);
  }
});

// Se l'utente chiude la finestra del reminder a mano, lo stato va ripulito,
// altrimenti il prossimo reminder proverebbe a riusare una finestra morta.
chrome.windows.onRemoved.addListener(async (windowId) => {
  const trackedId = await getReminderWindowId();
  if (trackedId === windowId) {
    await clearReminderState();
  }
});
