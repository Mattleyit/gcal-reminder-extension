// Gestione della finestra di reminder: apertura, chiusura, snooze.
// Il modulo non sa nulla di Google Calendar: riceve un oggetto evento
// normalizzato, cosi' la fase di polling potra' limitarsi a chiamare
// openReminderWindow() senza toccare questo file.

import { ALARM_SNOOZE_PREFIX, SNOOZE_MINUTES, STORAGE_KEYS } from './constants.js';

const REMINDER_PAGE = 'src/reminder/reminder.html';

// Dimensioni minime accettabili. Sotto questa soglia la finestra e' da
// considerare degenerata: Chrome a volte crea popup di pochi pixel quando
// non riceve bounds espliciti.
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

// Fallback usato quando non si riesce a stimare lo spazio disponibile.
const FALLBACK_BOUNDS = { left: 0, top: 0, width: 1280, height: 800 };

// Riconosce i link delle piattaforme di meeting piu' comuni dentro a un testo.
const MEETING_PATTERNS = [
  { label: 'Google Meet', regex: /https:\/\/meet\.google\.com\/[a-z0-9-]+/i },
  { label: 'Zoom', regex: /https:\/\/[a-z0-9.-]*zoom\.us\/j\/[^\s<>"]+/i },
  { label: 'Microsoft Teams', regex: /https:\/\/teams\.microsoft\.com\/[^\s<>"]+/i }
];

// Un evento normalizzato ha questa forma:
// { id, title, startISO, meetingUrl, meetingLabel }
export function normalizeEvent(raw) {
  const meeting = findMeetingLink(raw);
  return {
    id: raw.id || `event-${Date.now()}`,
    title: raw.summary || raw.title || 'Evento senza titolo',
    startISO: raw.startISO || raw.start?.dateTime || null,
    meetingUrl: meeting?.url || null,
    meetingLabel: meeting?.label || null
  };
}

// Cerca il link del meeting nei campi dove Google Calendar lo mette,
// in ordine di affidabilita': campo dedicato, poi conferenza, poi testo libero.
export function findMeetingLink(raw) {
  if (raw.meetingUrl) {
    return { url: raw.meetingUrl, label: raw.meetingLabel || labelFor(raw.meetingUrl) };
  }

  if (raw.hangoutLink) {
    return { url: raw.hangoutLink, label: 'Google Meet' };
  }

  const entryPoint = raw.conferenceData?.entryPoints?.find(
    (point) => point.entryPointType === 'video' && point.uri
  );
  if (entryPoint) {
    return { url: entryPoint.uri, label: raw.conferenceData?.conferenceSolution?.name || labelFor(entryPoint.uri) };
  }

  const haystack = `${raw.location || ''}\n${raw.description || ''}`;
  for (const { label, regex } of MEETING_PATTERNS) {
    const match = haystack.match(regex);
    if (match) return { url: match[0], label };
  }

  return null;
}

function labelFor(url) {
  const found = MEETING_PATTERNS.find(({ regex }) => regex.test(url));
  return found ? found.label : 'Apri link';
}

export function reminderPageUrl() {
  return chrome.runtime.getURL(REMINDER_PAGE);
}

// Stima l'area utile dello schermo dalle finestre Chrome gia' aperte.
// Non serve il permesso `system.display`: basta il rettangolo che le
// contiene tutte, che approssima bene il desktop.
async function estimateBounds() {
  try {
    const windows = await chrome.windows.getAll();
    const usable = windows.filter(
      (win) => win.type === 'normal' && typeof win.width === 'number' && win.width >= MIN_WIDTH
    );
    if (usable.length === 0) return { ...FALLBACK_BOUNDS };

    const right = Math.max(...usable.map((win) => (win.left || 0) + win.width));
    const bottom = Math.max(...usable.map((win) => (win.top || 0) + win.height));

    return {
      left: 0,
      top: 0,
      width: Math.max(MIN_WIDTH, right),
      height: Math.max(MIN_HEIGHT, bottom)
    };
  } catch {
    return { ...FALLBACK_BOUNDS };
  }
}

// Apre il reminder a tutto schermo.
//
// Nota importante: `state: 'maximized'` passato direttamente a
// chrome.windows.create NON e' affidabile (su macOS viene ignorato e la
// finestra nasce di pochi pixel, invisibile). La sequenza corretta e':
// creare con bounds espliciti, poi massimizzare con una update separata,
// poi verificare le dimensioni reali e correggerle se sono degenerate.
export async function openReminderWindow(rawEvent, { forceNew = false } = {}) {
  const event = normalizeEvent(rawEvent);
  const existingId = await getReminderWindowId();

  // Stesso evento e finestra viva: la si riporta davanti invece di
  // aprirne una seconda. Un evento diverso (o un test) rimpiazza.
  if (existingId !== null) {
    const existing = await getWindowOrNull(existingId);
    const stored = await chrome.storage.local.get(STORAGE_KEYS.activeReminder);
    const sameEvent = stored[STORAGE_KEYS.activeReminder]?.event?.id === event.id;

    if (existing && sameEvent && !forceNew) {
      await bringToFront(existingId);
      return existingId;
    }

    if (existing) {
      try {
        await chrome.windows.remove(existingId);
      } catch {
        // Gia' chiusa: nessun problema.
      }
    }
    await chrome.storage.local.remove(STORAGE_KEYS.reminderWindowId);
  }

  // I dati vanno in storage prima di aprire: la pagina li legge all'avvio.
  await chrome.storage.local.set({
    [STORAGE_KEYS.activeReminder]: { event, shownAt: Date.now() }
  });

  const bounds = await estimateBounds();
  const win = await chrome.windows.create({
    url: reminderPageUrl(),
    type: 'popup',
    focused: true,
    ...bounds
  });

  await chrome.storage.local.set({ [STORAGE_KEYS.reminderWindowId]: win.id });
  await maximizeAndVerify(win.id, bounds);
  return win.id;
}

// Massimizza e controlla il risultato. Se Chrome ha comunque prodotto una
// finestra degenerata, riapplica i bounds espliciti: meglio una finestra
// grande ma non massimizzata che una invisibile.
async function maximizeAndVerify(windowId, bounds) {
  try {
    await chrome.windows.update(windowId, { state: 'maximized', focused: true, drawAttention: true });
  } catch (error) {
    console.warn('[gcal-reminder] maximize fallito', error);
  }

  const current = await getWindowOrNull(windowId);
  if (!current) return;

  const tooSmall = (current.width || 0) < MIN_WIDTH || (current.height || 0) < MIN_HEIGHT;
  if (!tooSmall) return;

  console.warn('[gcal-reminder] finestra degenerata', current.width, 'x', current.height, '- riapplico i bounds');
  try {
    await chrome.windows.update(windowId, { state: 'normal', ...bounds, focused: true });
  } catch (error) {
    console.error('[gcal-reminder] impossibile ridimensionare la finestra', error);
  }
}

async function bringToFront(windowId) {
  try {
    await chrome.windows.update(windowId, { focused: true, drawAttention: true, state: 'maximized' });
  } catch {
    await chrome.storage.local.remove(STORAGE_KEYS.reminderWindowId);
  }
}

async function getWindowOrNull(windowId) {
  try {
    return await chrome.windows.get(windowId);
  } catch {
    return null;
  }
}

export async function getReminderWindowId() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.reminderWindowId);
  const id = stored[STORAGE_KEYS.reminderWindowId];
  return typeof id === 'number' ? id : null;
}

// Chiude la finestra e pulisce lo stato. Usata sia dal Dismiss sia dallo Snooze.
export async function closeReminderWindow() {
  const id = await getReminderWindowId();
  if (id !== null) {
    try {
      await chrome.windows.remove(id);
    } catch {
      // Gia' chiusa dall'utente: nessun problema.
    }
  }
  await clearReminderState();
}

export async function clearReminderState() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.activeReminder,
    STORAGE_KEYS.reminderWindowId
  ]);
}

// Chiude le finestre di reminder rimaste orfane (per esempio create troppo
// piccole per essere cliccate, o sopravvissute a un riavvio del service
// worker). Salta quella attualmente tracciata, che e' legittima.
export async function pruneOrphanReminderWindows() {
  const trackedId = await getReminderWindowId();
  let windows;
  try {
    windows = await chrome.windows.getAll({ populate: true });
  } catch {
    return 0;
  }

  const pageUrl = reminderPageUrl();
  let closed = 0;

  for (const win of windows) {
    if (win.id === trackedId) continue;
    const isReminder = (win.tabs || []).some((tab) => (tab.url || tab.pendingUrl || '').startsWith(pageUrl));
    if (!isReminder) continue;

    try {
      await chrome.windows.remove(win.id);
      closed += 1;
    } catch {
      // Niente da fare: si prosegue con le altre.
    }
  }

  if (closed > 0) {
    console.log('[gcal-reminder] chiuse', closed, 'finestre reminder orfane');
  }
  return closed;
}

// Rimanda il reminder: salva l'evento e programma un alarm dedicato.
// L'evento viene messo in storage.local perche' gli alarm non possono
// trasportare dati.
export async function snoozeReminder(minutes = SNOOZE_MINUTES) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.activeReminder);
  const active = stored[STORAGE_KEYS.activeReminder];
  if (!active?.event) {
    await closeReminderWindow();
    return { ok: false, error: 'Nessun reminder attivo da rimandare' };
  }

  const alarmName = `${ALARM_SNOOZE_PREFIX}${active.event.id}`;
  const snoozedStore = await chrome.storage.local.get(STORAGE_KEYS.snoozed);
  const snoozed = snoozedStore[STORAGE_KEYS.snoozed] || {};
  snoozed[alarmName] = active.event;

  await chrome.storage.local.set({ [STORAGE_KEYS.snoozed]: snoozed });
  await chrome.alarms.create(alarmName, { when: Date.now() + minutes * 60 * 1000 });
  await closeReminderWindow();

  return { ok: true, minutes };
}

// Chiamata dal listener degli alarm nel service worker.
export async function handleSnoozeAlarm(alarmName) {
  const snoozedStore = await chrome.storage.local.get(STORAGE_KEYS.snoozed);
  const snoozed = snoozedStore[STORAGE_KEYS.snoozed] || {};
  const event = snoozed[alarmName];
  if (!event) return;

  delete snoozed[alarmName];
  await chrome.storage.local.set({ [STORAGE_KEYS.snoozed]: snoozed });
  await openReminderWindow(event);
}

// Evento finto usato dal bottone "Test" della options page e durante lo sviluppo,
// finche' il polling del calendario non e' implementato.
export function buildTestEvent(minutesBefore = 1) {
  const start = new Date(Date.now() + minutesBefore * 60 * 1000);
  return {
    id: `test-${start.getTime()}`,
    title: 'Reminder di prova',
    startISO: start.toISOString(),
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    meetingLabel: 'Google Meet'
  };
}
