import { DEFAULT_SETTINGS, MESSAGES, SNOOZE_MINUTES, STORAGE_KEYS } from '../background/constants.js';
import { playChime } from './sound.js';

const card = document.getElementById('card');
const eyebrowEl = document.getElementById('eyebrow');
const titleEl = document.getElementById('title');
const startTimeEl = document.getElementById('start-time');
const countdownEl = document.getElementById('countdown');
const joinEl = document.getElementById('join');
const snoozeEl = document.getElementById('snooze');
const dismissEl = document.getElementById('dismiss');
const soundHintEl = document.getElementById('sound-hint');

let startTimestamp = null;
let tickHandle = null;

init();

async function init() {
  const [localStore, syncStore] = await Promise.all([
    chrome.storage.local.get(STORAGE_KEYS.activeReminder),
    chrome.storage.sync.get(STORAGE_KEYS.settings)
  ]);

  const active = localStore[STORAGE_KEYS.activeReminder];
  const settings = { ...DEFAULT_SETTINGS, ...(syncStore[STORAGE_KEYS.settings] || {}) };

  if (!active?.event) {
    // Nessun dato: la finestra e' rimasta orfana, meglio chiuderla
    // che mostrare un reminder vuoto.
    titleEl.textContent = 'Nessun reminder attivo';
    countdownEl.textContent = '--:--';
    return;
  }

  render(active.event);
  wireActions();

  if (settings.soundEnabled) {
    const played = await playChime(settings.volume);
    // Chrome puo' bloccare l'audio senza interazione utente: in quel caso
    // si mostra un bottone invece di restare in silenzio senza spiegazioni.
    soundHintEl.hidden = played;
    if (!played) {
      soundHintEl.addEventListener('click', async () => {
        await playChime(settings.volume);
        soundHintEl.hidden = true;
      });
    }
  }
}

function render(event) {
  document.title = `${event.title} sta per iniziare`;
  titleEl.textContent = event.title;

  startTimestamp = event.startISO ? new Date(event.startISO).getTime() : null;

  if (startTimestamp) {
    const formatted = new Date(startTimestamp).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    });
    startTimeEl.textContent = `Inizio alle ${formatted}`;
  } else {
    startTimeEl.textContent = 'Orario di inizio non disponibile';
  }

  if (event.meetingUrl) {
    joinEl.hidden = false;
    joinEl.href = event.meetingUrl;
    joinEl.textContent = `Entra su ${event.meetingLabel || 'meeting'}`;
  }

  tick();
  tickHandle = setInterval(tick, 500);
}

function tick() {
  if (!startTimestamp) {
    countdownEl.textContent = '--:--';
    return;
  }

  const remaining = startTimestamp - Date.now();

  if (remaining <= 0) {
    card.classList.add('is-late');
    card.classList.remove('is-soon');
    eyebrowEl.textContent = 'Gia\u0027 iniziato';
    countdownEl.textContent = `+${formatDuration(-remaining)}`;
    return;
  }

  card.classList.toggle('is-soon', remaining <= 60 * 1000);
  eyebrowEl.textContent = 'Sta per iniziare';
  countdownEl.textContent = formatDuration(remaining);
}

// mm:ss sotto l'ora, hh:mm:ss sopra. I secondi non sparaiscono mai:
// sono loro a dare il senso di urgenza.
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function wireActions() {
  joinEl.addEventListener('click', async (clickEvent) => {
    clickEvent.preventDefault();
    await chrome.tabs.create({ url: joinEl.href, active: true });
    await closeWithMessage(MESSAGES.dismissReminder);
  });

  dismissEl.addEventListener('click', () => closeWithMessage(MESSAGES.dismissReminder));

  snoozeEl.addEventListener('click', () =>
    closeWithMessage(MESSAGES.snoozeReminder, { minutes: SNOOZE_MINUTES })
  );
}

async function closeWithMessage(type, extra = {}) {
  clearInterval(tickHandle);
  try {
    await chrome.runtime.sendMessage({ type, ...extra });
  } catch (error) {
    console.error('[gcal-reminder] invio messaggio fallito', error);
  }
  // Se il service worker non ha chiuso la finestra, la si chiude da qui:
  // il popup non deve mai restare bloccato sullo schermo.
  window.close();
}
