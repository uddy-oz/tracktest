const DEBUG_STORAGE_KEY = "stanzer.arenaDebug";
const LEGACY_AUDIO_DEBUG_STORAGE_KEY = "stanzer.arenaAudioDebug";
const CLIENT_ID_STORAGE_KEY = "stanzer.arenaClientId";

function createClientId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `arena-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getArenaClientId() {
  try {
    const storedId = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (storedId) return storedId;

    const nextId = createClientId();
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return createClientId();
  }
}

export function isArenaDebugEnabled() {
  if (import.meta.env.DEV) return true;

  try {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get("stanzerDebug") === "1" ||
      params.get("audioDebug") === "1"
    ) {
      window.localStorage.setItem(DEBUG_STORAGE_KEY, "1");
      return true;
    }

    return (
      window.localStorage.getItem(DEBUG_STORAGE_KEY) === "1" ||
      window.localStorage.getItem(LEGACY_AUDIO_DEBUG_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function logArenaDiagnostic(
  event: string,
  details: Record<string, unknown> = {}
) {
  if (!isArenaDebugEnabled()) return;

  console.info(
    `[STANZER_ARENA] ${JSON.stringify({
      event,
      clientId: getArenaClientId(),
      browserTimeMs: Date.now(),
      timestamp: new Date().toISOString(),
      ...details,
    })}`
  );
}
