import { randomUUID } from "node:crypto";
import {
  buildTrustedQuestionSet,
  parseITunesAlbumId,
  playableTracksFromLookup,
} from "./arena-question-set.js";

const MAX_BODY_BYTES = 2_000;
const REQUEST_TIMEOUT_MS = 8_000;

function json(res, status, value) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(value);
}

function supabaseHeaders(apiKey, accessToken = apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

function getConfiguration() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return url && anonKey && serviceKey ? { url, anonKey, serviceKey } : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed." });
  }

  const config = getConfiguration();
  if (!config) {
    return json(res, 503, {
      code: "ARENA_QUESTION_SERVER_NOT_CONFIGURED",
      error: "Secure multiplayer question preparation is not configured.",
    });
  }

  const authorization = req.headers.authorization || "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!accessToken || Buffer.byteLength(JSON.stringify(req.body || {})) > MAX_BODY_BYTES) {
    return json(res, 401, { error: "A valid signed-in session is required." });
  }

  const roomId = String(req.body?.roomId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) {
    return json(res, 400, { error: "A valid Arena room is required." });
  }

  try {
    const authResult = await fetchJson(`${config.url}/auth/v1/user`, {
      headers: supabaseHeaders(config.anonKey, accessToken),
    });
    const hostUserId = authResult.payload?.id;
    if (!authResult.response.ok || !hostUserId) {
      return json(res, 401, { error: "Your session could not be verified." });
    }

    const roomUrl = new URL(`${config.url}/rest/v1/arena_rooms`);
    roomUrl.searchParams.set("id", `eq.${roomId}`);
    roomUrl.searchParams.set("select", "id,host_user_id,mode,status,album_id,round_number");
    const roomResult = await fetchJson(roomUrl, {
      headers: supabaseHeaders(config.serviceKey),
    });
    const room = Array.isArray(roomResult.payload) ? roomResult.payload[0] : null;
    if (!roomResult.response.ok) throw new Error("Could not verify the Arena room.");
    if (!room || room.host_user_id !== hostUserId || room.status !== "waiting") {
      return json(res, 403, { error: "Only the host of a waiting room can prepare questions." });
    }
    if (!["duel", "group_lobby", "party_mode"].includes(room.mode)) {
      return json(res, 400, { error: "This Arena mode does not support this question set." });
    }

    const { country, collectionId } = parseITunesAlbumId(room.album_id);
    const lookupUrl = new URL("https://itunes.apple.com/lookup");
    lookupUrl.searchParams.set("id", collectionId);
    lookupUrl.searchParams.set("entity", "song");
    lookupUrl.searchParams.set("country", country);
    const lookup = await fetchJson(lookupUrl, {
      headers: { "User-Agent": "StanZer/1.0", Accept: "application/json" },
    });
    if (!lookup.response.ok) throw new Error("The album catalog could not be reached. Try again.");

    const tracks = playableTracksFromLookup(lookup.payload?.results, collectionId);
    const questionSetId = randomUUID();
    const set = buildTrustedQuestionSet({
      tracks,
      mode: room.mode,
      roundNumber: Number(room.round_number || 1),
      questionSetId,
    });

    const staged = await fetchJson(`${config.url}/rest/v1/rpc/stage_arena_question_set`, {
      method: "POST",
      headers: supabaseHeaders(config.serviceKey),
      body: JSON.stringify({
        p_room_id: room.id,
        p_host_user_id: hostUserId,
        p_mode: room.mode,
        p_round_number: set.roundNumber,
        p_question_set_id: set.questionSetId,
        p_target_question_count: set.targetQuestionCount,
        p_public_questions: set.questions,
        p_reserve_questions: set.reserveQuestions,
        p_question_keys: set.keys,
      }),
    });
    if (!staged.response.ok) {
      const detail = staged.payload?.message || staged.payload?.details || "";
      throw new Error(detail || "The trusted question set could not be staged.");
    }
    const stagedQuestionSetId = staged.payload;
    if (typeof stagedQuestionSetId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stagedQuestionSetId)) {
      throw new Error("The trusted question set could not be confirmed.");
    }

    return json(res, 200, {
      questionSetId: stagedQuestionSetId,
      targetQuestionCount: set.targetQuestionCount,
    });
  } catch (error) {
    console.error("Arena question preparation failed:", error?.message || error);
    const message = error instanceof Error ? error.message : "Could not prepare this match.";
    const clientMessage = /at least 5 playable previews/i.test(message)
      ? message
      : "Could not prepare trusted album questions. Refresh the room and try again.";
    return json(res, 422, { error: clientMessage });
  }
}
