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

  return {
    ok: true,
    username: normalizedUsername,
    message: "",
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

  return fetchCurrentUserProfile(user);
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
