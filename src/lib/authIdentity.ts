import type { User } from "@supabase/supabase-js";

const GUEST_NAME_KEY = "stanzer.guest.name";
const GUEST_ID_KEY = "stanzer.guest.id";
const INTERNAL_GUEST_ID_PATTERN = /^guest_\d{6}$/i;
const GUEST_ROOM_HANDLE_PREFIX = "temporary_guest:";

export const FRIENDLY_GUEST_NAMES = Object.freeze([
  "Aaliyah",
  "Alex",
  "Amara",
  "Amina",
  "Andre",
  "Ari",
  "Avery",
  "Bella",
  "Caleb",
  "Chloe",
  "Daniel",
  "Dylan",
  "Elijah",
  "Ella",
  "Ethan",
  "Eva",
  "Grace",
  "Isaac",
  "Jade",
  "Jasmine",
  "Jayden",
  "Johnny",
  "Jordan",
  "Kai",
  "Layla",
  "Leo",
  "Liam",
  "Maya",
  "Mia",
  "Naomi",
  "Noah",
  "Nora",
  "Olivia",
  "Owen",
  "Patrick",
  "Ruby",
  "Sam",
  "Sophie",
  "Theo",
  "Zara",
]);

function stableGuestNumber(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function readSessionValue(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function isFriendlyGuestName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    FRIENDLY_GUEST_NAMES.some(
      (name) => name.toLowerCase() === value.trim().toLowerCase()
    )
  );
}

export function isAnonymousUser(user: User | null | undefined) {
  return Boolean(user?.is_anonymous || user?.app_metadata?.provider === "anonymous");
}

export function createGuestId() {
  const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return `guest_${String(digits).padStart(6, "0")}`;
}

export function createGuestName(excludedNames: Iterable<string> = []) {
  const excluded = new Set(
    Array.from(excludedNames, (name) => name.trim().toLowerCase())
  );
  const availableNames = FRIENDLY_GUEST_NAMES.filter(
    (name) => !excluded.has(name.toLowerCase())
  );
  const candidates = availableNames.length > 0 ? availableNames : FRIENDLY_GUEST_NAMES;
  const randomIndex =
    crypto.getRandomValues(new Uint32Array(1))[0] % candidates.length;

  return candidates[randomIndex];
}

export function isInternalGuestId(value: unknown): value is string {
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

export function getFallbackGuestName(guestId: string) {
  return FRIENDLY_GUEST_NAMES[
    stableGuestNumber(guestId.toLowerCase()) % FRIENDLY_GUEST_NAMES.length
  ];
}

export function getGuestName(user?: User | null) {
  const metadataName = user?.user_metadata?.guest_name;
  if (isFriendlyGuestName(metadataName)) {
    return FRIENDLY_GUEST_NAMES.find(
      (name) => name.toLowerCase() === metadataName.trim().toLowerCase()
    ) || metadataName.trim();
  }

  const stored = readSessionValue(GUEST_NAME_KEY);
  if (isFriendlyGuestName(stored)) {
    return FRIENDLY_GUEST_NAMES.find(
      (name) => name.toLowerCase() === stored.trim().toLowerCase()
    ) || stored.trim();
  }

  const guestId = getGuestId(user);
  return guestId ? getFallbackGuestName(guestId) : null;
}

export function getSafeGuestDisplayName(
  displayName: string | null | undefined,
  guestId: string
) {
  const normalizedDisplayName = displayName?.trim();

  if (normalizedDisplayName && !isInternalGuestId(normalizedDisplayName)) {
    return normalizedDisplayName;
  }

  return getFallbackGuestName(guestId);
}

export function resolveUniqueGuestName(
  preferredName: string,
  takenNames: Iterable<string>,
  guestId: string
) {
  const taken = new Set(
    Array.from(takenNames, (name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const normalizedPreferred = preferredName.trim();

  if (normalizedPreferred && !taken.has(normalizedPreferred.toLowerCase())) {
    return normalizedPreferred;
  }

  const startIndex = stableGuestNumber(guestId) % FRIENDLY_GUEST_NAMES.length;

  for (let offset = 0; offset < FRIENDLY_GUEST_NAMES.length; offset += 1) {
    const candidate =
      FRIENDLY_GUEST_NAMES[(startIndex + offset) % FRIENDLY_GUEST_NAMES.length];

    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${getFallbackGuestName(guestId)} ${
    (stableGuestNumber(`${guestId}:suffix`) % 90) + 10
  }`;
}

export function rememberGuestName(name: string) {
  try {
    window.sessionStorage.setItem(GUEST_NAME_KEY, name);
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
