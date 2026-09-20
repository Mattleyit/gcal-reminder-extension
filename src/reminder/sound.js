// Suono di notifica generato con la Web Audio API.
// Niente file audio: un asset binario non e' committabile tramite l'API GitHub
// usata in questo progetto, e due note sintetizzate bastano per un reminder.

const NOTES = [
  { frequency: 880, startAt: 0, duration: 0.18 },
  { frequency: 1320, startAt: 0.22, duration: 0.3 }
];

// Ritorna true se il suono e' partito, false se il browser lo ha bloccato
// (autoplay policy: serve un'interazione dell'utente).
export async function playChime(volume = 0.7) {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return false;

  const ctx = new AudioCtor();

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      await ctx.close();
      return false;
    }
  }

  if (ctx.state !== 'running') {
    await ctx.close();
    return false;
  }

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);

  const peak = Math.min(Math.max(Number(volume) || 0, 0), 1) * 0.35;

  // Due ripetizioni della coppia di note: la prima avvisa, la seconda insiste.
  for (const repeat of [0, 0.75]) {
    for (const note of NOTES) {
      const oscillator = ctx.createOscillator();
      const noteGain = ctx.createGain();
      const startAt = ctx.currentTime + repeat + note.startAt;

      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency;

      // Attacco e rilascio morbidi: un gain "a scatto" produce un click.
      noteGain.gain.setValueAtTime(0, startAt);
      noteGain.gain.linearRampToValueAtTime(peak, startAt + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.duration);

      oscillator.connect(noteGain);
      noteGain.connect(gain);
      oscillator.start(startAt);
      oscillator.stop(startAt + note.duration + 0.05);
    }
  }

  gain.gain.value = 1;

  // Il contesto si chiude da solo a suono finito, per non tenere aperto
  // un AudioContext inutile.
  setTimeout(() => ctx.close().catch(() => {}), 2500);
  return true;
}
