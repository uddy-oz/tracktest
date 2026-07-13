import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { UserProfile } from "./profiles";
import type { SpotifyAlbum } from "./spotifyApi";

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
};

export type ArenaRoom = {
  id: string;
  hostUserId: string;
  mode: string;
  status: string;
  albumId: string;
  albumName: string;
  artistName: string;
  artworkUrl: string;
  maxPlayers: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  quizQuestions: DuelQuizQuestion[];
  players: ArenaRoomPlayer[];
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
};

const ACTIVE_DUEL_STATUSES = ["waiting", "starting", "active"];

function getPlayerDisplay(profile: UserProfile | null, user: User) {
  return {
    displayName:
      profile?.displayName || profile?.username || user.email || "Arena Player",
    username: profile?.username || null,
  };
}

export async function cancelStaleDuelRooms() {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("cancel_stale_duel_rooms");

  return { error: error?.message || null };
}

export async function fetchOpenDuelRooms() {
  if (!supabase) {
    return { rooms: [], error: "Supabase is not configured yet." };
  }

  await cancelStaleDuelRooms();

  const { data: roomsData, error: roomsError } = await supabase
    .from("arena_rooms")
    .select("*")
    .eq("mode", "duel")
    .eq("status", "waiting")
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

  await cancelStaleDuelRooms();

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
    .eq("mode", "duel")
    .in("status", ACTIVE_DUEL_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (roomsError) {
    return { room: null, error: roomsError.message };
  }

  const roomRow = ((roomsData || []) as ArenaRoomRow[])[0];

  if (!roomRow) {
    return { room: null, error: null };
  }

  return fetchArenaRoom(roomRow.id);
}

export async function createDuelRoom({
  album,
  user,
  profile,
}: {
  album: SpotifyAlbum;
  user: User;
  profile: UserProfile | null;
}) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  const currentRoom = await fetchCurrentDuelRoom(user);

  if (currentRoom.room) {
    return {
      room: currentRoom.room,
      error: "You already have an active Duel room.",
    };
  }

  const { data: roomData, error: roomError } = await supabase
    .from("arena_rooms")
    .insert({
      host_user_id: user.id,
      mode: "duel",
      status: "waiting",
      album_id: album.id,
      album_name: album.title,
      artist_name: album.artist,
      artwork_url: album.imageUrl,
      max_players: 2,
    })
    .select("*")
    .single();

  if (roomError || !roomData) {
    return { room: null, error: roomError?.message || "Could not create room." };
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
      error: playerError?.message || "Room created, but host could not join.",
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
      error: "You are already in another active Duel room.",
    };
  }

  const { room: freshRoom, error: roomError } = await fetchArenaRoom(room.id);
  const targetRoom = freshRoom || room;

  if (roomError && !freshRoom) {
    return { room: null, error: roomError };
  }

  if (targetRoom.status !== "waiting") {
    return { room: targetRoom, error: "This Duel room is no longer waiting." };
  }

  const existingPlayer = targetRoom.players.find(
    (player) => player.userId === user.id
  );

  if (existingPlayer) {
    return { room: targetRoom, error: null };
  }

  if (targetRoom.players.length >= targetRoom.maxPlayers) {
    return { room: targetRoom, error: "This Duel room is already full." };
  }

  const { displayName, username } = getPlayerDisplay(profile, user);
  const { error } = await supabase.from("arena_room_players").insert({
    room_id: targetRoom.id,
    user_id: user.id,
    display_name: displayName,
    username,
  });

  if (error) {
    return { room: null, error: error.message };
  }

  return fetchArenaRoom(targetRoom.id);
}

export async function fetchArenaRoom(roomId: string) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

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
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  if (playersError) {
    return { room, error: playersError.message };
  }

  return {
    room: {
      ...room,
      players: ((playersData || []) as ArenaRoomPlayerRow[]).map(mapPlayerRow),
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
    return { room: null, error: error.message };
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

  return { error: error?.message || null };
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
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  return { error: error?.message || null };
}

export async function finishDuelRoom(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase.rpc("finish_duel_room_if_complete", {
    target_room_id: roomId,
  });

  return { error: error?.message || null };
}

export async function cancelDuelRoom(roomId: string) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase
    .from("arena_rooms")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("id", roomId);

  return { error: error?.message || null };
}

function attachPlayers(rooms: ArenaRoom[], players: ArenaRoomPlayerRow[]) {
  return rooms.map((room) => ({
    ...room,
    players: players
      .filter((player) => player.room_id === room.id)
      .map(mapPlayerRow),
  }));
}

function mapRoomRow(row: ArenaRoomRow): ArenaRoom {
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    mode: row.mode,
    status: row.status,
    albumId: row.album_id || "",
    albumName: row.album_name || "Unknown album",
    artistName: row.artist_name || "Unknown artist",
    artworkUrl: row.artwork_url || "",
    maxPlayers: row.max_players,
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
  };
}
