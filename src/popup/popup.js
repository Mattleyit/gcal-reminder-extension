import { MESSAGES } from '../background/constants.js';

const versionEl = document.getElementById('version');
const dotEl = document.getElementById('status-dot');
const textEl = document.getElementById('status-text');

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function render() {
  try {
    const status = await chrome.runtime.sendMessage({ type: MESSAGES.getStatus });
    if (!status?.ok) throw new Error(status?.error || 'risposta non valida');

    versionEl.textContent = `v${status.version}`;

    if (status.authenticated) {
      dotEl.className = 'dot dot--ok';
      textEl.textContent = `Attivo, reminder ${status.settings.minutesBefore} min prima`;
    } else {
      dotEl.className = 'dot dot--warn';
      textEl.textContent = 'Account Google non collegato';
    }
  } catch (error) {
    dotEl.className = 'dot dot--warn';
    textEl.textContent = 'Service worker non raggiungibile';
    console.error('[gcal-reminder] popup', error);
  }
}

render();
