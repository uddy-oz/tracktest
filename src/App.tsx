import { useState } from "react";
import Navbar from "./Components/Navbar";
import Hero from "./Components/Hero";
import AlbumSearch from "./Components/AlbumSearch";
import Quiz from "./Components/Quiz";
import SpotifyCallback from "./Components/SpotifyCallback";
import Leaderboard from "./Components/Leaderboard";
import { redirectToSpotifyLogin } from "./lib/spotifyAuth";
import type { SpotifyAlbum } from "./lib/spotifyApi";

type AppView = "play" | "leaderboard";

function App() {
  const [activeView, setActiveView] = useState<AppView>("play");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [isQuizStarted, setIsQuizStarted] = useState(false);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(
    Boolean(localStorage.getItem("spotify_access_token"))
  );

  function startQuiz(album: SpotifyAlbum) {
    setActiveView("play");
    setSelectedAlbum(album);
    setIsQuizStarted(true);
  }

  function restartApp() {
    setActiveView("play");
    setSelectedAlbum(null);
    setIsQuizStarted(false);
  }

  function showPlay() {
    restartApp();
  }

  function showLeaderboard() {
    setSelectedAlbum(null);
    setIsQuizStarted(false);
    setActiveView("leaderboard");
  }

  function logoutSpotify() {
    localStorage.removeItem("spotify_access_token");
    localStorage.removeItem("spotify_code_verifier");
    setIsSpotifyConnected(false);
  }

  if (window.location.pathname === "/callback") {
    return (
      <SpotifyCallback
        onSpotifyConnected={() => setIsSpotifyConnected(true)}
      />
    );
  }

  return (
    <>
      <Navbar
        onLogin={redirectToSpotifyLogin}
        onLogout={logoutSpotify}
        onShowPlay={showPlay}
        onShowLeaderboard={showLeaderboard}
        isSpotifyConnected={isSpotifyConnected}
        activeView={activeView}
      />

      {activeView === "play" && !isQuizStarted && (
        <>
          <Hero />
          <AlbumSearch onStartQuiz={startQuiz} />
        </>
      )}

      {activeView === "play" && isQuizStarted && selectedAlbum && (
        <Quiz selectedAlbum={selectedAlbum} onRestartApp={restartApp} />
      )}

      {activeView === "leaderboard" && <Leaderboard onPlay={showPlay} />}
    </>
  );
}

export default App;
