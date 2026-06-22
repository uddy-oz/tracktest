import { useEffect, useRef, useState } from "react";
import type { SpotifyAlbum, SpotifyTrack } from "../lib/spotifyApi";
import { getSpotifyAlbumTracks } from "../lib/spotifyApi";
import { searchITunesPreview } from "../lib/itunesApi";

type QuizProps = {
  selectedAlbum: SpotifyAlbum;
  onRestartApp: () => void;
};

type QuizQuestion = {
  correctTrack: SpotifyTrack;
  options: SpotifyTrack[];
};

function shuffleArray<T>(array: T[]) {
  return [...array].sort(() => Math.random() - 0.5);
}

function buildQuizQuestions(tracks: SpotifyTrack[]) {
  const quizTracks = shuffleArray(tracks).slice(0, 5);

  return quizTracks.map((correctTrack) => {
    const wrongOptions = shuffleArray(
      tracks.filter((track) => track.id !== correctTrack.id)
    ).slice(0, 3);

    return {
      correctTrack,
      options: shuffleArray([correctTrack, ...wrongOptions]),
    };
  });
}

async function addPreviewUrlsToSpotifyTracks(
  tracks: SpotifyTrack[],
  artistName: string,
  albumTitle: string
) {
  const playableTracks: SpotifyTrack[] = [];

  for (const track of tracks) {
    if (track.previewUrl) {
      playableTracks.push(track);
      continue;
    }

    try {
      const preview = await searchITunesPreview(
        artistName,
        track.name,
        albumTitle
      );

      if (preview?.previewUrl) {
        playableTracks.push({
          ...track,
          previewUrl: preview.previewUrl,
        });
      }
    } catch (error) {
      console.error("Could not load preview for:", track.name, error);
    }

    if (playableTracks.length >= 12) {
      break;
    }
  }

  return playableTracks;
}

function Quiz({ selectedAlbum, onRestartApp }: QuizProps) {
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [message, setMessage] = useState("");
  const [score, setScore] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isQuizComplete, setIsQuizComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isClipPlaying, setIsClipPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipStartTimeRef = useRef(8);
  const clipTimerRef = useRef<number | null>(null);

  const CLIP_LENGTH_SECONDS = 5;

  const currentQuestion = questions[currentQuestionIndex];
  const previewUrl = currentQuestion?.correctTrack.previewUrl || "";

  useEffect(() => {
    async function loadTracks() {
      try {
        setIsLoading(true);
        setError("");
        setQuestions([]);
        setTracks([]);
        setCurrentQuestionIndex(0);
        setGuess("");
        setMessage("");
        setScore(0);
        setHasAnswered(false);
        setIsQuizComplete(false);
        setIsClipPlaying(false);

        const albumTracks = await getSpotifyAlbumTracks(selectedAlbum.id);

        if (albumTracks.length < 4) {
          setError("Not enough tracks for a quiz.");
          return;
        }

        const cleanedSpotifyTracks = albumTracks.slice(0, 20);

        const playableTracks = await addPreviewUrlsToSpotifyTracks(
          cleanedSpotifyTracks,
          selectedAlbum.artist,
          selectedAlbum.title
        );

        console.log("Playable Spotify tracks:", playableTracks);

        if (playableTracks.length < 4) {
          setError(
            "Not enough reliable audio previews found for this album. Try another album."
          );
          return;
        }

        setTracks(playableTracks);
        setQuestions(buildQuizQuestions(playableTracks));
      } catch (error) {
        console.error(error);
        setError("Could not load tracks for this album.");
      } finally {
        setIsLoading(false);
      }
    }

    loadTracks();
  }, [selectedAlbum.id, selectedAlbum.artist, selectedAlbum.title]);

  useEffect(() => {
    clearClipTimer();
    setIsClipPlaying(false);

    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.load();
    }

    clipStartTimeRef.current = 8;

    return () => {
      clearClipTimer();
    };
  }, [currentQuestionIndex, previewUrl]);

  function clearClipTimer() {
    if (clipTimerRef.current !== null) {
      window.clearTimeout(clipTimerRef.current);
      clipTimerRef.current = null;
    }
  }

  function getRandomClipStart(duration: number) {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;
    const latestStart = Math.max(0, safeDuration - CLIP_LENGTH_SECONDS - 1);

    const minStart = latestStart >= 12 ? 8 : 0;
    const maxStart = Math.min(22, latestStart);

    if (maxStart <= minStart) {
      return 0;
    }

    return Math.floor(Math.random() * (maxStart - minStart + 1)) + minStart;
  }

  function stopClip() {
    const audio = audioRef.current;

    clearClipTimer();

    if (audio) {
      audio.pause();
      audio.currentTime = clipStartTimeRef.current;
    }

    setIsClipPlaying(false);
  }

  async function playFiveSecondClip() {
    const audio = audioRef.current;

    if (!audio || !previewUrl) {
      return;
    }

    try {
      clearClipTimer();

      const startTime = getRandomClipStart(audio.duration);
      clipStartTimeRef.current = startTime;

      audio.pause();
      audio.currentTime = startTime;

      await audio.play();

      setIsClipPlaying(true);

      clipTimerRef.current = window.setTimeout(() => {
        stopClip();
      }, CLIP_LENGTH_SECONDS * 1000 + 250);
    } catch (error) {
      console.error("Could not play audio clip:", error);
      setIsClipPlaying(false);
    }
  }

  function handleAudioTimeUpdate() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.currentTime >= clipStartTimeRef.current + CLIP_LENGTH_SECONDS) {
      stopClip();
    }
  }

  function handleAudioEnded() {
    clearClipTimer();
    setIsClipPlaying(false);
  }

  function checkAnswer() {
    if (!currentQuestion) {
      return;
    }

    if (guess === "") {
      setMessage("Pick an answer first.");
      return;
    }

    if (hasAnswered) {
      setMessage("You already answered this question.");
      return;
    }

    const correctAnswer = currentQuestion.correctTrack.name;

    if (guess.toLowerCase() === correctAnswer.toLowerCase()) {
      setMessage("Correct. You know ball.");
      setScore((currentScore) => currentScore + 1);
    } else {
      setMessage(`Wrong. The correct answer was ${correctAnswer}.`);
    }

    setHasAnswered(true);
  }

  function goToNextQuestion() {
    stopClip();
    setCurrentQuestionIndex((currentIndex) => currentIndex + 1);
    setGuess("");
    setMessage("");
    setHasAnswered(false);
  }

  function finishQuiz() {
    stopClip();
    setIsQuizComplete(true);
  }

  function restartQuiz() {
    stopClip();
    setCurrentQuestionIndex(0);
    setGuess("");
    setMessage("");
    setScore(0);
    setHasAnswered(false);
    setIsQuizComplete(false);
    setQuestions(buildQuizQuestions(tracks));
  }

  if (isLoading) {
    return (
      <section className="quiz">
        <h2>Loading reliable previews...</h2>
      </section>
    );
  }

  if (error) {
    return (
      <section className="quiz">
        <h2>{error}</h2>
        <button type="button" onClick={onRestartApp}>
          Choose Another Album
        </button>
      </section>
    );
  }

  if (questions.length === 0 || !currentQuestion) {
    return (
      <section className="quiz">
        <h2>No questions available.</h2>
        <button type="button" onClick={onRestartApp}>
          Choose Another Album
        </button>
      </section>
    );
  }

  if (isQuizComplete) {
    return (
      <section className="quiz">
        <h2>Quiz complete</h2>

        <p className="score">
          Final score: {score} / {questions.length}
        </p>

        <p className="quiz-message">
          {score === questions.length
            ? "Perfect score. Certified album demon."
            : "Not bad. Run it back and beat your score."}
        </p>

        <div className="hero-buttons">
          <button type="button" onClick={restartQuiz}>
            Restart Quiz
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={onRestartApp}
          >
            Choose Another Album
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="quiz">
      {selectedAlbum.imageUrl && (
        <img
          className="quiz-album-cover"
          src={selectedAlbum.imageUrl}
          alt={`${selectedAlbum.title} cover`}
        />
      )}

      <h2>Guess the song</h2>

      <p className="score">
        Score: {score} / {questions.length}
      </p>

      <p className="quiz-clue">
        Question {currentQuestionIndex + 1} of {questions.length}: Pick the
        correct track from <strong>{selectedAlbum.title}</strong>.
      </p>

      <div className="audio-preview-wrapper">
        {previewUrl ? (
          <>
            <audio
              ref={audioRef}
              key={previewUrl}
              className="hidden-audio-preview"
              preload="auto"
              src={previewUrl}
              onTimeUpdate={handleAudioTimeUpdate}
              onEnded={handleAudioEnded}
            >
              Your browser does not support the audio element.
            </audio>

            <button
              type="button"
              className="clip-button"
              onClick={isClipPlaying ? stopClip : playFiveSecondClip}
            >
              {isClipPlaying ? "Stop Clip" : "Play 5 Second Clip"}
            </button>
          </>
        ) : (
          <p className="preview-unavailable">
            Audio preview unavailable. Pick the correct track from the options.
          </p>
        )}
      </div>

      <div className="song-options">
        {currentQuestion.options.map((track) => (
          <button
            type="button"
            key={track.id}
            className={`song-button ${
              guess === track.name ? "selected-song" : ""
            } ${
              hasAnswered && track.name === currentQuestion.correctTrack.name
                ? "correct-song"
                : ""
            } ${
              hasAnswered &&
              guess === track.name &&
              guess !== currentQuestion.correctTrack.name
                ? "wrong-song"
                : ""
            }`}
            onClick={() => setGuess(track.name)}
            disabled={hasAnswered}
          >
            {track.name}
          </button>
        ))}
      </div>

      {guess && (
        <p className="selected-guess">
          Your guess: <strong>{guess}</strong>
        </p>
      )}

      {!hasAnswered && (
        <button type="button" onClick={checkAnswer}>
          Submit Answer
        </button>
      )}

      {hasAnswered && currentQuestionIndex < questions.length - 1 && (
        <button type="button" className="next-button" onClick={goToNextQuestion}>
          Next Question
        </button>
      )}

      {hasAnswered && currentQuestionIndex === questions.length - 1 && (
        <button type="button" className="next-button" onClick={finishQuiz}>
          Finish Quiz
        </button>
      )}

      {message && <p className="quiz-message">{message}</p>}
    </section>
  );
}

export default Quiz;