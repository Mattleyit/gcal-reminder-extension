# Icone

Qui vanno `icon16.png`, `icon48.png` e `icon128.png`.

I file binari non possono essere committati tramite l'API usata per aprire questa PR:
vengono caricati a mano (GitHub web: *Add file > Upload files*) e la chiave `icons`
viene aggiunta al `manifest.json` con un commit successivo sullo stesso branch.

Finche' la chiave `icons` non e' presente nel manifest, Chrome usa l'icona di default
e l'estensione si carica senza errori.
