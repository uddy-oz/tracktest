import type { User } from "@supabase/supabase-js";

const GUEST_NAME_KEY = "stanzer.guest.name";
const GUEST_ID_KEY = "stanzer.guest.id";
const INTERNAL_GUEST_ID_PATTERN = /^guest_\d{6}$/i;
const GUEST_ROOM_HANDLE_PREFIX = "temporary_guest:";
type InternalGuestId = `guest_${string}`;
export const GUEST_DISPLAY_NAME_MIN_LENGTH = 2;
export const GUEST_DISPLAY_NAME_MAX_LENGTH = 24;

const GUEST_DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u;
const RESERVED_GUEST_NAMES = new Set([
  "admin",
  "moderator",
  "stanzer",
  "support",
  "system",
]);

function readSessionValue(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function normalizeGuestDisplayName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function validateGuestDisplayName(value: string) {
  const normalized = normalizeGuestDisplayName(value);

  if (!normalized) {
    return { ok: false as const, error: "Enter a name to continue.", value: "" };
  }

  if (normalized.length < GUEST_DISPLAY_NAME_MIN_LENGTH) {
    return {
      ok: false as const,
      error: `Use at least ${GUEST_DISPLAY_NAME_MIN_LENGTH} characters.`,
      value: normalized,
    };
  }

  if (normalized.length > GUEST_DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false as const,
      error: `Keep your name to ${GUEST_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`,
      value: normalized,
    };
  }

  if (isInternalGuestId(normalized)) {
    return {
      ok: false as const,
      error: "Choose a player name instead of an internal guest ID.",
      value: normalized,
    };
  }

  if (!GUEST_DISPLAY_NAME_PATTERN.test(normalized)) {
    return {
      ok: false as const,
      error: "Use letters, numbers, spaces, apostrophes, periods, or hyphens only.",
      value: normalized,
    };
  }

  if (RESERVED_GUEST_NAMES.has(normalized.toLowerCase())) {
    return {
      ok: false as const,
      error: "That name is reserved. Choose another player name.",
      value: normalized,
    };
  }

  return { ok: true as const, error: "", value: normalized };
}

export function isAnonymousUser(user: User | null | undefined) {
  return Boolean(user?.is_anonymous || user?.app_metadata?.provider === "anonymous");
}

export function createGuestId() {
  const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return `guest_${String(digits).padStart(6, "0")}`;
}

export function isInternalGuestId(value: unknown): value is InternalGuestId {
  return typeof value === "string" && INTERNAL_GUEST_ID_PATTERN.test(value.trim());
}

export function createGuestRoomHandle(guestId: string) {
  return `${GUEST_ROOM_HANDLE_PREFIX}${guestId.toLowerCase()}`;
}

export function getGuestIdFromRoomHandle(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.toLowerCase().startsWith(GUEST_ROOM_HANDLE_PREFIX)
  ) {
    return null;
  }

  const guestId = value.slice(GUEST_ROOM_HANDLE_PREFIX.length);
  return isInternalGuestId(guestId) ? guestId.toLowerCase() : null;
}

export function getGuestId(user?: User | null) {
  const metadataId = user?.user_metadata?.guest_id;
  if (isInternalGuestId(metadataId)) {
    return metadataId.toLowerCase();
  }

  const legacyMetadataName = user?.user_metadata?.guest_name;
  if (isInternalGuestId(legacyMetadataName)) {
    return legacyMetadataName.toLowerCase();
  }

  const storedId = readSessionValue(GUEST_ID_KEY);
  if (isInternalGuestId(storedId)) {
    return storedId.toLowerCase();
  }

  const legacyStoredName = readSessionValue(GUEST_NAME_KEY);
  return isInternalGuestId(legacyStoredName)
    ? legacyStoredName.toLowerCase()
    : null;
}

export function getFallbackGuestName() {
  return "Guest Player";
}

export function getGuestName(user?: User | null) {
  if (user && user.user_metadata?.guest_name_source !== "player") {
    return null;
  }

  const metadataNames = [
    user?.user_metadata?.guest_name,
    user?.user_metadata?.display_name,
  ];

  for (const metadataName of metadataNames) {
    if (typeof metadataName !== "string") continue;
    const validation = validateGuestDisplayName(metadataName);
    if (validation.ok) return validation.value;
  }

  const stored = readSessionValue(GUEST_NAME_KEY);
  if (stored) {
    const validation = validateGuestDisplayName(stored);
    if (validation.ok) return validation.value;
  }

  return null;
}

export function getSafeGuestDisplayName(
  displayName: string | null | undefined
) {
  if (displayName) {
    const validation = validateGuestDisplayName(displayName);
    if (validation.ok) return validation.value;
  }

  return getFallbackGuestName();
}

export function resolveUniqueGuestName(
  preferredName: string,
  takenNames: Iterable<string>
) {
  const taken = new Set(
    Array.from(takenNames, (name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const validation = validateGuestDisplayName(preferredName);
  const normalizedPreferred = validation.ok
    ? validation.value
    : getFallbackGuestName();

  if (normalizedPreferred && !taken.has(normalizedPreferred.toLowerCase())) {
    return normalizedPreferred;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const suffixText = ` ${suffix}`;
    const availableBaseLength = GUEST_DISPLAY_NAME_MAX_LENGTH - suffixText.length;
    const candidate = `${normalizedPreferred.slice(0, availableBaseLength).trim()}${suffixText}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    suffix += 1;
  }

  return "Guest Player";
}

export function rememberGuestName(name: string) {
  const validation = validateGuestDisplayName(name);
  if (!validation.ok) return;

  try {
    window.sessionStorage.setItem(GUEST_NAME_KEY, validation.value);
  } catch {
    // Session storage can be blocked in privacy-restricted contexts.
  }
}

export function rememberGuestId(guestId: string) {
  try {
    window.sessionStorage.setItem(GUEST_ID_KEY, guestId);
  } catch {
    // Session storage can be blocked in privacy-restricted contexts.
  }
}

export function rememberGuestIdentity(guestId: string, name: string) {
  rememberGuestId(guestId);
  rememberGuestName(name);
}

export function clearGuestName() {
  try {
    window.sessionStorage.removeItem(GUEST_NAME_KEY);
    window.sessionStorage.removeItem(GUEST_ID_KEY);
  } catch {
    // No persistent guest identity is required.
  }
}
