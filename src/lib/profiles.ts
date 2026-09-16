import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type UserProfile = {
  id: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
};

export type ProfileDisplayInfo = {
  userId: string;
  username: string | null;
  displayName: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
};

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "tracktest",
  "support",
  "moderator",
  "null",
  "undefined",
]);

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string) {
  const normalizedUsername = normalizeUsername(username);

  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    return {
      ok: false,
      username: normalizedUsername,
      message:
        "Username must be 3 to 20 characters using lowercase letters, numbers, or underscores.",
    };
  }

  if (RESERVED_USERNAMES.has(normalizedUsername)) {
    return {
      ok: false,
      username: normalizedUsername,
      message: "That username is reserved. Pick another Arena handle.",
    };
  }

  return {
    ok: true,
    username: normalizedUsername,
    message: "",
  };
}

export async function checkUsernameAvailability(usernameInput: string, userId?: string) {
  if (!supabase) {
    return { available: false, message: "Supabase is not configured yet." };
  }

  const validation = validateUsername(usernameInput);

  if (!validation.ok) {
    return { available: false, message: validation.message };
  }

  // The profiles table is owner-only. The public profile view exposes only
  // leaderboard-safe display fields, so it can check availability before a
  // user has completed signup without exposing email addresses.
  const { data, error } = await supabase
    .from("public_profile_summary")
    .select("user_id, username")
    .eq("username", validation.username)
    .limit(1);

  if (error) {
    return { available: false, message: "Could not check username yet." };
  }

  return {
    available: (data || []).every((row) => row.user_id === userId),
    message:
      (data || []).every((row) => row.user_id === userId)
        ? "Username is available."
        : "That username is already taken.",
  };
}

export function getProfileDisplayLabel(
  profile: UserProfile | null,
  emailFallback?: string | null
) {
  if (profile?.displayName) {
    return profile.displayName;
  }

  if (profile?.username) {
    return `@${profile.username}`;
  }

  return emailFallback || "Account";
}

export async function ensureUserProfile(user: User) {
  if (!supabase) {
    return { profile: null, error: "Supabase is not configured yet." };
  }

  const { error: upsertError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (upsertError) {
    return { profile: null, error: upsertError.message };
  }

  const currentProfile = await fetchCurrentUserProfile(user);

  if (currentProfile.error || currentProfile.profile?.username) {
    return currentProfile;
  }

  const metadataUsername =
    typeof user.user_metadata?.username === "string"
      ? user.user_metadata.username
      : "";
  const metadataDisplayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : "";

  if (!validateUsername(metadataUsername).ok) {
    return currentProfile;
  }

  const metadataProfile = await saveUserProfile(
    user,
    metadataUsername,
    metadataDisplayName
  );

  if (metadataProfile.error) {
    return {
      profile: currentProfile.profile,
      error: metadataProfile.error,
    };
  }

  return metadataProfile;
}

export async function fetchCurrentUserProfile(user: User) {
  if (!supabase) {
    return { profile: null, error: "Supabase is not configured yet." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, username, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return { profile: null, error: error.message };
  }

  return {
    profile: data ? mapProfileRow(data as ProfileRow) : null,
    error: null,
  };
}

export async function saveUserProfile(
  user: User,
  usernameInput: string,
  displayNameInput: string
) {
  if (!supabase) {
    return { profile: null, error: "Supabase is not configured yet." };
  }

  const validation = validateUsername(usernameInput);

  if (!validation.ok) {
    return { profile: null, error: validation.message };
  }

  const displayName = displayNameInput.trim() || validation.username;
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        email: user.email || null,
        username: validation.username,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("id, email, username, display_name")
    .single();

  if (error) {
    const isDuplicateUsername =
      error.code === "23505" || error.message.toLowerCase().includes("unique");

    return {
      profile: null,
      error: isDuplicateUsername
        ? "That username is already taken."
        : error.message,
    };
  }

  return {
    profile: mapProfileRow(data as ProfileRow),
    error: null,
  };
}

export async function fetchProfileDisplayInfo(
  userId: string,
  emailFallback = "Unknown player"
): Promise<ProfileDisplayInfo> {
  if (!supabase) {
    return {
      userId,
      username: null,
      displayName: emailFallback,
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, username, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return {
      userId,
      username: null,
      displayName: emailFallback,
    };
  }

  const profile = mapProfileRow(data as ProfileRow);

  return {
    userId,
    username: profile.username,
    displayName: getProfileDisplayLabel(profile, emailFallback),
  };
}

function mapProfileRow(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
  };
}
