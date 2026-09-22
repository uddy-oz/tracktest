export type CompetitiveRoundPhase =
  | "idle"
  | "preparing_audio"
  | "countdown"
  | "answering"
  | "reveal"
  | "finished";

export type CompetitiveRoundIdentity = {
  roomId: string;
  matchGeneration: number;
  roundId: string;
  questionIndex: number;
};

export type CompetitiveRoundSnapshot = CompetitiveRoundIdentity & {
  mode: "duel" | "group_lobby" | "party_mode";
  status: string;
  phase: CompetitiveRoundPhase;
};

const COMPETITIVE_PHASE_ORDER: Record<CompetitiveRoundPhase, number> = {
  idle: 0,
  preparing_audio: 1,
  countdown: 2,
  answering: 3,
  reveal: 4,
  finished: 5,
};

export function getCompetitiveRoundKey(identity: CompetitiveRoundIdentity) {
  return `${identity.roomId}:${identity.matchGeneration}:${identity.roundId}:${identity.questionIndex}`;
}

export function isSameCompetitiveRound(
  left: CompetitiveRoundIdentity,
  right: CompetitiveRoundIdentity
) {
  return (
    left.roomId === right.roomId &&
    left.matchGeneration === right.matchGeneration &&
    left.roundId === right.roundId &&
    left.questionIndex === right.questionIndex
  );
}

export function canReportCompetitiveAudioFailure(
  current: CompetitiveRoundSnapshot,
  expected: CompetitiveRoundIdentity
) {
  return (
    current.status === "active" &&
    current.mode !== "party_mode" &&
    current.phase === "preparing_audio" &&
    isSameCompetitiveRound(current, expected)
  );
}

export function isOlderCompetitiveSnapshot(
  next: CompetitiveRoundSnapshot,
  current: CompetitiveRoundSnapshot
) {
  if (next.roomId !== current.roomId) return false;
  if (next.matchGeneration !== current.matchGeneration) {
    return next.matchGeneration < current.matchGeneration;
  }
  if (next.questionIndex !== current.questionIndex) {
    return next.questionIndex < current.questionIndex;
  }
  if (next.roundId !== current.roundId) {
    return true;
  }

  return COMPETITIVE_PHASE_ORDER[next.phase] < COMPETITIVE_PHASE_ORDER[current.phase];
}
