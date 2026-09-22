import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  checkUsernameAvailability,
  ensureUserProfile,
  getProfileDisplayLabel,
  normalizeUsername,
  saveUserProfile,
  validateUsername,
  type UserProfile,
} from "../lib/profiles";
import { sounds } from "../lib/sounds";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { resetCurrentUserProgress } from "../lib/accountProgress";
import { clearLocalFeaturedBadgeIds } from "../lib/featuredBadges";
import { clearTrackTestStats } from "../lib/stats";
import { isAnonymousUser } from "../lib/authIdentity";

export type AuthPageMode =
  | "login"
  | "signup"
  | "forgot"
  | "reset"
  | "settings"
  | "profile";

type Notice = {
  kind: "error" | "success" | "info";
  text: string;
};

type AuthPageProps = {
  mode: AuthPageMode;
  session: Session | null;
  profile: UserProfile | null;
  isProfileLoading: boolean;
  onNavigate: (mode: AuthPageMode) => void;
  onAuthenticated: () => void;
  onProfileSaved: (profile: UserProfile) => void;
  onLogout: () => void | Promise<void>;
  onPlay: () => void;
  onGuest?: () => Promise<string>;
  onProgressReset?: () => void | Promise<void>;
};

type ProfileEditorProps = {
  user: User;
  profile: UserProfile | null;
  required?: boolean;
  onProfileSaved: (profile: UserProfile) => void;
  onComplete?: () => void;
};

const PASSWORD_MIN_LENGTH = 8;

function getAuthErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "Confirm your email before logging in.";
  }

  if (normalizedMessage.includes("user already registered")) {
    return "An account already exists for that email. Try logging in instead.";
  }

  if (normalizedMessage.includes("password should be")) {
    return `Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  return message || "Something went wrong. Please try again.";
}

function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  return "";
}

function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="auth-page">
      <div className="auth-layout">
        <aside className="auth-brand-panel" aria-label="StanZer account benefits">
          <div>
            <p className="eyebrow">StanZer</p>
            <h1>Prove you're a superfan.</h1>
            <p>
              Keep your rank, badges, records, and multiplayer identity with you
              on every device.
            </p>
          </div>

          <ul className="auth-benefits">
            <li>Build one persistent player identity</li>
            <li>Save Solo and multiplayer progression</li>
            <li>Compete on the Global Arena leaderboard</li>
          </ul>
        </aside>

        <div className="auth-panel">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="auth-intro">{description}</p>
          {children}
        </div>
      </div>
    </section>
  );
}

function AuthNotice({ notice }: { notice: Notice | null }) {
  if (!notice) {
    return null;
  }

  return (
    <p
      className={`auth-message auth-message-${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
        <button
          type="button"
          className="password-visibility-button"
          onClick={() => setIsVisible((current) => !current)}
          aria-label={`${isVisible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={isVisible}
        >
          {isVisible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

function ProfileEditor({
  user,
  profile,
  required = false,
  onProfileSaved,
  onComplete,
}: ProfileEditorProps) {
  const metadataUsername =
    typeof user.user_metadata?.username === "string"
      ? user.user_metadata.username
      : "";
  const metadataDisplayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : "";
  const [username, setUsername] = useState(
    profile?.username || normalizeUsername(metadataUsername)
  );
  const [displayName, setDisplayName] = useState(
    profile?.displayName || metadataDisplayName
  );
  const [availability, setAvailability] = useState<Notice | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const usernameValidation = validateUsername(username);

  useEffect(() => {
    if (!usernameValidation.ok) {
      return;
    }

    let isActive = true;
    const checkId = window.setTimeout(() => {
      void checkUsernameAvailability(username, user.id).then((result) => {
        if (!isActive) {
          return;
        }

        setAvailability({
          kind: result.available ? "success" : "error",
          text: result.message,
        });
      });
    }, 350);

    return () => {
      isActive = false;
      window.clearTimeout(checkId);
    };
  }, [user.id, username, usernameValidation.ok]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!usernameValidation.ok) {
      setNotice({ kind: "error", text: usernameValidation.message });
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const availabilityResult = await checkUsernameAvailability(username, user.id);

      if (!availabilityResult.available) {
        setNotice({ kind: "error", text: availabilityResult.message });
        return;
      }

      const { profile: savedProfile, error } = await saveUserProfile(
        user,
        username,
        displayName
      );

      if (error || !savedProfile) {
        setNotice({ kind: "error", text: error || "Could not save profile." });
        return;
      }

      // Metadata is a convenience for email-confirmation handoff only. Public
      // profile reads continue to use the RLS-protected profiles table/views.
      await supabase?.auth.updateUser({
        data: {
          username: savedProfile.username,
          display_name: savedProfile.displayName,
        },
      });

      onProfileSaved(savedProfile);
      setNotice({ kind: "success", text: "Profile saved." });
      onComplete?.();
    } catch (error) {
      setNotice({ kind: "error", text: getAuthErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }

  const usernameFeedback = !usernameValidation.ok
    ? usernameValidation.message
    : availability?.text ||
      "3 to 20 lowercase letters, numbers, or underscores.";

  return (
    <form className="auth-form" onSubmit={handleSave} noValidate>
      <div className="auth-field">
        <label htmlFor="profile-username">
          Username {required && <span aria-hidden="true">*</span>}
        </label>
        <div className="auth-input-prefix">
          <span aria-hidden="true">@</span>
          <input
            id="profile-username"
            type="text"
            value={username}
            onChange={(event) => {
              setUsername(normalizeUsername(event.target.value));
              setAvailability(null);
              setNotice(null);
            }}
            autoComplete="username"
            inputMode="text"
            maxLength={20}
            aria-describedby="profile-username-help"
            required
          />
        </div>
        <p
          id="profile-username-help"
          className={`auth-field-help ${
            availability?.kind === "success" ? "is-success" : ""
          }`}
        >
          {usernameFeedback}
        </p>
      </div>

      <div className="auth-field">
        <label htmlFor="profile-display-name">Display name</label>
        <input
          id="profile-display-name"
          type="text"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setNotice(null);
          }}
          autoComplete="name"
          maxLength={40}
          placeholder={username || "How players will see you"}
        />
        <p className="auth-field-help">
          Optional. Your username is used if this is left blank.
        </p>
      </div>

      <button
        type="submit"
        className="auth-primary-button"
        disabled={
          isSaving ||
          !usernameValidation.ok ||
          availability?.kind === "error"
        }
      >
        {isSaving ? "Saving profile..." : required ? "Enter StanZer" : "Save profile"}
      </button>

      <AuthNotice notice={notice} />
    </form>
  );
}

function LoginForm({
  onNavigate,
  onAuthenticated,
  onProfileSaved,
  onGuest,
}: {
  onNavigate: (mode: AuthPageMode) => void;
  onAuthenticated: () => void;
  onProfileSaved: (profile: UserProfile) => void;
  onGuest?: () => Promise<string>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStartingGuest, setIsStartingGuest] = useState(false);

  async function handleGuest() {
    if (!onGuest) return;
    setIsStartingGuest(true);
    setNotice(null);
    const error = await onGuest();
    if (error) setNotice({ kind: "error", text: error });
    setIsStartingGuest(false);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setNotice({ kind: "error", text: "Supabase is not configured yet." });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setNotice({ kind: "error", text: getAuthErrorMessage(error) });
        return;
      }

      if (!data.user) {
        setNotice({ kind: "error", text: "Login completed without a user session." });
        return;
      }

      const profileResult = await ensureUserProfile(data.user);

      if (profileResult.profile) {
        onProfileSaved(profileResult.profile);
      }

      if (!profileResult.profile?.username) {
        setNotice({
          kind: "info",
          text: "Signed in. Complete your username to enter StanZer.",
        });
        return;
      }

      onAuthenticated();
    } catch (error) {
      setNotice({ kind: "error", text: getAuthErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleLogin}>
      <div className="auth-field">
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          inputMode="email"
          required
        />
      </div>

      <PasswordField
        id="login-password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />

      <div className="auth-inline-action">
        <button type="button" onClick={() => onNavigate("forgot")}>
          Forgot password?
        </button>
      </div>

      <button
        type="submit"
        className="auth-primary-button"
        disabled={!isSupabaseConfigured || isSubmitting}
      >
        {isSubmitting ? "Logging in..." : "Log in"}
      </button>

      {onGuest && (
        <button
          type="button"
          className="auth-secondary-button auth-guest-button"
          disabled={!isSupabaseConfigured || isStartingGuest}
          onClick={() => void handleGuest()}
        >
          {isStartingGuest ? "Starting guest session..." : "Play multiplayer as guest"}
        </button>
      )}

      <AuthNotice notice={notice} />

      <p className="auth-switch-copy">
        New to StanZer?{" "}
        <button type="button" onClick={() => onNavigate("signup")}>
          Create an account
        </button>
      </p>
    </form>
  );
}

function SignupForm({
  onNavigate,
  onAuthenticated,
  onProfileSaved,
}: {
  onNavigate: (mode: AuthPageMode) => void;
  onAuthenticated: () => void;
  onProfileSaved: (profile: UserProfile) => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [availability, setAvailability] = useState<Notice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const usernameValidation = validateUsername(username);

  useEffect(() => {
    if (!usernameValidation.ok) {
      return;
    }

    let isActive = true;
    const checkId = window.setTimeout(() => {
      void checkUsernameAvailability(username).then((result) => {
        if (isActive) {
          setAvailability({
            kind: result.available ? "success" : "error",
            text: result.message,
          });
        }
      });
    }, 350);

    return () => {
      isActive = false;
      window.clearTimeout(checkId);
    };
  }, [username, usernameValidation.ok]);

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setNotice({ kind: "error", text: "Supabase is not configured yet." });
      return;
    }

    if (!usernameValidation.ok) {
      setNotice({ kind: "error", text: usernameValidation.message });
      return;
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      setNotice({ kind: "error", text: passwordError });
      return;
    }

    if (password !== confirmPassword) {
      setNotice({ kind: "error", text: "Passwords do not match." });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const availabilityResult = await checkUsernameAvailability(username);

      if (!availabilityResult.available) {
        setNotice({ kind: "error", text: availabilityResult.message });
        return;
      }

      const normalizedUsername = usernameValidation.username;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: {
            username: normalizedUsername,
            display_name: normalizedUsername,
          },
        },
      });

      if (error) {
        setNotice({ kind: "error", text: getAuthErrorMessage(error) });
        return;
      }

      if (data.session && data.user) {
        const profileResult = await saveUserProfile(
          data.user,
          normalizedUsername,
          normalizedUsername
        );

        if (profileResult.profile) {
          onProfileSaved(profileResult.profile);
        }

        onAuthenticated();
        return;
      }

      setNotice({
        kind: "success",
        text: "Check your email to confirm your account. Your username will be completed when you first log in.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: getAuthErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSignUp} noValidate>
      <div className="auth-field">
        <label htmlFor="signup-username">Username</label>
        <div className="auth-input-prefix">
          <span aria-hidden="true">@</span>
          <input
            id="signup-username"
            type="text"
            value={username}
            onChange={(event) => {
              setUsername(normalizeUsername(event.target.value));
              setAvailability(null);
              setNotice(null);
            }}
            autoComplete="username"
            maxLength={20}
            aria-describedby="signup-username-help"
            required
          />
        </div>
        <p
          id="signup-username-help"
          className={`auth-field-help ${
            availability?.kind === "success" ? "is-success" : ""
          }`}
        >
          {!usernameValidation.ok
            ? usernameValidation.message
            : availability?.text ||
              "3 to 20 lowercase letters, numbers, or underscores."}
        </p>
      </div>

      <div className="auth-field">
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          inputMode="email"
          required
        />
      </div>

      <PasswordField
        id="signup-password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
      />

      <PasswordField
        id="signup-password-confirm"
        label="Confirm password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
      />

      <p className="auth-field-help auth-password-help">
        Use at least {PASSWORD_MIN_LENGTH} characters. A password manager is recommended.
      </p>

      <button
        type="submit"
        className="auth-primary-button"
        disabled={
          !isSupabaseConfigured ||
          isSubmitting ||
          availability?.kind === "error"
        }
      >
        {isSubmitting ? "Creating account..." : "Create account"}
      </button>

      <AuthNotice notice={notice} />

      <p className="auth-switch-copy">
        Already have an account?{" "}
        <button type="button" onClick={() => onNavigate("login")}>
          Log in
        </button>
      </p>
    </form>
  );
}

function ForgotPasswordForm({
  onNavigate,
}: {
  onNavigate: (mode: AuthPageMode) => void;
}) {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setNotice({ kind: "error", text: "Supabase is not configured yet." });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        setNotice({ kind: "error", text: getAuthErrorMessage(error) });
        return;
      }

      setNotice({
        kind: "success",
        text: "If an account exists for this email, we've sent a password reset link.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: getAuthErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleResetRequest}>
      <div className="auth-field">
        <label htmlFor="recovery-email">Email</label>
        <input
          id="recovery-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          inputMode="email"
          required
        />
      </div>

      <button
        type="submit"
        className="auth-primary-button"
        disabled={!isSupabaseConfigured || isSubmitting}
      >
        {isSubmitting ? "Sending link..." : "Send reset link"}
      </button>

      <AuthNotice notice={notice} />

      <p className="auth-switch-copy">
        Remembered it?{" "}
        <button type="button" onClick={() => onNavigate("login")}>
          Back to login
        </button>
      </p>
    </form>
  );
}

function ResetPasswordForm({
  session,
  onNavigate,
  onAuthenticated,
}: {
  session: Session | null;
  onNavigate: (mode: AuthPageMode) => void;
  onAuthenticated: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    },
    []
  );

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !session) {
      setNotice({
        kind: "error",
        text: "This recovery link is missing or has expired. Request a new one.",
      });
      return;
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      setNotice({ kind: "error", text: passwordError });
      return;
    }

    if (password !== confirmPassword) {
      setNotice({ kind: "error", text: "Passwords do not match." });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setNotice({ kind: "error", text: getAuthErrorMessage(error) });
        return;
      }

      setNotice({
        kind: "success",
        text: "Password updated. Taking you back to StanZer...",
      });
      redirectTimerRef.current = window.setTimeout(onAuthenticated, 900);
    } catch (error) {
      setNotice({ kind: "error", text: getAuthErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!session) {
    return (
      <div className="auth-form">
        <AuthNotice
          notice={{
            kind: "error",
            text: "This recovery link is missing or has expired. Request a new one.",
          }}
        />
        <button
          type="button"
          className="auth-primary-button"
          onClick={() => onNavigate("forgot")}
        >
          Request another link
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handlePasswordReset}>
      <PasswordField
        id="reset-password"
        label="New password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
      />
      <PasswordField
        id="reset-password-confirm"
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
      />

      <button
        type="submit"
        className="auth-primary-button"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Updating password..." : "Update password"}
      </button>

      <AuthNotice notice={notice} />
    </form>
  );
}

function AccountSettings({
  session,
  profile,
  onProfileSaved,
  onLogout,
  onProgressReset,
}: {
  session: Session;
  profile: UserProfile | null;
  onProfileSaved: (profile: UserProfile) => void;
  onLogout: () => void | Promise<void>;
  onProgressReset?: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState(session.user.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailNotice, setEmailNotice] = useState<Notice | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<Notice | null>(null);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isMuted, setIsMuted] = useState(sounds.isMuted());
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetNotice, setResetNotice] = useState<Notice | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  async function handleProgressReset() {
    if (resetConfirmation !== "RESET") return;

    setIsResetting(true);
    setResetNotice(null);
    const result = await resetCurrentUserProgress();

    if (result.error || !result.reset) {
      setResetNotice({
        kind: "error",
        text: result.error || "Progress could not be reset.",
      });
      setIsResetting(false);
      return;
    }

    clearTrackTestStats();
    clearLocalFeaturedBadgeIds();
    await onProgressReset?.();
    setShowResetConfirmation(false);
    setResetConfirmation("");
    setResetNotice({ kind: "success", text: "Your StanZer progress was reset." });
    setIsResetting(false);
  }

  async function handleEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !email.trim() || email.trim() === session.user.email) {
      setEmailNotice({ kind: "info", text: "Enter a different email address." });
      return;
    }

    setIsSavingEmail(true);
    setEmailNotice(null);

    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });

      if (error) {
        setEmailNotice({ kind: "error", text: getAuthErrorMessage(error) });
        return;
      }

      setEmailNotice({
        kind: "success",
        text: "Check your inbox to confirm the email change. Your current email stays active until confirmation is complete.",
      });
    } catch (error) {
      setEmailNotice({ kind: "error", text: getAuthErrorMessage(error) });
    } finally {
      setIsSavingEmail(false);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setPasswordNotice({ kind: "error", text: "Supabase is not configured yet." });
      return;
    }

    const passwordError = validatePassword(newPassword);

    if (passwordError) {
      setPasswordNotice({ kind: "error", text: passwordError });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordNotice({ kind: "error", text: "Passwords do not match." });
      return;
    }

    setIsSavingPassword(true);
    setPasswordNotice(null);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });

      if (error) {
        setPasswordNotice({ kind: "error", text: getAuthErrorMessage(error) });
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice({ kind: "success", text: "Password updated." });
    } catch (error) {
      setPasswordNotice({ kind: "error", text: getAuthErrorMessage(error) });
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <div className="settings-sections">
      <section className="settings-section" aria-labelledby="settings-profile-heading">
        <div className="settings-section-heading">
          <p className="eyebrow">Profile</p>
          <h3 id="settings-profile-heading">Player identity</h3>
          <p>These names appear on profiles, rooms, and public leaderboards.</p>
        </div>
        <ProfileEditor
          key={`${profile?.id || session.user.id}:${profile?.username || "new"}`}
          user={session.user}
          profile={profile}
          onProfileSaved={onProfileSaved}
        />
      </section>

      <section className="settings-section" aria-labelledby="settings-email-heading">
        <div className="settings-section-heading">
          <p className="eyebrow">Account</p>
          <h3 id="settings-email-heading">Email</h3>
          <p>Your email is private and is never shown on public profiles.</p>
        </div>
        <form className="auth-form" onSubmit={handleEmailChange}>
          <div className="auth-field">
            <label htmlFor="settings-email">Email address</label>
            <input
              id="settings-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <button
            type="submit"
            className="auth-secondary-button"
            disabled={isSavingEmail}
          >
            {isSavingEmail ? "Sending confirmation..." : "Change email"}
          </button>
          <AuthNotice notice={emailNotice} />
        </form>
      </section>

      <section className="settings-section" aria-labelledby="settings-password-heading">
        <div className="settings-section-heading">
          <p className="eyebrow">Security</p>
          <h3 id="settings-password-heading">Change password</h3>
          <p>Use a unique password that you do not reuse elsewhere.</p>
        </div>
        <form className="auth-form" onSubmit={handlePasswordChange}>
          <PasswordField
            id="settings-current-password"
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordField
            id="settings-new-password"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          <PasswordField
            id="settings-confirm-password"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          <button
            type="submit"
            className="auth-secondary-button"
            disabled={isSavingPassword}
          >
            {isSavingPassword ? "Updating password..." : "Update password"}
          </button>
          <AuthNotice notice={passwordNotice} />
        </form>
      </section>

      <section className="settings-section settings-preference-row">
        <div className="settings-section-heading">
          <p className="eyebrow">Game</p>
          <h3>Sound effects</h3>
          <p>Music previews are separate from interface sound effects.</p>
        </div>
        <button
          type="button"
          className={`settings-toggle ${isMuted ? "" : "is-active"}`}
          onClick={() => setIsMuted(sounds.toggleMuted())}
          aria-pressed={!isMuted}
        >
          {isMuted ? "Sound effects off" : "Sound effects on"}
        </button>
      </section>

      <section className="settings-section settings-signout-row">
        <div className="settings-section-heading">
          <p className="eyebrow">Session</p>
          <h3>Sign out on this device</h3>
          <p>Your cloud progress stays attached to your account.</p>
        </div>
        <button type="button" className="auth-danger-button" onClick={onLogout}>
          Log out
        </button>
      </section>

      <section className="settings-section settings-danger-zone" aria-labelledby="settings-danger-heading">
        <div className="settings-section-heading">
          <p className="eyebrow">Danger zone</p>
          <h3 id="settings-danger-heading">Reset game progress</h3>
          <p>
            Permanently deletes quiz results, stats, badges, and completed Arena records.
            Your account, username, email, and password stay intact.
          </p>
        </div>
        <button
          type="button"
          className="auth-danger-button"
          onClick={() => setShowResetConfirmation(true)}
        >
          Reset progress
        </button>
        <AuthNotice notice={resetNotice} />
      </section>

      {showResetConfirmation && (
        <div className="settings-reset-backdrop" role="presentation">
          <section
            className="settings-reset-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-progress-title"
          >
            <p className="eyebrow">Permanent action</p>
            <h3 id="reset-progress-title">Reset all game progress?</h3>
            <p>This cannot be undone. Type <strong>RESET</strong> to confirm.</p>
            <label htmlFor="reset-progress-confirmation">Confirmation</label>
            <input
              id="reset-progress-confirmation"
              value={resetConfirmation}
              onChange={(event) => setResetConfirmation(event.target.value)}
              autoComplete="off"
              autoFocus
            />
            <div className="settings-reset-actions">
              <button
                type="button"
                className="auth-secondary-button"
                disabled={isResetting}
                onClick={() => {
                  setShowResetConfirmation(false);
                  setResetConfirmation("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="auth-danger-button"
                disabled={resetConfirmation !== "RESET" || isResetting}
                onClick={() => void handleProgressReset()}
              >
                {isResetting ? "Resetting..." : "Reset permanently"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AuthPage({
  mode,
  session,
  profile,
  isProfileLoading,
  onNavigate,
  onAuthenticated,
  onProfileSaved,
  onLogout,
  onPlay,
  onGuest,
  onProgressReset,
}: AuthPageProps) {
  if (mode === "profile" && session) {
    return (
      <AuthShell
        eyebrow="Player setup"
        title="Claim your StanZer username"
        description="Every player needs a unique public handle before scores can enter the Arena. Your email always stays private."
      >
        {isProfileLoading ? (
          <div className="auth-loading-state" role="status">
            <span className="auth-loading-dot" aria-hidden="true" />
            Loading your profile...
          </div>
        ) : (
          <ProfileEditor
            key={session.user.id}
            user={session.user}
            profile={profile}
            required
            onProfileSaved={onProfileSaved}
            onComplete={onAuthenticated}
          />
        )}
      </AuthShell>
    );
  }

  if (mode === "settings") {
    if (!session) {
      return (
        <AuthShell
          eyebrow="Protected account"
          title="Log in to open settings"
          description="Your account settings contain private information and require an active session."
        >
          <LoginForm
            onNavigate={onNavigate}
            onAuthenticated={onAuthenticated}
            onProfileSaved={onProfileSaved}
          />
        </AuthShell>
      );
    }

    if (isAnonymousUser(session.user)) {
      return (
        <AuthShell
          eyebrow="Guest session"
          title="Create an account to save your progress"
          description="Guest rooms are temporary. A free account keeps your stats, wins, badges, and rank across devices."
        >
          <div className="auth-session-actions">
            <button type="button" className="auth-primary-button" onClick={() => onNavigate("signup")}>
              Create account
            </button>
            <button type="button" className="auth-secondary-button" onClick={onPlay}>
              Back home
            </button>
          </div>
        </AuthShell>
      );
    }

    return (
      <section className="account-settings-page">
        <header className="settings-header">
          <div>
            <p className="eyebrow">Account settings</p>
            <h1>{getProfileDisplayLabel(profile, session.user.email)}</h1>
            <p>Manage your player identity, login details, and game preferences.</p>
          </div>
          <button type="button" className="auth-secondary-button" onClick={onPlay}>
            Back home
          </button>
        </header>

        {isProfileLoading ? (
          <div className="auth-loading-state" role="status">
            <span className="auth-loading-dot" aria-hidden="true" />
            Loading account settings...
          </div>
        ) : (
          <AccountSettings
            key={`${session.user.id}:${profile?.username || "setup"}`}
            session={session}
            profile={profile}
            onProfileSaved={onProfileSaved}
            onLogout={onLogout}
            onProgressReset={onProgressReset}
          />
        )}
      </section>
    );
  }

  if (session && mode !== "reset") {
    if (isAnonymousUser(session.user)) {
      return (
        <AuthShell
          eyebrow="Guest session"
          title="Make your StanZer record permanent"
          description="Guest room scores disappear with this browser session. Create an account to start saving stats, badges, wins, and rank."
        >
          <div className="auth-session-actions">
            <button
              type="button"
              className="auth-primary-button"
              onClick={() => {
                void Promise.resolve(onLogout()).then(() => onNavigate("signup"));
              }}
            >
              Create account
            </button>
            <button type="button" className="auth-secondary-button" onClick={onPlay}>
              Continue as guest
            </button>
          </div>
          <p className="auth-field-help">
            Creating an account ends this temporary guest identity. Finish or leave an active room first.
          </p>
        </AuthShell>
      );
    }

    return (
      <AuthShell
        eyebrow="Session active"
        title={`Welcome back, ${getProfileDisplayLabel(profile, session.user.email)}`}
        description="You're already logged in on this device. Continue playing or manage your account."
      >
        <div className="auth-session-actions">
          <button type="button" className="auth-primary-button" onClick={onPlay}>
            Continue to StanZer
          </button>
          <button
            type="button"
            className="auth-secondary-button"
            onClick={() => onNavigate("settings")}
          >
            Account settings
          </button>
        </div>
      </AuthShell>
    );
  }

  if (mode === "signup") {
    return (
      <AuthShell
        eyebrow="Create account"
        title="Build your player identity"
        description="Choose your public handle, then start building a record that follows you across devices."
      >
        <SignupForm
          onNavigate={onNavigate}
          onAuthenticated={onAuthenticated}
          onProfileSaved={onProfileSaved}
        />
      </AuthShell>
    );
  }

  if (mode === "forgot") {
    return (
      <AuthShell
        eyebrow="Account recovery"
        title="Reset your password"
        description="Enter the private email connected to your StanZer account."
      >
        <ForgotPasswordForm onNavigate={onNavigate} />
      </AuthShell>
    );
  }

  if (mode === "reset") {
    return (
      <AuthShell
        eyebrow="Secure recovery"
        title="Choose a new password"
        description="Set a fresh password for your StanZer account."
      >
        <ResetPasswordForm
          session={session}
          onNavigate={onNavigate}
          onAuthenticated={onAuthenticated}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to StanZer"
      description="Continue your rank, badge collection, and multiplayer record."
    >
      {!isSupabaseConfigured && (
        <AuthNotice
          notice={{
            kind: "error",
            text: "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login.",
          }}
        />
      )}
      <LoginForm
        onNavigate={onNavigate}
        onAuthenticated={onAuthenticated}
        onProfileSaved={onProfileSaved}
        onGuest={onGuest}
      />
    </AuthShell>
  );
}

export default AuthPage;
