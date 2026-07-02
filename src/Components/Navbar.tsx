type NavbarProps = {
  onLogin: () => void;
  onLogout: () => void;
  onShowPlay: () => void;
  onShowLeaderboard: () => void;
  isSpotifyConnected: boolean;
  activeView: "play" | "leaderboard";
};

function Navbar({
  onLogin,
  onLogout,
  onShowPlay,
  onShowLeaderboard,
  isSpotifyConnected,
  activeView,
}: NavbarProps) {
  return (
    <nav className="navbar">
      <h2 className="logo">TrackTest</h2>

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

        {isSpotifyConnected ? (
          <button className="nav-login-button" onClick={onLogout}>
            Connected
          </button>
        ) : (
          <button className="nav-login-button" onClick={onLogin}>
            Login
          </button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
