import type { Session } from "@supabase/supabase-js";
import { getProfileDisplayLabel, type UserProfile } from "../lib/profiles";
import PlayerIdentityBadges from "./PlayerIdentityBadges";
import type { CompactPlayerBadge } from "../lib/playerIdentity";

type NavbarProps = {
  onLogout: () => void;
  onShowHome: () => void;
  onShowAuth: () => void;
  onShowPlay: () => void;
  onShowLeaderboard: () => void;
  onShowMultiplayer: () => void;
  onShowProfile: () => void;
  session: Session | null;
  profile: UserProfile | null;
  identityBadges: CompactPlayerBadge[] | null;
  activeView: "home" | "play" | "leaderboard" | "multiplayer" | "auth" | "profile";
};

function Navbar({
  onLogout,
  onShowHome,
  onShowAuth,
  onShowPlay,
  onShowLeaderboard,
  onShowMultiplayer,
  onShowProfile,
  session,
  profile,
  identityBadges,
  activeView,
}: NavbarProps) {
  const accountLabel = profile?.username
    ? getProfileDisplayLabel(profile, session?.user.email)
    : session
      ? "Set username"
      : "Account";
  const accountBadges = identityBadges || [];

  return (
    <nav className="navbar">
      <button type="button" className="logo logo-button" onClick={onShowHome}>
        TrackTest Arena
      </button>

      <div className="nav-links">
        <button
          type="button"
          className={`nav-link-button ${activeView === "home" ? "active" : ""}`}
          onClick={onShowHome}
        >
          Home
        </button>
        <button
          type="button"
          className={`nav-link-button ${activeView === "play" ? "active" : ""}`}
          onClick={onShowPlay}
        >
          Single Player
        </button>
        <button
          type="button"
          className={`nav-link-button ${
            activeView === "leaderboard" ? "active" : ""
          }`}
          onClick={onShowLeaderboard}
        >
          Leaderboard
        </button>
        <button
          type="button"
          className={`nav-link-button ${
            activeView === "multiplayer" ? "active" : ""
          }`}
          onClick={onShowMultiplayer}
        >
          Multiplayer
        </button>

        {session ? (
          <>
            <button
              type="button"
              className={`nav-link-button account-button ${
                activeView === "profile" || activeView === "auth" ? "active" : ""
              }`}
              onClick={profile?.username ? onShowProfile : onShowAuth}
            >
              <span>{accountLabel}</span>
              {identityBadges && (
                <PlayerIdentityBadges badges={accountBadges} compact />
              )}
            </button>
            <button type="button" className="nav-login-button" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <button type="button" className="nav-login-button" onClick={onShowAuth}>
            Login
          </button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
