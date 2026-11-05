/**
 * Web Audio API synthesizer for the Movement Hub clinic waiting room chime.
 * Generates a warm, pleasant 3-tone chime (C5 -> E5 -> G5) directly in browser memory.
 * No external MP3 file or network request required — 100% reliable on Smart TVs.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function enableAudioOnFirstInteraction() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

export function playClinicChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Pleasant major triad clinic chime: C5 (523.25 Hz) -> E5 (659.25 Hz) -> G5 (783.99 Hz)
    const tones = [
      { freq: 523.25, time: 0.0, duration: 0.6 },
      { freq: 659.25, time: 0.22, duration: 0.6 },
      { freq: 783.99, time: 0.44, duration: 0.9 },
    ];

    tones.forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + time);

      // Smooth attack & gentle exponential decay
      gain.gain.setValueAtTime(0.0001, now + time);
      gain.gain.linearRampToValueAtTime(0.3, now + time + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + duration);
    });
  } catch (err) {
    console.warn("[TV Audio] Chime play error:", err);
  }
}

