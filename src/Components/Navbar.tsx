type NavbarProps = {
  onLogin: () => void;
  onLogout: () => void;
  isSpotifyConnected: boolean;
};

function Navbar({ onLogin, onLogout, isSpotifyConnected }: NavbarProps) {
  return (
    <nav className="navbar">
      <h2 className="logo">TrackTest</h2>

      <div className="nav-links">
        <a href="#">Play</a>
        <a href="#">Leaderboard</a>

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