import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  getProfileDisplayLabel,
  checkUsernameAvailability,
  normalizeUsername,
  saveUserProfile,
  validateUsername,
  type UserProfile,
} from "../lib/profiles";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type AuthPageProps = {
  session: Session | null;
  profile: UserProfile | null;
  isProfileLoading: boolean;
  onProfileSaved: (profile: UserProfile) => void;
  onPlay: () => void;
};

function AuthPage({
  session,
  profile,
  isProfileLoading,
  onProfileSaved,
  onPlay,
}: AuthPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [usernameStatus, setUsernameStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    if (!session?.user || profile?.username || !username) {
      setUsernameStatus("");
      return;
    }

    const validation = validateUsername(username);

    if (!validation.ok) {
      setUsernameStatus(validation.message);
      return;
    }

    let isActive = true;
    const checkId = window.setTimeout(() => {
      checkUsernameAvailability(username, session.user.id).then((result) => {
        if (isActive) {
          setUsernameStatus(result.message);
        }
      });
    }, 350);

    return () => {
      isActive = false;
      window.clearTimeout(checkId);
    };
  }, [profile?.username, session?.user, username]);

  async function handleSignUp() {
    if (!supabase) {
      setMessage("Supabase is not configured yet.");
      return;
    }

    try {
      setIsSubmitting(true);
      setMessage("");

      const { error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Check your email to confirm your account, then log in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogin() {
    if (!supabase) {
      setMessage("Supabase is not configured yet.");
      return;
    }

    try {
      setIsSubmitting(true);
      setMessage("");

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Signed in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveProfile() {
    if (!session?.user) {
      setMessage("Log in before saving a profile.");
      return;
    }

    try {
      setIsSavingProfile(true);
      setMessage("");

      const { profile: savedProfile, error } = await saveUserProfile(
        session.user,
        username,
        displayName
      );

      if (error || !savedProfile) {
        setMessage(error || "Could not save profile.");
        return;
      }

      onProfileSaved(savedProfile);
      setUsername("");
      setDisplayName("");
      setMessage("Profile saved.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  if (session) {
    const hasUsername = Boolean(profile?.username);
    const accountLabel = getProfileDisplayLabel(profile, session.user.email);

    return (
      <section className="auth-page">
        <div className="auth-panel">
          <p className="eyebrow">Account</p>
          {isProfileLoading ? (
            <>
              <h1>Loading profile</h1>
              <p>Getting your Arena profile ready...</p>
            </>
          ) : hasUsername ? (
            <>
              <h1>{accountLabel}</h1>
              <p>
                Signed in as <strong>{session.user.email}</strong>. Your Arena
                name is ready for future leaderboards.
              </p>
              <button type="button" onClick={onPlay}>
                Back Home
              </button>
            </>
          ) : (
            <>
              <h1>Set your username</h1>
              <p>
                Pick the name future leaderboards will show. Usernames are
                lowercase, unique, and use letters, numbers, or underscores.
              </p>

              <div className="auth-form profile-setup-form">
                <input
                  type="text"
                  placeholder="username"
                  value={username}
                  onChange={(event) =>
                    setUsername(normalizeUsername(event.target.value))
                  }
                  maxLength={20}
                />
                <input
                  type="text"
                  placeholder="Display name optional"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={40}
                />

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={
                    isSavingProfile ||
                    !validateUsername(username).ok ||
                    usernameStatus === "That username is already taken."
                  }
                >
                  {isSavingProfile ? "Saving..." : "Save Profile"}
                </button>
              </div>

              <p className="profile-rules">
                {usernameStatus ||
                  "3 to 20 characters. Lowercase letters, numbers, and underscore only."}
              </p>
            </>
          )}

          {message && <p className="auth-message">{message}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">TrackTest Arena Account</p>
        <h1>Log in or sign up</h1>
        <p>
          Use email auth now. Local stats still save on this browser until cloud
          sync is connected.
        </p>

        {!isSupabaseConfigured && (
          <p className="auth-message">
            Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login.
          </p>
        )}

        <div className="auth-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <div className="auth-actions">
            <button
              type="button"
              onClick={handleLogin}
              disabled={!isSupabaseConfigured || isSubmitting}
            >
              {isSubmitting ? "Working..." : "Log In"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleSignUp}
              disabled={!isSupabaseConfigured || isSubmitting}
            >
              Sign Up
            </button>
          </div>
        </div>

        {message && <p className="auth-message">{message}</p>}
      </div>
    </section>
  );
}

export default AuthPage;
