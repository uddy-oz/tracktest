import type { SpotifyAlbum } from "./spotifyApi";
import { supabase } from "./supabaseClient";

export type ChallengeClip = {
  options: string[];
  previewUrl: string;
  offset: number;
};
export type ChallengeQuestion = ChallengeClip & { correctIndex: number };
export type SoloChallenge = {
  id: string;
  album: SpotifyAlbum;
  playerName: string;
  score: number;
  correct: number;
  questionCount: number;
  expiresAt: string;
};
export type ChallengeReplay = { challenge: SoloChallenge; attemptId: string };

export function isChallengeId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function challengeOutcome(score: number, target: number) {
  return score === target ? "You tied" : score > target ? "You won" : "You lost";
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Challenges are unavailable in this environment.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function createChallenge(album: SpotifyAlbum, score: number, correct: number, questions: ChallengeQuestion[]) {
  return rpc<string>("create_solo_challenge", {p_album: album, p_score: score, p_correct: correct, p_questions: questions});
}

export function fetchChallenge(id: string) {
  return isChallengeId(id) ? rpc<SoloChallenge | null>("get_solo_challenge", {p_challenge: id}) : Promise.resolve(null);
}

export function startChallenge(id: string) {
  return rpc<string>("begin_solo_challenge", {p_challenge: id});
}

export function openChallengeQuestion(attemptId: string, index: number) {
  return rpc<ChallengeClip>("open_solo_challenge_question", {p_attempt: attemptId, p_index: index});
}

export function revealChallengeAnswer(attemptId: string, index: number) {
  return rpc<number>("reveal_solo_challenge_answer", {p_attempt: attemptId, p_index: index});
}
