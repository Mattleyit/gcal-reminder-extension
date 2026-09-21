import { MESSAGES } from '../background/constants.js';

const versionEl = document.getElementById('version');
const dotEl = document.getElementById('status-dot');
const textEl = document.getElementById('status-text');
const errorEl = document.getElementById('error');
const signInEl = document.getElementById('sign-in');
const signOutEl = document.getElementById('sign-out');
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
    showError(error);
    testEl.disabled = false;
  }
});

signInEl.addEventListener('click', async () => {
  setBusy(signInEl, 'Apertura consenso Google...');
  try {
    const result = await chrome.runtime.sendMessage({ type: MESSAGES.signIn });
    if (!result?.ok) throw new Error(result?.error || 'autenticazione fallita');
    hideError();
    await render();
  } catch (error) {
    showError(error);
  } finally {
    clearBusy(signInEl, 'Collega Google Calendar');
  }
});

signOutEl.addEventListener('click', async () => {
  setBusy(signOutEl, 'Scollegamento...');
  try {
    const result = await chrome.runtime.sendMessage({ type: MESSAGES.signOut });
    if (!result?.ok) throw new Error(result?.error || 'logout fallito');
    hideError();
    await render();
  } catch (error) {
    showError(error);
  } finally {
    clearBusy(signOutEl, 'Scollega account');
  }
});

async function render() {
  try {
    const status = await chrome.runtime.sendMessage({ type: MESSAGES.getStatus });
    if (!status?.ok) throw new Error(status?.error || 'risposta non valida');

    versionEl.textContent = `v${status.version}`;

    if (status.authenticated) {
      dotEl.className = 'dot dot--ok';
      textEl.textContent = status.email
        ? `${status.email} - reminder ${status.settings.minutesBefore} min prima`
        : `Attivo, reminder ${status.settings.minutesBefore} min prima`;
      signInEl.hidden = true;
      signOutEl.hidden = false;
      return;
    }

    dotEl.className = 'dot dot--warn';
    // "Ricollega" invece di "collega" quando c'era una sessione: in stato
    // Test l'autorizzazione Google scade dopo 7 giorni, e sapere che e'
    // normale evita di pensare che l'estensione sia rotta.
    textEl.textContent = status.expired
      ? 'Autorizzazione Google scaduta, ricollega l\u0027account'
      : 'Account Google non collegato';
    signInEl.hidden = false;
    signInEl.textContent = status.expired ? 'Ricollega Google Calendar' : 'Collega Google Calendar';
    signOutEl.hidden = true;
  } catch (error) {
    dotEl.className = 'dot dot--error';
    textEl.textContent = 'Service worker non raggiungibile';
    showError(error);
  }
}

function setBusy(button, label) {
  button.dataset.label = button.textContent;
  button.textContent = label;
  button.disabled = true;
}

function clearBusy(button, fallbackLabel) {
  button.textContent = button.dataset.label || fallbackLabel;
  button.disabled = false;
}

function showError(error) {
  errorEl.textContent = String(error?.message || error);
  errorEl.hidden = false;
  console.error('[gcal-reminder] popup', error);
}

function hideError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

render();
