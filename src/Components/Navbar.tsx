import type { Session } from "@supabase/supabase-js";

type NavbarProps = {
  onLogout: () => void;
  onShowAuth: () => void;
  onShowPlay: () => void;
  onShowLeaderboard: () => void;
  session: Session | null;
  activeView: "play" | "leaderboard" | "auth";
};

function Navbar({
  onLogout,
  onShowAuth,
  onShowPlay,
  onShowLeaderboard,
  session,
  activeView,
}: NavbarProps) {
  const userEmail = session?.user.email;

  return (
    <nav className="navbar">
      <h2 className="logo">TrackTest Arena</h2>

      <div className="nav-links">
        <button
          type="button"
          className={`nav-link-button ${activeView === "play" ? "active" : ""}`}
          onClick={onShowPlay}
        >
          Play
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

        {session ? (
          <>
            <button
              type="button"
              className="nav-link-button account-button"
              onClick={onShowAuth}
            >
              {userEmail || "Account"}
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
