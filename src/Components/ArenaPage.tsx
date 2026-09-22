import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  acknowledgeCompetitiveAudioReady,
  activateDuelRoom,
  cancelDuelRoom,
  createDuelRoom,
  endArenaRoom,
  fetchArenaRoom,
  fetchArenaInvite,
  fetchCompetitiveClockOffset,
  fetchPartyClockOffset,
  fetchOpenDuelRooms,
  forfeitDuelRoom,
  getFriendlyArenaError,
  isArenaRoomRecoverableForUser,
  joinArenaRoomByInvite,
  joinDuelRoom,
  leaveArenaRoom,
  normalizeArenaInviteCode,
  requestArenaRematch,
  reportCompetitiveAudioFailure,
  resetArenaRoomForRematch,
  type ArenaInvite,
  setPartyAudioState,
  skipPartyQuestion,
  submitCompetitiveArenaAnswer,
  submitPartyAnswer,
  syncCompetitiveArenaTimeline,
  syncPartyRoomTimeline,
  type ArenaRoom,
  type ArenaRoomMode,
  type ArenaRoomPlayer,
  type DuelQuizQuestion,
} from "../lib/arenaRooms";
import type { UserProfile } from "../lib/profiles";
import { supabase } from "../lib/supabaseClient";
import {
  ArenaAudioController,
  type ArenaAudioPhase,
} from "../lib/arenaAudioController";
import {
  getSpotifyAlbumTracks,
  prefetchSpotifyAlbumTracks,
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
    enabled: true,
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
  | "partyWaitingAudio"
  | "audioBlocked"
  | "audioSkipped"
  | "answering"
  | "partyAnswerLocked"
  | "partyHostWatching"
  | "correctHold"
  | "reveal";

type DuelResult = {
  isCorrect: boolean;
  points: number;
  correctAnswer: string;
  wasAudioSkipped?: boolean;
};

const ALBUMS_PER_PAGE = 8;
const MAX_VISIBLE_ALBUMS = 48;
const QUESTION_TIME_SECONDS = 10;
const START_COUNTDOWN_SECONDS = 3;
const REVEAL_NEXT_QUESTION_DELAY_MS = 2500;
const REVEAL_COUNTDOWN_SECONDS = Math.ceil(REVEAL_NEXT_QUESTION_DELAY_MS / 1000);
const CLIP_LENGTH_SECONDS = 5;
const DUEL_ROOM_REFRESH_MS = 1000;
const DUEL_OPEN_ROOM_REFRESH_MS = 12000;
const AUDIO_BLOCKED_SKIP_DELAY_MS = 3500;
const ALBUM_SEARCH_DEBOUNCE_MS = 450;
const ARENA_STATUS_ORDER: Record<string, number> = {
  waiting: 0,
  starting: 1,
  active: 2,
  finished: 3,
  cancelled: 3,
  expired: 3,
  forfeited: 3,
  ended: 3,
};
const COMPETITIVE_PHASE_ORDER = {
  idle: 0,
  preparing_audio: 1,
  countdown: 2,
  answering: 3,
  reveal: 4,
  finished: 5,
} as const;
const PARTY_PHASE_ORDER = {
  idle: 0,
  countdown: 1,
  awaiting_audio: 2,
  answering: 3,
  reveal: 4,
  finished: 5,
} as const;
const LEGACY_ARENA_ROOM_STORAGE_KEYS = [
  "tracktest.activeArenaRoomId",
  "tracktestArenaRoomId",
  "tracktest_arena_room_id",
];

function isOlderArenaRoomSnapshot(next: ArenaRoom, current: ArenaRoom) {
  if (next.id !== current.id) return false;
  if (next.roundNumber !== current.roundNumber) {
    return next.roundNumber < current.roundNumber;
  }

  const nextStatusOrder = ARENA_STATUS_ORDER[next.status] ?? 0;
  const currentStatusOrder = ARENA_STATUS_ORDER[current.status] ?? 0;
  if (nextStatusOrder !== currentStatusOrder) {
    return nextStatusOrder < currentStatusOrder;
  }

  if (next.mode === "party_mode" && current.mode === "party_mode") {
    if (next.partyQuestionIndex !== current.partyQuestionIndex) {
      return next.partyQuestionIndex < current.partyQuestionIndex;
    }

    return (
      PARTY_PHASE_ORDER[next.partyQuestionPhase] <
      PARTY_PHASE_ORDER[current.partyQuestionPhase]
    );
  }

  if (next.mode !== "party_mode" && current.mode !== "party_mode") {
    if (next.competitiveQuestionIndex !== current.competitiveQuestionIndex) {
      return next.competitiveQuestionIndex < current.competitiveQuestionIndex;
    }

    return (
      COMPETITIVE_PHASE_ORDER[next.competitiveRoundPhase] <
      COMPETITIVE_PHASE_ORDER[current.competitiveRoundPhase]
    );
  }

  return false;
}
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
  party_mode: {
    title: "Party Mode",
    roomTitle: "Party Room",
    activeTitle: "Party Mode Live",
    resultsTitle: "Party Results",
    maxPlayers: 30,
    minPlayersToStart: 2,
  },
};
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 12;
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function clearStoredArenaRoomReferences() {
  for (const key of LEGACY_ARENA_ROOM_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }

    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // The database membership remains the source of truth.
    }
  }
}

type ArenaPageProps = {
  session: Session | null;
  profile: UserProfile | null;
  onHome: () => void;
  onLogin: () => void;
  onGuest?: () => Promise<string>;
  inviteCode?: string | null;
  recoveredRoom?: ArenaRoom | null;
  onArenaRoomChange?: (room: ArenaRoom | null) => void;
  onInviteHandled?: () => void;
  onProgressionUpdated?: () => void;
};

type ArenaTheme = ArenaRoomMode | "championship";

function ArenaPage({
  session,
  profile,
  onHome,
  onLogin,
  onGuest,
  inviteCode,
  recoveredRoom,
  onArenaRoomChange,
  onInviteHandled,
  onProgressionUpdated,
}: ArenaPageProps) {
  const [selectedArenaTheme, setSelectedArenaTheme] =
    useState<ArenaTheme | null>(null);
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
  const [isLeavingRoom, setIsLeavingRoom] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isPreparingDuel, setIsPreparingDuel] = useState(false);

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
  const [duelAudioRetryUsed, setDuelAudioRetryUsed] = useState(false);
  const [isDuelAudioPrimed, setIsDuelAudioPrimed] = useState(false);
  const [isDuelClipPlaying, setIsDuelClipPlaying] = useState(false);
  const [isDuelFinished, setIsDuelFinished] = useState(false);
  const [duelRevealMessage, setDuelRevealMessage] = useState("");
  const [duelLastResult, setDuelLastResult] = useState<DuelResult | null>(null);
  const [duelFlash, setDuelFlash] = useState<"good" | "bad" | null>(null);
  const [isDuelMuted, setIsDuelMuted] = useState(sounds.isMuted());
  const [competitiveClockOffsetMs, setCompetitiveClockOffsetMs] = useState(0);
  const [partyClockOffsetMs, setPartyClockOffsetMs] = useState(0);

  const duelAudioRef = useRef<HTMLAudioElement | null>(null);
  const duelAudioFallbackTimerRef = useRef<number | null>(null);
  const duelClipCompletedRef = useRef(false);
  const duelPhaseRef = useRef<DuelPhase>("idle");
  const duelSelectedAnswerRef = useRef("");
  const activeRoundKeyRef = useRef<string>("");
  const progressionSyncedRoundRef = useRef<string>("");
  const competitiveQuestionKeyRef = useRef<string>("");
  const competitiveAudioStartKeyRef = useRef<string>("");
  const competitiveAudioReadyKeyRef = useRef<string>("");
  const competitiveAudioFailureKeyRef = useRef<string>("");
  const competitiveRevealSoundKeyRef = useRef<string>("");
  const partyQuestionKeyRef = useRef<string>("");
  const partyAudioStartKeyRef = useRef<string>("");
  const leavingRoomIdRef = useRef<string | null>(null);
  const ignoredRoomIdsRef = useRef(new Set<string>());
  const activeRoomIdRef = useRef<string | null>(null);
  const activeRoomSnapshotRef = useRef<ArenaRoom | null>(null);
  const activeRoomRefreshRequestRef = useRef(0);
  const activeQuestionRunKeyRef = useRef("");
  const arenaAudioControllerRef = useRef<ArenaAudioController | null>(null);
  const albumSearchRequestRef = useRef<AbortController | null>(null);
  const albumSearchSequenceRef = useRef(0);

  if (!arenaAudioControllerRef.current) {
    arenaAudioControllerRef.current = new ArenaAudioController();
  }

  const arenaAudioController = arenaAudioControllerRef.current;
  arenaAudioController.setCallbacks({
    onPlaybackChange: setIsDuelClipPlaying,
    onPlaybackConfirmed: () => {
      setIsDuelAudioPrimed(true);
    },
    onPlaybackStopped: (roundKey, reason) => {
      if (
        roundKey === activeQuestionRunKeyRef.current &&
        ["shared-clip-ended", "clip-time-reached", "media-ended"].includes(reason)
      ) {
        duelClipCompletedRef.current = true;
      }
    },
    onPlaybackFailure: ({ roundKey, message: audioMessage, errorName, errorMessage }) => {
      console.error("Arena audio playback failed:", {
        roundKey,
        message: audioMessage,
        errorName,
        errorMessage,
      });
      if (
        activeRoomSnapshotRef.current?.mode !== "party_mode" &&
        activeRoomSnapshotRef.current?.status === "active"
      ) {
        void failCompetitiveQuestionAudio(audioMessage, roundKey);
      } else {
        enterDuelAudioFallback(audioMessage, roundKey);
      }
    },
  });

  const isPartyMode = activeRoom?.mode === "party_mode";
  const isCompetitiveMode = Boolean(
    activeRoom && ["duel", "group_lobby"].includes(activeRoom.mode)
  );
  const isPartyHost = Boolean(
    isPartyMode && activeRoom?.hostUserId === session?.user.id
  );
  const gameQuestionIndex = isPartyMode
    ? activeRoom?.partyQuestionIndex || 0
    : activeRoom?.competitiveQuestionIndex || 0;
  const currentDuelQuestion = activeRoom?.quizQuestions[gameQuestionIndex];
  const activeQuestionRunKey = activeRoom
    ? `${activeRoom.id}:${activeRoom.roundNumber}:${activeRoom.status}:${
        activeRoom.competitiveRoundId || "party"
      }:${gameQuestionIndex}`
    : "";
  activeRoomIdRef.current = activeRoom?.id || null;
  activeRoomSnapshotRef.current = activeRoom;
  activeQuestionRunKeyRef.current = activeQuestionRunKey;
  duelPhaseRef.current = duelPhase;
  duelSelectedAnswerRef.current = duelSelectedAnswer;
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
  const currentArenaPlayer = activeRoom?.players.find(
    (player) => player.userId === session?.user.id
  );
  const duelAnsweredCount = isPartyMode
    ? Math.max(
        currentArenaPlayer?.currentQuestionIndex || 0,
        duelAnswerTimes.length
      )
    : currentArenaPlayer?.roundsPlayed || 0;
  const duelLiveAccuracy =
    duelAnsweredCount > 0
      ? Math.round((duelCorrectAnswers / duelAnsweredCount) * 100)
      : 0;
  const shouldShowDuelDanger =
    duelPhase === "answering" && duelTimeRemaining <= 3 && !duelSelectedAnswer;
  const visibleRecoveryRoom =
    [activeRoom, recoveredRoom].find(
      (room): room is ArenaRoom =>
        Boolean(
          room &&
            !ignoredRoomIdsRef.current.has(room.id) &&
            isArenaRoomRecoverableForUser(room, session?.user.id)
        )
    ) || null;
  const shouldShowAlbumDock = Boolean(
    selectedAlbum && (!activeRoom || isChoosingRematchAlbum)
  );

  const burstPieces = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: index,
        rotation: `${index * 30}deg`,
        color: ["#7c5cff", "#2ee66b", "#ff4fa0", "#f2f0ea"][index % 4],
      })),
    [gameQuestionIndex]
  );

  useEffect(() => {
    if (!activeArenaMode) {
      return;
    }

    void loadOpenRooms(false);
  }, [activeArenaMode, session?.user?.id, inviteCode]);

  useEffect(() => {
    const query = searchTerm.trim();
    if (!activeArenaMode || activeRoom || query.length < 2) return;

    const debounceId = window.setTimeout(() => {
      void runArenaAlbumSearch(query);
    }, ALBUM_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(debounceId);
  }, [activeArenaMode, activeRoom?.id, searchTerm]);

  useEffect(
    () => () => {
      albumSearchRequestRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || activeRoom || pendingInvite || inviteError) {
        return;
      }

      setActiveArenaMode(null);
      setSelectedArenaTheme(null);
      setPendingPublicRoom(null);
      setSelectedAlbum(null);
      setAlbums([]);
      setMessage("");
    }

    window.addEventListener("keydown", handleEscape);

    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeRoom, inviteError, pendingInvite]);

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
    if (
      !recoveredRoom ||
      activeRoom ||
      activeArenaMode ||
      pendingInvite ||
      inviteCode ||
      ignoredRoomIdsRef.current.has(recoveredRoom.id) ||
      !isArenaRoomRecoverableForUser(recoveredRoom, session?.user.id)
    ) {
      return;
    }

    updateActiveRoom(recoveredRoom);
    resetDuelLocalState();
  }, [activeArenaMode, activeRoom, inviteCode, pendingInvite, recoveredRoom, session?.user.id]);

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
      activeRoundKeyRef.current = "";
      return;
    }

    const refreshId = window.setInterval(() => {
      if (navigator.onLine) {
        void refreshActiveRoom(false);
      }
    }, DUEL_ROOM_REFRESH_MS);

    const handleOnline = () => void refreshActiveRoom(false);
    window.addEventListener("online", handleOnline);

    return () => {
      window.clearInterval(refreshId);
      window.removeEventListener("online", handleOnline);
    };
  }, [activeRoom?.id]);

  useEffect(() => {
    const client = supabase;

    if (
      !client ||
      !activeRoom ||
      activeRoom.status !== "active"
    ) {
      return;
    }

    const channel = client
      .channel(`arena-game-${activeRoom.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "arena_rooms",
          filter: `id=eq.${activeRoom.id}`,
        },
        () => {
          void refreshActiveRoom(false);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "arena_room_players",
          filter: `room_id=eq.${activeRoom.id}`,
        },
        () => {
          void refreshActiveRoom(false);
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [activeRoom?.id, activeRoom?.status]);

  useEffect(() => {
    if (!activeRoom) {
      activeRoundKeyRef.current = "";
      return;
    }

    const roundKey = `${activeRoom.id}:${activeRoom.roundNumber}:${activeRoom.status}:${activeRoom.startedAt || ""}`;

    if (!activeRoundKeyRef.current) {
      activeRoundKeyRef.current = roundKey;
      return;
    }

    if (activeRoundKeyRef.current === roundKey) {
      return;
    }

    const previousRoomId = activeRoundKeyRef.current.split(":")[0];
    activeRoundKeyRef.current = roundKey;

    if (previousRoomId !== activeRoom.id) {
      resetDuelLocalState();
      return;
    }

    if (activeRoom.status === "waiting") {
      resetDuelLocalState();
      return;
    }

    if (
      activeRoom.mode !== "party_mode" &&
      activeRoom.status === "active" &&
      activeRoom.quizQuestions.length > 0
    ) {
      const startsAtMs = activeRoom.startedAt ? Date.parse(activeRoom.startedAt) : 0;
      resetDuelLocalState(startsAtMs && Date.now() < startsAtMs ? "syncing" : "idle");
    }
  }, [
    activeRoom?.id,
    activeRoom?.roundNumber,
    activeRoom?.status,
    activeRoom?.startedAt,
    activeRoom?.quizQuestions.length,
  ]);

  useEffect(() => {
    if (
      !activeRoom ||
      activeRoom.mode !== "party_mode" ||
      activeRoom.status !== "active"
    ) {
      return;
    }

    let isActive = true;

    const syncClock = async () => {
      const { offsetMs } = await fetchPartyClockOffset(activeRoom.id);
      if (isActive) {
        setPartyClockOffsetMs(offsetMs);
      }
    };

    void syncClock();
    const clockSyncId = window.setInterval(syncClock, 30000);

    return () => {
      isActive = false;
      window.clearInterval(clockSyncId);
    };
  }, [activeRoom?.id, activeRoom?.roundNumber, activeRoom?.status]);

  useEffect(() => {
    if (!activeRoom || !isCompetitiveMode || activeRoom.status !== "active") {
      return;
    }

    let isActive = true;

    const syncClock = async () => {
      const { offsetMs } = await fetchCompetitiveClockOffset(activeRoom.id);
      if (isActive) {
        setCompetitiveClockOffsetMs(offsetMs);
      }
    };

    void syncClock();
    const clockSyncId = window.setInterval(syncClock, 30000);

    return () => {
      isActive = false;
      window.clearInterval(clockSyncId);
    };
  }, [activeRoom?.id, activeRoom?.roundNumber, activeRoom?.status, isCompetitiveMode]);

  useEffect(() => {
    const audio = duelAudioRef.current;
    if (!audio) return;

    arenaAudioController.attach(audio);

    return () => {
      arenaAudioController.dispose();
    };
  }, [arenaAudioController]);

  useEffect(() => {
    const roundKey = activeQuestionRunKey;
    const previewUrl = currentDuelQuestion?.correctTrack.previewUrl || "";
    const ownsRoundAudio = Boolean(
      activeRoom &&
        activeRoom.status === "active" &&
        roundKey &&
        previewUrl &&
        (!isPartyMode || isPartyHost)
    );

    if (!ownsRoundAudio || !activeRoom || !currentDuelQuestion) {
      arenaAudioController.stopAll("no-active-audio-round");
      return;
    }

    const nextQuestion = activeRoom.quizQuestions[gameQuestionIndex + 1];
    const phase: ArenaAudioPhase = isPartyMode
      ? activeRoom.partyQuestionPhase === "awaiting_audio"
        ? "party_waiting_audio"
        : activeRoom.partyQuestionPhase === "answering"
          ? "party_host_watching"
          : activeRoom.partyQuestionPhase
      : activeRoom.competitiveRoundPhase;
    const serverTimestamp = isPartyMode
      ? activeRoom.partyClipStartsAt
      : activeRoom.competitiveAnswerStartsAt;

    arenaAudioController.prepareRound(
      {
        roomId: activeRoom.id,
        mode: activeRoom.mode,
        roundKey,
        roundId:
          activeRoom.competitiveRoundId ||
          `party:${activeRoom.roundNumber}:${gameQuestionIndex}`,
        roundIndex: gameQuestionIndex,
        phase,
        previewUrl,
        clipStartSeconds: currentDuelQuestion.clipStartSeconds,
        serverTimestamp,
      },
      nextQuestion?.correctTrack.previewUrl || ""
    );
  }, [
    activeQuestionRunKey,
    activeRoom,
    arenaAudioController,
    currentDuelQuestion,
    gameQuestionIndex,
    isPartyHost,
    isPartyMode,
  ]);

  useEffect(() => {
    if (
      !activeRoom ||
      !isCompetitiveMode ||
      activeRoom.status !== "active" ||
      activeRoom.competitiveRoundPhase !== "preparing_audio" ||
      !activeRoom.competitiveRoundId ||
      !currentDuelQuestion
    ) {
      return;
    }

    const roundKey = activeQuestionRunKey;
    const readinessKey = `${activeRoom.id}:${activeRoom.roundNumber}:${activeRoom.competitiveRoundId}`;
    const previewUrl = currentDuelQuestion.correctTrack.previewUrl || "";

    if (competitiveAudioReadyKeyRef.current === readinessKey) {
      return;
    }

    competitiveAudioReadyKeyRef.current = readinessKey;
    let cancelled = false;

    const prepareAndAcknowledge = async () => {
      const readyResult = await arenaAudioController.waitUntilRoundReady(
        roundKey,
        CLIP_LENGTH_SECONDS
      );

      if (cancelled || readyResult.status === "stale") return;

      if (readyResult.status === "failed") {
        await failCompetitiveQuestionAudio(readyResult.message, roundKey);
        return;
      }

      const readinessDeadline = Date.parse(
        activeRoom.competitiveAudioReadyDeadlineAt || ""
      );
      let lastError = "";

      while (
        !cancelled &&
        (!Number.isFinite(readinessDeadline) ||
          Date.now() + competitiveClockOffsetMs < readinessDeadline)
      ) {
        if (!navigator.onLine) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          continue;
        }

        const { error } = await acknowledgeCompetitiveAudioReady({
          roomId: activeRoom.id,
          roundId: activeRoom.competitiveRoundId!,
          questionIndex: activeRoom.competitiveQuestionIndex,
          previewUrl,
        });

        if (!error) {
          const refreshed = await fetchArenaRoom(activeRoom.id);
          if (!cancelled && refreshed.room) updateActiveRoom(refreshed.room);
          return;
        }

        lastError = error;
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }

      if (!cancelled && lastError) {
        setMessage(`Could not confirm audio readiness: ${lastError}`);
      }
    };

    void prepareAndAcknowledge();
    return () => {
      cancelled = true;
    };
  }, [
    activeQuestionRunKey,
    activeRoom?.id,
    activeRoom?.roundNumber,
    activeRoom?.competitiveQuestionIndex,
    activeRoom?.competitiveRoundId,
    activeRoom?.competitiveRoundPhase,
    activeRoom?.competitiveAudioReadyDeadlineAt,
    activeRoom?.status,
    arenaAudioController,
    currentDuelQuestion,
    competitiveClockOffsetMs,
    isCompetitiveMode,
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
    if (
      !activeRoom ||
      !isCompetitiveMode ||
      activeRoom.status !== "active" ||
      activeRoom.quizQuestions.length === 0
    ) {
      return;
    }

    const questionKey = `${activeRoom.id}:${activeRoom.roundNumber}:${
      activeRoom.competitiveRoundId || activeRoom.competitiveQuestionIndex
    }`;
    const player = activeRoom.players.find(
      (roomPlayer) => roomPlayer.userId === session?.user.id
    );
    const playerAnsweredThisRound = Boolean(
      player &&
        player.competitiveAnsweredQuestionIndex ===
          activeRoom.competitiveQuestionIndex
    );

    if (competitiveQuestionKeyRef.current !== questionKey) {
      competitiveQuestionKeyRef.current = questionKey;
      competitiveAudioStartKeyRef.current = "";
      duelClipCompletedRef.current = false;
      duelSelectedAnswerRef.current = "";
      setDuelSelectedAnswer("");
      setDuelRevealMessage("");
      setDuelLastResult(null);
      setDuelFlash(null);
      setDuelAudioFallbackMessage("");
      setDuelAudioRetryUsed(false);
      setIsDuelFinished(false);
    }

    if (player) {
      // The player row is the durable scoreboard snapshot after reconnects.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDuelScore(player.roundPoints);
      setDuelCorrectAnswers(player.roundsWon);
      setDuelStreak(player.currentStreak);

      if (playerAnsweredThisRound && player.competitiveSelectedAnswer) {
        duelSelectedAnswerRef.current = player.competitiveSelectedAnswer;
        setDuelSelectedAnswer(player.competitiveSelectedAnswer);
        setDuelLastResult({
          isCorrect: Boolean(player.competitiveAnswerWasCorrect),
          points: player.competitiveAnswerWasCorrect ? 1 : 0,
          correctAnswer: currentDuelQuestion?.correctAnswer || "",
        });
      }
    }

    const updateCompetitiveClock = () => {
      const now = Date.now() + competitiveClockOffsetMs;
      const answerStartsAt = Date.parse(
        activeRoom.competitiveAnswerStartsAt || ""
      );
      const answerEndsAt = Date.parse(activeRoom.competitiveAnswerEndsAt || "");
      const revealEndsAt = Date.parse(activeRoom.competitiveRevealEndsAt || "");
      const phase = activeRoom.competitiveRoundPhase;

      if (phase === "preparing_audio") {
        arenaAudioController.updateRoundPhase(
          activeQuestionRunKeyRef.current,
          "preparing_audio",
          activeRoom.competitiveAudioReadyDeadlineAt
        );
        duelPhaseRef.current = "preparing";
        setDuelPhase("preparing");
        setDuelAudioFallbackMessage(
          `Preparing audio ${activeRoom.competitiveReadyCount}/${activeRoom.competitiveRequiredReadyCount || activeRoom.players.length}`
        );
        return;
      }

      if (phase === "countdown") {
        arenaAudioController.updateRoundPhase(
          activeQuestionRunKeyRef.current,
          "countdown",
          activeRoom.competitiveAnswerStartsAt
        );
        setDuelStartCountdown(
          Number.isFinite(answerStartsAt)
            ? Math.max(0, Math.ceil((answerStartsAt - now) / 1000))
            : START_COUNTDOWN_SECONDS
        );
        duelPhaseRef.current = "countdown";
        setDuelPhase("countdown");
        return;
      }

      if (phase === "answering") {
        arenaAudioController.updateRoundPhase(
          activeQuestionRunKeyRef.current,
          "answering",
          activeRoom.competitiveAnswerStartsAt
        );
        setDuelTimeRemaining(
          Number.isFinite(answerEndsAt)
            ? Math.max(0, Math.ceil((answerEndsAt - now) / 1000))
            : QUESTION_TIME_SECONDS
        );

        if (playerAnsweredThisRound) {
          duelPhaseRef.current = "partyAnswerLocked";
          setDuelPhase("partyAnswerLocked");
        } else if (duelPhaseRef.current !== "audioBlocked") {
          duelPhaseRef.current = "answering";
          setDuelPhase("answering");
        }
        return;
      }

      if (phase === "reveal") {
        if (duelPhaseRef.current !== "reveal") {
          arenaAudioController.noteRoundWinner(
            activeQuestionRunKeyRef.current
          );
          stopDuelClip(false, activeQuestionRunKeyRef.current, "round-reveal");
        }
        arenaAudioController.updateRoundPhase(
          activeQuestionRunKeyRef.current,
          "reveal",
          activeRoom.competitiveRevealEndsAt
        );

        const winner = activeRoom.players.find(
          (roomPlayer) =>
            roomPlayer.userId === activeRoom.competitiveRoundWinnerUserId
        );
        const didCurrentPlayerWin = Boolean(
          winner && winner.userId === session?.user.id
        );
        const revealSoundKey = `${questionKey}:reveal`;

        setDuelRevealCountdown(
          Number.isFinite(revealEndsAt)
            ? Math.max(0, Math.ceil((revealEndsAt - now) / 1000))
            : REVEAL_COUNTDOWN_SECONDS
        );
        setDuelLastResult({
          isCorrect: didCurrentPlayerWin,
          points: didCurrentPlayerWin ? 1 : 0,
          correctAnswer: currentDuelQuestion?.correctAnswer || "",
          wasAudioSkipped: activeRoom.competitiveAudioFailed,
        });
        setDuelRevealMessage(
          activeRoom.competitiveAudioFailed
            ? "Audio unavailable on a player device. Question skipped for everyone."
            : winner
            ? `${winner.displayName} got it first in ${formatResponseTime(
                activeRoom.competitiveWinningResponseTime
              )}`
            : "No correct answer this round."
        );

        if (competitiveRevealSoundKeyRef.current !== revealSoundKey) {
          competitiveRevealSoundKeyRef.current = revealSoundKey;
          if (didCurrentPlayerWin) {
            sounds.correct();
            setDuelFlash("good");
          }
        }

        duelPhaseRef.current = "reveal";
        setDuelPhase("reveal");
        return;
      }

      if (phase === "finished") {
        arenaAudioController.updateRoundPhase(
          activeQuestionRunKeyRef.current,
          "finished",
          activeRoom.finishedAt
        );
        stopDuelClip(false, activeQuestionRunKeyRef.current, "game-finished");
        setIsDuelFinished(true);
        duelPhaseRef.current = "idle";
        setDuelPhase("idle");
      }
    };

    updateCompetitiveClock();
    const clockId = window.setInterval(updateCompetitiveClock, 200);

    return () => window.clearInterval(clockId);
  }, [
    activeRoom?.id,
    activeRoom?.roundNumber,
    activeRoom?.status,
    activeRoom?.competitiveQuestionIndex,
    activeRoom?.competitiveRoundId,
    activeRoom?.competitiveRoundPhase,
    activeRoom?.competitiveAnswerStartsAt,
    activeRoom?.competitiveAnswerEndsAt,
    activeRoom?.competitiveRevealEndsAt,
    activeRoom?.competitiveRoundWinnerUserId,
    activeRoom?.competitiveWinningResponseTime,
    activeRoom?.competitiveAudioReadyDeadlineAt,
    activeRoom?.competitiveRequiredReadyCount,
    activeRoom?.competitiveReadyCount,
    activeRoom?.competitiveAudioFailed,
    activeRoom?.quizQuestions.length,
    competitiveClockOffsetMs,
    currentArenaPlayer?.roundPoints,
    currentArenaPlayer?.roundsWon,
    currentArenaPlayer?.currentStreak,
    currentArenaPlayer?.competitiveAnsweredQuestionIndex,
    currentArenaPlayer?.competitiveSelectedAnswer,
    currentArenaPlayer?.competitiveAnswerWasCorrect,
    currentDuelQuestion?.correctAnswer,
    isCompetitiveMode,
    session?.user.id,
  ]);

  useEffect(() => {
    if (!activeRoom || !isCompetitiveMode || activeRoom.status !== "active") {
      return;
    }

    const boundary =
      activeRoom.competitiveRoundPhase === "preparing_audio"
        ? activeRoom.competitiveAudioReadyDeadlineAt
        : activeRoom.competitiveRoundPhase === "countdown"
        ? activeRoom.competitiveAnswerStartsAt
        : activeRoom.competitiveRoundPhase === "answering"
          ? activeRoom.competitiveAnswerEndsAt
          : activeRoom.competitiveRoundPhase === "reveal"
            ? activeRoom.competitiveRevealEndsAt
            : null;

    if (!boundary) {
      return;
    }

    let isCancelled = false;
    let syncId: number | null = null;
    const phaseAtSchedule = activeRoom.competitiveRoundPhase;
    const questionAtSchedule = activeRoom.competitiveQuestionIndex;

    const syncAtBoundary = async () => {
      if (!navigator.onLine) {
        syncId = window.setTimeout(syncAtBoundary, 1000);
        return;
      }

      const { room, error } = await syncCompetitiveArenaTimeline(activeRoom.id);

      if (isCancelled) {
        return;
      }

      if (room) {
        updateActiveRoom(room);

        if (
          room.status === "active" &&
          room.competitiveRoundPhase === phaseAtSchedule &&
          room.competitiveQuestionIndex === questionAtSchedule
        ) {
          syncId = window.setTimeout(syncAtBoundary, 400);
        }
      } else if (error) {
        setMessage(error);
        syncId = window.setTimeout(syncAtBoundary, 1000);
      }
    };

    const delay = Math.max(
      0,
      Date.parse(boundary) - (Date.now() + competitiveClockOffsetMs)
    ) + 80;
    syncId = window.setTimeout(syncAtBoundary, delay);

    return () => {
      isCancelled = true;
      if (syncId !== null) {
        window.clearTimeout(syncId);
      }
    };
  }, [
    activeRoom?.id,
    activeRoom?.competitiveQuestionIndex,
    activeRoom?.competitiveRoundPhase,
    activeRoom?.competitiveAnswerStartsAt,
    activeRoom?.competitiveAnswerEndsAt,
    activeRoom?.competitiveRevealEndsAt,
    activeRoom?.competitiveAudioReadyDeadlineAt,
    activeRoom?.status,
    competitiveClockOffsetMs,
    isCompetitiveMode,
  ]);

  useEffect(() => {
    if (
      !activeRoom ||
      !isCompetitiveMode ||
      activeRoom.status !== "active" ||
      !["countdown", "answering"].includes(
        activeRoom.competitiveRoundPhase
      ) ||
      !activeRoom.competitiveAnswerStartsAt
    ) {
      return;
    }

    const audioKey = `${activeRoom.id}:${activeRoom.roundNumber}:${
      activeRoom.competitiveRoundId || activeRoom.competitiveQuestionIndex
    }`;

    if (competitiveAudioStartKeyRef.current === audioKey) {
      return;
    }

    const delay = Math.max(
      0,
      Date.parse(activeRoom.competitiveAnswerStartsAt) -
        (Date.now() + competitiveClockOffsetMs)
    );
    const audioStartId = window.setTimeout(() => {
      competitiveAudioStartKeyRef.current = audioKey;
      void startDuelAnswerRound(false);
    }, delay);

    return () => window.clearTimeout(audioStartId);
  }, [
    activeRoom?.id,
    activeRoom?.roundNumber,
    activeRoom?.status,
    activeRoom?.competitiveQuestionIndex,
    activeRoom?.competitiveRoundId,
    activeRoom?.competitiveRoundPhase,
    activeRoom?.competitiveAnswerStartsAt,
    competitiveClockOffsetMs,
    isCompetitiveMode,
  ]);

  useEffect(() => {
    if (
      !activeRoom ||
      activeRoom.mode !== "party_mode" ||
      activeRoom.status !== "active" ||
      activeRoom.quizQuestions.length === 0
    ) {
      return;
    }

    const questionKey = `${activeRoom.id}:${activeRoom.roundNumber}:${activeRoom.partyQuestionIndex}`;

    if (partyQuestionKeyRef.current !== questionKey) {
      partyQuestionKeyRef.current = questionKey;
      partyAudioStartKeyRef.current = "";
      duelClipCompletedRef.current = false;
      duelSelectedAnswerRef.current = "";
      setDuelSelectedAnswer("");
      setDuelRevealMessage("");
      setDuelLastResult(null);
      setDuelFlash(null);
      setDuelAudioFallbackMessage("");
      setDuelAudioRetryUsed(false);
      setIsDuelFinished(false);
    }

    const player = activeRoom.players.find(
      (roomPlayer) => roomPlayer.userId === session?.user.id
    );

    if (player && !isPartyHost) {
      // Mirror the latest server-owned player snapshot after reconnect/realtime updates.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDuelScore(player.currentScore);
      setDuelCorrectAnswers(player.currentCorrectAnswers);
      setDuelStreak(player.currentStreak);
    }

    const updatePartyClock = () => {
      const now = Date.now() + partyClockOffsetMs;
      const answerStartsAt = Date.parse(activeRoom.partyAnswerStartsAt || "");
      const answerEndsAt = Date.parse(activeRoom.partyAnswerEndsAt || "");
      const revealEndsAt = Date.parse(activeRoom.partyRevealEndsAt || "");
      const phase = activeRoom.partyQuestionPhase;

      if (phase === "countdown") {
        if (isPartyHost) {
          arenaAudioController.updateRoundPhase(
            activeQuestionRunKeyRef.current,
            "countdown",
            activeRoom.partyClipStartsAt
          );
        }
        setDuelStartCountdown(
          Number.isFinite(answerStartsAt)
            ? Math.max(0, Math.ceil((answerStartsAt - now) / 1000))
            : START_COUNTDOWN_SECONDS
        );
        if (
          isPartyHost &&
          duelPhaseRef.current === "audioBlocked" &&
          Number.isFinite(answerStartsAt) &&
          now >= answerStartsAt
        ) {
          return;
        }
        duelPhaseRef.current = "countdown";
        setDuelPhase("countdown");
        return;
      }

      if (phase === "awaiting_audio") {
        if (isPartyHost) {
          arenaAudioController.updateRoundPhase(
            activeQuestionRunKeyRef.current,
            "party_waiting_audio",
            activeRoom.partyClipStartsAt
          );
        }
        setDuelTimeRemaining(
          Number.isFinite(answerEndsAt)
            ? Math.max(0, Math.ceil((answerEndsAt - now) / 1000))
            : QUESTION_TIME_SECONDS
        );

        if (!(isPartyHost && duelPhaseRef.current === "audioBlocked")) {
          duelPhaseRef.current = "partyWaitingAudio";
          setDuelPhase("partyWaitingAudio");
        }
        return;
      }

      if (phase === "answering") {
        if (isPartyHost) {
          arenaAudioController.updateRoundPhase(
            activeQuestionRunKeyRef.current,
            "party_host_watching",
            activeRoom.partyAnswerStartsAt
          );
        }
        setDuelTimeRemaining(
          Number.isFinite(answerEndsAt)
            ? Math.max(0, Math.ceil((answerEndsAt - now) / 1000))
            : QUESTION_TIME_SECONDS
        );

        const nextPhase = isPartyHost
          ? "partyHostWatching"
          : duelSelectedAnswerRef.current ||
              (player &&
                player.currentQuestionIndex > activeRoom.partyQuestionIndex)
            ? "partyAnswerLocked"
            : "answering";
        duelPhaseRef.current = nextPhase;
        setDuelPhase(nextPhase);
        return;
      }

      if (phase === "reveal") {
        if (duelPhaseRef.current !== "reveal") {
          stopDuelClip(false, activeQuestionRunKeyRef.current, "party-reveal");
        }
        if (isPartyHost) {
          arenaAudioController.updateRoundPhase(
            activeQuestionRunKeyRef.current,
            "reveal",
            activeRoom.partyRevealEndsAt
          );
        }
        setDuelRevealCountdown(
          Number.isFinite(revealEndsAt)
            ? Math.max(0, Math.ceil((revealEndsAt - now) / 1000))
            : REVEAL_COUNTDOWN_SECONDS
        );
        duelPhaseRef.current = "reveal";
        setDuelPhase("reveal");
        return;
      }

      if (phase === "finished") {
        if (isPartyHost) {
          arenaAudioController.updateRoundPhase(
            activeQuestionRunKeyRef.current,
            "finished",
            activeRoom.finishedAt
          );
          stopDuelClip(false, activeQuestionRunKeyRef.current, "party-finished");
        }
        duelPhaseRef.current = "idle";
        setDuelPhase("idle");
      }
    };

    updatePartyClock();
    const clockId = window.setInterval(updatePartyClock, 200);

    return () => window.clearInterval(clockId);
  }, [
    activeRoom?.id,
    activeRoom?.roundNumber,
    activeRoom?.status,
    activeRoom?.partyQuestionIndex,
    activeRoom?.partyQuestionPhase,
    activeRoom?.partyAnswerStartsAt,
    activeRoom?.partyAnswerEndsAt,
    activeRoom?.partyRevealEndsAt,
    activeRoom?.quizQuestions.length,
    currentArenaPlayer?.currentScore,
    currentArenaPlayer?.currentCorrectAnswers,
    currentArenaPlayer?.currentStreak,
    isPartyHost,
    partyClockOffsetMs,
    session?.user.id,
  ]);

  useEffect(() => {
    if (
      !activeRoom ||
      activeRoom.mode !== "party_mode" ||
      activeRoom.status !== "active"
    ) {
      return;
    }

    const boundary =
      activeRoom.partyQuestionPhase === "countdown"
        ? activeRoom.partyAnswerStartsAt
        : activeRoom.partyQuestionPhase === "awaiting_audio" ||
            activeRoom.partyQuestionPhase === "answering"
          ? activeRoom.partyAnswerEndsAt
          : activeRoom.partyQuestionPhase === "reveal"
            ? activeRoom.partyRevealEndsAt
            : null;

    if (!boundary) {
      return;
    }

    let isCancelled = false;
    let syncId: number | null = null;
    const phaseAtSchedule = activeRoom.partyQuestionPhase;
    const questionAtSchedule = activeRoom.partyQuestionIndex;

    const syncAtBoundary = async () => {
      const { room, error } = await syncPartyRoomTimeline(activeRoom.id);

      if (isCancelled) {
        return;
      }

      if (room) {
        updateActiveRoom(room);

        if (
          room.status === "active" &&
          room.partyQuestionPhase === phaseAtSchedule &&
          room.partyQuestionIndex === questionAtSchedule
        ) {
          syncId = window.setTimeout(syncAtBoundary, 400);
        }
      } else if (error) {
        setMessage(error);
        syncId = window.setTimeout(syncAtBoundary, 1000);
      }
    };

    const delay = Math.max(
      0,
      Date.parse(boundary) - (Date.now() + partyClockOffsetMs)
    ) + 80;
    syncId = window.setTimeout(syncAtBoundary, delay);

    return () => {
      isCancelled = true;
      if (syncId !== null) {
        window.clearTimeout(syncId);
      }
    };
  }, [
    activeRoom?.id,
    activeRoom?.partyQuestionIndex,
    activeRoom?.partyQuestionPhase,
    activeRoom?.partyAnswerStartsAt,
    activeRoom?.partyAnswerEndsAt,
    activeRoom?.partyRevealEndsAt,
    activeRoom?.status,
    partyClockOffsetMs,
  ]);

  useEffect(() => {
    if (
      !activeRoom ||
      !isPartyHost ||
      activeRoom.status !== "active" ||
      !["countdown", "awaiting_audio", "answering"].includes(
        activeRoom.partyQuestionPhase
      ) ||
      !["pending", "playing"].includes(activeRoom.partyAudioStatus) ||
      !activeRoom.partyClipStartsAt
    ) {
      return;
    }

    const audioKey = `${activeRoom.id}:${activeRoom.roundNumber}:${activeRoom.partyQuestionIndex}`;

    if (partyAudioStartKeyRef.current === audioKey) {
      return;
    }

    const delay = Math.max(
      0,
      Date.parse(activeRoom.partyClipStartsAt) -
        (Date.now() + partyClockOffsetMs)
    );
    const audioStartId = window.setTimeout(() => {
      partyAudioStartKeyRef.current = audioKey;
      void startDuelAnswerRound(false);
    }, delay);

    return () => window.clearTimeout(audioStartId);
  }, [
    activeRoom?.id,
    activeRoom?.roundNumber,
    activeRoom?.status,
    activeRoom?.partyQuestionIndex,
    activeRoom?.partyQuestionPhase,
    activeRoom?.partyAudioStatus,
    activeRoom?.partyClipStartsAt,
    isPartyHost,
    partyClockOffsetMs,
  ]);

  useEffect(() => {
    if (!duelFlash) {
      return;
    }

    const flashId = window.setTimeout(() => setDuelFlash(null), 650);

    return () => window.clearTimeout(flashId);
  }, [duelFlash]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible" || !currentDuelQuestion) {
        return;
      }

      if (isPartyMode && activeRoom) {
        void syncPartyRoomTimeline(activeRoom.id).then(({ room }) => {
          if (room) {
            updateActiveRoom(room);
          }
        });
        return;
      }

      if (isCompetitiveMode && activeRoom) {
        void syncCompetitiveArenaTimeline(activeRoom.id).then(({ room }) => {
          if (room) {
            updateActiveRoom(room);
          }
        });

        const audio = duelAudioRef.current;
        if (
          activeRoom.competitiveRoundPhase === "answering" &&
          !duelSelectedAnswerRef.current &&
          audio?.paused &&
          !duelClipCompletedRef.current
        ) {
          enterDuelAudioFallback("Audio paused while this tab was inactive.");
        }
        return;
      }

    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [
    activeRoom,
    currentDuelQuestion,
    duelPhase,
    isCompetitiveMode,
    isPartyHost,
    isPartyMode,
  ]);

  useEffect(() => {
    if (!activeRoom || activeRoom.status !== "finished" || !onProgressionUpdated) {
      return;
    }

    const progressionKey = `${activeRoom.id}:${activeRoom.roundNumber}`;

    if (progressionSyncedRoundRef.current === progressionKey) {
      return;
    }

    progressionSyncedRoundRef.current = progressionKey;
    const refreshId = window.setTimeout(onProgressionUpdated, 300);

    return () => window.clearTimeout(refreshId);
  }, [activeRoom?.id, activeRoom?.roundNumber, activeRoom?.status, onProgressionUpdated]);

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

  function clearDuelAudioFallbackTimer() {
    if (duelAudioFallbackTimerRef.current !== null) {
      window.clearTimeout(duelAudioFallbackTimerRef.current);
      duelAudioFallbackTimerRef.current = null;
    }
  }

  function stopDuelClip(
    resetToStart = true,
    expectedRoundKey = activeQuestionRunKeyRef.current,
    reason = "arena-stop"
  ) {
    clearDuelAudioFallbackTimer();
    arenaAudioController.stopRound(expectedRoundKey, {
      resetToClipStart: resetToStart,
      reason,
    });
  }

  async function playDuelClip({
    roundKey,
    timelineStartsAtMs,
    clockOffsetMs,
  }: {
    roundKey: string;
    previewUrl: string;
    clipStartSeconds: number;
    timelineStartsAtMs: number;
    clockOffsetMs: number;
  }) {
    duelClipCompletedRef.current = false;
    return arenaAudioController.startRound({
      roundKey,
      timelineStartsAtMs,
      clockOffsetMs,
      clipLengthSeconds: CLIP_LENGTH_SECONDS,
    });
  }

  async function primeCurrentDuelAudio() {
    const roundKey = activeQuestionRunKeyRef.current;
    const previewUrl = currentDuelQuestion?.correctTrack.previewUrl || "";

    if (!previewUrl || !roundKey) {
      setDuelAudioFallbackMessage("This question does not have a playable preview.");
      return;
    }

    const didPrime = await arenaAudioController.primeRound(roundKey);

    if (activeQuestionRunKeyRef.current !== roundKey) return;

    setIsDuelAudioPrimed(didPrime);
    setDuelAudioFallbackMessage(
      didPrime ? "Game audio enabled." : "Audio will retry when the question starts."
    );
  }

  async function failCompetitiveQuestionAudio(
    reason: string,
    expectedRoundKey = activeQuestionRunKeyRef.current
  ) {
    const room = activeRoomSnapshotRef.current;
    const question = room?.quizQuestions[room.competitiveQuestionIndex];

    if (
      !room ||
      room.mode === "party_mode" ||
      room.status !== "active" ||
      !room.competitiveRoundId ||
      activeQuestionRunKeyRef.current !== expectedRoundKey ||
      competitiveAudioFailureKeyRef.current === expectedRoundKey
    ) {
      return;
    }

    competitiveAudioFailureKeyRef.current = expectedRoundKey;
    stopDuelClip(false, expectedRoundKey, "competitive-audio-failed");
    duelPhaseRef.current = "audioSkipped";
    setDuelPhase("audioSkipped");
    setDuelAudioFallbackMessage(
      "Audio unavailable on a player device. Question skipped for everyone."
    );

    const { error } = await reportCompetitiveAudioFailure({
      roomId: room.id,
      roundId: room.competitiveRoundId,
      questionIndex: room.competitiveQuestionIndex,
      previewUrl: question?.correctTrack.previewUrl || "",
      reason,
    });

    if (error) {
      competitiveAudioFailureKeyRef.current = "";
      setMessage(`Could not synchronize the audio skip: ${error}`);
      return;
    }

    const refreshed = await fetchArenaRoom(room.id);
    if (refreshed.room) updateActiveRoom(refreshed.room);
  }

  function skipDuelQuestionForAudio(
    expectedRoundKey = activeQuestionRunKeyRef.current
  ) {
    if (activeQuestionRunKeyRef.current !== expectedRoundKey) {
      return;
    }

    clearDuelAudioFallbackTimer();

    if (
      duelSelectedAnswerRef.current ||
      ["reveal", "correctHold", "audioSkipped"].includes(duelPhaseRef.current)
    ) {
      return;
    }

    if (isPartyHost) {
      void skipPartyQuestion(activeRoom!.id).then(({ room, error }) => {
        if (room) {
          updateActiveRoom(room);
        }
        setDuelAudioFallbackMessage(
          error || "Host audio unavailable. Question skipped for everyone."
        );
      });
      return;
    }

    if (isCompetitiveMode) {
      void failCompetitiveQuestionAudio(
        "Local playback remained unavailable after retry.",
        expectedRoundKey
      );
      return;
    }

    void recordDuelAnswer("", true, "audioUnavailable");
  }

  function enterDuelAudioFallback(
    message: string,
    expectedRoundKey = activeQuestionRunKeyRef.current
  ) {
    if (
      activeQuestionRunKeyRef.current !== expectedRoundKey ||
      !currentDuelQuestion ||
      duelSelectedAnswerRef.current ||
      ["reveal", "correctHold", "audioSkipped"].includes(duelPhaseRef.current)
    ) {
      return;
    }

    stopDuelClip(false, expectedRoundKey);
    duelPhaseRef.current = "audioBlocked";
    setDuelPhase("audioBlocked");
    setDuelAudioFallbackMessage(message);
    clearDuelAudioFallbackTimer();
    duelAudioFallbackTimerRef.current = window.setTimeout(() => {
      skipDuelQuestionForAudio(expectedRoundKey);
    }, AUDIO_BLOCKED_SKIP_DELAY_MS);
  }

  async function publishPartyAudioState(
    status: "pending" | "playing"
  ) {
    if (!activeRoom || !isPartyHost) {
      return { error: "Only the Party host can control room audio." };
    }

    return setPartyAudioState({
      roomId: activeRoom.id,
      roundNumber: activeRoom.roundNumber,
      questionIndex: gameQuestionIndex,
      status,
    });
  }

  async function startDuelAnswerRound(isManualStart: boolean) {
    if (
      !currentDuelQuestion ||
      (duelPhase === "answering" && !isCompetitiveMode) ||
      duelPhase === "correctHold" ||
      duelPhase === "reveal"
    ) {
      return;
    }

    const questionRunKey = activeQuestionRunKeyRef.current;
    const isCurrentQuestionRun = () =>
      Boolean(questionRunKey) &&
      activeQuestionRunKeyRef.current === questionRunKey;

    if (isManualStart) {
      clearDuelAudioFallbackTimer();
      setDuelAudioRetryUsed(true);
    }

    setDuelAudioFallbackMessage("");

    if (isPartyMode) {
      if (!isPartyHost || !activeRoom) {
        return;
      }

      if (!currentDuelQuestion.correctTrack.previewUrl) {
        setDuelAudioRetryUsed(true);
        enterDuelAudioFallback(
          "Audio unavailable on the host device. Question will be skipped."
        );
        return;
      }

      const clipStartsAt = Date.parse(activeRoom.partyClipStartsAt || "");
      const timelineOffset = Number.isFinite(clipStartsAt)
        ? Math.max(
            0,
            (Date.now() + partyClockOffsetMs - clipStartsAt) / 1000
          )
        : 0;

      if (timelineOffset >= CLIP_LENGTH_SECONDS) {
        clearDuelAudioFallbackTimer();
        duelPhaseRef.current = "partyHostWatching";
        setDuelPhase("partyHostWatching");
        return;
      }

      const playResult = await playDuelClip({
        roundKey: questionRunKey,
        previewUrl: currentDuelQuestion.correctTrack.previewUrl,
        clipStartSeconds: currentDuelQuestion.clipStartSeconds,
        timelineStartsAtMs: clipStartsAt,
        clockOffsetMs: partyClockOffsetMs,
      });

      if (!isCurrentQuestionRun()) {
        return;
      }

      if (playResult.status !== "playing") {
        if (playResult.status === "stale") {
          return;
        }

        if (isManualStart) {
          setDuelAudioFallbackMessage(
            "Audio unavailable on the host device. Question skipped."
          );
          skipDuelQuestionForAudio();
        } else {
          enterDuelAudioFallback(
            "Host audio needs one tap. The shared game clock is still running."
          );
        }
        return;
      }

      const { error } = await publishPartyAudioState("playing");

      if (!isCurrentQuestionRun()) {
        return;
      }

      if (error) {
        enterDuelAudioFallback(
          "Host audio started, but the room could not sync. Retry once."
        );
        return;
      }

      clearDuelAudioFallbackTimer();
      duelPhaseRef.current = "partyHostWatching";
      setDuelPhase("partyHostWatching");
      const refreshedRoom = await fetchArenaRoom(activeRoom.id);

      if (refreshedRoom.room && isCurrentQuestionRun()) {
        updateActiveRoom(refreshedRoom.room);
      }
      return;
    }

    if (isCompetitiveMode && activeRoom) {
      const player = activeRoom.players.find(
        (roomPlayer) => roomPlayer.userId === session?.user.id
      );

      if (
        player?.competitiveAnsweredQuestionIndex ===
        activeRoom.competitiveQuestionIndex
      ) {
        duelPhaseRef.current = "partyAnswerLocked";
        setDuelPhase("partyAnswerLocked");
        return;
      }

      const serverNow = Date.now() + competitiveClockOffsetMs;
      const answerStartsAt = Date.parse(
        activeRoom.competitiveAnswerStartsAt || ""
      );
      const answerEndsAt = Date.parse(activeRoom.competitiveAnswerEndsAt || "");

      if (
        !Number.isFinite(answerStartsAt) ||
        !Number.isFinite(answerEndsAt) ||
        serverNow >= answerEndsAt
      ) {
        void syncCompetitiveArenaTimeline(activeRoom.id).then(({ room }) => {
          if (room) {
            updateActiveRoom(room);
          }
        });
        return;
      }

      setDuelTimeRemaining(
        Math.max(0, Math.ceil((answerEndsAt - serverNow) / 1000))
      );

      const timelineOffset = Math.max(0, (serverNow - answerStartsAt) / 1000);

      if (timelineOffset >= CLIP_LENGTH_SECONDS) {
        duelClipCompletedRef.current = true;
        duelPhaseRef.current = "answering";
        setDuelPhase("answering");
        setDuelAudioFallbackMessage(
          "The shared clip has ended. The round timer is still live."
        );
        return;
      }

      if (!currentDuelQuestion.correctTrack.previewUrl) {
        setDuelAudioRetryUsed(true);
        enterDuelAudioFallback(
          "Audio unavailable on this device. Your answer will be skipped."
        );
        return;
      }

      const playResult = await playDuelClip({
        roundKey: questionRunKey,
        previewUrl: currentDuelQuestion.correctTrack.previewUrl,
        clipStartSeconds: currentDuelQuestion.clipStartSeconds,
        timelineStartsAtMs: answerStartsAt,
        clockOffsetMs: competitiveClockOffsetMs,
      });

      if (!isCurrentQuestionRun()) {
        return;
      }

      if (playResult.status !== "playing") {
        if (playResult.status === "stale") {
          return;
        }

        await failCompetitiveQuestionAudio(
          playResult.message,
          questionRunKey
        );
        return;
      }

      clearDuelAudioFallbackTimer();
      duelPhaseRef.current = "answering";
      setDuelPhase("answering");
      return;
    }
  }

  function resetDuelLocalState(nextPhase: DuelPhase = "idle") {
    arenaAudioController.stopAll("reset-local-state");
    duelClipCompletedRef.current = false;
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
    setDuelAudioRetryUsed(false);
    setIsDuelClipPlaying(false);
    setIsDuelFinished(false);
    setDuelRevealMessage("");
    setDuelLastResult(null);
    setDuelFlash(null);
    duelSelectedAnswerRef.current = "";
    duelPhaseRef.current = nextPhase;
    setDuelPhase(nextPhase);
  }

  async function recordPartyAnswer(answer: string) {
    if (
      !activeRoom ||
      !session?.user ||
      !currentDuelQuestion ||
      !isPartyMode ||
      isPartyHost ||
      duelPhaseRef.current !== "answering" ||
      duelSelectedAnswerRef.current
    ) {
      return;
    }

    duelSelectedAnswerRef.current = answer;
    setDuelSelectedAnswer(answer);
    duelPhaseRef.current = "partyAnswerLocked";
    setDuelPhase("partyAnswerLocked");

    const { result, error } = await submitPartyAnswer(activeRoom.id, answer);

    if (error || !result?.accepted) {
      setMessage(
        error ||
          (result?.duplicate
            ? "Answer already locked."
            : "This question is no longer accepting answers.")
      );
      const refreshedRoom = await fetchArenaRoom(activeRoom.id);
      if (refreshedRoom.room) {
        updateActiveRoom(refreshedRoom.room);
      }
      return;
    }

    const isCorrect = Boolean(result.isCorrect);
    const points = result.points || 0;
    const correctAnswer =
      result.correctAnswer || currentDuelQuestion.correctAnswer;
    const answerTime = result.answerTimeSeconds || 0;
    const nextStreak = isCorrect ? duelStreak + 1 : 0;

    setDuelScore((currentScore) => currentScore + points);
    setDuelCorrectAnswers((currentTotal) => currentTotal + (isCorrect ? 1 : 0));
    setDuelAnswerTimes((currentTimes) => [...currentTimes, answerTime]);
    setDuelStreak(nextStreak);
    setDuelLastResult({ isCorrect, points, correctAnswer });
    setDuelFlash(isCorrect ? "good" : "bad");
    setDuelRevealMessage(
      isCorrect
        ? getStreakRewardLabel(nextStreak) || "Answer locked"
        : `Correct answer: ${correctAnswer}`
    );

    if (isCorrect) {
      if (nextStreak >= 3) {
        sounds.streak();
      } else {
        sounds.correct();
      }
    } else {
      sounds.wrong();
    }

    const refreshedRoom = await fetchArenaRoom(activeRoom.id);
    if (refreshedRoom.room) {
      updateActiveRoom(refreshedRoom.room);
    }
  }

  async function recordDuelAnswer(
    answer: string,
    timedOut = false,
    reason: "answer" | "timeout" | "audioUnavailable" = timedOut
      ? "timeout"
      : "answer"
  ) {
    if (
      !activeRoom ||
      !session?.user ||
      !currentDuelQuestion ||
      isPartyMode ||
      !isCompetitiveMode ||
      !activeRoom.competitiveRoundId
    ) {
      return;
    }

    if (
      !["answering", "audioBlocked"].includes(
        duelPhaseRef.current
      ) ||
      duelSelectedAnswerRef.current
    ) {
      return;
    }

    const submissionRoundKey = activeQuestionRunKeyRef.current;
    const submissionRoundId = activeRoom.competitiveRoundId;
    const submissionQuestionIndex = activeRoom.competitiveQuestionIndex;
    const submissionRoundNumber = activeRoom.roundNumber;
    const submittedCorrectAnswer = currentDuelQuestion.correctAnswer;
    const isCurrentSubmissionRound = () =>
      Boolean(submissionRoundKey) &&
      activeQuestionRunKeyRef.current === submissionRoundKey;
    const selectedAnswer =
      answer || (reason === "audioUnavailable" ? "Audio unavailable" : "Timed out");
    duelSelectedAnswerRef.current = selectedAnswer;
    setDuelSelectedAnswer(selectedAnswer);
    duelPhaseRef.current = "partyAnswerLocked";
    setDuelPhase("partyAnswerLocked");
    setDuelRevealMessage(
      reason === "audioUnavailable"
        ? "Audio unavailable on this device. Answer skipped."
        : "Answer submitted. Waiting for the round result."
    );

    const { result, error } = await submitCompetitiveArenaAnswer({
      roomId: activeRoom.id,
      roundId: submissionRoundId,
      questionIndex: submissionQuestionIndex,
      answer: reason === "audioUnavailable" || timedOut ? null : answer,
    });
    const refreshed = await fetchArenaRoom(activeRoom.id);

    if (refreshed.room) {
      updateActiveRoom(refreshed.room);
    }

    const refreshedStillMatchesSubmission = Boolean(
      !refreshed.room ||
        (refreshed.room.roundNumber === submissionRoundNumber &&
          refreshed.room.competitiveRoundId === submissionRoundId &&
          refreshed.room.competitiveQuestionIndex === submissionQuestionIndex)
    );

    // A slow answer request may return after the server has already opened the
    // next round. Never let that old response change or stop the new round.
    if (!isCurrentSubmissionRound() || !refreshedStillMatchesSubmission) {
      return;
    }

    if (error || !result?.accepted) {
      const refreshedPlayer = refreshed.room?.players.find(
        (player) => player.userId === session.user.id
      );
      const wasPersisted = Boolean(
        refreshedPlayer &&
          refreshedPlayer.competitiveAnsweredQuestionIndex ===
            submissionQuestionIndex
      );

      if (!wasPersisted && !result?.roundLocked && !result?.staleRound) {
        duelSelectedAnswerRef.current = "";
        setDuelSelectedAnswer("");
        duelPhaseRef.current = "answering";
        setDuelPhase("answering");
      }

      setMessage(
        error ||
          (result?.duplicate
            ? "Your answer is already locked."
            : "The round closed before this answer arrived.")
      );
      return;
    }

    const isCorrect = Boolean(result.isCorrect);
    setDuelLastResult({
      isCorrect,
      points: result.roundWon ? 1 : 0,
      correctAnswer: submittedCorrectAnswer,
      wasAudioSkipped: reason === "audioUnavailable",
    });

    if (reason === "audioUnavailable") {
      stopDuelClip(false, submissionRoundKey);
      setDuelAudioFallbackMessage(
        "Audio unavailable on this device. Answer skipped."
      );
      return;
    }

    if (isCorrect && result.roundWon) {
      stopDuelClip(false, submissionRoundKey);
      setDuelRevealMessage("Correct answer accepted. Locking the round...");
      return;
    }

    setDuelFlash("bad");
    setDuelRevealMessage(
      "Wrong answer locked. Waiting for another player or the timer."
    );
    sounds.wrong();
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

  async function runArenaAlbumSearch(rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 2) {
      return;
    }

    albumSearchRequestRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++albumSearchSequenceRef.current;
    albumSearchRequestRef.current = controller;
    setIsSearching(true);
    setMessage("");
    setVisibleAlbumCount(ALBUMS_PER_PAGE);

    try {
      const results = await searchSpotifyAlbums(query, {
        signal: controller.signal,
      });
      if (sequence === albumSearchSequenceRef.current) setAlbums(results);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error(error);
      setMessage("Could not search albums. Try another album or artist.");
    } finally {
      if (sequence === albumSearchSequenceRef.current) setIsSearching(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runArenaAlbumSearch(searchTerm);
  }

  function handleSelectArenaAlbum(album: SpotifyAlbum) {
    setSelectedAlbum(album);
    prefetchSpotifyAlbumTracks(album.id);
  }

  function handleViewMoreAlbums() {
    setVisibleAlbumCount((currentCount) =>
      Math.min(currentCount + ALBUMS_PER_PAGE, MAX_VISIBLE_ALBUMS, albums.length)
    );
  }

  function updateActiveRoom(room: ArenaRoom | null) {
    if (room && ignoredRoomIdsRef.current.has(room.id)) {
      return;
    }

    const currentRoom = activeRoomSnapshotRef.current;
    if (room && currentRoom && isOlderArenaRoomSnapshot(room, currentRoom)) {
      return;
    }

    // Any direct room update invalidates slower polling responses that were
    // started from an older room snapshot.
    activeRoomRefreshRequestRef.current += 1;
    activeRoomIdRef.current = room?.id || null;
    activeRoomSnapshotRef.current = room;
    setActiveRoom(room);
    onArenaRoomChange?.(room);

    if (room) {
      setActiveArenaMode(room.mode);
      setSelectedArenaTheme(room.mode);
    }
  }

  function allowRoomActivation(room: ArenaRoom) {
    ignoredRoomIdsRef.current.delete(room.id);
    updateActiveRoom(room);
  }

  function clearActiveRoomClientState(roomId: string, nextMessage: string) {
    ignoredRoomIdsRef.current.add(roomId);
    clearStoredArenaRoomReferences();
    updateActiveRoom(null);
    setActiveArenaMode(null);
    setSelectedArenaTheme(null);
    setPendingInvite(null);
    setPendingPublicRoom(null);
    setInviteError("");
    setRoomCodeInput("");
    setSelectedAlbum(null);
    setAlbums([]);
    setVisibleAlbumCount(ALBUMS_PER_PAGE);
    setSearchTerm("");
    setIsChoosingRematchAlbum(false);
    setIsPrivateRoom(false);
    resetDuelLocalState();
    setMessage(nextMessage);
    onInviteHandled?.();
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
      allowRoomActivation(room);
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

    void handleJoinRoom(room);
    setPendingInvite(null);
    setMessage("");
  }

  async function handleJoinRoom(room: ArenaRoom) {
    if (!session?.user) {
      onLogin();
      return;
    }

    // play() is invoked synchronously from the Join gesture so desktop browsers
    // authorize the persistent Arena media element before asynchronous room work.
    void arenaAudioController.unlockFromUserGesture();

    const isAlreadyInRoom = room.players.some(
      (player) => player.userId === session.user.id
    );

    if (isAlreadyInRoom) {
      const { room: freshRoom, error } = await fetchArenaRoom(room.id);

      const nextRoom = freshRoom || room;
      allowRoomActivation(nextRoom);
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
      allowRoomActivation(joinedRoom);
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

    void arenaAudioController.unlockFromUserGesture();

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
      allowRoomActivation(room);
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
      setMessage("StanZer invite link copied.");
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
    const roomLabel =
      room.mode === "group_lobby"
        ? "Group Lobby"
        : room.mode === "party_mode"
          ? "Party Mode"
          : "Duel";
    const shareText =
      room.mode === "duel"
        ? `${hostHandle} challenged you to a StanZer Duel on ${room.albumName}.`
        : `${hostHandle} invited you to a StanZer ${roomLabel} on ${room.albumName}.`;

    try {
      await navigator.share({
        title: `StanZer ${roomLabel}`,
        text: shareText,
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

    const roomId = activeRoom.id;
    const requestId = ++activeRoomRefreshRequestRef.current;

    if (ignoredRoomIdsRef.current.has(roomId)) {
      return;
    }

    const { room, error } = await fetchArenaRoom(roomId);

    if (
      requestId !== activeRoomRefreshRequestRef.current ||
      activeRoomIdRef.current !== roomId ||
      ignoredRoomIdsRef.current.has(roomId)
    ) {
      return;
    }

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
    if (
      room.hostUserId !== session?.user.id ||
      isClosingActiveRoom ||
      leavingRoomIdRef.current === room.id
    ) {
      return;
    }

    leavingRoomIdRef.current = room.id;
    ignoredRoomIdsRef.current.add(room.id);
    setIsClosingActiveRoom(true);
    const { error } = await cancelDuelRoom(room.id);

    if (error) {
      ignoredRoomIdsRef.current.delete(room.id);
      setMessage(error);
    } else {
      clearActiveRoomClientState(room.id, "Arena room closed.");
    }
    leavingRoomIdRef.current = null;
    setIsClosingActiveRoom(false);
    await loadOpenRooms(false);
  }

  async function handleLeaveDuelRoom() {
    if (
      !activeRoom ||
      !session?.user ||
      leavingRoomIdRef.current === activeRoom.id
    ) {
      return;
    }

    const roomId = activeRoom.id;
    leavingRoomIdRef.current = roomId;
    ignoredRoomIdsRef.current.add(roomId);
    setIsLeavingRoom(true);

    const { error } = await leaveArenaRoom(roomId);

    if (error) {
      ignoredRoomIdsRef.current.delete(roomId);
      setMessage(error);
    } else {
      clearActiveRoomClientState(roomId, "You left the Arena room.");
    }

    leavingRoomIdRef.current = null;
    setIsLeavingRoom(false);
    await loadOpenRooms(false);
  }

  async function handleForfeitDuelRoom() {
    if (
      !activeRoom ||
      !session?.user ||
      leavingRoomIdRef.current === activeRoom.id
    ) {
      return;
    }

    leavingRoomIdRef.current = activeRoom.id;
    setIsLeavingRoom(true);
    const result = await forfeitDuelRoom(activeRoom.id);

    setMessage(result.error || "You forfeited the game.");
    if (!result.error) {
      setIsDuelFinished(true);
      setDuelPhase("idle");
      await refreshActiveRoom(false);
      await loadOpenRooms(false);
    }

    leavingRoomIdRef.current = null;
    setIsLeavingRoom(false);
  }

  function getPresentPlayers(room: ArenaRoom) {
    return room.players.filter(
      (player) =>
        !player.leftAt &&
        !["cancelled", "left"].includes(player.resultStatus)
    );
  }

  function getPartyCompetitors(room: ArenaRoom) {
    return getPresentPlayers(room).filter(
      (player) =>
        player.userId !== room.hostUserId && player.resultStatus !== "forfeit"
    );
  }

  function getPartyAnsweredCount(room: ArenaRoom) {
    return getPartyCompetitors(room).filter(
      (player) => player.currentQuestionIndex > room.partyQuestionIndex
    ).length;
  }

  async function startArenaRoom(roomToStart: ArenaRoom) {
    if (!session?.user) {
      return;
    }

    void arenaAudioController.unlockFromUserGesture();

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
      ARENA_MODE_SETTINGS[freshRoom.mode] || ARENA_MODE_SETTINGS.duel;

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

    const activatedRoom = await activateDuelRoom(
      freshRoom.id,
      questions,
      freshRoom.mode
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
    if (!activeRoom || leavingRoomIdRef.current === activeRoom.id) {
      return;
    }

    const roomId = activeRoom.id;
    leavingRoomIdRef.current = roomId;
    ignoredRoomIdsRef.current.add(roomId);
    setIsLeavingRoom(true);
    const { error } = await endArenaRoom(roomId);

    if (error) {
      ignoredRoomIdsRef.current.delete(roomId);
      setMessage(error);
    } else {
      clearActiveRoomClientState(roomId, "Arena room ended.");
    }

    leavingRoomIdRef.current = null;
    setIsLeavingRoom(false);
    await loadOpenRooms(false);
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

  function formatResponseTime(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value)
      ? `${value.toFixed(1)}s`
      : "--";
  }

  function getCompetitivePlayerScore(player: ArenaRoomPlayer) {
    return player.roundsPlayed > 0 ? player.roundPoints : player.finalScore;
  }

  function getWinnerLabel(players: ArenaRoomPlayer[]) {
    if (players.length < 2) {
      return "Waiting for result";
    }

    const [firstPlayer] = players;

    if (firstPlayer.resultStatus === "win_by_forfeit") {
      return `${firstPlayer.displayName} wins by forfeit`;
    }

    const isCompetitiveResult = Boolean(
      activeRoom && activeRoom.mode !== "party_mode"
    );
    const tiedForFirst = players.filter((player) => {
      if (isCompetitiveResult) {
        return (
          getCompetitivePlayerScore(player) ===
            getCompetitivePlayerScore(firstPlayer) &&
          player.averageWinningResponseTime ===
            firstPlayer.averageWinningResponseTime
        );
      }

      return (
        player.finalScore === firstPlayer.finalScore &&
        getPlayerAccuracy(player) === getPlayerAccuracy(firstPlayer) &&
        player.averageAnswerTime === firstPlayer.averageAnswerTime
      );
    });

    if (tiedForFirst.length > 1) {
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

      if (activeRoom?.mode !== "party_mode") {
        return (
          (resultRank[b.resultStatus] || 0) -
            (resultRank[a.resultStatus] || 0) ||
          getCompetitivePlayerScore(b) - getCompetitivePlayerScore(a) ||
          a.averageWinningResponseTime - b.averageWinningResponseTime
        );
      }

      return (
        (resultRank[b.resultStatus] || 0) - (resultRank[a.resultStatus] || 0) ||
        b.finalScore - a.finalScore ||
        accuracyB - accuracyA ||
        a.averageAnswerTime - b.averageAnswerTime
      );
    });
  }

  function getLiveRankedPlayers(room: ArenaRoom) {
    return room.players
      .filter(
        (player) =>
          player.resultStatus !== "cancelled" &&
          player.resultStatus !== "left" &&
          (room.mode !== "party_mode" ||
            (!player.leftAt &&
              player.resultStatus !== "forfeit" &&
              player.userId !== room.hostUserId))
      )
      .sort(
        (a, b) =>
          b.currentScore - a.currentScore ||
          b.currentCorrectAnswers - a.currentCorrectAnswers ||
          b.currentQuestionIndex - a.currentQuestionIndex
      );
  }

  function renderGroupLiveLeaderboard(room: ArenaRoom) {
    const rankedPlayers = getLiveRankedPlayers(room);

    return (
      <div className="group-live-board">
        <div className="profile-panel-heading">
          <div>
            <p className="eyebrow">
              {room.mode === "party_mode"
                ? "Live Party Leaderboard"
                : "Live Group Leaderboard"}
            </p>
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
              <strong>
                {player.displayName || player.username || "Arena Player"}
                {player.userId === session?.user.id && (
                  <b className="group-you-tag">YOU</b>
                )}
              </strong>
              <span>
                {player.currentScore.toLocaleString()} {room.mode === "party_mode" ? "pts" : "rounds"}
              </span>
              <small>
                {room.mode === "party_mode"
                  ? `${player.currentCorrectAnswers}/${room.quizQuestions.length} correct`
                  : `Avg win ${formatResponseTime(player.averageWinningResponseTime)}`}
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
    const isRecoverableInviteStatus = ["waiting", "starting", "active"].includes(
      status
    );
    const isAlreadyInside =
      Boolean(targetRoomId) &&
      (activeRoom?.id === targetRoomId ||
        (recoveredRoom?.id === targetRoomId &&
          isArenaRoomRecoverableForUser(recoveredRoom, session?.user.id)));
    const isHostInvite =
      Boolean(session?.user.id) &&
      (pendingInvite?.hostUserId === session?.user.id ||
        pendingPublicRoom?.hostUserId === session?.user.id);
    const canResumeRoom =
      isRecoverableInviteStatus && (isAlreadyInside || isHostInvite);
    const roomUnavailableMessage = pendingInvite
      ? getInviteUnavailableMessage(pendingInvite)
      : status === "cancelled"
        ? "This room was closed by the host."
        : status === "finished"
          ? "The game has already finished."
          : status !== "waiting"
            ? "This room is no longer accepting players."
            : "";
    const isFullForNewUser = playerCount >= maxPlayers && !canResumeRoom;
    const unavailableMessage =
      roomUnavailableMessage ||
      (isFullForNewUser
        ? isPrivate
          ? "This private room is full."
          : "This room is full."
        : "");
    const isUnavailable = Boolean(unavailableMessage) && !canResumeRoom;

    return (
      <section className="arena-accept-screen">
        <div className="duel-results-card arena-accept-card">
          <p className="eyebrow">
            {inviteMode === "party_mode"
              ? "Party Mode Invite"
              : isGroupInvite
                ? "Group Lobby Invite"
                : "Duel Request"}
          </p>
          <h2>
            {inviteMode === "party_mode"
              ? `${hostName} invited you to a Party Mode room on ${albumName}`
              : isGroupInvite
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
          {canResumeRoom && (
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

                if (canResumeRoom) {
                  const roomId = targetRoomId;

                  if (roomId) {
                    fetchArenaRoom(roomId).then(({ room }) => {
                      if (room) {
                        allowRoomActivation(room);
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
                : canResumeRoom
                  ? "Resume Room"
                  : isJoiningInvite
                  ? "Joining..."
                  : isGroupInvite
                    ? "Accept Group Lobby"
                    : inviteMode === "party_mode"
                      ? "Accept Party Mode"
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
            className="secondary-button start-bar-clear"
            onClick={() => setSelectedAlbum(null)}
          >
            Change
          </button>

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

        <button
          type="button"
          className="secondary-button start-bar-clear"
          onClick={() => setSelectedAlbum(null)}
        >
          Change
        </button>

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
              : selectedMode === "party_mode"
                ? "Create Party Room"
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

        {isSearching && albums.length === 0 && (
          <div className="duel-album-grid" aria-label="Loading albums">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="duel-album-card duel-album-skeleton" key={index} aria-hidden>
                <span className="skeleton-cover" />
                <span className="skeleton-line skeleton-line-title" />
              </div>
            ))}
          </div>
        )}

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
                  onClick={() => handleSelectArenaAlbum(album)}
                  key={album.id}
                >
                  {album.imageUrl && (
                    <img
                      src={album.imageUrl}
                      alt={`${album.title} cover`}
                      loading="lazy"
                    />
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
          {(!isPartyMode || isPartyHost) &&
            !isDuelAudioPrimed &&
            currentDuelQuestion?.correctTrack.previewUrl && (
            <button
              type="button"
              className="clip-button audio-prime-button"
              onClick={() => void primeCurrentDuelAudio()}
            >
              Enable game audio
            </button>
            )}
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
          {(!isPartyMode || isPartyHost) &&
            !isDuelAudioPrimed &&
            currentDuelQuestion?.correctTrack.previewUrl && (
            <button
              type="button"
              className="clip-button audio-prime-button"
              onClick={() => void primeCurrentDuelAudio()}
            >
              Enable game audio
            </button>
            )}
        </>
      );
    }

    if (duelPhase === "partyWaitingAudio") {
      return (
        <>
          <p className="game-state-label">
            {isPartyHost ? "Starting host audio" : "Listen to the host"}
          </p>
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
            {isPartyHost
              ? "Players remain on the shared clock while audio starts."
              : "The clip plays only from the Party host device."}
          </p>
        </>
      );
    }

    if (duelPhase === "partyHostWatching" && activeRoom) {
      const competitors = getPartyCompetitors(activeRoom);
      const answeredCount = getPartyAnsweredCount(activeRoom);

      return (
        <>
          <p className="game-state-label">Players are answering</p>
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
            {answeredCount} of {competitors.length} players answered
          </p>
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
          <p className="game-state-detail">
            Question continues in {duelTimeRemaining}s on the shared timeline.
          </p>
        </>
      );
    }

    if (duelPhase === "audioSkipped") {
      return (
        <>
          <p className="game-state-label">Question skipped</p>
          <p className="game-state-detail">
            {isPartyMode
              ? "Host audio unavailable. Question skipped for everyone."
              : "Audio unavailable on this device. Question skipped."}
          </p>
          <p className="game-state-detail">
            Next reveal in {duelTimeRemaining}s.
          </p>
        </>
      );
    }

    if (duelPhase === "partyAnswerLocked") {
      if (isCompetitiveMode) {
        return (
          <>
            <p className="game-state-label">
              {duelLastResult?.isCorrect ? "Answer received" : "Answer locked"}
            </p>
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
              {duelRevealMessage ||
                "One answer only. Waiting for a winner or the round clock."}
            </p>
          </>
        );
      }

      return (
        <>
          <p className="game-state-label">
            {duelLastResult?.isCorrect ? "Correct" : "Answer locked"}
          </p>
          {duelLastResult?.isCorrect ? (
            <p className="points-pop">+{duelLastResult.points}</p>
          ) : (
            <p className="reveal-answer">
              Correct answer:{" "}
              <strong>
                {duelLastResult?.correctAnswer || currentDuelQuestion?.correctAnswer}
              </strong>
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
            Next reveal in {duelTimeRemaining}s
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
            {isPartyMode && !isPartyHost
              ? "Listen to the host device. Faster correct answers score more."
              : isCompetitiveMode
                ? "First correct answer wins this round."
              : isDuelClipPlaying
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
          <p className="game-state-label">
            {duelLastResult?.wasAudioSkipped ||
            (isPartyMode && activeRoom?.partyAudioStatus === "skipped")
              ? "Audio skipped"
              : isCompetitiveMode
                ? activeRoom?.competitiveRoundWinnerUserId
                  ? "Round won"
                  : "Round over"
              : "Reveal"}
          </p>
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
              Correct answer:{" "}
              <strong>
                {duelLastResult?.correctAnswer || currentDuelQuestion?.correctAnswer}
              </strong>
            </p>
          )}
          {duelRevealMessage && (
            <p
              className={`hype-message ${
                duelLastResult?.wasAudioSkipped
                  ? ""
                  : duelLastResult?.isCorrect
                    ? "hype-good"
                    : "hype-bad"
              }`}
            >
              {duelRevealMessage}
            </p>
          )}
          <p className="game-state-detail">
            Next {isCompetitiveMode ? "round" : "question"} in{" "}
            {duelRevealCountdown}s
          </p>
        </>
      );
    }

    return (
      <>
        <p className="game-state-label">Preparing question</p>
        <p className="game-state-detail">
          {duelAudioFallbackMessage || "Waiting for the shared room clock..."}
        </p>
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
      const activeModeSettings = ARENA_MODE_SETTINGS[activeRoom.mode];
      const isActiveGroupLobby = activeRoom.mode === "group_lobby";
      const isActivePartyMode = activeRoom.mode === "party_mode";
      const usesLiveLeaderboard = activeRoom.mode !== "duel";
      const presentPlayers = getPresentPlayers(activeRoom);
      const partyCompetitors = isActivePartyMode
        ? getPartyCompetitors(activeRoom)
        : [];
      const partyAnsweredCount = isActivePartyMode
        ? getPartyAnsweredCount(activeRoom)
        : 0;
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
          !player.leftAt &&
          player.resultStatus !== "cancelled" &&
          player.resultStatus !== "left" &&
          (!isActivePartyMode || player.userId !== activeRoom.hostUserId)
      );
      const bothPlayersFinished =
        activeRoom.status === "finished" ||
        (resultPlayers.length >= activeModeSettings.minPlayersToStart &&
          resultPlayers.every((player) => player.finishedAt));
      const question = activeRoom.quizQuestions[gameQuestionIndex];
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
              className="secondary-button danger-button"
              disabled={isLeavingRoom}
              onClick={() => void handleLeaveDuelRoom()}
            >
              {isLeavingRoom ? "Leaving..." : "Leave Lobby"}
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
                  usesLiveLeaderboard ? "group-results-grid" : ""
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
                    {isActivePartyMode ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <p>{getCompetitivePlayerScore(player)} round points</p>
                        <small>
                          Rounds won: {player.roundsWon}/{player.roundsPlayed}
                        </small>
                        <small>
                          Avg winning response: {formatResponseTime(
                            player.averageWinningResponseTime
                          )}
                        </small>
                      </>
                    )}
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
                      {isActivePartyMode
                        ? "End Party"
                        : isActiveGroupLobby
                          ? "End Lobby"
                          : "End Duel"}
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
                      disabled={isLeavingRoom}
                      onClick={() => void handleLeaveDuelRoom()}
                    >
                      {isLeavingRoom ? "Leaving..." : "Leave Lobby"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {isHost && renderRematchAlbumPicker()}
          </section>
        );
      }

      if (activeRoom.status === "active" && question) {
        if (
          currentPlayer?.finishedAt ||
          isDuelFinished ||
          (isActivePartyMode &&
            isHost &&
            activeRoom.partyQuestionPhase === "finished")
        ) {
          return (
            <section className="duel-room-screen">
              <div className="duel-room-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshActiveRoom()}
                >
                  Refresh Results
                </button>
                <button
                  type="button"
                  className="secondary-button danger-button"
                  disabled={isLeavingRoom}
                  onClick={() => void handleLeaveDuelRoom()}
                >
                  {isLeavingRoom ? "Leaving..." : "Leave Lobby"}
                </button>
              </div>
              <div className="duel-results-card">
                <p className="eyebrow">{activeModeSettings.title} Submitted</p>
                <h2>
                  {isActivePartyMode && isHost
                    ? "Players are submitting final scores."
                    : usesLiveLeaderboard
                    ? "Waiting for other players to finish."
                    : "Waiting for opponent to finish."}
                </h2>
                {!isActivePartyMode || !isHost ? (
                  <p className="arena-note">
                    Your score: {duelScore.toLocaleString()}{" "}
                    {isActivePartyMode ? "points" : "round points"}.
                  </p>
                ) : (
                  <p className="arena-note">
                    The Party host is not included in competitive standings.
                  </p>
                )}
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
                  {isActivePartyMode ? "Question" : "Round"}{" "}
                  {gameQuestionIndex + 1} of{" "}
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
                disabled={isLeavingRoom}
                onClick={() =>
                  void (isActivePartyMode && isHost
                    ? handleEndArenaRoom()
                    : handleForfeitDuelRoom())
                }
              >
                {isLeavingRoom
                  ? isActivePartyMode && isHost
                    ? "Ending..."
                    : "Forfeiting..."
                  : isActivePartyMode && isHost
                    ? "End Party"
                    : "Forfeit Game"}
              </button>
            </div>

            {usesLiveLeaderboard ? (
              renderGroupLiveLeaderboard(activeRoom)
            ) : (
              <div className="duel-head-to-head">
                <div className="duel-h2h-card current">
                  <span>You <b className="group-you-tag">YOU</b></span>
                  <strong>{currentPlayer?.displayName || "Arena Player"}</strong>
                  <p>{duelScore.toLocaleString()} round points</p>
                  <small>
                    {duelCorrectAnswers}/{activeRoom.quizQuestions.length} rounds won
                  </small>
                  <small>Streak {duelStreak}</small>
                </div>
                <div className="duel-h2h-vs">VS</div>
                <div className="duel-h2h-card">
                  <span>Opponent</span>
                  <strong>{opponentPlayer?.displayName || "Waiting"}</strong>
                  <p>
                    {(opponentPlayer?.currentScore || 0).toLocaleString()} round points
                  </p>
                  <small>
                    {opponentPlayer?.currentCorrectAnswers || 0}/
                    {activeRoom.quizQuestions.length} rounds won
                  </small>
                  <small>
                    Avg win {formatResponseTime(
                      opponentPlayer?.averageWinningResponseTime
                    )}
                  </small>
                </div>
              </div>
            )}

            <div className={`quiz-status duel-game-status ${
              isActivePartyMode && isHost ? "party-host-status" : ""
            }`}>
              {isActivePartyMode && isHost ? (
                <>
                  <span>
                    Answers: {partyAnsweredCount} / {partyCompetitors.length}
                  </span>
                  <span>Audio: {activeRoom.partyAudioStatus}</span>
                  <span>
                    Phase: {activeRoom.partyQuestionPhase.replace("_", " ")}
                  </span>
                </>
              ) : (
                <>
                  <span>
                    {isActivePartyMode ? "Score" : "Round points"}:{" "}
                    {duelScore.toLocaleString()}
                  </span>
                  <span>
                    {isActivePartyMode ? "Correct" : "Rounds won"}:{" "}
                    {duelCorrectAnswers} / {activeRoom.quizQuestions.length}
                  </span>
                  <span>Accuracy: {duelLiveAccuracy}%</span>
                  <span className={duelStreak >= 3 ? "streak-reward" : "streak-chip"}>
                    {getStreakRewardLabel(duelStreak) || `Streak: ${duelStreak}`}
                  </span>
                </>
              )}
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
              {isActivePartyMode && isHost ? (
                <>
                  Players are answering from <strong>{activeRoom.albumName}</strong>.
                </>
              ) : (
                <>
                  Pick the correct track from <strong>{activeRoom.albumName}</strong>.
                </>
              )}
            </p>

            <div className="audio-preview-wrapper">
              {isActivePartyMode && !isHost ? (
                <p className="party-host-audio-note">
                  Audio plays from the host device only.
                </p>
              ) : !question.correctTrack.previewUrl ? (
                <p className="preview-unavailable">
                  Audio preview unavailable for this question.
                </p>
              ) : null}

              {duelPhase === "audioBlocked" &&
                (!isActivePartyMode || isHost) &&
                question.correctTrack.previewUrl &&
                !duelAudioRetryUsed && (
                <button
                  type="button"
                  className="clip-button"
                  onClick={() => void startDuelAnswerRound(true)}
                >
                  Retry audio once
                </button>
              )}
            </div>

            {isActivePartyMode && isHost ? (
              <div className="party-host-answer-state" aria-live="polite">
                <strong>Players are answering</strong>
                <span>
                  {partyAnsweredCount} of {partyCompetitors.length} players answered
                </span>
              </div>
            ) : (
              <div className="song-options">
                {question.options.map((option) => (
                  <button
                    type="button"
                    className={`song-button ${
                      duelSelectedAnswer === option.name ? "selected-song" : ""
                    } ${
                      ((isActivePartyMode && duelSelectedAnswer) ||
                        (!isActivePartyMode && duelPhase === "reveal")) &&
                      option.name === question.correctAnswer
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
                    onClick={() =>
                      isActivePartyMode
                        ? void recordPartyAnswer(option.name)
                        : void recordDuelAnswer(option.name)
                    }
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            )}

            <p className="score score-live">
              {isActivePartyMode ? "Score" : "Round points"}: {duelScore.toLocaleString()}
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
            {isHost && activeRoom.mode === "duel" && (
              <button
                type="button"
                className="secondary-button danger-button"
                onClick={() => void handleCloseDuelRoom()}
              >
                Close Lobby
              </button>
            )}
            {(!isHost || activeRoom.mode !== "duel") && (
              <button
                type="button"
                className="secondary-button danger-button"
                disabled={isLeavingRoom}
                onClick={() => void handleLeaveDuelRoom()}
              >
                {isLeavingRoom ? "Leaving..." : "Leave Lobby"}
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

          {usesLiveLeaderboard ? (
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
            <div className="arena-guest-entry">
              <p className="arena-note">
                Log in to save multiplayer progression, or enter as a temporary guest.
              </p>
              <div className="arena-guest-actions">
                <button type="button" className="secondary-button" onClick={onLogin}>
                  Log in
                </button>
                {onGuest && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void onGuest().then((error) => error && setMessage(error));
                    }}
                  >
                    Play as Guest
                  </button>
                )}
              </div>
            </div>
          )}

          {session?.user.is_anonymous && (
            <p className="arena-guest-banner">
              Guest session. Create an account to save stats, badges, and wins.
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

          {isSearching && albums.length === 0 && (
            <div className="duel-album-grid" aria-label="Loading albums">
              {Array.from({ length: 4 }, (_, index) => (
                <div className="duel-album-card duel-album-skeleton" key={index} aria-hidden>
                  <span className="skeleton-cover" />
                  <span className="skeleton-line skeleton-line-title" />
                </div>
              ))}
            </div>
          )}

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
                    onClick={() => handleSelectArenaAlbum(album)}
                    key={album.id}
                  >
                    {album.imageUrl && (
                      <img
                        src={album.imageUrl}
                        alt={`${album.title} cover`}
                        loading="lazy"
                      />
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
      </section>
    );
  }

  return (
    <section
      className={`arena-page ${shouldShowAlbumDock ? "arena-page-has-dock" : ""} ${
        selectedArenaTheme ? `arena-theme-${selectedArenaTheme}` : ""
      }`}
    >
      <audio
        ref={duelAudioRef}
        className="hidden-audio-preview"
        preload="auto"
        aria-hidden="true"
      />
      <div className="arena-hero">
        <p className="eyebrow">StanZer</p>
        <h1>Multiplayer</h1>
        <p>
          Challenge your friends in live Duels, Group Lobbies, and Party Mode.
        </p>
      </div>

      <div className="arena-status">
        <span>{activeArenaMode ? `${modeSettings.title} live` : "Live multiplayer"}</span>
        <div>
          <h2>
            {activeArenaMode
              ? `${modeSettings.title} rooms are playable`
              : "Choose your Arena"}
          </h2>
          <p>
            {activeArenaMode
              ? "Create or join a waiting room, start together, and play the same synced album quiz."
              : "Create a Duel, Group Lobby, or Party room, or join one with an invite code."}
          </p>
        </div>
      </div>

      {visibleRecoveryRoom && (
        <section className="arena-recovery-strip">
          <ArenaActiveRoomCard
            room={visibleRecoveryRoom}
            currentUserId={session?.user.id}
            onResume={() => {
              allowRoomActivation(visibleRecoveryRoom);
              setActiveArenaMode(visibleRecoveryRoom.mode);
              setSelectedArenaTheme(visibleRecoveryRoom.mode);
              setMessage("Resumed active Arena room.");
            }}
            onClose={() => void handleCloseArenaRoom(visibleRecoveryRoom)}
            isClosing={isClosingActiveRoom}
          />
        </section>
      )}

      <div className="arena-mode-grid">
        {arenaModes.map((mode) => {
          const isDuel = mode.title === "Duel";
          const isGroup = mode.title === "Group Lobby";
          const isParty = mode.title === "Party Mode";
          const roomMode: ArenaRoomMode | null = isDuel
            ? "duel"
            : isGroup
              ? "group_lobby"
              : isParty
                ? "party_mode"
                : null;
          const theme: ArenaTheme = roomMode || "championship";

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

      {message && <p className="arena-message">{message}</p>}
      {(activeRoom ||
        activeArenaMode ||
        pendingInvite ||
        pendingPublicRoom ||
        inviteError ||
        isInviteLoading) && (
        <div
          className={`arena-mode-overlay ${
            activeRoom?.status === "active" ? "arena-game-overlay" : ""
          } ${shouldShowAlbumDock ? "arena-overlay-has-dock" : ""}`}
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !activeRoom &&
              !pendingInvite &&
              !inviteError
            ) {
              setActiveArenaMode(null);
              setSelectedArenaTheme(null);
              setPendingPublicRoom(null);
              setSelectedAlbum(null);
              setAlbums([]);
              setMessage("");
            }
          }}
        >
          <div
            className={`arena-mode-modal ${
              activeRoom?.status === "active" ? "arena-game-modal" : ""
            }`}
          >
            {!activeRoom && !pendingInvite && !inviteError && (
              <button
                type="button"
                className="arena-modal-close"
                onClick={() => {
                  setActiveArenaMode(null);
                  setSelectedArenaTheme(null);
                  setPendingPublicRoom(null);
                  setSelectedAlbum(null);
                  setAlbums([]);
                  setMessage("");
                }}
              >
                Back to Multiplayer
              </button>
            )}
            {renderDuelLobby()}
          </div>
        </div>
      )}

      {shouldShowAlbumDock && renderSelectedAlbumStartBar()}

      <button type="button" onClick={onHome}>
        Back Home
      </button>
    </section>
  );
}

export default ArenaPage;
