const MUTE_STORAGE_KEY = "tracktest_arena_muted";

let audioContext: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem(MUTE_STORAGE_KEY) === "1";
} catch {
  muted = false;
}

function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }

  return audioContext;
}

function tone(
  frequency: number,
  startDelay: number,
  duration: number,
  type: OscillatorType = "sine",
  peakGain = 0.08
) {
  if (muted) {
    return;
  }

  try {
    const context = getAudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startTime = context.currentTime + startDelay;
    const endTime = startTime + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.02);
  } catch {
    // Sound effects are best-effort and should never block gameplay.
  }
}

export const sounds = {
  isMuted() {
    return muted;
  },

  toggleMuted() {
    muted = !muted;

    try {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }

    return muted;
  },

  tick() {
    tone(660, 0, 0.07, "square", 0.045);
  },

  go() {
    tone(784, 0, 0.1, "square", 0.07);
    tone(1175, 0.09, 0.16, "square", 0.07);
  },

  correct() {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(frequency, index * 0.055, 0.09, "triangle", 0.07);
    });
  },

  streak() {
    [659.25, 830.61, 987.77, 1318.5].forEach((frequency, index) => {
      tone(frequency, index * 0.045, 0.08, "square", 0.06);
    });
  },

  wrong() {
    tone(233.08, 0, 0.13, "sawtooth", 0.045);
    tone(196, 0.11, 0.16, "sawtooth", 0.04);
  },

  complete() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(frequency, index * 0.08, 0.14, "triangle", 0.07);
    });
  },

  perfectRun() {
    [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach(
      (frequency, index) => {
        tone(frequency, index * 0.065, 0.16, "triangle", 0.085);
      }
    );
    tone(1046.5, 0.42, 0.24, "square", 0.05);
    tone(1567.98, 0.48, 0.28, "square", 0.045);
  },
};
