import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type AuthPageProps = {
  session: Session | null;
  onPlay: () => void;
};

function AuthPage({ session, onPlay }: AuthPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  if (session) {
    return (
      <section className="auth-page">
        <div className="auth-panel">
          <p className="eyebrow">Account</p>
          <h1>Signed in</h1>
          <p>
            You are signed in as <strong>{session.user.email}</strong>. Cloud
            stat sync is coming next.
          </p>
          <button type="button" onClick={onPlay}>
            Back to Play
          </button>
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
