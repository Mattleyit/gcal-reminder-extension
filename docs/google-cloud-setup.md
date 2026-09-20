# Google Cloud / OAuth setup

Documentazione della configurazione Google Cloud che alimenta l'autenticazione
dell'estensione. Chiude la issue #5.

Lo stato descritto qui e' **gia' applicato** sul progetto Google Cloud: questo
documento serve a capire com'e' fatto, a rifarlo da zero se serve, e a sapere
cosa toccare quando si passa in produzione.

---

## 1. Valori di riferimento

| Voce | Valore |
| --- | --- |
| Nome progetto GCP | `gcal-reminder-extension` |
| ID progetto GCP | `gcal-reminder-extension-509219` |
| Numero progetto | `185581795549` |
| API abilitata | Google Calendar API (`calendar-json.googleapis.com`) |
| Nome app (consent screen) | GCal Reminder |
| Tipo di utente | Esterno |
| Stato pubblicazione | Test |
| Scope | `https://www.googleapis.com/auth/calendar.readonly` |
| Email assistenza / contatto | `mattleyit@gmail.com` |
| Tipo client OAuth | Estensione di Chrome |
| Nome client OAuth | GCal Reminder Extension |
| **Client ID** | `185581795549-6gq1a8dg02rm5u68c0gg23448u23srjg.apps.googleusercontent.com` |
| **Extension ID** | `ghoaagpljnphhilolmhpbndjhabpfcbo` |

Console del progetto:
<https://console.cloud.google.com/auth/overview?project=gcal-reminder-extension-509219>

---

## 2. Il problema dell'Extension ID, e come e' stato risolto

Un client OAuth di tipo *Estensione di Chrome* e' legato a un **Item ID**: i 32
caratteri (`a`-`p`) che identificano l'estensione. Se l'ID cambia, Google
rifiuta il token e `chrome.identity.getAuthToken` fallisce con
`OAuth2 request failed` / `bad client id`.

Il problema: un'estensione caricata come *unpacked* riceve un ID **derivato dal
percorso della cartella**. Cambi cartella, cambia l'ID. E l'ID definitivo
normalmente lo assegna il Chrome Web Store al primo upload, cioe' molto dopo
il momento in cui servono le credenziali.

Soluzione adottata: **fissare l'ID con una chiave RSA**. Chrome, quando trova
un campo `key` nel manifest, deriva l'ID da quella chiave pubblica invece che
dal percorso. Lo stesso ID viene poi riconosciuto dal Web Store se si carica il
pacchetto firmato con la chiave privata corrispondente.

Risultato: **un solo Extension ID, valido in locale e in produzione**, deciso
prima ancora di scrivere una riga di codice di auth.

### Come si deriva l'ID dalla chiave

```
ID = SHA-256(chiave pubblica DER)[0..15]  ->  esadecimale  ->  0-f mappato su a-p
```

Verifica riproducibile (deve stampare l'Extension ID della tabella sopra):

```bash
node -e '
const fs=require("fs"), crypto=require("crypto");
const key=JSON.parse(fs.readFileSync("manifest.json","utf8")).key;
const der=Buffer.from(key,"base64");
const hash=crypto.createHash("sha256").update(der).digest("hex").slice(0,32);
console.log([...hash].map(c=>String.fromCharCode(parseInt(c,16)+97)).join(""));
'
```

### La chiave privata

La chiave privata (`gcal-reminder-extension.pem`) **non e' nel repo** ed e'
coperta da `.gitignore` (`*.pem`). Serve solo per firmare il pacchetto `.crx`
e per il primo upload sul Chrome Web Store.

Se la chiave privata viene persa, l'Extension ID non e' piu' riproducibile:
va rigenerata la coppia e vanno rifatti sia il campo `key` sia l'Item ID del
client OAuth. Conservala in un password manager, non su disco a caso.

---

## 3. Cosa finisce nel manifest

```json
{
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOC...",
  "oauth2": {
    "client_id": "185581795549-6gq1a8dg02rm5u68c0gg23448u23srjg.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/calendar.readonly"]
  },
  "permissions": ["identity", "..."]
}
```

Tre condizioni devono valere insieme, altrimenti l'auth non parte:

1. `permissions` contiene `identity`;
2. `oauth2.scopes` combacia **esattamente** con gli scope del consent screen;
3. l'ID derivato da `key` combacia con l'Item ID del client OAuth.

Il campo `key` va **rimosso prima dell'upload sul Chrome Web Store**: lo Store
lo rifiuta perche' la chiave la gestisce lui. Va invece tenuto in locale e nel
repo, perche' e' l'unica cosa che rende l'ID stabile in sviluppo.

---

## 4. Rifare il setup da zero

1. **Progetto** - <https://console.cloud.google.com/projectcreate>, nome
   `gcal-reminder-extension`, nessuna organizzazione.
2. **API** - *Libreria* > Google Calendar API > **Abilita**.
3. **Consent screen** - *Google Auth Platform* > **Inizia**:
   nome app `GCal Reminder`, email assistenza, tipo utente **Esterno**,
   email di contatto, accettazione delle Norme relative ai dati utente.
4. **Scope** - *Accesso ai dati* > *Aggiungi o rimuovi ambiti*, filtra
   `calendar.readonly`, seleziona, **Aggiorna**, poi **Save**.
   Compare sotto "ambiti sensibili": e' corretto.
5. **Utenti di prova** - *Pubblico* > *Add users* > la propria email.
   Finche' lo stato e' "Test", solo questi account possono autenticarsi.
6. **Client OAuth** - *Client* > *Crea client*, tipo **Estensione di Chrome**,
   nome `GCal Reminder Extension`, Item ID = l'Extension ID derivato dalla
   chiave. Copia il Client ID in `manifest.json` e in `.env.example`.

Nota: le modifiche al consent screen possono richiedere **da 5 minuti a
qualche ora** per propagarsi. Un `bad client id` subito dopo la creazione non
e' necessariamente un errore di configurazione.

---

## 5. Limiti dello stato attuale

**Modalita' Test.** L'app e' in stato *Test*, non pubblicata. Conseguenze:

- solo gli account nella lista *Utenti di prova* possono autenticarsi
  (massimo 100, conteggiati per l'intera durata dell'app);
- la schermata di consenso mostra l'avviso "app non verificata";
- **il refresh token scade dopo 7 giorni**: passata una settimana l'utente
  deve riautenticarsi. E' il limite piu' rilevante per un'estensione che deve
  girare in background, va tenuto presente nella issue #3, che dovra'
  gestire il token scaduto senza rompere il polling.

**Passaggio in produzione.** Pubblicare l'app richiede, sulla pagina *Branding*:
dominio dell'app, link a privacy policy e termini di servizio, e dominio
verificato in Search Console. Dato che `calendar.readonly` e' uno scope
**sensibile**, serve anche la verifica OAuth da parte di Google (tempi
nell'ordine delle settimane). Finche' l'estensione e' a uso personale,
restare in Test e' la scelta corretta.

---

## 6. Sicurezza: cosa e' segreto e cosa no

| Elemento | Segreto? | Perche' |
| --- | --- | --- |
| Client ID | No | Identificatore pubblico, visibile nel manifest di ogni installazione |
| Client secret | - | Non esiste per i client Chrome Extension: e' un flusso pubblico |
| Campo `key` (pubblica) | No | E' la chiave *pubblica*, sta nel manifest per definizione |
| File `.pem` (privata) | **Si'** | Firma i pacchetti: chi ce l'ha puo' pubblicare aggiornamenti |
| Token OAuth utente | **Si'** | Gestito da Chrome, mai scritto su disco dall'estensione |

Google lega il client all'Extension ID: un Client ID copiato da terzi non e'
utilizzabile da un'estensione con un ID diverso.
