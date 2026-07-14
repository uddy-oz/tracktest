import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { UserProfile } from "./profiles";
import type { SpotifyAlbum } from "./spotifyApi";

export type ArenaRoomMode = "duel" | "group_lobby";

export type DuelQuizTrack = {
  id: string;
  name: string;
  previewUrl: string | null;
};

export type DuelQuizQuestion = {
  correctTrack: DuelQuizTrack;
  options: DuelQuizTrack[];
  correctAnswer: string;
  clipStartSeconds: number;
};

export type ArenaRoomPlayer = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  username: string | null;
  joinedAt: string;
  finalScore: number;
  correctAnswers: number;
  totalQuestions: number;
  averageAnswerTime: number;
  currentScore: number;
  currentCorrectAnswers: number;
  currentQuestionIndex: number;
  currentStreak: number;
  isReady: boolean;
  finishedAt: string | null;
  leftAt: string | null;
  forfeitedAt: string | null;
  resultStatus: string;
};

export type ArenaRoom = {
  id: string;
  hostUserId: string;
  mode: ArenaRoomMode;
  status: string;
  albumId: string;
  albumName: string;
  artistName: string;
  artworkUrl: string;
  maxPlayers: number;
  isPrivate: boolean;
  inviteCode: string | null;
  roundNumber: number;
  rematchRequestedBy: string | null;
  rematchRequestedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  quizQuestions: DuelQuizQuestion[];
  players: ArenaRoomPlayer[];
};

export type ArenaInvite = {
  roomId: string;
  mode: ArenaRoomMode;
  status: string;
  albumId: string;
  albumName: string;
  artistName: string;
  artworkUrl: string;
  maxPlayers: number;
  isPrivate: boolean;
  inviteCode: string;
  hostUserId: string;
  hostDisplayName: string;
  hostUsername: string | null;
  playerCount: number;
  expiresAt: string | null;
};

type ArenaRoomRow = {
  id: string;
  host_user_id: string;
  mode: string;
  status: string;
  album_id: string | null;
  album_name: string | null;
  artist_name: string | null;
  artwork_url: string | null;
  max_players: number;
  is_private?: boolean | null;
  invite_code?: string | null;
  round_number?: number | null;
  rematch_requested_by?: string | null;
  rematch_requested_at?: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at?: string | null;
  quiz_questions?: unknown;
};

type ArenaRoomPlayerRow = {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string | null;
  username: string | null;
  joined_at: string;
  final_score: number;
  correct_answers: number;
  total_questions: number;
  average_answer_time: number;
  current_score?: number;
  current_correct_answers?: number;
  current_question_index?: number;
  current_streak?: number;
  is_ready?: boolean;
  finished_at?: string | null;
  left_at?: string | null;
  forfeited_at?: string | null;
  result_status?: string | null;
};

const ACTIVE_ARENA_STATUSES = [
  "waiting",
  "countdown",
  "starting",
  "active",
  "submitted",
];
const ARENA_ROOM_MODES: ArenaRoomMode[] = ["duel", "group_lobby"];

function isArenaRoomMode(value: string | null | undefined): value is ArenaRoomMode {
  return value === "duel" || value === "group_lobby";
}

export function normalizeArenaInviteCode(value: string) {
  return value.trim().toUpperCase();
}

export function getFriendlyArenaError(error: string | null | undefined) {
  if (!error) {
    return "";
  }

  const normalizedError = error.toLowerCase();

  if (normalizedError.includes("invite not found")) {
    return "Invalid private room code.";
  }

  if (
    normalizedError.includes("expired") ||
    normalizedError.includes("invite has expired")
  ) {
    return "This invite has expired.";
  }

  if (
    normalizedError.includes("no longer waiting") ||
    normalizedError.includes("not waiting")
  ) {
    return "This room is no longer accepting players.";
  }

  if (normalizedError.includes("already full")) {
    return "This private room is full.";
  }

  if (
    normalizedError.includes("already in another active") ||
    normalizedError.includes("already has an active")
  ) {
    return "Resume your active room before creating another.";
  }

  if (normalizedError.includes("closed") || normalizedError.includes("cancelled")) {
    return "This room was closed by the host.";
  }

  if (normalizedError.includes("finished")) {
    return "The game has already finished.";
  }

  if (normalizedError.includes("own room")) {
    return "You cannot join your own room as a second player.";
  }

  if (normalizedError.includes("duplicate key")) {
    return "You are already in this room. Reconnecting...";
  }

  return error;
}

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getPlayerDisplay(profile: UserProfile | null, user: User) {
  return {
    displayName:
      profile?.displayName || profile?.username || user.email || "Arena Player",
    username: profile?.username || null,
  };
}

export async function cancelStaleArenaRooms() {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("cancel_stale_arena_rooms");

  return { error: error?.message || null };
}

export async function fetchOpenDuelRooms(mode: ArenaRoomMode = "duel") {
  if (!supabase) {
    return { rooms: [], error: "Supabase is not configured yet." };
  }

  await cancelStaleArenaRooms();

  const { data: roomsData, error: roomsError } = await supabase
    .from("arena_rooms")
    .select("*")
    .eq("mode", mode)
    .eq("status", "waiting")
    .eq("is_private", false)
    .order("created_at", { ascending: false });

  if (roomsError) {
    return { rooms: [], error: roomsError.message };
  }

  const rooms = ((roomsData || []) as ArenaRoomRow[]).map(mapRoomRow);
  const roomIds = rooms.map((room) => room.id);

  if (roomIds.length === 0) {
    return { rooms, error: null };
  }

  const { data: playersData, error: playersError } = await supabase
    .from("arena_room_players")
    .select("*")
    .in("room_id", roomIds)
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  if (playersError) {
    return { rooms, error: playersError.message };
  }

  return {
    rooms: attachPlayers(rooms, (playersData || []) as ArenaRoomPlayerRow[]),
    error: null,
  };
}

export async function fetchCurrentDuelRoom(user: User) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  await cancelStaleArenaRooms();

  const { data: playerRows, error: playerError } = await supabase
    .from("arena_room_players")
    .select("room_id")
    .eq("user_id", user.id)
    .is("left_at", null)
    .order("joined_at", { ascending: false });

  if (playerError) {
    return { room: null, error: playerError.message };
  }

  const roomIds = Array.from(
    new Set(((playerRows || []) as Array<{ room_id: string }>).map((row) => row.room_id))
  );

  if (roomIds.length === 0) {
    return { room: null, error: null };
  }

  const { data: roomsData, error: roomsError } = await supabase
    .from("arena_rooms")
    .select("*")
    .in("id", roomIds)
    .in("mode", ARENA_ROOM_MODES)
    .in("status", [...ACTIVE_ARENA_STATUSES, "finished"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (roomsError) {
    return { room: null, error: roomsError.message };
  }

  const roomRow = ((roomsData || []) as ArenaRoomRow[]).find(
    (row) => row.status !== "finished" || Boolean(row.rematch_requested_by)
  );

  if (!roomRow) {
    return { room: null, error: null };
  }

  return fetchArenaRoom(roomRow.id);
}

export async function createDuelRoom({
  album,
  user,
  profile,
  mode = "duel",
  maxPlayers = 2,
  isPrivate = false,
}: {
  album: SpotifyAlbum;
  user: User;
  profile: UserProfile | null;
  mode?: ArenaRoomMode;
  maxPlayers?: number;
  isPrivate?: boolean;
}) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  const currentRoom = await fetchCurrentDuelRoom(user);

  if (currentRoom.room) {
    return {
      room: currentRoom.room,
      error: "You already have an active Arena room.",
    };
  }

  const { data: roomData, error: roomError } = await supabase
    .from("arena_rooms")
    .insert({
      host_user_id: user.id,
      mode,
      status: "waiting",
      album_id: album.id,
      album_name: album.title,
      artist_name: album.artist,
      artwork_url: album.imageUrl,
      max_players: maxPlayers,
      is_private: isPrivate,
      invite_code: isPrivate ? generateInviteCode() : null,
    })
    .select("*")
    .single();

  if (roomError || !roomData) {
    const activeRoom = await fetchCurrentDuelRoom(user);

    if (activeRoom.room) {
      return {
        room: activeRoom.room,
        error: "You already have an active Arena room.",
      };
    }

    return {
      room: null,
      error: getFriendlyArenaError(roomError?.message) || "Could not create room.",
    };
  }

  const room = mapRoomRow(roomData as ArenaRoomRow);
  const { displayName, username } = getPlayerDisplay(profile, user);
  const { data: playerData, error: playerError } = await supabase
    .from("arena_room_players")
    .insert({
      room_id: room.id,
      user_id: user.id,
      display_name: displayName,
      username,
    })
    .select("*")
    .single();

  if (playerError || !playerData) {
    return {
      room,
      error:
        getFriendlyArenaError(playerError?.message) ||
        "Room created, but host could not join.",
    };
  }

  return {
    room: {
      ...room,
      players: [mapPlayerRow(playerData as ArenaRoomPlayerRow)],
    },
    error: null,
  };
}

export async function joinDuelRoom({
  room,
  user,
  profile,
}: {
  room: ArenaRoom;
  user: User;
  profile: UserProfile | null;
}) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  const currentRoom = await fetchCurrentDuelRoom(user);

  if (currentRoom.room) {
    if (currentRoom.room.id === room.id) {
      return { room: currentRoom.room, error: null };
    }

    return {
      room: currentRoom.room,
      error: "You are already in another active Arena room.",
    };
  }

  const { room: freshRoom, error: roomError } = await fetchArenaRoom(room.id);
  const targetRoom = freshRoom || room;

  if (roomError && !freshRoom) {
    return { room: null, error: roomError };
  }

  if (targetRoom.status !== "waiting") {
    return { room: targetRoom, error: "This Arena room is no longer waiting." };
  }

  const existingPlayer = targetRoom.players.find(
    (player) => player.userId === user.id && !player.leftAt
  );

  if (existingPlayer) {
    return { room: targetRoom, error: null };
  }

  const presentPlayers = targetRoom.players.filter((player) => !player.leftAt);

  if (presentPlayers.length >= targetRoom.maxPlayers) {
    return { room: targetRoom, error: "This Arena room is already full." };
  }

  const { displayName, username } = getPlayerDisplay(profile, user);
  const { data: rejoinedPlayers, error: rejoinError } = await supabase
    .from("arena_room_players")
    .update({
      display_name: displayName,
      username,
      left_at: null,
      forfeited_at: null,
      result_status: "active",
    })
    .eq("room_id", targetRoom.id)
    .eq("user_id", user.id)
    .select("id");

  if (rejoinError) {
    return { room: null, error: getFriendlyArenaError(rejoinError.message) };
  }

  if (rejoinedPlayers && rejoinedPlayers.length > 0) {
    return fetchArenaRoom(targetRoom.id);
  }

  const { error } = await supabase.from("arena_room_players").insert({
    room_id: targetRoom.id,
    user_id: user.id,
    display_name: displayName,
    username,
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate")) {
      return fetchArenaRoom(targetRoom.id);
    }

    return { room: null, error: getFriendlyArenaError(error.message) };
  }

  return fetchArenaRoom(targetRoom.id);
}

export async function fetchArenaInvite(inviteCode: string) {
  if (!supabase) {
    return { invite: null, error: "Supabase is not configured yet." };
  }

  const { data, error } = await supabase.rpc("get_arena_invite", {
    target_invite_code: normalizeArenaInviteCode(inviteCode),
  });

  if (error) {
    return { invite: null, error: getFriendlyArenaError(error.message) };
  }

  const row = (Array.isArray(data) ? data[0] : null) as
    | {
        room_id: string;
        mode: string;
        status: string;
        album_id: string | null;
        album_name: string | null;
        artist_name: string | null;
        artwork_url: string | null;
        max_players: number;
        is_private: boolean;
        invite_code: string | null;
        host_user_id: string;
        host_display_name: string | null;
        host_username: string | null;
        player_count: number;
        expires_at: string | null;
      }
    | null;

  if (!row || !isArenaRoomMode(row.mode)) {
    return { invite: null, error: "Invalid private room code." };
  }

  return {
    invite: {
      roomId: row.room_id,
      mode: row.mode,
      status: row.status,
      albumId: row.album_id || "",
      albumName: row.album_name || "Unknown album",
      artistName: row.artist_name || "Unknown artist",
      artworkUrl: row.artwork_url || "",
      maxPlayers: row.max_players,
      isPrivate: Boolean(row.is_private),
      inviteCode: row.invite_code || normalizeArenaInviteCode(inviteCode),
      hostUserId: row.host_user_id,
      hostDisplayName:
        row.host_display_name || row.host_username || "Arena Host",
      hostUsername: row.host_username,
      playerCount: row.player_count || 0,
      expiresAt: row.expires_at || null,
    },
    error: null,
  };
}

export async function joinArenaRoomByInvite({
  inviteCode,
  user,
  profile,
}: {
  inviteCode: string;
  user: User;
  profile: UserProfile | null;
}) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  const currentRoom = await fetchCurrentDuelRoom(user);

  if (currentRoom.room) {
    if (
      currentRoom.room.inviteCode?.toLowerCase() ===
        normalizeArenaInviteCode(inviteCode).toLowerCase()
    ) {
      return { room: currentRoom.room, error: null };
    }

    return {
      room: currentRoom.room,
      error: "You are already in another active Arena room.",
    };
  }

  const { displayName, username } = getPlayerDisplay(profile, user);
  const { data, error } = await supabase.rpc("join_arena_room_by_invite", {
    target_invite_code: normalizeArenaInviteCode(inviteCode),
    player_display_name: displayName,
    player_username: username,
  });

  if (error || !data) {
    return {
      room: null,
      error:
        getFriendlyArenaError(error?.message) ||
        "Could not join this Arena invite.",
    };
  }

  return fetchArenaRoom(String(data));
}

export async function fetchArenaRoom(roomId: string) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  await cancelStaleArenaRooms();

  const { data: roomData, error: roomError } = await supabase
    .from("arena_rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (roomError || !roomData) {
    return { room: null, error: roomError?.message || "Room not found." };
  }

  const room = mapRoomRow(roomData as ArenaRoomRow);
  const { data: playersData, error: playersError } = await supabase
    .from("arena_room_players")
    .select("*")
    .eq("room_id", room.id)
    .order("joined_at", { ascending: true });

  if (playersError) {
    return { room, error: playersError.message };
  }

  return {
    room: {
      ...room,
      players: dedupeActivePlayers(
        ((playersData || []) as ArenaRoomPlayerRow[]).map(mapPlayerRow)
      ),
    },
    error: null,
  };
}

export async function activateDuelRoom(
  roomId: string,
  questions: DuelQuizQuestion[],
  startsAt: string
) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  const { error } = await supabase
    .from("arena_rooms")
    .update({
      status: "active",
      started_at: startsAt,
      quiz_questions: questions,
    })
    .eq("id", roomId);

  if (error) {
    return { room: null, error: getFriendlyArenaError(error.message) };
  }

  return fetchArenaRoom(roomId);
}

export async function updateDuelPlayerProgress({
  roomId,
  user,
  currentScore,
  currentCorrectAnswers,
  currentQuestionIndex,
  currentStreak,
}: {
  roomId: string;
  user: User;
  currentScore: number;
  currentCorrectAnswers: number;
  currentQuestionIndex: number;
  currentStreak: number;
}) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase
    .from("arena_room_players")
    .update({
      current_score: currentScore,
      current_correct_answers: currentCorrectAnswers,
      current_question_index: currentQuestionIndex,
      current_streak: currentStreak,
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  return { error: getFriendlyArenaError(error?.message) || null };
}

export async function saveDuelPlayerResult({
  roomId,
  user,
  finalScore,
  correctAnswers,
  totalQuestions,
  averageAnswerTime,
}: {
  roomId: string;
  user: User;
  finalScore: number;
  correctAnswers: number;
  totalQuestions: number;
  averageAnswerTime: number;
}) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase
    .from("arena_room_players")
    .update({
      final_score: finalScore,
      correct_answers: correctAnswers,
      total_questions: totalQuestions,
      average_answer_time: averageAnswerTime,
      current_score: finalScore,
      current_correct_answers: correctAnswers,
      current_question_index: totalQuestions,
      current_streak: 0,
      finished_at: new Date().toISOString(),
      result_status: "completed",
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  return { error: getFriendlyArenaError(error?.message) || null };
}

export async function finishDuelRoom(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("finish_arena_room_if_complete", {
    target_room_id: roomId,
  });

  return { error: getFriendlyArenaError(error?.message) || null };
}

export async function cancelDuelRoom(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("close_arena_room", {
    target_room_id: roomId,
  });

  return { error: getFriendlyArenaError(error?.message) || null };
}

export async function leaveWaitingDuelRoom(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("leave_waiting_arena_room", {
    target_room_id: roomId,
  });

  return { error: getFriendlyArenaError(error?.message) || null };
}

export async function forfeitDuelRoom(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("forfeit_arena_room", {
    target_room_id: roomId,
  });

  return { error: getFriendlyArenaError(error?.message) || null };
}

export async function requestArenaRematch(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("request_arena_rematch", {
    target_room_id: roomId,
  });

  return { error: error?.message || null };
}

export async function resetArenaRoomForRematch({
  roomId,
  album,
}: {
  roomId: string;
  album?: SpotifyAlbum | null;
}) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("reset_arena_room_for_rematch", {
    target_room_id: roomId,
    new_album_id: album?.id || null,
    new_album_name: album?.title || null,
    new_artist_name: album?.artist || null,
    new_artwork_url: album?.imageUrl || null,
  });

  if (error) {
    return { room: null, error: getFriendlyArenaError(error.message) };
  }

  return fetchArenaRoom(roomId);
}

export async function endArenaRoom(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("end_arena_room", {
    target_room_id: roomId,
  });

  return { error: getFriendlyArenaError(error?.message) || null };
}

function attachPlayers(rooms: ArenaRoom[], players: ArenaRoomPlayerRow[]) {
  return rooms.map((room) => ({
    ...room,
    players: dedupeActivePlayers(
      players
        .filter((player) => player.room_id === room.id)
        .map(mapPlayerRow)
    ),
  }));
}

function dedupeActivePlayers(players: ArenaRoomPlayer[]) {
  const seenPresentUsers = new Set<string>();

  return players.filter((player) => {
    if (player.leftAt) {
      return true;
    }

    if (seenPresentUsers.has(player.userId)) {
      return false;
    }

    seenPresentUsers.add(player.userId);
    return true;
  });
}

function mapRoomRow(row: ArenaRoomRow): ArenaRoom {
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    mode: isArenaRoomMode(row.mode) ? row.mode : "duel",
    status: row.status,
    albumId: row.album_id || "",
    albumName: row.album_name || "Unknown album",
    artistName: row.artist_name || "Unknown artist",
    artworkUrl: row.artwork_url || "",
    maxPlayers: row.max_players,
    isPrivate: Boolean(row.is_private),
    inviteCode: row.invite_code || null,
    roundNumber: row.round_number || 1,
    rematchRequestedBy: row.rematch_requested_by || null,
    rematchRequestedAt: row.rematch_requested_at || null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    expiresAt: row.expires_at || null,
    quizQuestions: normalizeDuelQuestions(row.quiz_questions),
    players: [],
  };
}

function normalizeDuelQuestions(questions: unknown): DuelQuizQuestion[] {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions
    .map((question) => {
      const rawQuestion = question as Partial<DuelQuizQuestion>;
      const correctTrack = rawQuestion.correctTrack;
      const options = rawQuestion.options;

      if (!correctTrack || !Array.isArray(options)) {
        return null;
      }

      return {
        correctTrack,
        options,
        correctAnswer: rawQuestion.correctAnswer || correctTrack.name,
        clipStartSeconds:
          typeof rawQuestion.clipStartSeconds === "number"
            ? rawQuestion.clipStartSeconds
            : 8,
      };
    })
    .filter((question): question is DuelQuizQuestion => Boolean(question));
}

function mapPlayerRow(row: ArenaRoomPlayerRow): ArenaRoomPlayer {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    displayName: row.display_name || row.username || "Arena Player",
    username: row.username,
    joinedAt: row.joined_at,
    finalScore: row.final_score,
    correctAnswers: row.correct_answers,
    totalQuestions: row.total_questions,
    averageAnswerTime: row.average_answer_time,
    currentScore: row.current_score || 0,
    currentCorrectAnswers: row.current_correct_answers || 0,
    currentQuestionIndex: row.current_question_index || 0,
    currentStreak: row.current_streak || 0,
    isReady: Boolean(row.is_ready),
    finishedAt: row.finished_at || null,
    leftAt: row.left_at || null,
    forfeitedAt: row.forfeited_at || null,
    resultStatus: row.result_status || "active",
  };
}
