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

type QuestionResult = {
  isCorrect: boolean;
  points: number;
  answerTimeSeconds: number;
};

type QuizPhase =
  | "preparing"
  | "countdown"
  | "audioBlocked"
  | "answering"
  | "reveal";

const QUESTION_TIME_SECONDS = 10;
const START_COUNTDOWN_SECONDS = 3;
const REVEAL_COUNTDOWN_SECONDS = 5;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 12;

function shuffleArray<T>(array: T[]) {
  return [...array].sort(() => Math.random() - 0.5);
}

function getQuestionCount(totalPlayableTracks: number) {
  return Math.min(
    MAX_QUESTIONS,
    Math.max(MIN_QUESTIONS, Math.floor(totalPlayableTracks / 2))
  );
}

function buildQuizQuestions(tracks: SpotifyTrack[]) {
  const questionCount = getQuestionCount(tracks.length);
  const quizTracks = shuffleArray(tracks).slice(0, questionCount);

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
  const [totalPoints, setTotalPoints] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([]);
  const [timeRemaining, setTimeRemaining] = useState(QUESTION_TIME_SECONDS);
  const [startCountdown, setStartCountdown] = useState(
    START_COUNTDOWN_SECONDS
  );
  const [revealCountdown, setRevealCountdown] = useState(
    REVEAL_COUNTDOWN_SECONDS
  );
  const [quizPhase, setQuizPhase] = useState<QuizPhase>("preparing");
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isQuizComplete, setIsQuizComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [previewUrl, setPreviewUrl] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isClipPlaying, setIsClipPlaying] = useState(false);
  const [audioFallbackMessage, setAudioFallbackMessage] = useState("");

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
        setTotalPoints(0);
        setCorrectAnswers(0);
        setQuestionResults([]);
        setTimeRemaining(QUESTION_TIME_SECONDS);
        setStartCountdown(START_COUNTDOWN_SECONDS);
        setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
        setQuizPhase("preparing");
        setHasAnswered(false);
        setIsQuizComplete(false);
        setPreviewUrl("");
        setIsPreviewLoading(false);
        setIsClipPlaying(false);
        setAudioFallbackMessage("");

        previewCacheRef.current = {};

        const albumTracks = await getSpotifyAlbumTracks(selectedAlbum.id);

        if (albumTracks.length < MIN_QUESTIONS) {
          setError("Not enough tracks for a quiz.");
          return;
        }

        const cleanedSpotifyTracks = albumTracks;

        setTracks(cleanedSpotifyTracks);
        setQuestions(buildQuizQuestions(cleanedSpotifyTracks));
        setQuizPhase("countdown");
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

  useEffect(() => {
    if (
      quizPhase !== "countdown" ||
      isLoading ||
      error ||
      isQuizComplete ||
      !currentQuestion ||
      startCountdown === 0
    ) {
      return;
    }

    const timerId = window.setInterval(() => {
      setStartCountdown((currentTime) => Math.max(0, currentTime - 1));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    currentQuestion,
    error,
    isLoading,
    isQuizComplete,
    quizPhase,
    startCountdown,
  ]);

  useEffect(() => {
    if (
      quizPhase !== "countdown" ||
      startCountdown !== 0 ||
      isQuizComplete ||
      !currentQuestion
    ) {
      return;
    }

    const startTimerId = window.setTimeout(() => {
      if (isPreviewLoading) {
        setQuizPhase("preparing");
        return;
      }

      void startAnswerRound(false);
    }, 600);

    return () => {
      window.clearTimeout(startTimerId);
    };
  }, [
    currentQuestion,
    isPreviewLoading,
    isQuizComplete,
    previewUrl,
    quizPhase,
    startCountdown,
  ]);

  useEffect(() => {
    if (quizPhase !== "preparing" || isPreviewLoading || !currentQuestion) {
      return;
    }

    void startAnswerRound(false);
  }, [currentQuestion, isPreviewLoading, previewUrl, quizPhase]);

  useEffect(() => {
    if (quizPhase !== "answering" || isQuizComplete || !currentQuestion) {
      return;
    }

    const timerId = window.setInterval(() => {
      setTimeRemaining((currentTime) => Math.max(0, currentTime - 1));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [currentQuestion, isQuizComplete, quizPhase]);

  useEffect(() => {
    if (
      quizPhase !== "answering" ||
      !currentQuestion ||
      hasAnswered ||
      isQuizComplete
    ) {
      return;
    }

    if (timeRemaining === 0) {
      recordAnswer("", true);
    }
  }, [
    currentQuestion,
    hasAnswered,
    isQuizComplete,
    quizPhase,
    timeRemaining,
  ]);

  useEffect(() => {
    if (quizPhase !== "reveal" || isQuizComplete || !currentQuestion) {
      return;
    }

    const timerId = window.setInterval(() => {
      setRevealCountdown((currentTime) => Math.max(0, currentTime - 1));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [currentQuestion, isQuizComplete, quizPhase]);

  useEffect(() => {
    if (
      quizPhase !== "reveal" ||
      revealCountdown !== 0 ||
      isQuizComplete ||
      !currentQuestion
    ) {
      return;
    }

    advanceAfterReveal();
  }, [
    currentQuestion,
    isQuizComplete,
    quizPhase,
    revealCountdown,
  ]);

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
      return false;
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

      return true;
    } catch (error) {
      console.error("Could not play audio clip:", error);
      setIsClipPlaying(false);
      return false;
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

  function getPointsForAnswer(isCorrect: boolean, remainingSeconds: number) {
    if (!isCorrect) {
      return 0;
    }

    const speedBonus = Math.floor(
      500 * (remainingSeconds / QUESTION_TIME_SECONDS)
    );

    return 500 + speedBonus;
  }

  async function startAnswerRound(isManualStart: boolean) {
    if (!currentQuestion || quizPhase === "answering" || quizPhase === "reveal") {
      return;
    }

    setAudioFallbackMessage("");

    if (previewUrl) {
      const didPlay = await playFiveSecondClip();

      if (!didPlay) {
        setQuizPhase("audioBlocked");
        setAudioFallbackMessage(
          isManualStart
            ? "Audio is still blocked. Try the button again."
            : "Click to play audio and continue."
        );
        return;
      }
    }

    setTimeRemaining(QUESTION_TIME_SECONDS);
    setQuizPhase("answering");
  }

  function resetQuestionFlow() {
    stopClip(false);
    setGuess("");
    setMessage("");
    setTimeRemaining(QUESTION_TIME_SECONDS);
    setStartCountdown(START_COUNTDOWN_SECONDS);
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setAudioFallbackMessage("");
    setHasAnswered(false);
    setQuizPhase("countdown");
  }

  function advanceAfterReveal() {
    stopClip(false);

    if (currentQuestionIndex >= questions.length - 1) {
      finishQuiz();
      return;
    }

    setCurrentQuestionIndex((currentIndex) => currentIndex + 1);
    resetQuestionFlow();
  }

  function recordAnswer(selectedGuess: string, timedOut = false) {
    if (!currentQuestion) {
      return;
    }

    if (hasAnswered || quizPhase !== "answering") {
      setMessage("You already answered this question.");
      return;
    }

    const correctAnswer = currentQuestion.correctTrack.name;
    const normalizedGuess = selectedGuess.toLowerCase();
    const normalizedAnswer = correctAnswer.toLowerCase();
    const isCorrect = normalizedGuess === normalizedAnswer;
    const pointsEarned = getPointsForAnswer(isCorrect, timeRemaining);
    const answerTimeSeconds = QUESTION_TIME_SECONDS - timeRemaining;

    stopClip(false);

    if (timedOut) {
      setMessage(`Time's up. The correct answer was ${correctAnswer}.`);
    } else if (isCorrect) {
      setMessage(`Correct. +${pointsEarned} points.`);
      setCorrectAnswers((currentTotal) => currentTotal + 1);
    } else {
      setMessage(`Wrong. The correct answer was ${correctAnswer}.`);
    }

    setTotalPoints((currentPoints) => currentPoints + pointsEarned);
    setQuestionResults((currentResults) => [
      ...currentResults,
      {
        isCorrect,
        points: pointsEarned,
        answerTimeSeconds,
      },
    ]);
    setHasAnswered(true);
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setQuizPhase("reveal");
  }

  function handleAnswerSelect(selectedGuess: string) {
    if (quizPhase !== "answering" || hasAnswered) {
      return;
    }

    setGuess(selectedGuess);
    recordAnswer(selectedGuess);
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
    setTotalPoints(0);
    setCorrectAnswers(0);
    setQuestionResults([]);
    setTimeRemaining(QUESTION_TIME_SECONDS);
    setStartCountdown(START_COUNTDOWN_SECONDS);
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setAudioFallbackMessage("");
    setHasAnswered(false);
    setIsQuizComplete(false);
    setQuestions(buildQuizQuestions(tracks));
    setQuizPhase("countdown");
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
    const accuracy =
      questions.length > 0 ? Math.round((correctAnswers / questions.length) * 100) : 0;
    const averageAnswerTime =
      questionResults.length > 0
        ? questionResults.reduce(
            (total, result) => total + result.answerTimeSeconds,
            0
          ) / questionResults.length
        : 0;

    return (
      <section className="quiz">
        <h2>Quiz complete</h2>

        <p className="score">Final points: {totalPoints.toLocaleString()}</p>

        <div className="score-breakdown">
          <p>
            Correct answers: <strong>{correctAnswers}</strong> /{" "}
            <strong>{questions.length}</strong>
          </p>
          <p>
            Accuracy: <strong>{accuracy}%</strong>
          </p>
          <p>
            Average answer time:{" "}
            <strong>{averageAnswerTime.toFixed(1)}s</strong>
          </p>
          <p>
            Album: <strong>{selectedAlbum.title}</strong>
          </p>
          <p>
            Artist: <strong>{selectedAlbum.artist}</strong>
          </p>
        </div>

        <p className="quiz-message">
          {correctAnswers === questions.length
            ? "Perfect run. Arena-ready."
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

      <p className="score">Points: {totalPoints.toLocaleString()}</p>

      <div className="quiz-status">
        <span>
          Correct: {correctAnswers} / {questions.length}
        </span>
        <span
          className={
            timeRemaining <= 3 && quizPhase === "answering" ? "timer-low" : ""
          }
        >
          Time: {timeRemaining}s
        </span>
      </div>

      <div className="game-state">
        {quizPhase === "preparing" && (
          <>
            <p className="game-state-label">Preparing question</p>
            <p className="game-state-detail">Getting the clip ready...</p>
          </>
        )}

        {quizPhase === "countdown" && (
          <>
            <p className="game-state-label">Get ready</p>
            <p className="start-countdown">
              {startCountdown === 0 ? "GO" : startCountdown}
            </p>
          </>
        )}

        {quizPhase === "audioBlocked" && (
          <>
            <p className="game-state-label">Audio needs a tap</p>
            <p className="game-state-detail">
              {audioFallbackMessage || "Click to play audio and continue."}
            </p>
          </>
        )}

        {quizPhase === "answering" && (
          <>
            <p className="game-state-label">Answer now</p>
            <p className="game-state-detail">
              {isClipPlaying
                ? "Clip is playing. Faster correct answers score more."
                : "Faster correct answers score more."}
            </p>
          </>
        )}

        {quizPhase === "reveal" && (
          <>
            <p className="game-state-label">Reveal</p>
            <p className="game-state-detail">
              Next question in {revealCountdown}s
            </p>
          </>
        )}
      </div>

      <p className="quiz-clue">
        Question {currentQuestionIndex + 1} of {questions.length}: Pick the
        correct track from <strong>{selectedAlbum.title}</strong>.
      </p>

      <div className="audio-preview-wrapper">
        {isPreviewLoading && quizPhase === "preparing" && (
          <p className="preview-unavailable">Loading preview...</p>
        )}

        {!isPreviewLoading && previewUrl && (
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
        )}

        {quizPhase === "audioBlocked" && previewUrl && (
          <button
            type="button"
            className="clip-button"
            onClick={() => void startAnswerRound(true)}
          >
            Click to play audio and continue
          </button>
        )}

        {!isPreviewLoading && !previewUrl && quizPhase !== "countdown" && (
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
            onClick={() => handleAnswerSelect(track.name)}
            disabled={quizPhase !== "answering" || hasAnswered}
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

      {message && <p className="quiz-message">{message}</p>}
    </section>
  );
}

export default Quiz;
