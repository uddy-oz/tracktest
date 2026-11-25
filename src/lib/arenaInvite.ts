const roomIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function publicPartyInviteId(code: string) {
  const value = code.trim();
  return roomIdPattern.test(value) ? value.toLowerCase() : null;
}

export function getArenaInvitationCode(room: { id: string; mode: string; isPrivate: boolean; inviteCode: string | null }) {
  return room.inviteCode || (!room.isPrivate && room.mode === "party_mode" ? publicPartyInviteId(room.id) : null);
}

export function arenaInvitationUrl(code: string, origin: string) {
  return `${origin}/multiplayer/invite/${encodeURIComponent(code)}`;
}
