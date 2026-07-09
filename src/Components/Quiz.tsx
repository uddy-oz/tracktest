import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { SpotifyAlbum, SpotifyTrack } from "../lib/spotifyApi";
import { getSpotifyAlbumTracks } from "../lib/spotifyApi";
import { searchITunesPreview } from "../lib/itunesApi";
import { saveQuizResult } from "../lib/stats";
import { saveQuizResultToCloud } from "../lib/cloudStats";
import { pickGrade, pickHype, type HypeEvent } from "../lib/hype";
import { sounds } from "../lib/sounds";

type QuizProps = {
  selectedAlbum: SpotifyAlbum;
  onRestartApp: () => void;
  user: User | null;
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
  | "correctHold"
  | "reveal";

const QUESTION_TIME_SECONDS = 10;
const START_COUNTDOWN_SECONDS = 3;
const REVEAL_NEXT_QUESTION_DELAY_MS = 2500;
const REVEAL_COUNTDOWN_SECONDS = Math.ceil(REVEAL_NEXT_QUESTION_DELAY_MS / 1000);
const CORRECT_ANSWER_SONG_HOLD_MS = 3000;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 12;
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CONFETTI_COLORS = ["#7c5cff", "#2ee66b", "#ff4fa0", "#f2f0ea", "#ffcf4d"];

function shuffleArray<T>(array: T[]) {
  return [...array].sort(() => Math.random() - 0.5);
}

function getQuestionCount(totalPlayableTracks: number) {
  return Math.min(
    MAX_QUESTIONS,
    Math.max(MIN_QUESTIONS, Math.floor(totalPlayableTracks / 2) + 1)
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

function getStreakRewardLabel(currentStreak: number) {
  if (currentStreak >= 10) {
    return "Legendary Streak";
  }

  if (currentStreak >= 5) {
    return "On Fire";
  }

  if (currentStreak >= 3) {
    return "Hot Streak";
  }

  return "";
}

function Quiz({ selectedAlbum, onRestartApp, user }: QuizProps) {
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
  const [cloudSaveMessage, setCloudSaveMessage] = useState("");

  const [previewUrl, setPreviewUrl] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isClipPlaying, setIsClipPlaying] = useState(false);
  const [audioFallbackMessage, setAudioFallbackMessage] = useState("");
  const [isMuted, setIsMuted] = useState(sounds.isMuted());
  const [displayPoints, setDisplayPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [revealMessage, setRevealMessage] = useState("");
  const [flash, setFlash] = useState<"good" | "bad" | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipStartTimeRef = useRef(8);
  const clipTimerRef = useRef<number | null>(null);
  const correctAnswerHoldTimerRef = useRef<number | null>(null);
  const isCorrectAnswerHoldRef = useRef(false);
  const previewCacheRef = useRef<Record<string, string | null>>({});
  const hasSavedQuizResultRef = useRef(false);

  const CLIP_LENGTH_SECONDS = 5;

  const currentQuestion = questions[currentQuestionIndex];
  const currentTrack = currentQuestion?.correctTrack;
  const lastResult = questionResults[questionResults.length - 1];
  const timerProgress = Math.max(0, timeRemaining / QUESTION_TIME_SECONDS);
  const ringOffset = RING_CIRCUMFERENCE * (1 - timerProgress);
  const shouldShowDanger =
    quizPhase === "answering" && timeRemaining <= 3 && !hasAnswered;
  const activePoints = isQuizComplete ? displayPoints : totalPoints;
  const streakRewardLabel = getStreakRewardLabel(streak);

  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 34 }, (_, index) => ({
        id: index,
        left: `${Math.round(Math.random() * 100)}%`,
        delay: `${(index % 12) * 0.08}s`,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      })),
    []
  );

  const burstPieces = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: index,
        rotation: `${index * 30}deg`,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      })),
    [currentQuestionIndex]
  );

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
        setDisplayPoints(0);
        setCorrectAnswers(0);
        setQuestionResults([]);
        setStreak(0);
        setBestStreak(0);
        setRevealMessage("");
        setFlash(null);
        setTimeRemaining(QUESTION_TIME_SECONDS);
        setStartCountdown(START_COUNTDOWN_SECONDS);
        setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
        setQuizPhase("preparing");
        setHasAnswered(false);
        setIsQuizComplete(false);
        setCloudSaveMessage("");
        setPreviewUrl("");
        setIsPreviewLoading(false);
        setIsClipPlaying(false);
        setAudioFallbackMessage("");

        previewCacheRef.current = {};
        hasSavedQuizResultRef.current = false;

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
    clearCorrectAnswerHoldTimer();
    setIsClipPlaying(false);

    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.load();
    }

    return () => {
      clearClipTimer();
      clearCorrectAnswerHoldTimer();
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

    const revealEndsAt = Date.now() + REVEAL_NEXT_QUESTION_DELAY_MS;

    const timerId = window.setInterval(() => {
      const remainingMs = Math.max(0, revealEndsAt - Date.now());
      setRevealCountdown(Math.ceil(remainingMs / 1000));
    }, 250);

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

  useEffect(() => {
    if (quizPhase !== "countdown" || isQuizComplete || !currentQuestion) {
      return;
    }

    if (startCountdown > 0) {
      sounds.tick();
      return;
    }

    sounds.go();
  }, [currentQuestion, isQuizComplete, quizPhase, startCountdown]);

  useEffect(() => {
    if (
      quizPhase === "answering" &&
      timeRemaining > 0 &&
      timeRemaining <= 3 &&
      !hasAnswered
    ) {
      sounds.tick();
    }
  }, [hasAnswered, quizPhase, timeRemaining]);

  useEffect(() => {
    if (!flash) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setFlash(null);
    }, 650);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [flash]);

  useEffect(() => {
    if (!isQuizComplete) {
      setDisplayPoints(totalPoints);
      return;
    }

    const startTime = performance.now();
    const duration = 850;
    let animationFrame = 0;

    function animateScore(now: number) {
      const progress = Math.min(1, (now - startTime) / duration);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      setDisplayPoints(Math.round(totalPoints * easedProgress));

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(animateScore);
      }
    }

    setDisplayPoints(0);
    animationFrame = window.requestAnimationFrame(animateScore);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isQuizComplete, totalPoints]);

  useEffect(() => {
    return () => {
      clearClipTimer();
      clearCorrectAnswerHoldTimer();
    };
  }, []);

  function clearClipTimer() {
    if (clipTimerRef.current !== null) {
      window.clearTimeout(clipTimerRef.current);
      clipTimerRef.current = null;
    }
  }

  function clearCorrectAnswerHoldTimer() {
    if (correctAnswerHoldTimerRef.current !== null) {
      window.clearTimeout(correctAnswerHoldTimerRef.current);
      correctAnswerHoldTimerRef.current = null;
    }

    isCorrectAnswerHoldRef.current = false;
  }

  function getRandomClipStart(duration: number) {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;
    const latestStart = Math.max(0, safeDuration - CLIP_LENGTH_SECONDS);
    const preferredStart = 6;
    const preferredEnd = Math.min(22, latestStart);

    // iTunes previews do not include lyric/title timestamps. Starting later in
    // the preview reduces obvious title giveaways, but cannot fully guarantee
    // the title or hook will be avoided.
    if (preferredEnd >= preferredStart) {
      return preferredStart + Math.random() * (preferredEnd - preferredStart);
    }

    if (latestStart > 1) {
      return 1 + Math.random() * (latestStart - 1);
    }

    return 0;
  }

  function stopClip(resetToStart = true) {
    const audio = audioRef.current;

    clearClipTimer();
    clearCorrectAnswerHoldTimer();

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

    if (
      audio.currentTime >= clipStartTimeRef.current + CLIP_LENGTH_SECONDS &&
      !isCorrectAnswerHoldRef.current
    ) {
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
    if (
      !currentQuestion ||
      quizPhase === "answering" ||
      quizPhase === "correctHold" ||
      quizPhase === "reveal"
    ) {
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

  function startRevealCountdown() {
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setQuizPhase("reveal");
  }

  function holdCorrectAnswerClipBeforeReveal() {
    clearClipTimer();
    clearCorrectAnswerHoldTimer();
    isCorrectAnswerHoldRef.current = true;
    setQuizPhase("correctHold");

    correctAnswerHoldTimerRef.current = window.setTimeout(() => {
      correctAnswerHoldTimerRef.current = null;
      isCorrectAnswerHoldRef.current = false;
      stopClip(false);
      startRevealCountdown();
    }, CORRECT_ANSWER_SONG_HOLD_MS);
  }

  function resetQuestionFlow() {
    stopClip(false);
    setGuess("");
    setMessage("");
    setTimeRemaining(QUESTION_TIME_SECONDS);
    setStartCountdown(START_COUNTDOWN_SECONDS);
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setAudioFallbackMessage("");
    setRevealMessage("");
    setFlash(null);
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
    const isCorrect = !timedOut && normalizedGuess === normalizedAnswer;
    const pointsEarned = getPointsForAnswer(isCorrect, timeRemaining);
    const answerTimeSeconds = QUESTION_TIME_SECONDS - timeRemaining;
    let nextStreak = streak;
    let hypeEvent: HypeEvent = "wrong";

    if (timedOut) {
      stopClip(false);
      setMessage(`Time's up. The correct answer was ${correctAnswer}.`);
      hypeEvent = "timeout";
      nextStreak = 0;
      setStreak(0);
      setFlash("bad");
      sounds.wrong();
    } else if (isCorrect) {
      setMessage(`Correct. +${pointsEarned} points.`);
      setCorrectAnswers((currentTotal) => currentTotal + 1);
      nextStreak = streak + 1;
      hypeEvent =
        nextStreak >= 5
          ? "bigStreak"
          : answerTimeSeconds <= 2
            ? "speed"
            : nextStreak >= 2
              ? "streak"
              : questionResults.length === 0
                ? "firstCorrect"
                : lastResult && !lastResult.isCorrect
                  ? "comeback"
                  : "correct";

      setStreak(nextStreak);
      setBestStreak((currentBest) => Math.max(currentBest, nextStreak));
      setFlash("good");

      if (nextStreak >= 3) {
        sounds.streak();
      } else {
        sounds.correct();
      }
    } else {
      stopClip(false);
      setMessage(`Wrong. The correct answer was ${correctAnswer}.`);
      hypeEvent = streak >= 2 ? "streakLost" : "wrong";
      nextStreak = 0;
      setStreak(0);
      setFlash("bad");
      sounds.wrong();
    }

    setRevealMessage(getStreakRewardLabel(nextStreak) || pickHype(hypeEvent, nextStreak));
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

    if (isCorrect) {
      holdCorrectAnswerClipBeforeReveal();
      return;
    }

    startRevealCountdown();
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
    const isPerfectRun = questions.length > 0 && correctAnswers === questions.length;

    if (isPerfectRun) {
      sounds.perfectRun();
    } else {
      sounds.complete();
    }

    if (!hasSavedQuizResultRef.current) {
      const accuracy =
        questions.length > 0
          ? Math.round((correctAnswers / questions.length) * 100)
          : 0;
      const averageAnswerTime =
        questionResults.length > 0
          ? questionResults.reduce(
              (total, result) => total + result.answerTimeSeconds,
              0
            ) / questionResults.length
          : 0;

      const savedResult = saveQuizResult({
        albumName: selectedAlbum.title,
        artistName: selectedAlbum.artist,
        totalQuestions: questions.length,
        correctAnswers,
        accuracyPercentage: accuracy,
        finalPoints: totalPoints,
        averageAnswerTime,
      });

      hasSavedQuizResultRef.current = true;

      if (user) {
        setCloudSaveMessage("Saving result to cloud...");

        saveQuizResultToCloud(user, savedResult)
          .then((result) => {
            if (result.ok) {
              setCloudSaveMessage("Cloud save complete.");
              return;
            }

            setCloudSaveMessage(
              `Local stats saved. Cloud save failed: ${result.reason}`
            );
          })
          .catch((error) => {
            console.error("Cloud save failed:", error);
            setCloudSaveMessage(
              "Local stats saved. Cloud save failed unexpectedly."
            );
          });
      } else {
        setCloudSaveMessage("Local stats saved on this browser.");
      }
    }

    setIsQuizComplete(true);
  }

  function restartQuiz() {
    stopClip(false);
    setCurrentQuestionIndex(0);
    setGuess("");
    setMessage("");
    setTotalPoints(0);
    setDisplayPoints(0);
    setCorrectAnswers(0);
    setQuestionResults([]);
    setStreak(0);
    setBestStreak(0);
    setRevealMessage("");
    setFlash(null);
    setTimeRemaining(QUESTION_TIME_SECONDS);
    setStartCountdown(START_COUNTDOWN_SECONDS);
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setAudioFallbackMessage("");
    setHasAnswered(false);
    setIsQuizComplete(false);
    setCloudSaveMessage("");
    hasSavedQuizResultRef.current = false;
    setQuestions(buildQuizQuestions(tracks));
    setQuizPhase("countdown");
  }

  function handleToggleMute() {
    setIsMuted(sounds.toggleMuted());
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
    const isPerfectRun = questions.length > 0 && correctAnswers === questions.length;
    const averageAnswerTime =
      questionResults.length > 0
        ? questionResults.reduce(
            (total, result) => total + result.answerTimeSeconds,
            0
          ) / questionResults.length
        : 0;

    return (
      <section
        className={`quiz quiz-complete ${isPerfectRun ? "quiz-perfect-run" : ""}`}
      >
        <div className="confetti-field" aria-hidden="true">
          {confettiPieces.map((piece) => (
            <span
              key={piece.id}
              className="confetti-piece"
              style={{
                backgroundColor: piece.color,
                left: piece.left,
                animationDelay: piece.delay,
              }}
            />
          ))}
        </div>

        <h2>{isPerfectRun ? "Perfect Run" : "Quiz complete"}</h2>
        <p className={`grade-word ${isPerfectRun ? "gold-badge" : ""}`}>
          {isPerfectRun ? "Perfect Run Celebration" : pickGrade(accuracy)}
        </p>

        <p className="score score-hero">
          Final points: {activePoints.toLocaleString()}
        </p>

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
            Best streak:{" "}
            <strong className={isPerfectRun ? "gold-text" : ""}>
              {bestStreak}
            </strong>
          </p>
          <p>
            Album: <strong>{selectedAlbum.title}</strong>
          </p>
          <p>
            Artist: <strong>{selectedAlbum.artist}</strong>
          </p>
        </div>

        <p className="quiz-message">
          {isPerfectRun
            ? "Every question clean. Arena-ready."
            : "Not bad. Run it back and beat your score."}
        </p>

        {cloudSaveMessage && (
          <p className="cloud-save-message">{cloudSaveMessage}</p>
        )}

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
    <section className={`quiz quiz-live quiz-phase-${quizPhase}`}>
      {flash && <div className={`quiz-flash quiz-flash-${flash}`} />}
      {shouldShowDanger && <div className="danger-vignette" />}

      {selectedAlbum.imageUrl && (
        <img
          className="quiz-album-cover"
          src={selectedAlbum.imageUrl}
          alt={`${selectedAlbum.title} cover`}
        />
      )}

      <h2>Guess the song</h2>

      <p className="score score-live">Points: {totalPoints.toLocaleString()}</p>

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
        <span
          className={`streak-chip ${streak >= 2 ? "streak-active" : ""} ${
            streakRewardLabel ? "streak-reward" : ""
          } ${streak >= 10 ? "streak-legendary" : ""}`}
        >
          {streakRewardLabel ? `${streakRewardLabel}: ${streak}` : `Streak: ${streak}`}
        </span>
        <button
          type="button"
          className="mute-toggle"
          onClick={handleToggleMute}
          aria-pressed={isMuted}
        >
          {isMuted ? "Sound off" : "Sound on"}
        </button>
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
            <p className="game-state-detail">Clip starts on go.</p>
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
            <div
              className={`timer-ring ${timeRemaining <= 3 ? "timer-ring-low" : ""}`}
              aria-label={`${timeRemaining} seconds remaining`}
            >
              <svg viewBox="0 0 128 128" aria-hidden="true">
                <circle className="timer-ring-bg" cx="64" cy="64" r={RING_RADIUS} />
                <circle
                  className="timer-ring-fg"
                  cx="64"
                  cy="64"
                  r={RING_RADIUS}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <span>{timeRemaining}</span>
            </div>
            <p className="game-state-detail">
              {isClipPlaying
                ? "Clip is playing. Faster correct answers score more."
                : "Faster correct answers score more."}
            </p>
          </>
        )}

        {quizPhase === "correctHold" && (
          <>
            <p className="game-state-label">Correct</p>
            <p className="points-pop">+{lastResult?.points || 0}</p>
            {revealMessage && (
              <p className="hype-message hype-good">{revealMessage}</p>
            )}
            <p className="game-state-detail">Let it play...</p>
          </>
        )}

        {quizPhase === "reveal" && (
          <>
            <p className="game-state-label">Reveal</p>
            {lastResult?.isCorrect ? (
              <>
                <div className="correct-burst" aria-hidden="true">
                  {burstPieces.map((piece) => (
                    <span
                      key={piece.id}
                      style={{
                        backgroundColor: piece.color,
                        transform: `rotate(${piece.rotation}) translateY(-38px)`,
                      }}
                    />
                  ))}
                </div>
                <p className="points-pop">+{lastResult.points}</p>
              </>
            ) : (
              <p className="reveal-answer">
                Correct answer: <strong>{currentQuestion.correctTrack.name}</strong>
              </p>
            )}
            {revealMessage && (
              <p
                className={`hype-message ${
                  lastResult?.isCorrect ? "hype-good" : "hype-bad"
                }`}
              >
                {revealMessage}
              </p>
            )}
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
