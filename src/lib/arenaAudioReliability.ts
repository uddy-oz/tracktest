export type ArenaAudioFailureReason =
  | "AUTOPLAY_LOCK"
  | "PREVIEW_HTTP_FAILURE"
  | "METADATA_TIMEOUT"
  | "CANPLAY_TIMEOUT"
  | "MEDIA_NETWORK_ERROR"
  | "MEDIA_DECODE_ERROR"
  | "SEEK_TIMEOUT"
  | "BUFFER_TIMEOUT"
  | "PLAY_PROMISE_REJECTED"
  | "NO_PLAYBACK_MOVEMENT"
  | "STALE_ROUND"
  | "STALE_GENERATION"
  | "CLIENT_DISCONNECTED"
  | "PLAYER_LEFT"
  | "SERVER_PHASE_ADVANCED"
  | "REALTIME_MISSED"
  | "SERVER_STATE_CHANGED"
  | "UNKNOWN";

export function getArenaPrefetchKey(
  previewUrl: string,
  clipStartSeconds: number
) {
  return `${previewUrl}::${Math.max(0, clipStartSeconds).toFixed(3)}`;
}

export function classifyArenaAudioFailure(
  message: string,
  options: {
    errorName?: string;
    mediaErrorCode?: number | null;
    online?: boolean;
  } = {}
): ArenaAudioFailureReason {
  const normalized = `${options.errorName || ""} ${message}`.toLowerCase();
  if (options.online === false) return "CLIENT_DISCONNECTED";
  if (normalized.includes("player left")) return "PLAYER_LEFT";
  if (normalized.includes("realtime")) return "REALTIME_MISSED";
  if (normalized.includes("server phase advanced")) {
    return "SERVER_PHASE_ADVANCED";
  }
  if (normalized.includes("notallowed") || normalized.includes("autoplay")) {
    return "AUTOPLAY_LOCK";
  }
  if (options.mediaErrorCode === 2 || normalized.includes("http")) {
    return "PREVIEW_HTTP_FAILURE";
  }
  if (normalized.includes("network")) {
    return "MEDIA_NETWORK_ERROR";
  }
  if (options.mediaErrorCode === 3 || normalized.includes("decode")) {
    return "MEDIA_DECODE_ERROR";
  }
  if (normalized.includes("metadata")) return "METADATA_TIMEOUT";
  if (normalized.includes("canplay")) return "CANPLAY_TIMEOUT";
  if (normalized.includes("seek")) return "SEEK_TIMEOUT";
  if (
    normalized.includes("buffer") ||
    normalized.includes("playable") ||
    normalized.includes("stalled") ||
    normalized.includes("waiting")
  ) {
    return "BUFFER_TIMEOUT";
  }
  if (normalized.includes("play()") || normalized.includes("play promise")) {
    return "PLAY_PROMISE_REJECTED";
  }
  if (normalized.includes("did not advance") || normalized.includes("movement")) {
    return "NO_PLAYBACK_MOVEMENT";
  }
  if (normalized.includes("stale generation")) return "STALE_GENERATION";
  if (normalized.includes("stale")) return "STALE_ROUND";
  if (normalized.includes("server") || normalized.includes("phase")) {
    return "SERVER_STATE_CHANGED";
  }
  return "UNKNOWN";
}
