import { useEffect, useMemo, useRef, useState } from "react";
import { getAlbumDisplayTitle } from "../lib/albumDisplay";
import type { User } from "@supabase/supabase-js";
import type { SpotifyAlbum, SpotifyTrack } from "../lib/spotifyApi";
import BadgeEarnedPopup from "./BadgeEarnedPopup";
import SoloAlbumPicker from "./SoloAlbumPicker";
import { getSpotifyAlbumTracks } from "../lib/spotifyApi";
import { searchITunesPreview } from "../lib/itunesApi";
import { getTrackTestStats, saveQuizResult } from "../lib/stats";
import { saveQuizResultToCloud } from "../lib/cloudStats";
import { getArenaBadges, type ArenaBadge } from "../lib/badges";
import { fetchCloudBadgeStats } from "../lib/cloudBadgeStats";
import { pickGrade, pickHype, type HypeEvent } from "../lib/hype";
import { sounds } from "../lib/sounds";
import { isArenaDebugEnabled } from "../lib/arenaDiagnostics";
import {
  chooseSoloClipOffset,
  getSoloReserveTrack,
  SOLO_AUDIO_STALL_TIMEOUT_MS,
  SOLO_AUDIO_START_TIMEOUT_MS,
  SOLO_CLIP_SECONDS,
  startSoloAudio,
  waitForSoloMetadata,
} from "../lib/soloAudio";

type QuizProps = {
  selectedAlbum: SpotifyAlbum;
  onRestartApp: () => void;
  onStartAlbum: (album: SpotifyAlbum) => Promise<void>;
  onHome: () => void;
  onStatsUpdated?: () => void;
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
  | "audioStarting"
  | "audioBlocked"
  | "answering"
  | "correctHold"
  | "reveal";

const QUESTION_TIME_SECONDS = 10;
const START_COUNTDOWN_SECONDS = 3;
const REVEAL_NEXT_QUESTION_DELAY_MS = 800;
const REVEAL_COUNTDOWN_SECONDS = Math.ceil(REVEAL_NEXT_QUESTION_DELAY_MS / 1000);
const CORRECT_ANSWER_SONG_HOLD_MS = 1500;
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

  return quizTracks.map((track) => buildQuestion(track, tracks));
}

function buildQuestion(correctTrack: SpotifyTrack, tracks: SpotifyTrack[]): QuizQuestion {
  const wrongOptions = shuffleArray(tracks.filter(track => track.id !== correctTrack.id)).slice(0, 3);
  return { correctTrack, options: shuffleArray([correctTrack, ...wrongOptions]) };
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

function getNewlyUnlockedBadges(
  previousBadges: ArenaBadge[],
  nextBadges: ArenaBadge[]
) {
  const previousUnlockedIds = new Set(
    previousBadges.filter((badge) => badge.unlocked).map((badge) => badge.id)
  );

  return nextBadges.filter(
    (badge) => badge.unlocked && !previousUnlockedIds.has(badge.id)
  );
}

function Quiz({ selectedAlbum, onRestartApp, onStartAlbum, onHome, onStatsUpdated, user }: QuizProps) {
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [message, setMessage] = useState("");
  const [totalPoints, setTotalPoints] = useState(0);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([]);
  const [audioSkipCount, setAudioSkipCount] = useState(0);
  const [audioSkipped, setAudioSkipped] = useState(false);
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
  const [isAlbumPickerOpen, setIsAlbumPickerOpen] = useState(false);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!isQuizComplete) return;
    window.scrollTo({ top: 0, behavior: "instant" });
    resultsHeadingRef.current?.focus({ preventScroll: true });
  }, [isQuizComplete]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [cloudSaveMessage, setCloudSaveMessage] = useState("");

  const [resolvedPreview, setResolvedPreview] = useState<{ trackId: string; url: string } | null>(null);
  const [isClipPlaying, setIsClipPlaying] = useState(false);
  const [audioFallbackMessage, setAudioFallbackMessage] = useState("");
  const [isMuted, setIsMuted] = useState(sounds.isMuted());
  const [displayPoints, setDisplayPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [revealMessage, setRevealMessage] = useState("");
  const [flash, setFlash] = useState<"good" | "bad" | null>(null);
  const [earnedBadgeQueue, setEarnedBadgeQueue] = useState<ArenaBadge[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipStartTimeRef = useRef(0);
  const audioStartRef = useRef<AbortController | null>(null);
  const audioPreparedAtRef = useRef(0);
  const allowLateSeekRef = useRef(true);
  const countdownFinishedAtRef = useRef<number | null>(null);
  const answerDeadlineRef = useRef(0);
  const clipTimerRef = useRef<number | null>(null);
  const correctAnswerHoldTimerRef = useRef<number | null>(null);
  const isCorrectAnswerHoldRef = useRef(false);
  const previewCacheRef = useRef<Record<string, string>>({});
  const hasSavedQuizResultRef = useRef(false);
  const runRevisionRef = useRef(0);
  const retiredAudioTracksRef = useRef<SpotifyTrack[]>([]);
  const hasAnsweredRef = useRef(false);
  const isEndingRunRef = useRef(false);

  const currentQuestion = questions[currentQuestionIndex];
  const currentTrack = currentQuestion?.correctTrack;
  const previewUrl = currentTrack?.previewUrl ||
    (resolvedPreview?.trackId === currentTrack?.id ? resolvedPreview?.url : "") || "";
  const isPreviewLoading = Boolean(
    currentTrack && !currentTrack.previewUrl && resolvedPreview?.trackId !== currentTrack.id
  );
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
    const controller = new AbortController();
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
        setAudioSkipCount(0);
        setAudioSkipped(false);
        retiredAudioTracksRef.current = [];
        setStreak(0);
        setBestStreak(0);
        setRevealMessage("");
        setFlash(null);
        setEarnedBadgeQueue([]);
        setTimeRemaining(QUESTION_TIME_SECONDS);
        setStartCountdown(START_COUNTDOWN_SECONDS);
        setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
        setQuizPhase("preparing");
        setHasAnswered(false);
        hasAnsweredRef.current = false;
        setIsQuizComplete(false);
        setCloudSaveMessage("");
        setResolvedPreview(null);
        setIsClipPlaying(false);
        setAudioFallbackMessage("");

        previewCacheRef.current = {};
        hasSavedQuizResultRef.current = false;
        isEndingRunRef.current = false;

        const albumTracks = await getSpotifyAlbumTracks(selectedAlbum.id, { signal: controller.signal });
        if (controller.signal.aborted) return;

        if (albumTracks.length < MIN_QUESTIONS) {
          setError("Not enough tracks for a quiz.");
          return;
        }

        const cleanedSpotifyTracks = albumTracks;

        setTracks(cleanedSpotifyTracks);
        setQuestions(buildQuizQuestions(cleanedSpotifyTracks));
        setQuizPhase("countdown");
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setError("Could not load tracks for this album.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    loadTracks();
    return () => controller.abort();
  }, [selectedAlbum.id, selectedAlbum.artist, selectedAlbum.title]);

  useEffect(() => {
    if (!currentTrack || currentTrack.previewUrl) return;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => {
      controller.abort();
      setResolvedPreview({ trackId: currentTrack.id, url: "" });
    }, 6000);

    async function loadPreviewForCurrentQuestion() {
      if (!currentTrack) return;
      try {
        const cached = previewCacheRef.current[currentTrack.id];
        const foundPreviewUrl = cached ?? (await searchITunesPreview(
          selectedAlbum.artist,
          currentTrack.name,
          selectedAlbum.title,
          controller.signal
        ))?.previewUrl ?? "";
        if (controller.signal.aborted) return;
        previewCacheRef.current[currentTrack.id] = foundPreviewUrl;
        setResolvedPreview({ trackId: currentTrack.id, url: foundPreviewUrl });
      } finally {
        window.clearTimeout(deadline);
      }
    }

    loadPreviewForCurrentQuestion();

    return () => {
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [
    currentQuestionIndex,
    currentTrack,
    selectedAlbum.artist,
    selectedAlbum.title,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !previewUrl || !currentQuestion) return;
    audioPreparedAtRef.current = performance.now();
    allowLateSeekRef.current = true;
    clipStartTimeRef.current = 0;
    function prepareOffset() {
      if (!audio || audio.error || !allowLateSeekRef.current) return;
      const offset = chooseSoloClipOffset(audio.duration);
      try {
        audio.currentTime = offset;
        clipStartTimeRef.current = offset;
      } catch {
        // Non-seekable previews can still play from the beginning.
      }
    }
    if (audio.readyState >= 1) prepareOffset();
    else audio.addEventListener("loadedmetadata", prepareOffset, { once: true });

    return () => {
      audio.removeEventListener("loadedmetadata", prepareOffset);
      audioStartRef.current?.abort();
      audioStartRef.current = null;
      audio.pause();
      clearClipTimer();
      clearCorrectAnswerHoldTimer();
    };
  }, [previewUrl, currentQuestion]);

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
      countdownFinishedAtRef.current ??= performance.now();
      if (!isPreviewLoading) void startAnswerRound(false);
    }, 0);
    return () => window.clearTimeout(startTimerId);
  }, [
    currentQuestion,
    isPreviewLoading,
    isQuizComplete,
    previewUrl,
    quizPhase,
    startCountdown,
  ]);

  useEffect(() => {
    if (quizPhase !== "answering" || isQuizComplete || !currentQuestion) {
      return;
    }

    const timerId = window.setInterval(() => {
      setTimeRemaining(Math.max(0, Math.ceil((answerDeadlineRef.current - performance.now()) / 1000)));
    }, 100);

    return () => {
      window.clearInterval(timerId);
    };
  }, [currentQuestion, isQuizComplete, quizPhase]);

  useEffect(() => {
    if (quizPhase !== "audioStarting" && quizPhase !== "answering") return;
    function handleVisibility() {
      if (document.hidden) skipAudioQuestion("tab_hidden");
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  });

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

    if (startCountdown > 0) sounds.tick();
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

  function stopClip(resetToStart = true) {
    const audio = audioRef.current;

    clearClipTimer();
    clearCorrectAnswerHoldTimer();
    audioStartRef.current?.abort();
    audioStartRef.current = null;

    if (audio) {
      audio.pause();

      if (resetToStart && audio.readyState >= 1) {
        audio.currentTime = clipStartTimeRef.current;
      }
    }

    setIsClipPlaying(false);
  }

  function logSoloAudio(event: string, details: Record<string, unknown> = {}) {
    if (!isArenaDebugEnabled()) return;
    console.info("[STANZER_SOLO_AUDIO]", {
      event, round: currentQuestionIndex + 1,
      readyState: audioRef.current?.readyState,
      networkState: audioRef.current?.networkState,
      mediaError: audioRef.current?.error?.code,
      ...details,
    });
  }

  function skipAudioQuestion(reason: string) {
    if (!currentQuestion || isEndingRunRef.current || hasAnsweredRef.current) return;
    hasAnsweredRef.current = true;
    stopClip(false);
    // Do not offer a fresh scored question after the original started playing.
    const replacement = answerDeadlineRef.current === 0
      ? getSoloReserveTrack(tracks, questions.map(question => question.correctTrack), retiredAudioTracksRef.current)
      : undefined;
    if (replacement) {
      retiredAudioTracksRef.current.push(currentQuestion.correctTrack);
      const next = buildQuestion(replacement, tracks);
      logSoloAudio("question_replaced", { reason });
      setQuestions(questions.map((question, index) => index === currentQuestionIndex ? next : question));
      resetQuestionFlow();
      setMessage("Clip unavailable. Loading a replacement question.");
      return;
    }
    logSoloAudio("question_skipped", { reason });
    setHasAnswered(true);
    setAudioSkipCount(count => count + 1);
    setAudioSkipped(true);
    setMessage("Question skipped. Points and streak unchanged. This run will not be saved.");
    setRevealMessage("");
    startRevealCountdown();
  }

  function handleAudioTimeUpdate() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (
      audio.currentTime >= clipStartTimeRef.current + SOLO_CLIP_SECONDS &&
      !isCorrectAnswerHoldRef.current
    ) {
      stopClip();
    }
  }

  function handleAudioEnded() {
    clearClipTimer();
    setIsClipPlaying(false);
    const audio = audioRef.current;
    if (audio && quizPhase === "answering" && isClipPlaying &&
        audio.currentTime - clipStartTimeRef.current < SOLO_CLIP_SECONDS - 0.25) {
      skipAudioQuestion("preview_ended_early");
    }
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
      quizPhase === "reveal" ||
      isEndingRunRef.current ||
      audioStartRef.current ||
      answerDeadlineRef.current
    ) {
      return;
    }

    const audio = audioRef.current;
    if (document.hidden && previewUrl && audio && !audio.error) {
      setAudioFallbackMessage("Tap Retry Audio when you are ready to listen.");
      setQuizPhase("audioBlocked");
      return;
    }
    if (!previewUrl || !audio || audio.error) {
      skipAudioQuestion("preview_unavailable");
      return;
    }

    const attempt = new AbortController();
    audioStartRef.current = attempt;
    const requestedAt = performance.now();
    if (isManualStart) {
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = clipStartTimeRef.current;
        } catch {
          // Play within the gesture even if the browser cannot seek.
        }
      }
      else allowLateSeekRef.current = false;
    }
    setQuizPhase("audioStarting");
    const metadata = !isManualStart && audio.readyState < 1
      ? await waitForSoloMetadata(audio, attempt.signal)
      : "ready";
    if (audioStartRef.current !== attempt || attempt.signal.aborted) return;
    const playRequestedAt = performance.now();
    const remainingBudgetMs = SOLO_AUDIO_START_TIMEOUT_MS - (playRequestedAt - requestedAt);
    if (metadata === "ready" && remainingBudgetMs > 0) {
      logSoloAudio("play_requested", {
        manual: isManualStart, bufferedForMs: Math.round(playRequestedAt - audioPreparedAtRef.current),
        metadataWaitMs: Math.round(playRequestedAt - requestedAt),
      });
    }
    const outcome = metadata !== "ready" ? metadata : remainingBudgetMs > 0
      ? await startSoloAudio(audio, attempt.signal, remainingBudgetMs)
      : "timeout";
    if (audioStartRef.current !== attempt || attempt.signal.aborted) return;
    audioStartRef.current = null;
    const observedAt = performance.now();
    logSoloAudio("play_result", {
      outcome, manual: isManualStart,
      startupMs: Math.round(observedAt - requestedAt),
      playToPlaybackMs: metadata === "ready" ? Math.round(observedAt - playRequestedAt) : null,
      afterCountdownMs: Math.round(observedAt - (countdownFinishedAtRef.current ?? requestedAt)),
    });

    if (outcome !== "playing") {
      stopClip(false);
      if (!isManualStart && (outcome === "blocked" || outcome === "timeout")) {
        setQuizPhase("audioBlocked");
        setAudioFallbackMessage(outcome === "blocked"
          ? "Your browser needs a tap to start the clip."
          : "The clip took too long to start. Retry or skip this question.");
      } else if (outcome !== "aborted") {
        skipAudioQuestion(outcome);
      }
      return;
    }

    setIsClipPlaying(true);
    clipStartTimeRef.current = audio.currentTime;
    const stopAt = clipStartTimeRef.current + SOLO_CLIP_SECONDS;
    let lastPosition = audio.currentTime;
    let lastMovement = performance.now();
    const checkClip = () => {
      if (audio.currentTime >= stopAt) {
        stopClip();
        return;
      }
      if (audio.currentTime > lastPosition + 0.005) {
        lastPosition = audio.currentTime;
        lastMovement = performance.now();
      } else if (performance.now() - lastMovement >= SOLO_AUDIO_STALL_TIMEOUT_MS) {
        skipAudioQuestion("playback_stalled");
        return;
      }
      clipTimerRef.current = window.setTimeout(checkClip, 50);
    };
    clipTimerRef.current = window.setTimeout(checkClip, 50);
    answerDeadlineRef.current = observedAt + QUESTION_TIME_SECONDS * 1000;
    sounds.go();
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
    setAudioSkipped(false);
    answerDeadlineRef.current = 0;
    countdownFinishedAtRef.current = null;
    setGuess("");
    setMessage("");
    setTimeRemaining(QUESTION_TIME_SECONDS);
    setStartCountdown(START_COUNTDOWN_SECONDS);
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setAudioFallbackMessage("");
    setRevealMessage("");
    setFlash(null);
    setHasAnswered(false);
    hasAnsweredRef.current = false;
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

    if (hasAnsweredRef.current || hasAnswered || quizPhase !== "answering") {
      setMessage("You already answered this question.");
      return;
    }

    hasAnsweredRef.current = true;

    const correctAnswer = currentQuestion.correctTrack.name;
    const normalizedGuess = selectedGuess.toLowerCase();
    const normalizedAnswer = correctAnswer.toLowerCase();
    const remainingSeconds = Math.max(0, Math.ceil((answerDeadlineRef.current - performance.now()) / 1000));
    timedOut ||= remainingSeconds === 0;
    const isCorrect = !timedOut && normalizedGuess === normalizedAnswer;
    const pointsEarned = getPointsForAnswer(isCorrect, remainingSeconds);
    const answerTimeSeconds = QUESTION_TIME_SECONDS - remainingSeconds;
    let nextStreak = streak;
    let hypeEvent: HypeEvent;

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
    if (isEndingRunRef.current) {
      return;
    }

    stopClip(false);
    if (audioSkipCount > 0 || questionResults.length !== questions.length) {
      setCloudSaveMessage("Practice only: audio was skipped, so this run does not update scores, badges, or Daily Goals.");
      setIsQuizComplete(true);
      return;
    }
    const isPerfectRun = questions.length > 0 && correctAnswers === questions.length;

    if (isPerfectRun) {
      sounds.perfectRun();
    } else {
      sounds.complete();
    }

    if (!hasSavedQuizResultRef.current) {
      const localBadgesBefore = getArenaBadges(getTrackTestStats());
      const cloudBadgesBeforePromise = user
        ? fetchCloudBadgeStats(user)
            .then(({ data }) => (data ? getArenaBadges(data) : null))
            .catch(() => null)
        : Promise.resolve(null);
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

      const localBadgesAfter = getArenaBadges(getTrackTestStats());
      hasSavedQuizResultRef.current = true;

      if (user) {
        const savedRun = runRevisionRef.current;
        const isCurrentRun = () => runRevisionRef.current === savedRun;
        setCloudSaveMessage("Saving result to cloud...");

        saveQuizResultToCloud(user, savedResult)
          .then(async (result) => {
            if (result.ok) {
              if (isCurrentRun()) setCloudSaveMessage("Cloud save complete.");
              const cloudBadgesBefore = await cloudBadgesBeforePromise;
              const { data: cloudStatsAfter } = await fetchCloudBadgeStats(user);

              if (!isCurrentRun()) {
                void onStatsUpdated?.();
                return;
              }
              if (cloudBadgesBefore && cloudStatsAfter) {
                enqueueEarnedBadges(
                  getNewlyUnlockedBadges(
                    cloudBadgesBefore,
                    getArenaBadges(cloudStatsAfter)
                  )
                );
              } else {
                enqueueEarnedBadges(
                  getNewlyUnlockedBadges(localBadgesBefore, localBadgesAfter)
                );
              }

              void onStatsUpdated?.();
              return;
            }

            if (isCurrentRun()) {
              setCloudSaveMessage(
                `Local stats saved. Cloud save failed: ${result.reason}`
              );
              enqueueEarnedBadges(
                getNewlyUnlockedBadges(localBadgesBefore, localBadgesAfter)
              );
            }
            void onStatsUpdated?.();
          })
          .catch((error) => {
            console.error("Cloud save failed:", error);
            if (isCurrentRun()) {
              setCloudSaveMessage(
                "Local stats saved. Cloud save failed unexpectedly."
              );
              enqueueEarnedBadges(
                getNewlyUnlockedBadges(localBadgesBefore, localBadgesAfter)
              );
            }
            void onStatsUpdated?.();
          });
      } else {
        setCloudSaveMessage("Local stats saved on this browser.");
        enqueueEarnedBadges(
          getNewlyUnlockedBadges(localBadgesBefore, localBadgesAfter)
        );
        void onStatsUpdated?.();
      }
    }

    setIsQuizComplete(true);
  }

  function restartQuiz() {
    runRevisionRef.current += 1;
    stopClip(false);
    setAudioSkipCount(0);
    setAudioSkipped(false);
    retiredAudioTracksRef.current = [];
    answerDeadlineRef.current = 0;
    countdownFinishedAtRef.current = null;
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
    setEarnedBadgeQueue([]);
    setTimeRemaining(QUESTION_TIME_SECONDS);
    setStartCountdown(START_COUNTDOWN_SECONDS);
    setRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setAudioFallbackMessage("");
    setHasAnswered(false);
    hasAnsweredRef.current = false;
    setIsQuizComplete(false);
    setCloudSaveMessage("");
    hasSavedQuizResultRef.current = false;
    isEndingRunRef.current = false;
    setQuestions(buildQuizQuestions(tracks));
    setQuizPhase("countdown");
  }

  function handleToggleMute() {
    const nextMuted = sounds.toggleMuted();
    setIsMuted(nextMuted);
    if (!nextMuted) sounds.prime();
  }

  function handleEndRun() {
    if (!window.confirm("End this run? Your unfinished quiz will not be saved.")) {
      return;
    }

    isEndingRunRef.current = true;
    hasAnsweredRef.current = true;
    stopClip(false);
    onRestartApp();
  }

  function enqueueEarnedBadges(badges: ArenaBadge[]) {
    if (badges.length === 0) {
      return;
    }

    setEarnedBadgeQueue((currentQueue) => [...currentQueue, ...badges]);
  }

  function dismissEarnedBadge() {
    setEarnedBadgeQueue((currentQueue) => currentQueue.slice(1));
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
    const playedQuestions = questionResults.length;
    const accuracy =
      playedQuestions > 0 ? Math.round((correctAnswers / playedQuestions) * 100) : 0;
    const isPerfectRun = audioSkipCount === 0 && questions.length > 0 && correctAnswers === questions.length;
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
        <BadgeEarnedPopup
          badge={earnedBadgeQueue[0] || null}
          onDone={dismissEarnedBadge}
        />

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

        <h2 ref={resultsHeadingRef} tabIndex={-1}>{audioSkipCount > 0 ? "Practice run complete" : isPerfectRun ? "Perfect Run" : "Quiz complete"}</h2>
        <p className={`grade-word ${isPerfectRun ? "gold-badge" : ""}`}>
          {isPerfectRun ? "Perfect Run Celebration" : pickGrade(accuracy)}
        </p>

        <p className="score score-hero">
          Final points: {activePoints.toLocaleString()}
        </p>

        <div className="score-breakdown">
          <p>
            Correct answers: <strong>{correctAnswers}</strong> /{" "}
            <strong>{playedQuestions}</strong>
          </p>
          {audioSkipCount > 0 && <p>Audio skips: <strong>{audioSkipCount}</strong></p>}
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
            Album: <strong>{getAlbumDisplayTitle(selectedAlbum.title)}</strong>
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
          <p className="cloud-save-message" role="status">{cloudSaveMessage}</p>
        )}

        <div className="hero-buttons solo-postgame-actions">
          <button type="button" onClick={restartQuiz}>
            Rematch Same Album
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setIsAlbumPickerOpen(true)}
          >
            Choose Another Album
          </button>
          <button type="button" className="secondary-button" onClick={onHome}>
            Back to Home
          </button>
        </div>
        {isAlbumPickerOpen && (
          <SoloAlbumPicker
            onClose={() => setIsAlbumPickerOpen(false)}
            onStartAlbum={async (album) => {
              if (album.id === selectedAlbum.id) {
                setIsAlbumPickerOpen(false);
                restartQuiz();
              } else {
                await onStartAlbum(album);
              }
            }}
          />
        )}
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
          alt={`${getAlbumDisplayTitle(selectedAlbum.title)} cover`}
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
        <button
          type="button"
          className="mute-toggle quiz-end-run"
          onClick={handleEndRun}
        >
          End Run
        </button>
      </div>

      <div className="game-state">
        {(quizPhase === "preparing" || quizPhase === "audioStarting" ||
          (quizPhase === "countdown" && startCountdown === 0)) && (
          <>
            <p className="game-state-label">Preparing question</p>
            <p className="game-state-detail">Getting the clip ready...</p>
          </>
        )}

        {quizPhase === "countdown" && startCountdown > 0 && (
          <>
            <p className="game-state-label">Get ready</p>
            <p className="start-countdown">
              {startCountdown}
            </p>
            <p className="game-state-detail">Clip starts on go.</p>
          </>
        )}

        {quizPhase === "audioBlocked" && (
          <>
            <p className="game-state-label">Audio not ready</p>
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
            {audioSkipped ? <p className="game-state-detail">Audio skipped</p> : lastResult?.isCorrect ? (
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
        correct track from <strong>{getAlbumDisplayTitle(selectedAlbum.title)}</strong>.
      </p>

      <audio
        ref={audioRef}
        className="hidden-audio-preview"
        preload="auto"
        src={previewUrl || undefined}
        onTimeUpdate={handleAudioTimeUpdate}
        onEnded={handleAudioEnded}
        onWaiting={() => logSoloAudio("playback_waiting")}
        onError={() => {
          if (quizPhase === "answering" && isClipPlaying) skipAudioQuestion("media_error");
        }}
      >
        Your browser does not support the audio element.
      </audio>

      {quizPhase === "audioBlocked" && previewUrl && (
        <div className="solo-audio-actions">
            <button
              type="button"
              className="clip-button"
              onClick={() => void startAnswerRound(true)}
            >
              Retry Audio
            </button>
            <button type="button" className="secondary-button" onClick={() => skipAudioQuestion("player_skipped")}>
              Skip Question
            </button>
        </div>
      )}

      <div className="song-options">
        {currentQuestion.options.map((track) => (
          <button
            type="button"
            key={track.id}
            className={`song-button ${
              guess === track.name ? "selected-song" : ""
            } ${
              hasAnswered && !audioSkipped && track.name === currentQuestion.correctTrack.name
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
