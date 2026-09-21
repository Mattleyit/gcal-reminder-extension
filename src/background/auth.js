// Autenticazione Google tramite Chrome Identity API.
//
// Chrome gestisce il ciclo di vita del token: lo tiene in una cache interna e
// ne fa il refresh da solo. L'estensione non vede ne' salva mai un refresh
// token, e non deve scriverlo su disco. Quello che serve qui e':
//
// 1. chiedere il token (silenziosamente quando possibile);
// 2. buttare via dalla cache un token rifiutato e richiederne uno nuovo;
// 3. revocare tutto al logout.
//
// Attenzione al contesto: in stato "Test" sul consent screen Google fa
// scadere l'autorizzazione dopo 7 giorni. Quando succede, la richiesta
// silenziosa fallisce ed e' un caso ATTESO, non un errore da loggare come
// rotto: l'utente va semplicemente invitato a ricollegarsi.

import { STORAGE_KEYS } from './constants.js';

const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// Chiede un token a Chrome.
// interactive: false -> nessuna finestra, fallisce se serve il consenso.
// interactive: true  -> puo' aprire la schermata di consenso Google.
async function requestToken({ interactive }) {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    // A seconda della versione di Chrome ritorna una stringa o un oggetto.
    const token = typeof result === 'string' ? result : result?.token;
    return token || null;
  } catch (error) {
    // Fallimento silenzioso atteso: nessun account collegato, consenso
    // revocato, o autorizzazione scaduta (app in stato Test).
    if (!interactive) return null;
    throw normalizeAuthError(error);
  }
}

function normalizeAuthError(error) {
  const message = String(error?.message || error || '');

  if (/user did not approve|canceled|cancelled/i.test(message)) {
    return new Error('Autorizzazione annullata');
  }
  if (/bad client id|invalid client/i.test(message)) {
    return new Error(
      'Client ID OAuth non valido per questa estensione: controlla che l\u0027Item ID sul client Google corrisponda all\u0027Extension ID'
    );
  }
  if (/network/i.test(message)) {
    return new Error('Nessuna connessione: riprova');
  }
  return new Error(message || 'Autenticazione fallita');
}

// Token valido senza disturbare l'utente. null se serve il consenso.
export async function getTokenSilently() {
  return requestToken({ interactive: false });
}

// Login esplicito: puo' aprire la schermata di consenso.
export async function signIn() {
  const token = await requestToken({ interactive: true });
  if (!token) throw new Error('Autenticazione fallita: nessun token ricevuto');

  const email = await getProfileEmail();
  const authState = { email, connectedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.authState]: authState });

  return authState;
}

// Logout completo: butta il token dalla cache di Chrome, lo revoca lato
// Google (altrimenti resterebbe valido fino alla scadenza) e pulisce lo stato.
// La revoca e' best-effort: se la rete non c'e', il logout locale deve
// comunque riuscire.
export async function signOut() {
  const token = await getTokenSilently();

  if (token) {
    try {
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch (error) {
      console.warn('[gcal-reminder] revoca del token non riuscita', error);
    }

    try {
      await chrome.identity.removeCachedAuthToken({ token });
    } catch (error) {
      console.warn('[gcal-reminder] rimozione dalla cache non riuscita', error);
    }
  }

  try {
    await chrome.identity.clearAllCachedAuthTokens();
  } catch (error) {
    console.warn('[gcal-reminder] clearAllCachedAuthTokens non riuscita', error);
  }

  await chrome.storage.local.remove(STORAGE_KEYS.authState);
}

// Email dell'account collegato, per mostrarla nelle impostazioni.
// Arriva dal permesso identity.email, non dallo scope OAuth: non serve
// chiedere accesso al profilo Google.
async function getProfileEmail() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    return info?.email || null;
  } catch {
    return null;
  }
}

// Stato di autenticazione per popup e options page.
// Verifica che un token sia davvero ottenibile: se il consenso e' stato
// revocato dall'utente su myaccount.google.com, lo stato salvato in storage
// sarebbe bugiardo.
export async function getAuthState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.authState);
  const saved = stored[STORAGE_KEYS.authState] || null;
  const token = await getTokenSilently();

  if (!token) {
    return {
      authenticated: false,
      email: saved?.email || null,
      // true quando c'era una sessione ma non e' piu' valida: la UI puo'
      // dire "ricollegati" invece di "collega", che e' piu' chiaro.
      expired: Boolean(saved)
    };
  }

  if (!saved) {
    const email = await getProfileEmail();
    const authState = { email, connectedAt: Date.now() };
    await chrome.storage.local.set({ [STORAGE_KEYS.authState]: authState });
    return { authenticated: true, email, expired: false };
  }

  return { authenticated: true, email: saved.email, expired: false };
}

// Chiamata autenticata alle API Google.
//
// Un token rifiutato con 401 e' normale: Chrome puo' averne in cache uno
// scaduto. In quel caso lo si butta e si riprova UNA volta. Se il secondo
// tentativo fallisce, il consenso e' davvero da rifare e l'errore viene
// segnalato con requiresSignIn, cosi' il chiamante sa distinguere
// "riprova piu' tardi" da "chiedi all'utente di ricollegarsi".
export async function authFetch(url, options = {}) {
  let token = await getTokenSilently();
  if (!token) throw authRequiredError();

  let response = await fetchWithToken(url, options, token);
  if (response.status !== 401) return response;

  try {
    await chrome.identity.removeCachedAuthToken({ token });
  } catch {
    // Se la rimozione non riesce, il retry fallira' e si ricade nel
    // percorso "serve login": nessun danno.
  }

  token = await getTokenSilently();
  if (!token) throw authRequiredError();

  response = await fetchWithToken(url, options, token);
  if (response.status === 401) throw authRequiredError();

  return response;
}

function fetchWithToken(url, options, token) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
}

function authRequiredError() {
  const error = new Error('Autorizzazione Google scaduta: ricollega l\u0027account');
  error.requiresSignIn = true;
  return error;
}
