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

  const [previewUrl, setPreviewUrl] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isClipPlaying, setIsClipPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipStartTimeRef = useRef(8);
  const clipTimerRef = useRef<number | null>(null);
  const previewCacheRef = useRef<Record<string, string | null>>({});

  const CLIP_LENGTH_SECONDS = 5;

  const currentQuestion = questions[currentQuestionIndex];
  const currentTrack = currentQuestion?.correctTrack;

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
        setPreviewUrl("");
        setIsPreviewLoading(false);
        setIsClipPlaying(false);

        previewCacheRef.current = {};

        const albumTracks = await getSpotifyAlbumTracks(selectedAlbum.id);

        if (albumTracks.length < 4) {
          setError("Not enough tracks for a quiz.");
          return;
        }

        const cleanedSpotifyTracks = albumTracks.slice(0, 20);

        setTracks(cleanedSpotifyTracks);
        setQuestions(buildQuizQuestions(cleanedSpotifyTracks));
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
    let isActive = true;

    async function loadPreviewForCurrentQuestion() {
      stopClip(false);
      setPreviewUrl("");
      setIsPreviewLoading(false);

      if (!currentTrack) {
        return;
      }

      if (currentTrack.previewUrl) {
        setPreviewUrl(currentTrack.previewUrl);
        return;
      }

      if (currentTrack.id in previewCacheRef.current) {
        const cachedPreview = previewCacheRef.current[currentTrack.id];
        setPreviewUrl(cachedPreview || "");
        return;
      }

      try {
        setIsPreviewLoading(true);

        const preview = await searchITunesPreview(
          selectedAlbum.artist,
          currentTrack.name,
          selectedAlbum.title
        );

        if (!isActive) {
          return;
        }

        const foundPreviewUrl = preview?.previewUrl || null;

        previewCacheRef.current[currentTrack.id] = foundPreviewUrl;
        setPreviewUrl(foundPreviewUrl || "");
      } catch (error) {
        console.error("Could not load preview for:", currentTrack.name, error);

        if (isActive) {
          previewCacheRef.current[currentTrack.id] = null;
          setPreviewUrl("");
        }
      } finally {
        if (isActive) {
          setIsPreviewLoading(false);
        }
      }
    }

    loadPreviewForCurrentQuestion();

    return () => {
      isActive = false;
    };
  }, [
    currentQuestionIndex,
    currentTrack,
    selectedAlbum.artist,
    selectedAlbum.title,
  ]);

  useEffect(() => {
    clearClipTimer();
    setIsClipPlaying(false);

    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.load();
    }

    return () => {
      clearClipTimer();
    };
  }, [previewUrl, currentQuestionIndex]);

  function clearClipTimer() {
    if (clipTimerRef.current !== null) {
      window.clearTimeout(clipTimerRef.current);
      clipTimerRef.current = null;
    }
  }

  function getRandomClipStart(duration: number) {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;

    const latestStart = Math.max(0, safeDuration - CLIP_LENGTH_SECONDS - 1);

    const possibleStarts = [7, 9, 11, 13, 15, 17, 19, 21].filter(
      (time) => time <= latestStart
    );

    if (possibleStarts.length === 0) {
      return 0;
    }

    const randomIndex = Math.floor(Math.random() * possibleStarts.length);
    return possibleStarts[randomIndex];
  }

  function stopClip(resetToStart = true) {
    const audio = audioRef.current;

    clearClipTimer();

    if (audio) {
      audio.pause();

      if (resetToStart) {
        audio.currentTime = clipStartTimeRef.current;
      }
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
      }, CLIP_LENGTH_SECONDS * 1000);
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
    stopClip(false);
    setCurrentQuestionIndex((currentIndex) => currentIndex + 1);
    setGuess("");
    setMessage("");
    setHasAnswered(false);
  }

  function finishQuiz() {
    stopClip(false);
    setIsQuizComplete(true);
  }

  function restartQuiz() {
    stopClip(false);
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
        <h2>Loading tracks...</h2>
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
        {isPreviewLoading && (
          <p className="preview-unavailable">Loading preview...</p>
        )}

        {!isPreviewLoading && previewUrl && (
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
              onClick={isClipPlaying ? () => stopClip() : playFiveSecondClip}
            >
              {isClipPlaying ? "Stop Clip" : "Play 5 Second Clip"}
            </button>
          </>
        )}

        {!isPreviewLoading && !previewUrl && (
          <p className="preview-unavailable">
            Audio preview unavailable for this question. Try answering from the
            options.
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