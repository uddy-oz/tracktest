import { useState } from "react";
import Navbar from "./Components/Navbar";
import Hero from "./Components/Hero";
import AlbumSearch from "./Components/AlbumSearch";
import Quiz from "./Components/Quiz";

function App() {
  const [selectedAlbum, setSelectedAlbum] = useState("");
  const [isQuizStarted, setIsQuizStarted] = useState(false);

  function startQuiz(albumTitle: string) {
    setSelectedAlbum(albumTitle);
    setIsQuizStarted(true);
  }

  function restartApp() {
    setSelectedAlbum("");
    setIsQuizStarted(false);
  }

  return (
    <>
      <Navbar />

      {!isQuizStarted && (
        <>
          <Hero />
          <AlbumSearch onStartQuiz={startQuiz} />
        </>
      )}

      {isQuizStarted && (
        <Quiz selectedAlbum={selectedAlbum} onRestartApp={restartApp} />
      )}
    </>
  );
}

export default App;