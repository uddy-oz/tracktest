export const SOLO_AUDIO_START_TIMEOUT_MS = 6000;
export const SOLO_AUDIO_STALL_TIMEOUT_MS = 1800;
export const SOLO_CLIP_SECONDS = 5;
export const SOLO_MAX_AUDIO_REPLACEMENTS = 2;

export function getSoloReserveTrack<T extends { id: string; name: string; previewUrl?: string | null }>(
  tracks: readonly T[], scheduled: readonly T[], retired: readonly T[]
) {
  if (retired.length >= SOLO_MAX_AUDIO_REPLACEMENTS) return undefined;
  const used = [...scheduled, ...retired];
  return tracks.find(track => track.previewUrl && !used.some(previous =>
    previous.id === track.id || previous.name.trim().toLowerCase() === track.name.trim().toLowerCase()
  ));
}

export function chooseSoloClipOffset(duration: number, random = Math.random()) {
  const latest = Math.max(0, (Number.isFinite(duration) ? duration : 0) - SOLO_CLIP_SECONDS);
  const preferredEnd = Math.min(22, latest);
  if (preferredEnd >= 6) return 6 + random * (preferredEnd - 6);
  return latest > 1 ? 1 + random * (latest - 1) : 0;
}

export function hasSoloAudioAdvanced(audio: Pick<HTMLAudioElement, "paused" | "seeking" | "readyState" | "currentTime">, offset: number) {
  return !audio.paused && !audio.seeking && audio.readyState >= 2 &&
    audio.currentTime > offset + 0.015;
}

type AudioStart = "playing" | "blocked" | "failed" | "timeout" | "aborted";

export function startSoloAudio(
  audio: HTMLAudioElement,
  signal: AbortSignal,
  timeoutMs = SOLO_AUDIO_START_TIMEOUT_MS
): Promise<AudioStart> {
  if (signal.aborted) return Promise.resolve("aborted");

  return new Promise((resolve) => {
    let baseline: number | undefined;
    function finish(result: AudioStart) {
      clearInterval(poll);
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      audio.removeEventListener("error", fail);
      audio.removeEventListener("ended", fail);
      resolve(result);
    }
    const abort = () => finish("aborted");
    const fail = () => finish("failed");
    const poll = setInterval(() => {
      if (audio.paused || audio.seeking || audio.readyState < 2) {
        baseline = undefined;
        return;
      }
      baseline ??= audio.currentTime;
      if (hasSoloAudioAdvanced(audio, baseline)) finish("playing");
    }, 25);
    const timeout = setTimeout(() => finish("timeout"), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    audio.addEventListener("error", fail, { once: true });
    audio.addEventListener("ended", fail, { once: true });

    // Do not await preparation before calling play on a Safari retry gesture.
    try {
      void audio.play().catch((error: { name?: string }) => {
        finish(error?.name === "NotAllowedError" ? "blocked" : "failed");
      });
    } catch {
      finish("failed");
    }
  });
}

export function waitForSoloMetadata(audio: HTMLAudioElement, signal: AbortSignal): Promise<"ready" | "failed" | "timeout" | "aborted"> {
  if (signal.aborted) return Promise.resolve("aborted");
  if (audio.error) return Promise.resolve("failed");
  if (audio.readyState >= 1) return Promise.resolve("ready");
  return new Promise((resolve) => {
    function finish(result: "ready" | "failed" | "timeout" | "aborted") {
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      resolve(result);
    }
    const loaded = () => finish("ready");
    const failed = () => finish("failed");
    const aborted = () => finish("aborted");
    const timer = setTimeout(() => finish("timeout"), SOLO_AUDIO_START_TIMEOUT_MS);
    audio.addEventListener("loadedmetadata", loaded, { once: true });
    audio.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}
