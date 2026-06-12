import { useState } from "react";
import Navbar from "./Components/Navbar";
import Hero from "./Components/Hero";
import AlbumSearch from "./Components/AlbumSearch";
import Quiz from "./Components/Quiz";
import SpotifyCallback from "./Components/SpotifyCallback";
import { redirectToSpotifyLogin } from "./lib/spotifyAuth";
import type { SpotifyAlbum } from "./lib/spotifyApi";

function App() {
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [isQuizStarted, setIsQuizStarted] = useState(false);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(
    Boolean(localStorage.getItem("spotify_access_token"))
  );

  function startQuiz(album: SpotifyAlbum) {
  setSelectedAlbum(album);
  setIsQuizStarted(true);
}

  function restartApp() {
    setSelectedAlbum(null);
    setIsQuizStarted(false);
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
        isSpotifyConnected={isSpotifyConnected}
      />

      {!isQuizStarted && (
        <>
          <Hero />
          <AlbumSearch onStartQuiz={startQuiz} />
        </>
      )}

      {isQuizStarted && selectedAlbum && (
  <Quiz selectedAlbum={selectedAlbum} onRestartApp={restartApp} />
)}
    </>
  );
}

export default App;