import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  activateDuelRoom,
  cancelDuelRoom,
  createDuelRoom,
  fetchArenaRoom,
  fetchCurrentDuelRoom,
  fetchOpenDuelRooms,
  finishDuelRoom,
  forfeitDuelRoom,
  joinDuelRoom,
  leaveWaitingDuelRoom,
  saveDuelPlayerResult,
  updateDuelPlayerProgress,
  type ArenaRoom,
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
    enabled: false,
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
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 12;
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type ArenaPageProps = {
  session: Session | null;
  profile: UserProfile | null;
  onHome: () => void;
  onLogin: () => void;
};

function ArenaPage({ session, profile, onHome, onLogin }: ArenaPageProps) {
  const [isDuelOpen, setIsDuelOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [visibleAlbumCount, setVisibleAlbumCount] = useState(ALBUMS_PER_PAGE);
  const [rooms, setRooms] = useState<ArenaRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<ArenaRoom | null>(null);
  const [message, setMessage] = useState("");
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
  const cappedAlbums = albums.slice(0, MAX_VISIBLE_ALBUMS);
  const visibleAlbums = cappedAlbums.slice(0, visibleAlbumCount);
  const hasMoreAlbums = visibleAlbums.length < cappedAlbums.length;
  const duelTimerProgress = Math.max(0, duelTimeRemaining / QUESTION_TIME_SECONDS);
  const duelRingOffset = RING_CIRCUMFERENCE * (1 - duelTimerProgress);
  const shouldShowDuelDanger =
    duelPhase === "answering" && duelTimeRemaining <= 3 && !duelSelectedAnswer;

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
    if (!isDuelOpen) {
      return;
    }

    void loadOpenRooms(false);

    if (session?.user) {
      void reconnectCurrentDuelRoom();
    }
  }, [isDuelOpen, session?.user?.id]);

  useEffect(() => {
    if (!isDuelOpen || activeRoom) {
      return;
    }

    const refreshId = window.setInterval(() => {
      void loadOpenRooms(false);
    }, DUEL_OPEN_ROOM_REFRESH_MS);

    return () => window.clearInterval(refreshId);
  }, [activeRoom, isDuelOpen]);

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
      setActiveRoom(room);
      setMessage(error || "Reconnected to your active Duel room.");
    }
  }

  async function loadOpenRooms(showErrors = true) {
    setIsLoadingRooms(true);
    const { rooms: nextRooms, error } = await fetchOpenDuelRooms();

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

  async function handleCreateRoom() {
    if (!session?.user) {
      onLogin();
      return;
    }

    if (!selectedAlbum || isCreatingRoom) {
      return;
    }

    setIsCreatingRoom(true);
    setMessage("");

    const { room, error } = await createDuelRoom({
      album: selectedAlbum,
      user: session.user,
      profile,
    });

    if (room) {
      setActiveRoom(room);
      resetDuelLocalState();
      await loadOpenRooms(false);
    }

    setMessage(error || (room ? "Duel room created." : "Failed to create room."));
    setIsCreatingRoom(false);
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

      setActiveRoom(freshRoom || room);
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
      setActiveRoom(joinedRoom);
      resetDuelLocalState();
      await loadOpenRooms(false);
    }

    setMessage(error || (joinedRoom ? "Joined room." : "Failed to join room."));
  }

  async function refreshActiveRoom(showMessage = true) {
    if (!activeRoom) {
      return;
    }

    const { room, error } = await fetchArenaRoom(activeRoom.id);

    if (room) {
      setActiveRoom(room);
    }

    if (showMessage) {
      setMessage(error || "Room refreshed.");
    }
  }

  async function handleCloseDuelRoom() {
    if (!activeRoom || activeRoom.hostUserId !== session?.user.id) {
      return;
    }

    const { error } = await cancelDuelRoom(activeRoom.id);

    setMessage(error || "Duel room closed.");
    setActiveRoom(null);
    resetDuelLocalState();
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
      setActiveRoom(null);
      resetDuelLocalState();
      await loadOpenRooms(false);
      return;
    }

    if (activeRoom.status === "active") {
      const result = await forfeitDuelRoom(activeRoom.id);

      setMessage(result.error || "You forfeited the Duel.");
      setActiveRoom(null);
      resetDuelLocalState();
      await loadOpenRooms(false);
      return;
    }

    setActiveRoom(null);
    resetDuelLocalState();
  }

  function getPresentPlayers(room: ArenaRoom) {
    return room.players.filter((player) => !player.leftAt);
  }

  async function handleStartDuel() {
    if (!session?.user || !activeRoom) {
      return;
    }

    setIsPreparingDuel(true);
    setMessage("");

    const { room: freshRoom, error } = await fetchArenaRoom(activeRoom.id);

    if (!freshRoom) {
      setMessage(error || "Could not refresh room.");
      setIsPreparingDuel(false);
      return;
    }

    if (freshRoom.hostUserId !== session.user.id) {
      setMessage("Only the host can start the Duel.");
      setIsPreparingDuel(false);
      return;
    }

    if (getPresentPlayers(freshRoom).length < 2) {
      setMessage("Waiting for a second player.");
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

    setActiveRoom(activatedRoom.room || { ...freshRoom, quizQuestions: questions });
    resetDuelLocalState("syncing");
    setMessage(
      activatedRoom.error || "Duel starting. Both players get the same questions."
    );
    setIsPreparingDuel(false);
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
        presentPlayers.length >= 2 &&
        presentPlayers.every((player) => player.finishedAt);

      if (hasEveryoneFinished && room.status !== "finished") {
        await finishDuelRoom(room.id);
        const refreshedRoom = await fetchArenaRoom(room.id);
        setActiveRoom(refreshedRoom.room || room);
      } else {
        setActiveRoom(room);
      }
    }

    setMessage(result.error || "Duel complete. Waiting for opponent to finish.");
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

  function renderDuelGameState() {
    if (duelPhase === "syncing") {
      return (
        <>
          <p className="game-state-label">Synced start</p>
          <p className="start-countdown">{duelSyncCountdown || "..."}</p>
          <p className="game-state-detail">
            Both players start from the same room clock.
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
        <p className="game-state-detail">Waiting for the shared Duel clock...</p>
      </>
    );
  }

  function renderDuelLobby() {
    if (activeRoom) {
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
      const bothPlayersFinished =
        activeRoom.status === "finished" ||
        (activeRoom.players.length >= 2 &&
          activeRoom.players.every((player) => player.finishedAt));
      const question = activeRoom.quizQuestions[duelQuestionIndex];
      const isHost = activeRoom.hostUserId === session?.user.id;

      if (activeRoom.status === "cancelled") {
        return (
          <section className="duel-room-screen">
            <div className="duel-results-card">
              <p className="eyebrow">Duel Closed</p>
              <h2>This room was cancelled.</h2>
              <p className="arena-note">Create or join another waiting room.</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setActiveRoom(null);
                resetDuelLocalState();
              }}
            >
              Back to Duel Lobby
            </button>
          </section>
        );
      }

      if (bothPlayersFinished) {
        const sortedPlayers = sortDuelResults(activeRoom.players);

        return (
          <section className="duel-room-screen">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setActiveRoom(null);
                resetDuelLocalState();
              }}
            >
              Back to Duel Lobby
            </button>
            <div className="duel-results-card">
              <p className="eyebrow">Duel Results</p>
              <h2>{getWinnerLabel(sortedPlayers)}</h2>
              <div className="duel-player-grid">
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
            </div>
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
                <p className="eyebrow">Duel Submitted</p>
                <h2>Waiting for opponent to finish.</h2>
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
                <p className="eyebrow">Duel Active</p>
                <h2>{activeRoom.albumName}</h2>
                <p>
                  Question {duelQuestionIndex + 1} of{" "}
                  {activeRoom.quizQuestions.length}
                </p>
                <span>{duelPhase === "syncing" ? "Synced start" : "Live Duel"}</span>
              </div>
            </div>

            <div className="duel-room-actions">
              <button
                type="button"
                className="secondary-button danger-button"
                onClick={() => void handleLeaveDuelRoom()}
              >
                Forfeit Duel
              </button>
            </div>

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
              Duel score: {duelScore.toLocaleString()}
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
                setActiveRoom(null);
                resetDuelLocalState();
              }}
            >
              Back to Duel Lobby
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
              <p className="eyebrow">Duel Room</p>
              <h2>{activeRoom.albumName}</h2>
              <p>{activeRoom.artistName}</p>
              <span>
                {activeRoom.status === "active" ? "Active" : "Waiting to start"}
              </span>
            </div>
          </div>

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

          {isHost ? (
            <button
              type="button"
              className="duel-start-button"
              disabled={presentPlayers.length < 2 || isPreparingDuel}
              onClick={() => void handleStartDuel()}
            >
              {isPreparingDuel ? "Preparing..." : "Start Synced Duel"}
            </button>
          ) : (
            <p className="arena-note">
              Waiting for the host to start the Duel.
            </p>
          )}
          <p className="arena-note">
            The host starts once both players are in. A shared question set and
            future start clock keep both devices aligned.
          </p>
        </section>
      );
    }

    return (
      <section className="duel-lobby">
        <div className="duel-builder">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Create Duel</p>
              <h2>Pick an album</h2>
            </div>
            <span>1v1 lobby</span>
          </div>

          {!session && (
            <p className="arena-note">
              Log in to create or join Duel rooms.
            </p>
          )}

          <form className="search-box" onSubmit={handleSearch}>
            <input
              type="search"
              placeholder="Album or artist..."
              value={searchTerm}
              aria-label="Search for a Duel album"
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

          <button
            type="button"
            className="duel-create-button"
            disabled={!selectedAlbum || isCreatingRoom || !session}
            onClick={handleCreateRoom}
          >
            {isCreatingRoom ? "Creating..." : "Create Duel Room"}
          </button>
        </div>

        <div className="duel-open-rooms">
          <div className="profile-panel-heading">
            <div>
              <p className="eyebrow">Open Duel Rooms</p>
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
                      onClick={() => void handleJoinRoom(room)}
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
              No open Duel rooms yet. Create the first one.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="arena-page">
      <div className="arena-hero">
        <p className="eyebrow">TrackTest Arena</p>
        <h1>Arena Modes</h1>
        <p>
          The multiplayer wing is being built for duels, live rooms, parties,
          and championship runs.
        </p>
      </div>

      <div className="arena-status">
        <span>{isDuelOpen ? "Duel MVP" : "Coming Soon"}</span>
        <div>
          <h2>{isDuelOpen ? "Duel rooms are playable" : "Arena is coming soon"}</h2>
          <p>
            {isDuelOpen
              ? "Create or join a waiting Duel room, start together, and play the same synced album quiz."
              : "Solo stats, badges, profiles, and leaderboards are laying the foundation before live rooms open."}
          </p>
        </div>
      </div>

      <div className="arena-mode-grid">
        {arenaModes.map((mode) => {
          const isDuel = mode.title === "Duel";

          return (
            <button
              type="button"
              className={`arena-mode-card arena-mode-${mode.accent} ${
                isDuelOpen && isDuel ? "active" : ""
              }`}
              key={mode.title}
              onClick={() => {
                if (isDuel) {
                  setIsDuelOpen(true);
                }
              }}
              disabled={!mode.enabled}
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
      {isDuelOpen && renderDuelLobby()}

      <button type="button" onClick={onHome}>
        Back Home
      </button>
    </section>
  );
}

export default ArenaPage;
