/** Buzz, beep and speech for ride mode. Every call is safe to make on a device that lacks the feature. */
let ctx: AudioContext | null = null;

/** Create the audio context from a tap (browsers only allow sound after one). */
export function primeAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    void ctx.resume?.();
  } catch { /* no audio */ }
}

export const vibrate = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* unsupported (iPhone) */ } };

export function beep(times = 1, freq = 880) {
  try {
    if (!ctx) return;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.type = "sine";
      const t = ctx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.22);
    }
  } catch { /* no audio */ }
}

export function speak(text: string) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch { /* no speech */ }
}
