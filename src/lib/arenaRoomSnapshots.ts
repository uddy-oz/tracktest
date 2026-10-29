type SnapshotPlayer = {
  userId: string;
  currentScore?: number;
  currentCorrectAnswers?: number;
  currentQuestionIndex?: number;
  currentStreak?: number;
  finalScore?: number;
  correctAnswers?: number;
  totalQuestions?: number;
  roundPoints?: number;
  roundsWon?: number;
  roundsPlayed?: number;
  finishedAt?: string | null;
  leftAt?: string | null;
  resultStatus?: string;
  joinedAt?: string;
  presenceUpdatedAt?: string;
};

export type ArenaRoomSnapshot = {
  id: string;
  roundNumber: number;
  status: string;
  mode: "duel" | "group_lobby" | "party_mode";
  competitiveQuestionIndex: number;
  competitiveRoundPhase: string;
  partyQuestionIndex: number;
  partyQuestionPhase: string;
  players: SnapshotPlayer[];
};

const STATUS_ORDER: Record<string, number> = {
  waiting: 0,
  starting: 1,
  active: 2,
  finished: 3,
  cancelled: 3,
  expired: 3,
  forfeited: 3,
  ended: 3,
};

const COMPETITIVE_PHASE_ORDER: Record<string, number> = {
  idle: 0,
  preparing_audio: 1,
  countdown: 2,
  answering: 3,
  reveal: 4,
  finished: 5,
};

const PARTY_PHASE_ORDER: Record<string, number> = {
  idle: 0,
  preparing_audio: 1,
  countdown: 2,
  awaiting_audio: 3,
  answering: 4,
  reveal: 5,
  finished: 6,
};

const MONOTONIC_PLAYER_FIELDS = [
  "currentScore",
  "currentCorrectAnswers",
  "currentQuestionIndex",
  "finalScore",
  "correctAnswers",
  "totalQuestions",
  "roundPoints",
  "roundsWon",
  "roundsPlayed",
] as const;

const TERMINAL_PLAYER_STATUSES = new Set([
  "cancelled",
  "left",
  "forfeit",
  "win_by_forfeit",
  "completed",
]);

export function isOlderArenaRoomSnapshot(
  next: ArenaRoomSnapshot,
  current: ArenaRoomSnapshot
) {
  if (next.id !== current.id) return false;
  if (next.roundNumber !== current.roundNumber) {
    return next.roundNumber < current.roundNumber;
  }

  const nextStatusOrder = STATUS_ORDER[next.status] ?? 0;
  const currentStatusOrder = STATUS_ORDER[current.status] ?? 0;
  if (nextStatusOrder !== currentStatusOrder) {
    return nextStatusOrder < currentStatusOrder;
  }

  if (next.mode === "party_mode" && current.mode === "party_mode") {
    if (next.partyQuestionIndex !== current.partyQuestionIndex) {
      return next.partyQuestionIndex < current.partyQuestionIndex;
    }
    if (
      PARTY_PHASE_ORDER[next.partyQuestionPhase] !==
      PARTY_PHASE_ORDER[current.partyQuestionPhase]
    ) {
      return (
        (PARTY_PHASE_ORDER[next.partyQuestionPhase] ?? 0) <
        (PARTY_PHASE_ORDER[current.partyQuestionPhase] ?? 0)
      );
    }
  } else if (next.mode !== "party_mode" && current.mode !== "party_mode") {
    if (next.competitiveQuestionIndex !== current.competitiveQuestionIndex) {
      return next.competitiveQuestionIndex < current.competitiveQuestionIndex;
    }
    if (
      COMPETITIVE_PHASE_ORDER[next.competitiveRoundPhase] !==
      COMPETITIVE_PHASE_ORDER[current.competitiveRoundPhase]
    ) {
      return (
        (COMPETITIVE_PHASE_ORDER[next.competitiveRoundPhase] ?? 0) <
        (COMPETITIVE_PHASE_ORDER[current.competitiveRoundPhase] ?? 0)
      );
    }
  }

  const nextPlayers = new Map(next.players.map((player) => [player.userId, player]));
  for (const currentPlayer of current.players) {
    const nextPlayer = nextPlayers.get(currentPlayer.userId);
    if (!nextPlayer) continue;

    // Lobby membership can legitimately move LEFT -> active, and ready can
    // toggle in either direction. Order those updates by server timestamps,
    // not match-result monotonicity. Match generations/phases stay protected.
    if (next.status === "waiting" && current.status === "waiting") {
      const revision = (player: SnapshotPlayer) => Math.max(
        ...[player.joinedAt, player.presenceUpdatedAt, player.leftAt]
          .map((value) => Date.parse(value || "") || 0)
      );
      const nextRevision = revision(nextPlayer);
      const currentRevision = revision(currentPlayer);
      if (nextRevision < currentRevision) return true;
      if (nextRevision > currentRevision) continue;
    }

    if (TERMINAL_PLAYER_STATUSES.has(currentPlayer.resultStatus || "")) {
      if (currentPlayer.resultStatus !== nextPlayer.resultStatus) return true;
    }
    if (
      (currentPlayer.finishedAt && !nextPlayer.finishedAt) ||
      (currentPlayer.leftAt && !nextPlayer.leftAt)
    ) {
      return true;
    }

    if (
      MONOTONIC_PLAYER_FIELDS.some(
        (field) =>
          (currentPlayer[field] ?? 0) > (nextPlayer[field] ?? 0)
      )
    ) {
      return true;
    }
  }

  return false;
}
