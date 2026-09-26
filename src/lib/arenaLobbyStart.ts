import type { User } from "@supabase/supabase-js";
import type { ArenaRoom, ArenaRoomMode, DuelQuizQuestion } from "./arenaRooms";
import type { SpotifyTrack } from "./spotifyApi";

export const MIN_ARENA_TRACKS = 5;

export function getArenaAlbumError(playableTrackCount: number) {
  return playableTrackCount < MIN_ARENA_TRACKS
    ? `This album has ${playableTrackCount} playable tracks. Choose an album with at least ${MIN_ARENA_TRACKS}.`
    : "";
}

export function getArenaStartMembers(room: ArenaRoom) {
  return room.players.filter((player) =>
    !player.leftAt && !player.finishedAt && !player.forfeitedAt &&
    !["cancelled", "left", "forfeit"].includes(player.resultStatus)
  );
}

type RoomResult = { room: ArenaRoom | null; error: string | null };
type StartDependencies = {
  fetchRoom: (roomId: string) => Promise<RoomResult>;
  loadTracks: (albumId: string) => Promise<SpotifyTrack[]>;
  buildQuestions: (tracks: SpotifyTrack[]) => DuelQuizQuestion[];
  beforeActivate: (questions: DuelQuizQuestion[]) => Promise<void>;
  activateRoom: (roomId: string, questions: DuelQuizQuestion[], mode: ArenaRoomMode, context: Record<string, unknown>) => Promise<RoomResult>;
  log: (event: string, details: Record<string, unknown>) => void;
};

// Only a freshly fetched server snapshot may decide whether a lobby can start.
export async function prepareArenaLobbyStart(
  roomId: string,
  user: Pick<User, "id" | "is_anonymous">,
  dependencies: StartDependencies
): Promise<RoomResult> {
  let context: Record<string, unknown> = {
    roomId, userId: user.id, authType: user.is_anonymous ? "anonymous" : "permanent",
  };
  let stage = "refresh-room";
  try {
    dependencies.log("LOBBY_START_REQUESTED", context);
    if (!roomId || !user.id) throw new Error("Sign in and refresh the room before starting.");
    const { room, error } = await dependencies.fetchRoom(roomId);
    if (error || !room) throw new Error(error || "Could not refresh room.");
    const members = getArenaStartMembers(room);
    context = {
      ...context, hostId: room.hostUserId, mode: room.mode, status: room.status,
      memberCount: members.length, matchGeneration: room.roundNumber,
    };
    dependencies.log("LOBBY_START_SNAPSHOT", context);
    stage = "validate-membership";
    if (room.hostUserId !== user.id) throw new Error("Only the host can start this room.");
    if (["starting", "active"].includes(room.status)) return { room, error: null };
    if (room.status !== "waiting") throw new Error("This room is no longer waiting. Refresh the room.");
    if (!members.some((player) => player.userId === user.id)) {
      throw new Error("The host has not joined this room. Close the lobby and create it again.");
    }
    const minimum = room.mode === "group_lobby" ? 3 : 2;
    if (members.length < minimum || members.length > room.maxPlayers ||
      (room.mode === "duel" && members.length !== 2)) {
      throw new Error(`Waiting for ${minimum} active players to start.`);
    }

    stage = "load-album";
    let questions = room.quizQuestions;
    if (!questions.length) {
      const tracks = (await dependencies.loadTracks(room.albumId)).filter((track) => Boolean(track.previewUrl));
      dependencies.log("LOBBY_START_ALBUM", { ...context, playableTrackCount: tracks.length });
      const albumError = getArenaAlbumError(tracks.length);
      if (albumError) throw new Error(albumError);
      questions = dependencies.buildQuestions(tracks);
    }
    stage = "unlock-audio";
    await dependencies.beforeActivate(questions);
    stage = "prepare-rpc";
    const result = await dependencies.activateRoom(room.id, questions, room.mode, context);
    if (result.error || !result.room) throw new Error(result.error || "Could not prepare the room.");
    if (!["starting", "active"].includes(result.room.status)) {
      throw new Error("The room did not start. Refresh the room and try again.");
    }
    dependencies.log("LOBBY_START_PREPARED", { ...context, status: result.room.status });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh the room and try again.";
    dependencies.log("LOBBY_START_FAILED", { ...context, stage, message });
    return { room: null, error: `Could not start match. ${message}` };
  }
}
