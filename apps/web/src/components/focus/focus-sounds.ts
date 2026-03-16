/* ══════════════════════════════════════════════════════════════
   FOCUS MODE — Sound & Notification Utilities
   ══════════════════════════════════════════════════════════════
   - Web Audio API for lightweight notification sounds
   - Browser Notification API with fallback
   - No external audio files needed
   ══════════════════════════════════════════════════════════════ */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a pleasant chime sound for break time notification.
 * Uses Web Audio API — no file downloads needed.
 */
export function playBreakTimeChime() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Three-note ascending chime (C5 → E5 → G5)
    const notes = [523.25, 659.25, 783.99];
    const noteDuration = 0.3;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.15);

      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.05);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + i * 0.15 + noteDuration,
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + noteDuration + 0.1);
    });

    // Final shimmer
    setTimeout(() => {
      const shimmer = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6
      shimmerGain.gain.setValueAtTime(0.15, ctx.currentTime);
      shimmerGain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + 0.8,
      );
      shimmer.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      shimmer.start();
      shimmer.stop(ctx.currentTime + 1);
    }, 450);
  } catch {
    // Audio context not available — silent fallback
  }
}

/**
 * Play a dice rolling sound effect.
 */
export function playDiceRollSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Rapid clicking noise simulating dice tumble
    for (let i = 0; i < 8; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(200 + Math.random() * 400, now + i * 0.06);

      gain.gain.setValueAtTime(0.08, now + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.05);
    }
  } catch {
    // silent fallback
  }
}

/**
 * Play a celebration/reward reveal sound.
 */
export function playRewardRevealSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Triumphant ascending arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);

      gain.gain.setValueAtTime(0, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.25, now + i * 0.1 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.5);
    });
  } catch {
    // silent fallback
  }
}

/**
 * Request browser notification permission (call once on user interaction).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Send a browser notification for break time.
 */
export function sendBreakTimeNotification() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    new Notification('⏰ Break Time!', {
      body: 'Great focus session! Time to roll the dice and claim your reward.',
      icon: '/logo-engram.webp',
      tag: 'focus-break',
      requireInteraction: false,
    });
  } catch {
    // Notification not supported in this context
  }
}
