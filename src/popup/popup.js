import { MESSAGES } from '../background/constants.js';

const versionEl = document.getElementById('version');
const dotEl = document.getElementById('status-dot');
const textEl = document.getElementById('status-text');
const testEl = document.getElementById('test-reminder');

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Reminder di prova a 1 minuto: abbastanza vicino da vedere il countdown
// entrare nell'ultimo minuto senza aspettare.
testEl.addEventListener('click', async () => {
  testEl.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: MESSAGES.testReminder, minutesBefore: 1 });
    window.close();
  } catch (error) {
    console.error('[gcal-reminder] test reminder', error);
    testEl.disabled = false;
  }
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
