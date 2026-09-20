// Gestione della finestra di reminder: apertura, chiusura, snooze.
// Il modulo non sa nulla di Google Calendar: riceve un oggetto evento
// normalizzato, cosi' la fase di polling potra' limitarsi a chiamare
// openReminderWindow() senza toccare questo file.

import { ALARM_SNOOZE_PREFIX, SNOOZE_MINUTES, STORAGE_KEYS } from './constants.js';

const REMINDER_PAGE = 'src/reminder/reminder.html';

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

// Apre il reminder a tutto schermo. Se una finestra e' gia' aperta la riporta
// in primo piano invece di aprirne una seconda: il service worker puo' essere
// terminato in qualsiasi momento, quindi l'id vive in storage.local, non in memoria.
export async function openReminderWindow(rawEvent) {
  const event = normalizeEvent(rawEvent);

  await chrome.storage.local.set({
    [STORAGE_KEYS.activeReminder]: { event, shownAt: Date.now() }
  });

  const existingId = await getReminderWindowId();
  if (existingId !== null) {
    try {
      await chrome.windows.update(existingId, { focused: true, drawAttention: true });
      return existingId;
    } catch {
      // La finestra non esiste piu': si prosegue creandone una nuova.
      await chrome.storage.local.remove(STORAGE_KEYS.reminderWindowId);
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(REMINDER_PAGE),
    type: 'popup',
    state: 'maximized',
    focused: true
  });

  await chrome.storage.local.set({ [STORAGE_KEYS.reminderWindowId]: win.id });
  return win.id;
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
