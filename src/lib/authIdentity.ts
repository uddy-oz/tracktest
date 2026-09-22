import type { User } from "@supabase/supabase-js";

const GUEST_NAME_KEY = "stanzer.guest.name";

export function isAnonymousUser(user: User | null | undefined) {
  return Boolean(user?.is_anonymous || user?.app_metadata?.provider === "anonymous");
}

export function createGuestName() {
  const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return `guest_${String(digits).padStart(6, "0")}`;
}

export function getGuestName(user?: User | null) {
  const metadataName = user?.user_metadata?.guest_name;
  if (typeof metadataName === "string" && /^guest_\d{6}$/.test(metadataName)) {
    return metadataName;
  }

  try {
    const stored = window.sessionStorage.getItem(GUEST_NAME_KEY);
    return stored && /^guest_\d{6}$/.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function rememberGuestName(name: string) {
  try {
    window.sessionStorage.setItem(GUEST_NAME_KEY, name);
  } catch {
    // Session storage can be blocked in privacy-restricted contexts.
  }
}

export function clearGuestName() {
  try {
    window.sessionStorage.removeItem(GUEST_NAME_KEY);
  } catch {
    // No persistent guest identity is required.
  }
}
