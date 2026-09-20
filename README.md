# gcal-reminder-extension

Chrome extension: fullscreen popup reminder for Google Calendar events. Impossible to miss.

## Setup OAuth

L'estensione usa `chrome.identity.getAuthToken` (Manifest V3) con un solo
scope in sola lettura: `https://www.googleapis.com/auth/calendar.readonly`.

| | |
| --- | --- |
| Progetto Google Cloud | `gcal-reminder-extension-509219` |
| Client ID OAuth | `185581795549-6gq1a8dg02rm5u68c0gg23448u23srjg.apps.googleusercontent.com` |
| Extension ID | `ghoaagpljnphhilolmhpbndjhabpfcbo` |

Entrambi i valori sono gia' in `manifest.json` (`oauth2.client_id` e `key`) e
replicati in `.env.example`. Nessuno dei due e' un segreto.

L'Extension ID e' fissato dal campo `key` del manifest, quindi resta identico
tra caricamento unpacked e Chrome Web Store: puoi spostare la cartella del
progetto senza rompere l'autenticazione.

Dettagli, procedura di ricostruzione e limiti della modalita' Test:
**[docs/google-cloud-setup.md](docs/google-cloud-setup.md)**.

> L'app e' in stato *Test*: possono autenticarsi solo gli account nella lista
> utenti di prova, e il refresh token va rinnovato ogni 7 giorni.
