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
  isReady: boolean;
  finishedAt: string | null;
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
  is_ready?: boolean;
  finished_at?: string | null;
};

function getPlayerDisplay(profile: UserProfile | null, user: User) {
  return {
    displayName:
      profile?.displayName || profile?.username || user.email || "Arena Player",
    username: profile?.username || null,
  };
}

export async function fetchOpenDuelRooms() {
  if (!supabase) {
    return { rooms: [], error: "Supabase is not configured yet." };
  }

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
    .order("joined_at", { ascending: true });

  if (playersError) {
    return { rooms, error: playersError.message };
  }

  return {
    rooms: attachPlayers(rooms, (playersData || []) as ArenaRoomPlayerRow[]),
    error: null,
  };
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

  const existingPlayer = room.players.find((player) => player.userId === user.id);

  if (existingPlayer) {
    return { room, error: null };
  }

  if (room.players.length >= room.maxPlayers) {
    return { room: null, error: "This Duel room is already full." };
  }

  const { displayName, username } = getPlayerDisplay(profile, user);
  const { error } = await supabase.from("arena_room_players").insert({
    room_id: room.id,
    user_id: user.id,
    display_name: displayName,
    username,
  });

  if (error) {
    return { room: null, error: error.message };
  }

  return fetchArenaRoom(room.id);
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

export async function markPlayerReady(roomId: string, user: User) {
  if (!supabase) {
    return { error: "Supabase is not configured yet." };
  }

  const { error } = await supabase
    .from("arena_room_players")
    .update({ is_ready: true })
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  return { error: error?.message || null };
}

export async function activateDuelRoom(
  roomId: string,
  questions: DuelQuizQuestion[]
) {
  if (!supabase) {
    return { room: null, error: "Supabase is not configured yet." };
  }

  const { error } = await supabase
    .from("arena_rooms")
    .update({
      status: "active",
      started_at: new Date().toISOString(),
      quiz_questions: questions,
    })
    .eq("id", roomId);

  if (error) {
    return { room: null, error: error.message };
  }

  return fetchArenaRoom(roomId);
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

  const { error } = await supabase
    .from("arena_rooms")
    .update({
      status: "finished",
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
    quizQuestions: Array.isArray(row.quiz_questions)
      ? (row.quiz_questions as DuelQuizQuestion[])
      : [],
    players: [],
  };
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
    isReady: Boolean(row.is_ready),
    finishedAt: row.finished_at || null,
  };
}
