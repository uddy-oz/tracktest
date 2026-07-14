import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  activateDuelRoom,
  cancelDuelRoom,
  createDuelRoom,
  endArenaRoom,
  fetchArenaRoom,
  fetchArenaInvite,
  fetchCurrentDuelRoom,
  fetchOpenDuelRooms,
  finishDuelRoom,
  forfeitDuelRoom,
  getFriendlyArenaError,
  joinArenaRoomByInvite,
  joinDuelRoom,
  leaveWaitingDuelRoom,
  normalizeArenaInviteCode,
  requestArenaRematch,
  resetArenaRoomForRematch,
  type ArenaInvite,
  saveDuelPlayerResult,
  updateDuelPlayerProgress,
  type ArenaRoom,
  type ArenaRoomMode,
  type ArenaRoomPlayer,
  type DuelQuizQuestion,
} from "../lib/arenaRooms";
import type { UserProfile } from "../lib/profiles";
import {
  getSpotifyAlbumTracks,
  searchSpotifyAlbums,
  type SpotifyAlbum,
  type SpotifyTrack,
} from "../lib/spotifyApi";
import { sounds } from "../lib/sounds";
import ArenaActiveRoomCard from "./ArenaActiveRoomCard";

const arenaModes = [
  {
    title: "Duel",
    label: "1v1",
    description: "Challenge one player head to head on one album.",
    accent: "duel",
    enabled: true,
  },
  {
    title: "Group Lobby",
    label: "3-10",
    description: "3 to 10 players compete on one album.",
    accent: "group",
    enabled: true,
  },
  {
    title: "Party Mode",
    label: "Host",
    description:
      "In person game where one host plays music and everyone answers on their phones.",
    accent: "party",
    enabled: false,
  },
  {
    title: "Championship",
    label: "Final",
    description: "Multi album tournament with one final winner.",
    accent: "championship",
    enabled: false,
  },
];

type DuelPhase =
  | "idle"
  | "syncing"
  | "countdown"
  | "preparing"
  | "audioBlocked"
  | "answering"
  | "correctHold"
  | "reveal";

type DuelResult = {
  isCorrect: boolean;
  points: number;
  correctAnswer: string;
};

const ALBUMS_PER_PAGE = 8;
const MAX_VISIBLE_ALBUMS = 48;
const QUESTION_TIME_SECONDS = 10;
const START_COUNTDOWN_SECONDS = 3;
const REVEAL_NEXT_QUESTION_DELAY_MS = 800;
const REVEAL_COUNTDOWN_SECONDS = Math.ceil(REVEAL_NEXT_QUESTION_DELAY_MS / 1000);
const CORRECT_ANSWER_SONG_HOLD_MS = 1500;
const CLIP_LENGTH_SECONDS = 5;
const DUEL_SYNC_START_DELAY_MS = 5000;
const DUEL_ROOM_REFRESH_MS = 2500;
const DUEL_OPEN_ROOM_REFRESH_MS = 12000;
const ARENA_MODE_SETTINGS: Record<
  ArenaRoomMode,
  {
    title: string;
    roomTitle: string;
    activeTitle: string;
    resultsTitle: string;
    maxPlayers: number;
    minPlayersToStart: number;
  }
> = {
  duel: {
    title: "Duel",
    roomTitle: "Duel Room",
    activeTitle: "Duel Active",
    resultsTitle: "Duel Results",
    maxPlayers: 2,
    minPlayersToStart: 2,
  },
  group_lobby: {
    title: "Group Lobby",
    roomTitle: "Group Lobby",
    activeTitle: "Group Lobby Active",
    resultsTitle: "Group Results",
    maxPlayers: 10,
    minPlayersToStart: 3,
  },
};
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 12;
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type ArenaPageProps = {
  session: Session | null;
  profile: UserProfile | null;
  onHome: () => void;
  onLogin: () => void;
  inviteCode?: string | null;
  recoveredRoom?: ArenaRoom | null;
  onArenaRoomChange?: (room: ArenaRoom | null) => void;
  onInviteHandled?: () => void;
};

type ArenaTheme = ArenaRoomMode | "party" | "championship";

function ArenaPage({
  session,
  profile,
  onHome,
  onLogin,
  inviteCode,
  recoveredRoom,
  onArenaRoomChange,
  onInviteHandled,
}: ArenaPageProps) {
  const [selectedArenaTheme, setSelectedArenaTheme] =
    useState<ArenaTheme>("duel");
  const [activeArenaMode, setActiveArenaMode] = useState<ArenaRoomMode | null>(
    null
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [visibleAlbumCount, setVisibleAlbumCount] = useState(ALBUMS_PER_PAGE);
  const [rooms, setRooms] = useState<ArenaRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<ArenaRoom | null>(null);
  const [message, setMessage] = useState("");
  const [isPrivateRoom, setIsPrivateRoom] = useState(false);
  const [pendingPublicRoom, setPendingPublicRoom] = useState<ArenaRoom | null>(
    null
  );
  const [pendingInvite, setPendingInvite] = useState<ArenaInvite | null>(null);
  const [isInviteLoading, setIsInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [isJoiningInvite, setIsJoiningInvite] = useState(false);
  const [isChoosingRematchAlbum, setIsChoosingRematchAlbum] = useState(false);
  const [isClosingActiveRoom, setIsClosingActiveRoom] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isPreparingDuel, setIsPreparingDuel] = useState(false);

  const [duelQuestionIndex, setDuelQuestionIndex] = useState(0);
  const [duelScore, setDuelScore] = useState(0);
  const [duelCorrectAnswers, setDuelCorrectAnswers] = useState(0);
  const [duelAnswerTimes, setDuelAnswerTimes] = useState<number[]>([]);
  const [duelStreak, setDuelStreak] = useState(0);
  const [duelTimeRemaining, setDuelTimeRemaining] = useState(QUESTION_TIME_SECONDS);
  const [duelStartCountdown, setDuelStartCountdown] = useState(
    START_COUNTDOWN_SECONDS
  );
  const [duelSyncCountdown, setDuelSyncCountdown] = useState(0);
  const [duelRevealCountdown, setDuelRevealCountdown] = useState(
    REVEAL_COUNTDOWN_SECONDS
  );
  const [duelSelectedAnswer, setDuelSelectedAnswer] = useState("");
  const [duelPhase, setDuelPhase] = useState<DuelPhase>("idle");
  const [duelAudioFallbackMessage, setDuelAudioFallbackMessage] = useState("");
  const [isDuelClipPlaying, setIsDuelClipPlaying] = useState(false);
  const [isDuelFinished, setIsDuelFinished] = useState(false);
  const [duelRevealMessage, setDuelRevealMessage] = useState("");
  const [duelLastResult, setDuelLastResult] = useState<DuelResult | null>(null);
  const [duelFlash, setDuelFlash] = useState<"good" | "bad" | null>(null);
  const [isDuelMuted, setIsDuelMuted] = useState(sounds.isMuted());

  const duelAudioRef = useRef<HTMLAudioElement | null>(null);
  const duelClipTimerRef = useRef<number | null>(null);
  const duelCorrectAnswerHoldTimerRef = useRef<number | null>(null);
  const isDuelCorrectHoldRef = useRef(false);
  const hasSubmittedDuelResultRef = useRef(false);

  const currentDuelQuestion = activeRoom?.quizQuestions[duelQuestionIndex];
  const selectedMode =
    activeArenaMode || pendingInvite?.mode || pendingPublicRoom?.mode || activeRoom?.mode || null;
  const modeSettings =
    selectedMode && selectedMode in ARENA_MODE_SETTINGS
      ? ARENA_MODE_SETTINGS[selectedMode as ArenaRoomMode]
      : ARENA_MODE_SETTINGS.duel;
  const cappedAlbums = albums.slice(0, MAX_VISIBLE_ALBUMS);
  const visibleAlbums = cappedAlbums.slice(0, visibleAlbumCount);
  const hasMoreAlbums = visibleAlbums.length < cappedAlbums.length;
  const duelTimerProgress = Math.max(0, duelTimeRemaining / QUESTION_TIME_SECONDS);
  const duelRingOffset = RING_CIRCUMFERENCE * (1 - duelTimerProgress);
  const shouldShowDuelDanger =
    duelPhase === "answering" && duelTimeRemaining <= 3 && !duelSelectedAnswer;
  const visibleRecoveryRoom = activeRoom || recoveredRoom || null;

  const burstPieces = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: index,
        rotation: `${index * 30}deg`,
        color: ["#7c5cff", "#2ee66b", "#ff4fa0", "#f2f0ea"][index % 4],
      })),
    [duelQuestionIndex]
  );

  useEffect(() => {
    if (!activeArenaMode) {
      return;
    }

    void loadOpenRooms(false);

    if (session?.user && !inviteCode) {
      void reconnectCurrentDuelRoom();
    }
  }, [activeArenaMode, session?.user?.id, inviteCode]);

  useEffect(() => {
    let isActive = true;

    async function loadInvite() {
      if (!inviteCode) {
        setPendingInvite(null);
        setInviteError("");
        return;
      }

      setIsInviteLoading(true);
      setInviteError("");
      setPendingPublicRoom(null);
      updateActiveRoom(null);

      const { invite, error } = await fetchArenaInvite(inviteCode);

      if (!isActive) {
        return;
      }

      if (invite) {
        setPendingInvite(invite);
        setActiveArenaMode(invite.mode);
        setSelectedArenaTheme(invite.mode);
      } else {
        setPendingInvite(null);
        setInviteError(error || "Invite not found.");
        setActiveArenaMode("duel");
        setSelectedArenaTheme("duel");
      }

      setIsInviteLoading(false);
    }

    void loadInvite();

    return () => {
      isActive = false;
    };
  }, [inviteCode]);

  useEffect(() => {
    if (!recoveredRoom || activeRoom || pendingInvite || inviteCode) {
      return;
    }

    updateActiveRoom(recoveredRoom);
    resetDuelLocalState();
  }, [activeRoom, inviteCode, pendingInvite, recoveredRoom]);

  useEffect(() => {
    if (!activeArenaMode || activeRoom) {
      return;
    }

    const refreshId = window.setInterval(() => {
      void loadOpenRooms(false);
    }, DUEL_OPEN_ROOM_REFRESH_MS);

    return () => window.clearInterval(refreshId);
  }, [activeRoom, activeArenaMode]);

  useEffect(() => {
    if (!activeRoom) {
      return;
    }

    const refreshId = window.setInterval(() => {
      void refreshActiveRoom(false);
    }, DUEL_ROOM_REFRESH_MS);

    return () => window.clearInterval(refreshId);
  }, [activeRoom?.id]);

  useEffect(() => {
    if (
      !activeRoom ||
      activeRoom.status !== "active" ||
      activeRoom.quizQuestions.length === 0 ||
      isDuelFinished ||
      duelPhase !== "idle"
    ) {
      return;
    }

    const startsAtMs = activeRoom.startedAt ? Date.parse(activeRoom.startedAt) : 0;

    if (startsAtMs && Date.now() < startsAtMs) {
      setDuelPhase("syncing");
      return;
    }

    setDuelStartCountdown(START_COUNTDOWN_SECONDS);
    setDuelPhase("countdown");
  }, [
    activeRoom?.id,
    activeRoom?.quizQuestions.length,
    activeRoom?.startedAt,
    activeRoom?.status,
    duelPhase,
    isDuelFinished,
  ]);

  useEffect(() => {
    return () => {
      clearDuelClipTimer();
      clearDuelCorrectAnswerHoldTimer();
    };
  }, []);

  useEffect(() => {
    stopDuelClip(false);

    const audio = duelAudioRef.current;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.load();
    }

    return () => {
      clearDuelClipTimer();
      clearDuelCorrectAnswerHoldTimer();
    };
  }, [currentDuelQuestion?.correctTrack.previewUrl, duelQuestionIndex]);

  useEffect(() => {
    if (duelPhase !== "syncing" || !activeRoom?.startedAt) {
      return;
    }

    const syncId = window.setInterval(() => {
      const remainingMs = Math.max(0, Date.parse(activeRoom.startedAt || "") - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);

      setDuelSyncCountdown(remainingSeconds);

      if (remainingMs === 0) {
        window.clearInterval(syncId);
        setDuelStartCountdown(START_COUNTDOWN_SECONDS);
        setDuelPhase("countdown");
      }
    }, 250);

    return () => window.clearInterval(syncId);
  }, [activeRoom?.startedAt, duelPhase]);

  useEffect(() => {
    if (
      duelPhase !== "countdown" ||
      isDuelFinished ||
      !currentDuelQuestion ||
      duelStartCountdown === 0
    ) {
      return;
    }

    const timerId = window.setInterval(() => {
      setDuelStartCountdown((currentTime) => Math.max(0, currentTime - 1));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [currentDuelQuestion, duelPhase, duelStartCountdown, isDuelFinished]);

  useEffect(() => {
    if (duelPhase !== "countdown" || isDuelFinished || !currentDuelQuestion) {
      return;
    }

    if (duelStartCountdown > 0) {
      sounds.tick();
      return;
    }

    sounds.go();
  }, [currentDuelQuestion, duelPhase, duelStartCountdown, isDuelFinished]);

  useEffect(() => {
    if (
      duelPhase !== "countdown" ||
      duelStartCountdown !== 0 ||
      isDuelFinished ||
      !currentDuelQuestion
    ) {
      return;
    }

    const startTimerId = window.setTimeout(() => {
      void startDuelAnswerRound(false);
    }, 600);

    return () => window.clearTimeout(startTimerId);
  }, [currentDuelQuestion, duelPhase, duelStartCountdown, isDuelFinished]);

  useEffect(() => {
    if (duelPhase !== "answering" || isDuelFinished || !currentDuelQuestion) {
      return;
    }

    const timerId = window.setInterval(() => {
      setDuelTimeRemaining((currentTime) => Math.max(0, currentTime - 1));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [currentDuelQuestion, duelPhase, isDuelFinished]);

  useEffect(() => {
    if (
      duelPhase !== "answering" ||
      !currentDuelQuestion ||
      duelSelectedAnswer ||
      isDuelFinished
    ) {
      return;
    }

    if (duelTimeRemaining === 0) {
      recordDuelAnswer("", true);
    }
  }, [
    currentDuelQuestion,
    duelPhase,
    duelSelectedAnswer,
    duelTimeRemaining,
    isDuelFinished,
  ]);

  useEffect(() => {
    if (duelPhase !== "reveal" || isDuelFinished || !currentDuelQuestion) {
      return;
    }

    const revealEndsAt = Date.now() + REVEAL_NEXT_QUESTION_DELAY_MS;
    const timerId = window.setInterval(() => {
      const remainingMs = Math.max(0, revealEndsAt - Date.now());
      setDuelRevealCountdown(Math.ceil(remainingMs / 1000));
    }, 250);

    return () => window.clearInterval(timerId);
  }, [currentDuelQuestion, duelPhase, isDuelFinished]);

  useEffect(() => {
    if (
      duelPhase !== "reveal" ||
      duelRevealCountdown !== 0 ||
      isDuelFinished ||
      !currentDuelQuestion
    ) {
      return;
    }

    advanceAfterDuelReveal();
  }, [
    currentDuelQuestion,
    duelPhase,
    duelRevealCountdown,
    isDuelFinished,
  ]);

  useEffect(() => {
    if (
      duelPhase === "answering" &&
      duelTimeRemaining > 0 &&
      duelTimeRemaining <= 3 &&
      !duelSelectedAnswer
    ) {
      sounds.tick();
    }
  }, [duelPhase, duelSelectedAnswer, duelTimeRemaining]);

  useEffect(() => {
    if (!duelFlash) {
      return;
    }

    const flashId = window.setTimeout(() => setDuelFlash(null), 650);

    return () => window.clearTimeout(flashId);
  }, [duelFlash]);

  function shuffleArray<T>(array: T[]) {
    return [...array].sort(() => Math.random() - 0.5);
  }

  function getQuestionCount(totalPlayableTracks: number) {
    return Math.min(
      MAX_QUESTIONS,
      Math.max(MIN_QUESTIONS, Math.floor(totalPlayableTracks / 2) + 1)
    );
  }

  function getRandomClipStart(duration: number) {
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 30;
    const latestStart = Math.max(0, safeDuration - CLIP_LENGTH_SECONDS);
    const preferredStart = 6;
    const preferredEnd = Math.min(22, latestStart);

    // iTunes previews do not include lyric/title timestamps. Starting later in
    // the preview reduces obvious title giveaways, but cannot guarantee the
    // title or hook will be avoided.
    if (preferredEnd >= preferredStart) {
      return preferredStart + Math.random() * (preferredEnd - preferredStart);
    }

    if (latestStart > 1) {
      return 1 + Math.random() * (latestStart - 1);
    }

    return 0;
  }

  function buildDuelQuestions(tracks: SpotifyTrack[]): DuelQuizQuestion[] {
    const playableTracks = tracks.filter((track) => Boolean(track.previewUrl));
    const questionCount = getQuestionCount(playableTracks.length);
    const quizTracks = shuffleArray(playableTracks).slice(0, questionCount);

    return quizTracks.map((correctTrack) => {
      const wrongOptions = shuffleArray(
        playableTracks.filter((track) => track.id !== correctTrack.id)
      ).slice(0, 3);

      return {
        correctTrack,
        options: shuffleArray([correctTrack, ...wrongOptions]),
        correctAnswer: correctTrack.name,
        clipStartSeconds: getRandomClipStart(30),
      };
    });
  }

  function getPointsForAnswer(isCorrect: boolean, remainingSeconds: number) {
    if (!isCorrect) {
      return 0;
    }

    return 500 + Math.floor(500 * (remainingSeconds / QUESTION_TIME_SECONDS));
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

  function clearDuelClipTimer() {
    if (duelClipTimerRef.current !== null) {
      window.clearTimeout(duelClipTimerRef.current);
      duelClipTimerRef.current = null;
    }
  }

  function clearDuelCorrectAnswerHoldTimer() {
    if (duelCorrectAnswerHoldTimerRef.current !== null) {
      window.clearTimeout(duelCorrectAnswerHoldTimerRef.current);
      duelCorrectAnswerHoldTimerRef.current = null;
    }

    isDuelCorrectHoldRef.current = false;
  }

  function stopDuelClip(resetToStart = true) {
    const audio = duelAudioRef.current;

    clearDuelClipTimer();
    clearDuelCorrectAnswerHoldTimer();

    if (audio) {
      audio.pause();

      if (resetToStart && currentDuelQuestion) {
        audio.currentTime = currentDuelQuestion.clipStartSeconds;
      }
    }

    setIsDuelClipPlaying(false);
  }

  async function playDuelClip() {
    const audio = duelAudioRef.current;

    if (!audio || !currentDuelQuestion?.correctTrack.previewUrl) {
      return false;
    }

    try {
      clearDuelClipTimer();

      const latestStart = Number.isFinite(audio.duration)
        ? Math.max(0, audio.duration - CLIP_LENGTH_SECONDS)
        : currentDuelQuestion.clipStartSeconds;
      const safeClipStart = Math.min(
        currentDuelQuestion.clipStartSeconds,
        latestStart
      );

      audio.pause();
      audio.currentTime = safeClipStart;
      await audio.play();

      setIsDuelClipPlaying(true);

      duelClipTimerRef.current = window.setTimeout(() => {
        stopDuelClip();
      }, CLIP_LENGTH_SECONDS * 1000);

      return true;
    } catch (error) {
      console.error("Could not play Duel audio clip:", error);
      setIsDuelClipPlaying(false);
      return false;
    }
  }

  function handleDuelAudioTimeUpdate() {
    const audio = duelAudioRef.current;

    if (!audio || !currentDuelQuestion) {
      return;
    }

    if (
      audio.currentTime >= currentDuelQuestion.clipStartSeconds + CLIP_LENGTH_SECONDS &&
      !isDuelCorrectHoldRef.current
    ) {
      stopDuelClip();
    }
  }

  function handleDuelAudioEnded() {
    clearDuelClipTimer();
    setIsDuelClipPlaying(false);
  }

  async function startDuelAnswerRound(isManualStart: boolean) {
    if (
      !currentDuelQuestion ||
      duelPhase === "answering" ||
      duelPhase === "correctHold" ||
      duelPhase === "reveal"
    ) {
      return;
    }

    setDuelAudioFallbackMessage("");

    if (currentDuelQuestion.correctTrack.previewUrl) {
      const didPlay = await playDuelClip();

      if (!didPlay) {
        setDuelPhase("audioBlocked");
        setDuelAudioFallbackMessage(
          isManualStart
            ? "Audio is still blocked. Try the button again."
            : "Click to play audio and continue."
        );
        return;
      }
    }

    setDuelTimeRemaining(QUESTION_TIME_SECONDS);
    setDuelPhase("answering");
  }

  function startDuelRevealCountdown() {
    setDuelRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setDuelPhase("reveal");
  }

  function holdCorrectDuelClipBeforeReveal() {
    clearDuelClipTimer();
    clearDuelCorrectAnswerHoldTimer();
    isDuelCorrectHoldRef.current = true;
    setDuelPhase("correctHold");

    duelCorrectAnswerHoldTimerRef.current = window.setTimeout(() => {
      duelCorrectAnswerHoldTimerRef.current = null;
      isDuelCorrectHoldRef.current = false;
      stopDuelClip(false);
      startDuelRevealCountdown();
    }, CORRECT_ANSWER_SONG_HOLD_MS);
  }

  function resetDuelQuestionFlow() {
    stopDuelClip(false);
    setDuelSelectedAnswer("");
    setDuelTimeRemaining(QUESTION_TIME_SECONDS);
    setDuelStartCountdown(START_COUNTDOWN_SECONDS);
    setDuelRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setDuelAudioFallbackMessage("");
    setDuelRevealMessage("");
    setDuelLastResult(null);
    setDuelFlash(null);
    setDuelPhase("countdown");
  }

  function resetDuelLocalState(nextPhase: DuelPhase = "idle") {
    stopDuelClip(false);
    setDuelQuestionIndex(0);
    setDuelScore(0);
    setDuelCorrectAnswers(0);
    setDuelAnswerTimes([]);
    setDuelStreak(0);
    setDuelTimeRemaining(QUESTION_TIME_SECONDS);
    setDuelStartCountdown(START_COUNTDOWN_SECONDS);
    setDuelSyncCountdown(0);
    setDuelRevealCountdown(REVEAL_COUNTDOWN_SECONDS);
    setDuelSelectedAnswer("");
    setDuelAudioFallbackMessage("");
    setIsDuelClipPlaying(false);
    setIsDuelFinished(false);
    setDuelRevealMessage("");
    setDuelLastResult(null);
    setDuelFlash(null);
    setDuelPhase(nextPhase);
    hasSubmittedDuelResultRef.current = false;
  }

  function advanceAfterDuelReveal() {
    stopDuelClip(false);

    if (!activeRoom) {
      return;
    }

    if (duelQuestionIndex >= activeRoom.quizQuestions.length - 1) {
      void finishDuel({
        finalScore: duelScore,
        correctAnswers: duelCorrectAnswers,
        answerTimes: duelAnswerTimes,
      });
      return;
    }

    setDuelQuestionIndex((currentIndex) => currentIndex + 1);
    resetDuelQuestionFlow();
  }

  function recordDuelAnswer(answer: string, timedOut = false) {
    if (!activeRoom || !session?.user || !currentDuelQuestion) {
      return;
    }

    if (duelPhase !== "answering" || duelSelectedAnswer) {
      return;
    }

    const correctAnswer =
      currentDuelQuestion.correctAnswer || currentDuelQuestion.correctTrack.name;
    const isCorrect = !timedOut && answer === correctAnswer;
    const points = getPointsForAnswer(isCorrect, duelTimeRemaining);
    const answerTime = QUESTION_TIME_SECONDS - duelTimeRemaining;
    const nextScore = duelScore + points;
    const nextCorrectAnswers = duelCorrectAnswers + (isCorrect ? 1 : 0);
    const nextAnswerTimes = [...duelAnswerTimes, answerTime];
    const nextStreak = isCorrect ? duelStreak + 1 : 0;
    const answeredCount = duelQuestionIndex + 1;

    setDuelSelectedAnswer(answer || "Timed out");
    setDuelScore(nextScore);
    setDuelCorrectAnswers(nextCorrectAnswers);
    setDuelAnswerTimes(nextAnswerTimes);
    setDuelStreak(nextStreak);
    setDuelLastResult({ isCorrect, points, correctAnswer });
    setDuelFlash(isCorrect ? "good" : "bad");

    if (timedOut) {
      stopDuelClip(false);
      setDuelRevealMessage(`Time's up. Correct answer: ${correctAnswer}`);
      sounds.wrong();
    } else if (isCorrect) {
      const streakLabel = getStreakRewardLabel(nextStreak);
      setDuelRevealMessage(streakLabel || "Clean hit");

      if (nextStreak >= 3) {
        sounds.streak();
      } else {
        sounds.correct();
      }
    } else {
      stopDuelClip(false);
      setDuelRevealMessage(`Wrong. Correct answer: ${correctAnswer}`);
      sounds.wrong();
    }

    void updateDuelPlayerProgress({
      roomId: activeRoom.id,
      user: session.user,
      currentScore: nextScore,
      currentCorrectAnswers: nextCorrectAnswers,
      currentQuestionIndex: answeredCount,
      currentStreak: nextStreak,
    });

    if (isCorrect) {
      holdCorrectDuelClipBeforeReveal();
      return;
    }

    startDuelRevealCountdown();
  }

  async function reconnectCurrentDuelRoom() {
    if (!session?.user) {
      return;
    }

    const { room, error } = await fetchCurrentDuelRoom(session.user);

    if (room) {
      updateActiveRoom(room);
      setMessage(error || "Reconnected to your active Arena room.");
    }
  }

  async function loadOpenRooms(showErrors = true) {
    if (!activeArenaMode) {
      return;
    }

    setIsLoadingRooms(true);
    const { rooms: nextRooms, error } = await fetchOpenDuelRooms(activeArenaMode);

    setRooms(nextRooms);
    if (showErrors) {
      setMessage(error || "");
    }
    setIsLoadingRooms(false);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!searchTerm.trim() || isSearching) {
      return;
    }

    setIsSearching(true);
    setMessage("");
    setSelectedAlbum(null);
    setVisibleAlbumCount(ALBUMS_PER_PAGE);

    try {
      const results = await searchSpotifyAlbums(searchTerm);
      setAlbums(results);
    } catch (error) {
      console.error(error);
      setMessage("Could not search albums. Try another album or artist.");
    } finally {
      setIsSearching(false);
    }
  }

  function handleViewMoreAlbums() {
    setVisibleAlbumCount((currentCount) =>
      Math.min(currentCount + ALBUMS_PER_PAGE, MAX_VISIBLE_ALBUMS, albums.length)
    );
  }

  function updateActiveRoom(room: ArenaRoom | null) {
    setActiveRoom(room);
    onArenaRoomChange?.(room);

    if (room) {
      setActiveArenaMode(room.mode);
      setSelectedArenaTheme(room.mode);
    }
  }

  function getPresentPlayerCount(room: ArenaRoom | ArenaInvite) {
    if ("players" in room) {
      return getPresentPlayers(room).length;
    }

    return room.playerCount;
  }

  function getInviteUnavailableMessage(invite: ArenaInvite | null) {
    if (!invite) {
      return inviteError || "";
    }

    const isExpired = invite.expiresAt
      ? Date.parse(invite.expiresAt) <= Date.now()
      : false;

    if (inviteError) {
      return inviteError;
    }

    if (isExpired) {
      return "This invite has expired.";
    }

    if (invite.status === "cancelled") {
      return "This room was closed by the host.";
    }

    if (invite.status === "finished") {
      return "The game has already finished.";
    }

    if (invite.status !== "waiting") {
      return "This room is no longer accepting players.";
    }

    if (invite.playerCount >= invite.maxPlayers) {
      return "This private room is full.";
    }

    return "";
  }

  async function loadInviteForAcceptance(code: string) {
    const normalizedCode = normalizeArenaInviteCode(code);

    if (!normalizedCode) {
      setInviteError("Enter a private room code.");
      setPendingInvite(null);
      return;
    }

    setIsInviteLoading(true);
    setInviteError("");
    setPendingPublicRoom(null);
    setPendingInvite(null);

    const { invite, error } = await fetchArenaInvite(normalizedCode);

    if (invite) {
      setPendingInvite(invite);
      setActiveArenaMode(invite.mode);
      setSelectedArenaTheme(invite.mode);
      setRoomCodeInput(normalizedCode);

      if (recoveredRoom?.id === invite.roomId) {
        setMessage("You are already in this room. Reconnecting...");
      } else {
        setMessage("");
      }
    } else {
      setInviteError(getFriendlyArenaError(error) || "Invalid private room code.");
      setMessage("");
    }

    setIsInviteLoading(false);
  }

  function handleJoinWithCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadInviteForAcceptance(roomCodeInput);
  }

  async function handleCreateRoom() {
    if (!session?.user) {
      onLogin();
      return;
    }

    if (!selectedAlbum || isCreatingRoom || !activeArenaMode) {
      return;
    }

    setIsCreatingRoom(true);
    setMessage("");

    const { room, error } = await createDuelRoom({
      album: selectedAlbum,
      user: session.user,
      profile,
      mode: activeArenaMode,
      maxPlayers: modeSettings.maxPlayers,
      isPrivate: isPrivateRoom,
    });

    if (room) {
      updateActiveRoom(room);
      resetDuelLocalState();
      setSelectedAlbum(null);
      await loadOpenRooms(false);
    }

    setMessage(
      error ||
        (room
          ? `${isPrivateRoom ? "Private" : "Public"} ${modeSettings.title} room created.`
          : "Failed to create room.")
    );
    setIsCreatingRoom(false);
  }

  function handleOpenRoomRequest(room: ArenaRoom) {
    if (!session?.user) {
      onLogin();
      return;
    }

    const isAlreadyInRoom = room.players.some(
      (player) => player.userId === session.user.id && !player.leftAt
    );

    if (isAlreadyInRoom) {
      void handleJoinRoom(room);
      return;
    }

    setPendingPublicRoom(room);
    setPendingInvite(null);
    setMessage("");
  }

  async function handleJoinRoom(room: ArenaRoom) {
    if (!session?.user) {
      onLogin();
      return;
    }

    const isAlreadyInRoom = room.players.some(
      (player) => player.userId === session.user.id
    );

    if (isAlreadyInRoom) {
      const { room: freshRoom, error } = await fetchArenaRoom(room.id);

      const nextRoom = freshRoom || room;
      updateActiveRoom(nextRoom);
      setMessage(error || "Entered room.");
      return;
    }

    if (getPresentPlayers(room).length >= room.maxPlayers) {
      setMessage("Room full.");
      return;
    }

    setMessage("");
    const { room: joinedRoom, error } = await joinDuelRoom({
      room,
      user: session.user,
      profile,
    });

    if (joinedRoom) {
      updateActiveRoom(joinedRoom);
      setPendingPublicRoom(null);
      resetDuelLocalState();
      await loadOpenRooms(false);
    }

    setMessage(error || (joinedRoom ? "Joined room." : "Failed to join room."));
  }

  async function handleAcceptInvite() {
    if (!pendingInvite) {
      return;
    }

    if (!session?.user) {
      onLogin();
      return;
    }

    const unavailableMessage = getInviteUnavailableMessage(pendingInvite);

    if (unavailableMessage) {
      setInviteError(unavailableMessage);
      return;
    }

    setIsJoiningInvite(true);
    setInviteError("");

    const { room, error } = await joinArenaRoomByInvite({
      inviteCode: pendingInvite.inviteCode,
      user: session.user,
      profile,
    });

    if (room) {
      updateActiveRoom(room);
      setPendingInvite(null);
      resetDuelLocalState();
      onInviteHandled?.();
      await loadOpenRooms(false);
    }

    setMessage(
      getFriendlyArenaError(error) ||
        (room ? "Joined private room." : "Could not join invite.")
    );
    setIsJoiningInvite(false);
  }

  async function handleCopyInvite(room: ArenaRoom) {
    if (!room.inviteCode) {
      return;
    }

    const inviteUrl = `${window.location.origin}/multiplayer/invite/${room.inviteCode}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Invite link copied.");
    } catch (error) {
      console.error(error);
      setMessage(inviteUrl);
    }
  }

  async function handleShareInvite(room: ArenaRoom) {
    if (!room.inviteCode || !navigator.share) {
      return;
    }

    const inviteUrl = `${window.location.origin}/multiplayer/invite/${room.inviteCode}`;
    const hostHandle = profile?.username
      ? `@${profile.username}`
      : getHostName(room);
    const title =
      room.mode === "group_lobby"
        ? `Join ${hostHandle}'s Group Lobby on ${room.albumName}`
        : `Duel ${hostHandle} on ${room.albumName}`;

    try {
      await navigator.share({
        title,
        text: "Accept my TrackTest Arena challenge.",
        url: inviteUrl,
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshActiveRoom(showMessage = true) {
    if (!activeRoom) {
      return;
    }

    const { room, error } = await fetchArenaRoom(activeRoom.id);

    if (room) {
      updateActiveRoom(room);
    }

    if (showMessage) {
      setMessage(error || "Room refreshed.");
    }
  }

  async function handleCloseDuelRoom() {
    if (!activeRoom || activeRoom.hostUserId !== session?.user.id) {
      return;
    }

    await handleCloseArenaRoom(activeRoom);
  }

  async function handleCloseArenaRoom(room: ArenaRoom) {
    if (room.hostUserId !== session?.user.id) {
      return;
    }

    setIsClosingActiveRoom(true);
    const { error } = await cancelDuelRoom(room.id);

    setMessage(error || "Arena room closed.");
    if (!error) {
      updateActiveRoom(null);
      resetDuelLocalState();
    }
    setIsClosingActiveRoom(false);
    await loadOpenRooms(false);
  }

  async function handleLeaveDuelRoom() {
    if (!activeRoom || !session?.user) {
      return;
    }

    const isHost = activeRoom.hostUserId === session.user.id;

    if (activeRoom.status === "waiting" || activeRoom.status === "starting") {
      const result = isHost
        ? await cancelDuelRoom(activeRoom.id)
        : await leaveWaitingDuelRoom(activeRoom.id);

      setMessage(
        result.error ||
          (isHost ? "Duel lobby closed." : "You left the Duel lobby.")
      );
      updateActiveRoom(null);
      resetDuelLocalState();
      await loadOpenRooms(false);
      return;
    }

    if (activeRoom.status === "active") {
      const result = await forfeitDuelRoom(activeRoom.id);

      setMessage(result.error || "You forfeited the Duel.");
      updateActiveRoom(null);
      resetDuelLocalState();
      await loadOpenRooms(false);
      return;
    }

    updateActiveRoom(null);
    resetDuelLocalState();
  }

  function getPresentPlayers(room: ArenaRoom) {
    return room.players.filter((player) => !player.leftAt);
  }

  async function startArenaRoom(roomToStart: ArenaRoom) {
    if (!session?.user) {
      return;
    }

    setIsPreparingDuel(true);
    setMessage("");

    const { room: freshRoom, error } = await fetchArenaRoom(roomToStart.id);

    if (!freshRoom) {
      setMessage(error || "Could not refresh room.");
      setIsPreparingDuel(false);
      return;
    }

    if (freshRoom.hostUserId !== session.user.id) {
      setMessage("Only the host can start this Arena room.");
      setIsPreparingDuel(false);
      return;
    }

    const freshModeSettings =
      freshRoom.mode === "group_lobby"
        ? ARENA_MODE_SETTINGS.group_lobby
        : ARENA_MODE_SETTINGS.duel;

    if (getPresentPlayers(freshRoom).length < freshModeSettings.minPlayersToStart) {
      setMessage(
        `Waiting for ${freshModeSettings.minPlayersToStart} players to start.`
      );
      setIsPreparingDuel(false);
      return;
    }

    let questions = freshRoom.quizQuestions;

    if (questions.length === 0) {
      try {
        const tracks = await getSpotifyAlbumTracks(freshRoom.albumId);
        const playableTracks = tracks.filter((track) => Boolean(track.previewUrl));

        if (playableTracks.length < MIN_QUESTIONS) {
          setMessage("Not enough playable tracks for a Duel.");
          setIsPreparingDuel(false);
          return;
        }

        questions = buildDuelQuestions(playableTracks);
      } catch (loadError) {
        console.error(loadError);
        setMessage("Could not prepare Duel questions.");
        setIsPreparingDuel(false);
        return;
      }
    }

    const startsAt = new Date(Date.now() + DUEL_SYNC_START_DELAY_MS).toISOString();
    const activatedRoom = await activateDuelRoom(
      freshRoom.id,
      questions,
      startsAt
    );

    updateActiveRoom(activatedRoom.room || { ...freshRoom, quizQuestions: questions });
    resetDuelLocalState("syncing");
    setMessage(
      activatedRoom.error ||
        `${freshModeSettings.title} starting. Everyone gets the same questions.`
    );
    setIsPreparingDuel(false);
  }

  async function handleStartDuel() {
    if (!activeRoom) {
      return;
    }

    await startArenaRoom(activeRoom);
  }

  async function handleHostRematch(album?: SpotifyAlbum | null) {
    if (!activeRoom || activeRoom.hostUserId !== session?.user.id) {
      return;
    }

    setIsPreparingDuel(true);
    setMessage(album ? "Preparing new album rematch..." : "Preparing rematch...");

    const { room, error } = await resetArenaRoomForRematch({
      roomId: activeRoom.id,
      album,
    });

    if (!room) {
      setMessage(error || "Could not prepare rematch.");
      setIsPreparingDuel(false);
      return;
    }

    updateActiveRoom(room);
    setSelectedAlbum(null);
    setIsChoosingRematchAlbum(false);
    resetDuelLocalState();
    await startArenaRoom(room);
  }

  async function handleRequestRematch() {
    if (!activeRoom) {
      return;
    }

    const { error } = await requestArenaRematch(activeRoom.id);
    setMessage(error || "Rematch requested. Host controls the next start.");
    await refreshActiveRoom(false);
  }

  async function handleEndArenaRoom() {
    if (!activeRoom) {
      return;
    }

    const { error } = await endArenaRoom(activeRoom.id);
    setMessage(error || "Arena room ended.");
    updateActiveRoom(null);
    resetDuelLocalState();
    await loadOpenRooms(false);
  }

  async function finishDuel({
    finalScore,
    correctAnswers,
    answerTimes,
  }: {
    finalScore: number;
    correctAnswers: number;
    answerTimes: number[];
  }) {
    if (!activeRoom || !session?.user || hasSubmittedDuelResultRef.current) {
      return;
    }

    hasSubmittedDuelResultRef.current = true;
    stopDuelClip(false);

    const averageAnswerTime =
      answerTimes.length > 0
        ? answerTimes.reduce((total, answerTime) => total + answerTime, 0) /
          answerTimes.length
        : 0;

    const result = await saveDuelPlayerResult({
      roomId: activeRoom.id,
      user: session.user,
      finalScore,
      correctAnswers,
      totalQuestions: activeRoom.quizQuestions.length,
      averageAnswerTime,
    });

    const { room } = await fetchArenaRoom(activeRoom.id);

    if (room) {
      const presentPlayers = getPresentPlayers(room);
      const hasEveryoneFinished =
        presentPlayers.length > 0 &&
        presentPlayers.every((player) => player.finishedAt);

      if (hasEveryoneFinished && room.status !== "finished") {
        await finishDuelRoom(room.id);
        const refreshedRoom = await fetchArenaRoom(room.id);
        updateActiveRoom(refreshedRoom.room || room);
      } else {
        updateActiveRoom(room);
      }
    }

    setMessage(result.error || "Game complete. Waiting for others to finish.");
    setIsDuelFinished(true);
    setDuelPhase("idle");
  }

  function handleToggleDuelMute() {
    setIsDuelMuted(sounds.toggleMuted());
  }

  function getHostName(room: ArenaRoom) {
    const hostPlayer = getPresentPlayers(room).find(
      (player) => player.userId === room.hostUserId
    );

    return hostPlayer?.displayName || hostPlayer?.username || "Arena host";
  }

  function getPlayerAccuracy(player: ArenaRoomPlayer) {
    if (player.totalQuestions === 0) {
      return 0;
    }

    return Math.round((player.correctAnswers / player.totalQuestions) * 100);
  }

  function getWinnerLabel(players: ArenaRoomPlayer[]) {
    if (players.length < 2) {
      return "Waiting for result";
    }

    const [firstPlayer, secondPlayer] = players;

    if (firstPlayer.resultStatus === "win_by_forfeit") {
      return `${firstPlayer.displayName} wins by forfeit`;
    }

    const firstAccuracy =
      firstPlayer.totalQuestions > 0
        ? firstPlayer.correctAnswers / firstPlayer.totalQuestions
        : 0;
    const secondAccuracy =
      secondPlayer.totalQuestions > 0
        ? secondPlayer.correctAnswers / secondPlayer.totalQuestions
        : 0;

    if (
      firstPlayer.finalScore === secondPlayer.finalScore &&
      firstAccuracy === secondAccuracy &&
      firstPlayer.averageAnswerTime === secondPlayer.averageAnswerTime
    ) {
      return "Draw";
    }

    return `${firstPlayer.displayName} wins`;
  }

  function sortDuelResults(players: ArenaRoomPlayer[]) {
    return [...players].sort((a, b) => {
      const accuracyA = a.totalQuestions > 0 ? a.correctAnswers / a.totalQuestions : 0;
      const accuracyB = b.totalQuestions > 0 ? b.correctAnswers / b.totalQuestions : 0;
      const resultRank: Record<string, number> = {
        win_by_forfeit: 3,
        completed: 2,
        active: 1,
        left: 0,
        cancelled: 0,
        forfeit: -1,
      };

      return (
        (resultRank[b.resultStatus] || 0) - (resultRank[a.resultStatus] || 0) ||
        b.finalScore - a.finalScore ||
        accuracyB - accuracyA ||
        a.averageAnswerTime - b.averageAnswerTime
      );
    });
  }

  function getLiveRankedPlayers(room: ArenaRoom, currentPlayerId?: string) {
    return room.players
      .filter((player) => player.resultStatus !== "cancelled" && player.resultStatus !== "left")
      .map((player) =>
        player.userId === currentPlayerId
          ? {
              ...player,
              currentScore: duelScore,
              currentCorrectAnswers: duelCorrectAnswers,
              currentQuestionIndex: duelSelectedAnswer
                ? duelQuestionIndex + 1
                : duelQuestionIndex,
              currentStreak: duelStreak,
            }
          : player
      )
      .sort(
        (a, b) =>
          b.currentScore - a.currentScore ||
          b.currentCorrectAnswers - a.currentCorrectAnswers ||
          b.currentQuestionIndex - a.currentQuestionIndex
      );
  }

  function renderGroupLiveLeaderboard(room: ArenaRoom) {
    const rankedPlayers = getLiveRankedPlayers(room, session?.user.id);

    return (
      <div className="group-live-board">
        <div className="profile-panel-heading">
          <div>
            <p className="eyebrow">Live Group Leaderboard</p>
            <h2>Current Standings</h2>
          </div>
          <span>{rankedPlayers.length}/{room.maxPlayers}</span>
        </div>

        <div className="group-live-list">
          {rankedPlayers.map((player, index) => (
            <div
              className={`group-live-row ${
                player.userId === session?.user.id ? "current" : ""
              }`}
              key={player.id}
            >
              <span className="rank-number">{index + 1}</span>
              <strong>{player.displayName || player.username || "Arena Player"}</strong>
              <span>{player.currentScore.toLocaleString()} pts</span>
              <small>
                {player.currentCorrectAnswers}/{room.quizQuestions.length} correct
              </small>
              <small>
                Progress {player.currentQuestionIndex}/{room.quizQuestions.length}
              </small>
              <small>Streak {player.currentStreak}</small>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderArenaAcceptScreen() {
    if (!pendingInvite && !pendingPublicRoom) {
      return (
        <section className="arena-accept-screen">
          <div className="duel-results-card arena-accept-card">
            <p className="eyebrow">Private Room</p>
            <h2>{isInviteLoading ? "Checking room code..." : "Room not found"}</h2>
            <p className="arena-note">
              {isInviteLoading
                ? "Looking for that private Arena room."
                : inviteError || "Invalid private room code."}
            </p>
            <div className="duel-room-actions arena-accept-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setInviteError("");
                  setPendingInvite(null);
                  onInviteHandled?.();
                }}
              >
                Back to Multiplayer
              </button>
            </div>
          </div>
        </section>
      );
    }

    const inviteMode = pendingInvite?.mode || pendingPublicRoom?.mode || "duel";
    const acceptModeSettings = ARENA_MODE_SETTINGS[inviteMode];
    const isGroupInvite = inviteMode === "group_lobby";
    const status = pendingInvite?.status || pendingPublicRoom?.status || "waiting";
    const targetRoomId = pendingInvite?.roomId || pendingPublicRoom?.id || "";
    const albumName =
      pendingInvite?.albumName || pendingPublicRoom?.albumName || "Arena album";
    const artistName =
      pendingInvite?.artistName || pendingPublicRoom?.artistName || "Unknown artist";
    const artworkUrl = pendingInvite?.artworkUrl || pendingPublicRoom?.artworkUrl;
    const playerCount =
      pendingInvite?.playerCount ||
      (pendingPublicRoom ? getPresentPlayers(pendingPublicRoom).length : 0);
    const maxPlayers =
      pendingInvite?.maxPlayers || pendingPublicRoom?.maxPlayers || acceptModeSettings.maxPlayers;
    const isPrivate = pendingInvite?.isPrivate ?? pendingPublicRoom?.isPrivate ?? false;
    const hostName = pendingInvite
      ? pendingInvite.hostUsername
        ? `@${pendingInvite.hostUsername}`
        : pendingInvite.hostDisplayName
      : pendingPublicRoom
        ? getHostName(pendingPublicRoom)
        : "Arena host";
    const isAlreadyInside =
      Boolean(targetRoomId) &&
      (activeRoom?.id === targetRoomId || recoveredRoom?.id === targetRoomId);
    const isHostInvite =
      Boolean(session?.user.id) &&
      (pendingInvite?.hostUserId === session?.user.id ||
        pendingPublicRoom?.hostUserId === session?.user.id);
    const unavailableMessage = pendingInvite
      ? getInviteUnavailableMessage(pendingInvite)
      : status === "cancelled"
        ? "This room was closed by the host."
        : status === "finished"
          ? "The game has already finished."
          : status !== "waiting"
            ? "This room is no longer accepting players."
            : pendingPublicRoom && getPresentPlayerCount(pendingPublicRoom) >= maxPlayers
              ? "This room is full."
              : "";
    const isUnavailable = Boolean(unavailableMessage) && !isAlreadyInside && !isHostInvite;

    return (
      <section className="arena-accept-screen">
        <div className="duel-results-card arena-accept-card">
          <p className="eyebrow">
            {isGroupInvite ? "Group Lobby Invite" : "Duel Request"}
          </p>
          <h2>
            {isGroupInvite
              ? `${hostName} invited you to join ${albumName}`
              : `${hostName} wants to Duel on ${albumName}`}
          </h2>
          {artworkUrl && <img src={artworkUrl} alt="" aria-hidden />}
          <p>{artistName}</p>
          <div className="arena-accept-meta">
            <span>{isPrivate ? "Private" : "Public"}</span>
            <span>{playerCount}/{maxPlayers} players</span>
            <span>{status}</span>
          </div>

          {isInviteLoading && <p className="arena-note">Loading invite...</p>}
          {unavailableMessage && <p className="arena-note">{unavailableMessage}</p>}
          {isAlreadyInside && (
            <p className="arena-note">
              You are already in this room. Reconnecting...
            </p>
          )}

          <div className="duel-room-actions arena-accept-actions">
            <button
              type="button"
              disabled={isUnavailable || isInviteLoading || isJoiningInvite}
              onClick={() => {
                if (!session) {
                  onLogin();
                  return;
                }

                if (isAlreadyInside || isHostInvite) {
                  const roomId = targetRoomId;

                  if (roomId) {
                    fetchArenaRoom(roomId).then(({ room }) => {
                      if (room) {
                        updateActiveRoom(room);
                        setPendingInvite(null);
                        setPendingPublicRoom(null);
                        onInviteHandled?.();
                      }
                    });
                  }
                  return;
                }

                if (pendingInvite) {
                  void handleAcceptInvite();
                  return;
                }

                if (pendingPublicRoom) {
                  void handleJoinRoom(pendingPublicRoom);
                }
              }}
            >
              {!session
                ? "Login to Accept"
                : isAlreadyInside || isHostInvite
                  ? "Resume Room"
                  : isJoiningInvite
                  ? "Joining..."
                  : isGroupInvite
                    ? "Accept Group Lobby"
                    : "Accept Duel"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setPendingInvite(null);
                setPendingPublicRoom(null);
                setInviteError("");
                onInviteHandled?.();
              }}
            >
              Decline
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderPrivateInvitePanel(room: ArenaRoom) {
    if (!room.isPrivate || !room.inviteCode || room.status !== "waiting") {
      return null;
    }

    const inviteUrl = `${window.location.origin}/multiplayer/invite/${room.inviteCode}`;

    return (
      <div className="arena-invite-panel">
        <div>
          <p className="eyebrow">Private Invite</p>
          <h3>{room.inviteCode}</h3>
          <p>{inviteUrl}</p>
        </div>
        <div className="arena-invite-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleCopyInvite(room)}
          >
            Copy Link
          </button>
          {"share" in navigator && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleShareInvite(room)}
            >
              Share
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderSelectedAlbumStartBar() {
    if (!selectedAlbum) {
      return null;
    }

    if (isChoosingRematchAlbum && activeRoom) {
      return (
        <div className="start-bar arena-start-bar arena-rematch-start-bar">
          {selectedAlbum.imageUrl && (
            <img src={selectedAlbum.imageUrl} alt="" aria-hidden />
          )}

          <div className="start-bar-info">
            <strong>{selectedAlbum.title}</strong>
            <span>{selectedAlbum.artist}</span>
          </div>

          <button
            type="button"
            disabled={isPreparingDuel}
            onClick={() => void handleHostRematch(selectedAlbum)}
          >
            {isPreparingDuel ? "Preparing..." : "Start Rematch on Album"}
          </button>
        </div>
      );
    }

    if (activeRoom) {
      return null;
    }

    return (
      <div className="start-bar arena-start-bar">
        {selectedAlbum.imageUrl && (
          <img src={selectedAlbum.imageUrl} alt="" aria-hidden />
        )}

        <div className="start-bar-info">
          <strong>{selectedAlbum.title}</strong>
          <span>{selectedAlbum.artist}</span>
        </div>

        <div className="arena-privacy-toggle" role="group" aria-label="Room privacy">
          <button
            type="button"
            className={!isPrivateRoom ? "active" : ""}
            onClick={() => setIsPrivateRoom(false)}
          >
            Public
          </button>
          <button
            type="button"
            className={isPrivateRoom ? "active" : ""}
            onClick={() => setIsPrivateRoom(true)}
          >
            Private
          </button>
        </div>

        <button
          type="button"
          disabled={isCreatingRoom || !session}
          onClick={handleCreateRoom}
        >
          {isCreatingRoom
            ? "Creating..."
            : selectedMode === "group_lobby"
              ? "Create Group Lobby"
              : "Create Duel Room"}
        </button>
      </div>
    );
  }

  function renderRematchAlbumPicker() {
    if (!isChoosingRematchAlbum) {
      return null;
    }

    return (
      <div className="rematch-album-picker">
        <div className="profile-panel-heading">
          <div>
            <p className="eyebrow">Choose Another Album</p>
            <h2>Keep the room, change the battlefield</h2>
          </div>
        </div>

        <form className="search-box" onSubmit={handleSearch}>
          <input
            type="search"
            placeholder="Album or artist..."
            value={searchTerm}
            aria-label="Search for a rematch album"
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <button type="submit" disabled={isSearching}>
            {isSearching ? "Searching..." : "Search"}
          </button>
        </form>

        {albums.length > 0 && (
          <>
            <p className="album-result-count duel-result-count">
              Showing {visibleAlbums.length} of {cappedAlbums.length} results
            </p>

            <div className="duel-album-grid">
              {visibleAlbums.map((album) => (
                <button
                  type="button"
                  className={`duel-album-card ${
                    selectedAlbum?.id === album.id ? "selected" : ""
                  }`}
                  onClick={() => setSelectedAlbum(album)}
                  key={album.id}
                >
                  {album.imageUrl && (
                    <img src={album.imageUrl} alt={`${album.title} cover`} />
                  )}
                  <span>
                    <strong>{album.title}</strong>
                    <small>{album.artist}</small>
                  </span>
                </button>
              ))}
            </div>

            {hasMoreAlbums && (
              <button
                type="button"
                className="view-more-albums duel-view-more-albums"
                onClick={handleViewMoreAlbums}
              >
                View more albums
              </button>
            )}
          </>
        )}

        <div className="duel-room-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setIsChoosingRematchAlbum(false);
              setSelectedAlbum(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function renderDuelGameState() {
    if (duelPhase === "syncing") {
      return (
        <>
          <p className="game-state-label">Synced start</p>
          <p className="start-countdown">{duelSyncCountdown || "..."}</p>
          <p className="game-state-detail">
            Players start from the same room clock.
          </p>
        </>
      );
    }

    if (duelPhase === "countdown") {
      return (
        <>
          <p className="game-state-label">Get ready</p>
          <p className="start-countdown">
            {duelStartCountdown === 0 ? "GO" : duelStartCountdown}
          </p>
          <p className="game-state-detail">Clip starts on go.</p>
        </>
      );
    }

    if (duelPhase === "audioBlocked") {
      return (
        <>
          <p className="game-state-label">Audio needs a tap</p>
          <p className="game-state-detail">
            {duelAudioFallbackMessage || "Click to play audio and continue."}
          </p>
        </>
      );
    }

    if (duelPhase === "answering") {
      return (
        <>
          <p className="game-state-label">Answer now</p>
          <div
            className={`timer-ring ${
              duelTimeRemaining <= 3 ? "timer-ring-low" : ""
            }`}
            aria-label={`${duelTimeRemaining} seconds remaining`}
          >
            <svg viewBox="0 0 128 128" aria-hidden="true">
              <circle className="timer-ring-bg" cx="64" cy="64" r={RING_RADIUS} />
              <circle
                className="timer-ring-fg"
                cx="64"
                cy="64"
                r={RING_RADIUS}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={duelRingOffset}
              />
            </svg>
            <span>{duelTimeRemaining}</span>
          </div>
          <p className="game-state-detail">
            {isDuelClipPlaying
              ? "Clip is playing. Faster correct answers score more."
              : "Faster correct answers score more."}
          </p>
        </>
      );
    }

    if (duelPhase === "correctHold") {
      return (
        <>
          <p className="game-state-label">Correct</p>
          <p className="points-pop">+{duelLastResult?.points || 0}</p>
          {duelRevealMessage && (
            <p className="hype-message hype-good">{duelRevealMessage}</p>
          )}
          <p className="game-state-detail">Let it play...</p>
        </>
      );
    }

    if (duelPhase === "reveal") {
      return (
        <>
          <p className="game-state-label">Reveal</p>
          {duelLastResult?.isCorrect ? (
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
              <p className="points-pop">+{duelLastResult.points}</p>
            </>
          ) : (
            <p className="reveal-answer">
              Correct answer: <strong>{duelLastResult?.correctAnswer}</strong>
            </p>
          )}
          {duelRevealMessage && (
            <p
              className={`hype-message ${
                duelLastResult?.isCorrect ? "hype-good" : "hype-bad"
              }`}
            >
              {duelRevealMessage}
            </p>
          )}
          <p className="game-state-detail">
            Next question in {duelRevealCountdown}s
          </p>
        </>
      );
    }

    return (
      <>
        <p className="game-state-label">Preparing question</p>
        <p className="game-state-detail">Waiting for the shared room clock...</p>
      </>
    );
  }

  function renderDuelLobby() {
    if (
      !activeRoom &&
      (isInviteLoading || pendingInvite || pendingPublicRoom || inviteError)
    ) {
      return renderArenaAcceptScreen();
    }

    if (activeRoom) {
      const activeModeSettings =
        activeRoom.mode === "group_lobby"
          ? ARENA_MODE_SETTINGS.group_lobby
          : ARENA_MODE_SETTINGS.duel;
      const isActiveGroupLobby = activeRoom.mode === "group_lobby";
      const presentPlayers = getPresentPlayers(activeRoom);
      const hostPlayer = presentPlayers.find(
        (player) => player.userId === activeRoom.hostUserId
      );
      const guestPlayer = presentPlayers.find(
        (player) => player.userId !== activeRoom.hostUserId
      );
      const currentPlayer = activeRoom.players.find(
        (player) => player.userId === session?.user.id
      );
      const opponentPlayer = presentPlayers.find(
        (player) => player.userId !== session?.user.id
      );
      const resultPlayers = activeRoom.players.filter(
        (player) =>
          player.resultStatus !== "cancelled" && player.resultStatus !== "left"
      );
      const bothPlayersFinished =
        activeRoom.status === "finished" ||
        (resultPlayers.length >= activeModeSettings.minPlayersToStart &&
          resultPlayers.every((player) => player.finishedAt));
      const question = activeRoom.quizQuestions[duelQuestionIndex];
      const isHost = activeRoom.hostUserId === session?.user.id;

      if (activeRoom.status === "cancelled") {
        return (
          <section className="duel-room-screen">
            <div className="duel-results-card">
              <p className="eyebrow">{activeModeSettings.title} Closed</p>
              <h2>This room was cancelled.</h2>
              <p className="arena-note">Create or join another waiting room.</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                updateActiveRoom(null);
                resetDuelLocalState();
              }}
            >
              Back to Lobby
            </button>
          </section>
        );
      }

      if (bothPlayersFinished) {
        const sortedPlayers = sortDuelResults(resultPlayers);

        return (
          <section className="duel-room-screen">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  updateActiveRoom(null);
                  resetDuelLocalState();
                }}
              >
              Back to Lobby
              </button>
            <div className="duel-results-card">
              <p className="eyebrow">{activeModeSettings.resultsTitle}</p>
              <h2>{getWinnerLabel(sortedPlayers)}</h2>
              <div
                className={`duel-player-grid ${
                  isActiveGroupLobby ? "group-results-grid" : ""
                }`}
              >
                {sortedPlayers.map((player, index) => (
                  <div
                    className={`duel-player-card ${
                      index === 0 ? "duel-winner-card" : ""
                    }`}
                    key={player.id}
                  >
                    <span>{player.userId === activeRoom.hostUserId ? "Host" : "Player"}</span>
                    <strong>{player.displayName}</strong>
                    {player.resultStatus === "forfeit" && <p>Forfeited</p>}
                    {player.resultStatus === "win_by_forfeit" && <p>Win by forfeit</p>}
                    <p>
                      {player.finalScore.toLocaleString()} pts -{" "}
                      {getPlayerAccuracy(player)}%
                    </p>
                    <small>
                      Correct: {player.correctAnswers}/{player.totalQuestions}
                    </small>
                    <small>
                      Avg time: {player.averageAnswerTime.toFixed(1)}s
                    </small>
                  </div>
                ))}
              </div>
              {activeRoom.rematchRequestedBy && (
                <p className="arena-note">
                  A player requested a rematch. Host controls the next start.
                </p>
              )}
              <div className="duel-room-actions rematch-actions">
                {isHost ? (
                  <>
                    <button
                      type="button"
                      disabled={isPreparingDuel}
                      onClick={() => void handleHostRematch()}
                    >
                      {isPreparingDuel ? "Preparing..." : "Rematch"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setSelectedAlbum(null);
                        setAlbums([]);
                        setVisibleAlbumCount(ALBUMS_PER_PAGE);
                        setIsChoosingRematchAlbum(true);
                      }}
                    >
                      Choose Another Album
                    </button>
                    <button
                      type="button"
                      className="secondary-button danger-button"
                      onClick={() => void handleEndArenaRoom()}
                    >
                      {isActiveGroupLobby ? "End Lobby" : "End Duel"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRequestRematch()}
                    >
                      Request Rematch
                    </button>
                    <button
                      type="button"
                      className="secondary-button danger-button"
                      onClick={() => {
                        updateActiveRoom(null);
                        resetDuelLocalState();
                      }}
                    >
                      Leave Lobby
                    </button>
                  </>
                )}
              </div>
            </div>
            {isHost && renderRematchAlbumPicker()}
            {isHost && renderSelectedAlbumStartBar()}
          </section>
        );
      }

      if (activeRoom.status === "active" && question) {
        if (currentPlayer?.finishedAt || isDuelFinished) {
          return (
            <section className="duel-room-screen">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshActiveRoom()}
              >
                Refresh Results
              </button>
              <div className="duel-results-card">
                <p className="eyebrow">{activeModeSettings.title} Submitted</p>
                <h2>
                  {isActiveGroupLobby
                    ? "Waiting for other players to finish."
                    : "Waiting for opponent to finish."}
                </h2>
                <p className="arena-note">
                  Your score: {duelScore.toLocaleString()} points.
                </p>
              </div>
            </section>
          );
        }

        return (
          <section className="duel-room-screen duel-game-screen quiz-live">
            {duelFlash && (
              <div className={`quiz-flash quiz-flash-${duelFlash}`} aria-hidden="true" />
            )}
            {shouldShowDuelDanger && <div className="danger-vignette" aria-hidden="true" />}

            <div className="duel-room-hero">
              {activeRoom.artworkUrl && (
                <img src={activeRoom.artworkUrl} alt="" aria-hidden />
              )}
              <div>
                <p className="eyebrow">{activeModeSettings.activeTitle}</p>
                <h2>{activeRoom.albumName}</h2>
                <p>
                  Question {duelQuestionIndex + 1} of{" "}
                  {activeRoom.quizQuestions.length}
                </p>
                <span>
                  {duelPhase === "syncing"
                    ? "Synced start"
                    : `Live ${activeModeSettings.title}`}
                </span>
              </div>
            </div>

            <div className="duel-room-actions">
              <button
                type="button"
                className="secondary-button danger-button"
                onClick={() => void handleLeaveDuelRoom()}
              >
                Forfeit Game
              </button>
            </div>

            {isActiveGroupLobby ? (
              renderGroupLiveLeaderboard(activeRoom)
            ) : (
              <div className="duel-head-to-head">
                <div className="duel-h2h-card current">
                  <span>You</span>
                  <strong>{currentPlayer?.displayName || "Arena Player"}</strong>
                  <p>{duelScore.toLocaleString()} pts</p>
                  <small>
                    {duelCorrectAnswers}/{activeRoom.quizQuestions.length} correct
                  </small>
                  <small>Streak {duelStreak}</small>
                </div>
                <div className="duel-h2h-vs">VS</div>
                <div className="duel-h2h-card">
                  <span>Opponent</span>
                  <strong>{opponentPlayer?.displayName || "Waiting"}</strong>
                  <p>{(opponentPlayer?.currentScore || 0).toLocaleString()} pts</p>
                  <small>
                    {opponentPlayer?.currentCorrectAnswers || 0}/
                    {activeRoom.quizQuestions.length} correct
                  </small>
                  <small>
                    Progress {opponentPlayer?.currentQuestionIndex || 0}/
                    {activeRoom.quizQuestions.length}
                  </small>
                </div>
              </div>
            )}

            <div className="quiz-status duel-game-status">
              <span>Score: {duelScore.toLocaleString()}</span>
              <span>
                Correct: {duelCorrectAnswers} / {activeRoom.quizQuestions.length}
              </span>
              <span className={duelStreak >= 3 ? "streak-reward" : "streak-chip"}>
                {getStreakRewardLabel(duelStreak) || `Streak: ${duelStreak}`}
              </span>
              <button
                type="button"
                className="mute-toggle"
                onClick={handleToggleDuelMute}
                aria-pressed={isDuelMuted}
              >
                {isDuelMuted ? "Sound off" : "Sound on"}
              </button>
            </div>

            <div className="game-state">{renderDuelGameState()}</div>

            <p className="quiz-clue">
              Pick the correct track from <strong>{activeRoom.albumName}</strong>.
            </p>

            <div className="audio-preview-wrapper">
              {question.correctTrack.previewUrl ? (
                <audio
                  ref={duelAudioRef}
                  key={`${activeRoom.id}-${duelQuestionIndex}-${question.correctTrack.previewUrl}`}
                  className="hidden-audio-preview"
                  preload="auto"
                  src={question.correctTrack.previewUrl}
                  onTimeUpdate={handleDuelAudioTimeUpdate}
                  onEnded={handleDuelAudioEnded}
                >
                  Your browser does not support the audio element.
                </audio>
              ) : (
                <p className="preview-unavailable">
                  Audio preview unavailable for this question.
                </p>
              )}

              {duelPhase === "audioBlocked" && question.correctTrack.previewUrl && (
                <button
                  type="button"
                  className="clip-button"
                  onClick={() => void startDuelAnswerRound(true)}
                >
                  Click to play audio and continue
                </button>
              )}
            </div>

            <div className="song-options">
              {question.options.map((option) => (
                <button
                  type="button"
                  className={`song-button ${
                    duelSelectedAnswer === option.name ? "selected-song" : ""
                  } ${
                    duelSelectedAnswer && option.name === question.correctAnswer
                      ? "correct-song"
                      : ""
                  } ${
                    duelSelectedAnswer === option.name &&
                    option.name !== question.correctAnswer
                      ? "wrong-song"
                      : ""
                  }`}
                  key={`${option.id}-${option.name}`}
                  disabled={duelPhase !== "answering" || Boolean(duelSelectedAnswer)}
                  onClick={() => recordDuelAnswer(option.name)}
                >
                  {option.name}
                </button>
              ))}
            </div>

            <p className="score score-live">
              Score: {duelScore.toLocaleString()}
            </p>
          </section>
        );
      }

      return (
        <section className="duel-room-screen">
          <div className="duel-room-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                updateActiveRoom(null);
                resetDuelLocalState();
              }}
            >
              Back to Lobby
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void refreshActiveRoom()}
            >
              Refresh Room
            </button>
            {isHost && (
              <button
                type="button"
                className="secondary-button danger-button"
                onClick={() => void handleCloseDuelRoom()}
              >
                Close Lobby
              </button>
            )}
            {!isHost && (
              <button
                type="button"
                className="secondary-button danger-button"
                onClick={() => void handleLeaveDuelRoom()}
              >
                Leave Lobby
              </button>
            )}
          </div>

          <div className="duel-room-hero">
            {activeRoom.artworkUrl && (
              <img src={activeRoom.artworkUrl} alt="" aria-hidden />
            )}
            <div>
              <p className="eyebrow">{activeModeSettings.roomTitle}</p>
              <h2>{activeRoom.albumName}</h2>
              <p>{activeRoom.artistName}</p>
              <span>
                {activeRoom.status === "active" ? "Active" : "Waiting to start"}
              </span>
            </div>
          </div>

          {renderPrivateInvitePanel(activeRoom)}

          {isActiveGroupLobby ? (
            <div className="duel-player-grid group-player-grid">
              {presentPlayers.map((player) => (
                <div className="duel-player-card" key={player.id}>
                  <span>{player.userId === activeRoom.hostUserId ? "Host" : "Player"}</span>
                  <strong>{player.displayName || "Arena Player"}</strong>
                  {player.username && <p>@{player.username}</p>}
                </div>
              ))}
              {presentPlayers.length < activeRoom.maxPlayers && (
                <div className="duel-player-card">
                  <span>Open Spot</span>
                  <strong>Waiting for players</strong>
                  <p>{presentPlayers.length}/{activeRoom.maxPlayers}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="duel-player-grid">
              <div className="duel-player-card">
                <span>Host</span>
                <strong>{hostPlayer?.displayName || "Arena host"}</strong>
                {hostPlayer?.username && <p>@{hostPlayer.username}</p>}
              </div>
              <div className="duel-player-card">
                <span>Joined Player</span>
                <strong>{guestPlayer?.displayName || "Waiting for rival"}</strong>
                {guestPlayer?.username && <p>@{guestPlayer.username}</p>}
              </div>
            </div>
          )}

          {isHost ? (
            <button
              type="button"
              className="duel-start-button"
              disabled={
                presentPlayers.length < activeModeSettings.minPlayersToStart ||
                isPreparingDuel
              }
              onClick={() => void handleStartDuel()}
            >
              {isPreparingDuel
                ? "Preparing..."
                : `Start Synced ${activeModeSettings.title}`}
            </button>
          ) : (
            <p className="arena-note">
              Waiting for the host to start.
            </p>
          )}
          <p className="arena-note">
            The host starts once {activeModeSettings.minPlayersToStart} or more
            players are in. A shared question set and future start clock keep
            every device aligned.
          </p>
        </section>
      );
    }

    return (
      <section className="duel-lobby">
        <div className="duel-builder">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Create {modeSettings.title}</p>
              <h2>Pick an album</h2>
            </div>
            <span>
              {modeSettings.minPlayersToStart}-{modeSettings.maxPlayers} players
            </span>
          </div>

          {!session && (
            <p className="arena-note">
              Log in to create or join Arena rooms.
            </p>
          )}

          <form className="search-box" onSubmit={handleSearch}>
            <input
              type="search"
              placeholder="Album or artist..."
              value={searchTerm}
              aria-label={`Search for a ${modeSettings.title} album`}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? "Searching..." : "Search"}
            </button>
          </form>

          {albums.length > 0 && (
            <>
              <p className="album-result-count duel-result-count">
                Showing {visibleAlbums.length} of {cappedAlbums.length} results
              </p>

              <div className="duel-album-grid">
                {visibleAlbums.map((album) => (
                  <button
                    type="button"
                    className={`duel-album-card ${
                      selectedAlbum?.id === album.id ? "selected" : ""
                    }`}
                    onClick={() => setSelectedAlbum(album)}
                    key={album.id}
                  >
                    {album.imageUrl && (
                      <img src={album.imageUrl} alt={`${album.title} cover`} />
                    )}
                    <span>
                      <strong>{album.title}</strong>
                      <small>{album.artist}</small>
                    </span>
                  </button>
                ))}
              </div>

              {hasMoreAlbums && (
                <button
                  type="button"
                  className="view-more-albums duel-view-more-albums"
                  onClick={handleViewMoreAlbums}
                >
                  View more albums
                </button>
              )}
            </>
          )}

        </div>

        <div className="duel-open-rooms">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Open {modeSettings.title} Rooms</p>
              <h2>Waiting Rooms</h2>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void loadOpenRooms()}
            >
              Refresh Rooms
            </button>
          </div>

          {isLoadingRooms ? (
            <p className="empty-stats">Loading open rooms...</p>
          ) : rooms.length > 0 ? (
            <div className="duel-room-list">
              {rooms.map((room) => {
                const isAlreadyInRoom = Boolean(
                  session?.user &&
                    room.players.some(
                      (player) => player.userId === session.user.id && !player.leftAt
                    )
                );
                const presentRoomPlayers = getPresentPlayers(room);
                const isFull = presentRoomPlayers.length >= room.maxPlayers;
                const actionLabel = !session
                  ? "Login to Join"
                  : isAlreadyInRoom
                    ? "Enter Room"
                    : isFull
                      ? "Room Full"
                      : "Join Room";

                return (
                  <article className="duel-room-card" key={room.id}>
                    {room.artworkUrl && (
                      <img src={room.artworkUrl} alt="" aria-hidden />
                    )}
                    <div>
                      <strong>{room.albumName}</strong>
                      <span>{room.artistName}</span>
                      <small>Host: {getHostName(room)}</small>
                    </div>
                    <span className="duel-room-status">{room.status}</span>
                    <span className="duel-room-count">
                      {presentRoomPlayers.length}/{room.maxPlayers}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenRoomRequest(room)}
                      disabled={!session || (isFull && !isAlreadyInRoom)}
                    >
                      {actionLabel}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="empty-stats">
              No open {modeSettings.title} rooms yet. Create the first one.
            </p>
          )}
        </div>
        {renderSelectedAlbumStartBar()}
      </section>
    );
  }

  return (
    <section className={`arena-page arena-theme-${selectedArenaTheme}`}>
      <div className="arena-hero">
        <p className="eyebrow">TrackTest Arena</p>
        <h1>Arena Modes</h1>
        <p>
          The multiplayer wing is being built for duels, live rooms, parties,
          and championship runs.
        </p>
      </div>

      <div className="arena-status">
        <span>{activeArenaMode ? `${modeSettings.title} MVP` : "Coming Soon"}</span>
        <div>
          <h2>
            {activeArenaMode
              ? `${modeSettings.title} rooms are playable`
              : "Arena is coming soon"}
          </h2>
          <p>
            {activeArenaMode
              ? "Create or join a waiting room, start together, and play the same synced album quiz."
              : "Solo stats, badges, profiles, and leaderboards are laying the foundation before live rooms open."}
          </p>
        </div>
      </div>

      {visibleRecoveryRoom && (
        <section className="arena-recovery-strip">
          <ArenaActiveRoomCard
            room={visibleRecoveryRoom}
            currentUserId={session?.user.id}
            onResume={() => {
              updateActiveRoom(visibleRecoveryRoom);
              setActiveArenaMode(visibleRecoveryRoom.mode);
              setSelectedArenaTheme(visibleRecoveryRoom.mode);
              setMessage("Resumed active Arena room.");
            }}
            onClose={() => void handleCloseArenaRoom(visibleRecoveryRoom)}
            isClosing={isClosingActiveRoom}
          />
        </section>
      )}

      <form className="arena-code-entry" onSubmit={handleJoinWithCode}>
        <div>
          <p className="eyebrow">Private Room</p>
          <h2>Join with Code</h2>
        </div>
        <input
          type="text"
          placeholder="Enter private room code"
          value={roomCodeInput}
          aria-label="Enter private room code"
          onChange={(event) =>
            setRoomCodeInput(normalizeArenaInviteCode(event.target.value))
          }
        />
        <button type="submit" disabled={isInviteLoading}>
          {isInviteLoading ? "Checking..." : "Join with Code"}
        </button>
      </form>

      <div className="arena-mode-grid">
        {arenaModes.map((mode) => {
          const isDuel = mode.title === "Duel";
          const isGroup = mode.title === "Group Lobby";
          const isParty = mode.title === "Party Mode";
          const roomMode: ArenaRoomMode | null = isDuel
            ? "duel"
            : isGroup
              ? "group_lobby"
              : null;
          const theme: ArenaTheme = roomMode || (isParty ? "party" : "championship");

          return (
            <button
              type="button"
              className={`arena-mode-card arena-mode-${mode.accent} ${
                selectedArenaTheme === theme ? "active" : ""
              }`}
              key={mode.title}
              onClick={() => {
                setSelectedArenaTheme(theme);

                if (roomMode) {
                  setActiveArenaMode(roomMode);
                  setPendingInvite(null);
                  setPendingPublicRoom(null);
                  setSelectedAlbum(null);
                  setAlbums([]);
                  setMessage("");
                  if (!activeRoom) {
                    resetDuelLocalState();
                  }
                  return;
                }

                setActiveArenaMode(null);
                setPendingInvite(null);
                setPendingPublicRoom(null);
                setSelectedAlbum(null);
                setAlbums([]);
                setMessage(`${mode.title} is coming soon.`);
              }}
              aria-disabled={!mode.enabled}
            >
              <span className="arena-mode-label">{mode.label}</span>
              <h2>{mode.title}</h2>
              <p>{mode.description}</p>
              <strong>{mode.enabled ? "Open Lobby" : "Coming soon"}</strong>
            </button>
          );
        })}
      </div>

      {message && <p className="arena-message">{message}</p>}
      {(activeRoom ||
        activeArenaMode ||
        pendingInvite ||
        pendingPublicRoom ||
        inviteError ||
        isInviteLoading) &&
        renderDuelLobby()}

      <button type="button" onClick={onHome}>
        Back Home
      </button>
    </section>
  );
}

export default ArenaPage;
