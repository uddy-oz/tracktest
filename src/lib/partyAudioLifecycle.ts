export type PartyAudioRoundIdentity = {
  roomId: string;
  matchGeneration: number;
  questionIndex: number;
};

export type PartyAudioSnapshot = PartyAudioRoundIdentity & {
  mode: "duel" | "group_lobby" | "party_mode";
  status: string;
  phase: string;
  clipStartsAt: string | null;
};

export function getPartyAudioRoundKey(identity: PartyAudioRoundIdentity) {
  return `${identity.roomId}:${identity.matchGeneration}:party:${identity.questionIndex}`;
}

export function isSamePartyAudioRound(
  left: PartyAudioRoundIdentity,
  right: PartyAudioRoundIdentity
) {
  return (
    left.roomId === right.roomId &&
    left.matchGeneration === right.matchGeneration &&
    left.questionIndex === right.questionIndex
  );
}

export function canPreparePartyHostAudio(
  snapshot: PartyAudioSnapshot,
  expected: PartyAudioRoundIdentity
) {
  return (
    snapshot.mode === "party_mode" &&
    snapshot.status === "active" &&
    snapshot.phase === "preparing_audio" &&
    !snapshot.clipStartsAt &&
    isSamePartyAudioRound(snapshot, expected)
  );
}

export function canStartPartyHostPlayback(
  snapshot: PartyAudioSnapshot,
  expected: PartyAudioRoundIdentity
) {
  return (
    snapshot.mode === "party_mode" &&
    snapshot.status === "active" &&
    ["countdown", "awaiting_audio", "answering"].includes(snapshot.phase) &&
    Boolean(snapshot.clipStartsAt) &&
    isSamePartyAudioRound(snapshot, expected)
  );
}
