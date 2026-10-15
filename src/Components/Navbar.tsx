import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getProfileDisplayLabel, type UserProfile } from "../lib/profiles";
import PlayerIdentityBadges from "./PlayerIdentityBadges";
import type { CompactPlayerBadge } from "../lib/playerIdentity";
import GuestBadge from "./GuestBadge";

type NavbarProps = {
  onLogout: () => void;
  onShowHome: () => void;
  onShowAuth: () => void;
  onShowSettings: () => void;
  onShowPlay: () => void;
  onShowLeaderboard: () => void;
  onShowMultiplayer: () => void;
  onShowProfile: () => void;
  session: Session | null;
  profile: UserProfile | null;
  identityBadges: CompactPlayerBadge[] | null;
  isGuest?: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  activeView: "home" | "play" | "leaderboard" | "multiplayer" | "auth" | "profile";
};

function Navbar({
  onLogout,
  onShowHome,
  onShowAuth,
  onShowSettings,
  onShowPlay,
  onShowLeaderboard,
  onShowMultiplayer,
  onShowProfile,
  session,
  profile,
  identityBadges,
  isGuest = false,
  theme,
  onToggleTheme,
  activeView,
}: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const accountLabel = isGuest
    ? profile?.displayName || "Guest Player"
    : profile?.username
    ? getProfileDisplayLabel(profile, session?.user.email)
    : session
      ? "Set username"
      : "Account";
  const accountBadges = identityBadges || [];

  function navigate(action: () => void) {
    setIsMenuOpen(false);
    action();
  }

  return (
    <nav className="navbar" aria-label="Primary navigation">
      <div className="nav-shell">
        <button
          type="button"
          className="logo logo-button"
          onClick={() => navigate(onShowHome)}
        >
          <span>StanZer</span>
          <small>Music competition</small>
        </button>

        <button
          type="button"
          className={`nav-menu-button ${isMenuOpen ? "is-open" : ""}`}
          aria-expanded={isMenuOpen}
          aria-controls="primary-nav-links"
          aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>

      <div
        className={`nav-links ${isMenuOpen ? "is-open" : ""}`}
        id="primary-nav-links"
      >
        <button
          type="button"
          className={`nav-link-button ${activeView === "home" ? "active" : ""}`}
          onClick={() => navigate(onShowHome)}
        >
          Home
        </button>
        <button
          type="button"
          className={`nav-link-button ${activeView === "play" ? "active" : ""}`}
          onClick={() => navigate(onShowPlay)}
        >
          Single Player
        </button>
        <button
          type="button"
          className={`nav-link-button ${
            activeView === "leaderboard" ? "active" : ""
          }`}
          onClick={() => navigate(onShowLeaderboard)}
        >
          Leaderboard
        </button>
        <button
          type="button"
          className={`nav-link-button ${
            activeView === "multiplayer" ? "active" : ""
          }`}
          onClick={() => navigate(onShowMultiplayer)}
        >
          Multiplayer
        </button>

        {session ? (
          <>
            <button
              type="button"
              className={`nav-link-button account-button ${
                activeView === "profile" ? "active" : ""
              }`}
              onClick={() =>
                navigate(
                  isGuest
                    ? onShowAuth
                    : profile?.username
                      ? onShowProfile
                      : onShowAuth
                )
              }
            >
              <span>{accountLabel}</span>
              {isGuest && <GuestBadge compact />}
              {identityBadges && (
                <PlayerIdentityBadges badges={accountBadges} compact />
              )}
            </button>
            <button
              type="button"
              className={`nav-link-button ${
                activeView === "auth" ? "active" : ""
              }`}
              onClick={() => navigate(isGuest ? onShowAuth : onShowSettings)}
            >
              {isGuest ? "Create account" : "Settings"}
            </button>
            <button
              type="button"
              className="nav-login-button"
              onClick={() => navigate(onLogout)}
            >
              Logout
            </button>
          </>
        ) : (
          <button
            type="button"
            className="nav-login-button"
            onClick={() => navigate(onShowAuth)}
          >
            Login
          </button>
        )}

        <button
          type="button"
          className="theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={onToggleTheme}
        >
          <span className="theme-toggle-icon" aria-hidden="true" />
          <span className="theme-toggle-label">
            {theme === "dark" ? "Light" : "Dark"}
          </span>
        </button>
      </div>
      </div>
    </nav>
  );
}

export default Navbar;
