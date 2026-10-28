import assert from "node:assert/strict";
import { test } from "node:test";
import handler from "../api/prepare-arena-questions.js";

function responseRecorder() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("question preparation rejects unauthenticated calls before touching catalog or database", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  globalThis.fetch = async () => { throw new Error("unexpected network request"); };
  try {
    const res = responseRecorder();
    await handler({ method: "POST", headers: {}, body: { roomId: "00000000-0000-4000-8000-000000000001" } }, res);
    assert.equal(res.statusCode, 401);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  }
});

test("question preparation rejects a non-host before fetching the album", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000002" }), { status: 200 });
    }
    return new Response(JSON.stringify([{ id: "00000000-0000-4000-8000-000000000001", host_user_id: "00000000-0000-4000-8000-000000000003", mode: "duel", status: "waiting", album_id: "42", round_number: 1 }]), { status: 200 });
  };
  try {
    const res = responseRecorder();
    await handler({
      method: "POST", headers: { authorization: "Bearer user-token" },
      body: { roomId: "00000000-0000-4000-8000-000000000001" },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  }
});

test("only the verified host can stage catalog-derived safe snapshots", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  const hostId = "00000000-0000-4000-8000-000000000003";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  let stagedBody;
  const stagedResponseId = "00000000-0000-4000-8000-000000000009";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: hostId }), { status: 200 });
    }
    if (url.includes("/rest/v1/arena_rooms")) {
      return new Response(JSON.stringify([{
        id: "00000000-0000-4000-8000-000000000001",
        host_user_id: hostId, mode: "duel", status: "waiting", album_id: "42", round_number: 1,
      }]), { status: 200 });
    }
    if (url.includes("itunes.apple.com/lookup")) {
      return new Response(JSON.stringify({ results: [
        { wrapperType: "collection", collectionId: 42 },
        ...Array.from({ length: 12 }, (_, index) => ({
          wrapperType: "track", trackId: 100 + index, trackName: `Song ${index}`,
          artistName: "Artist", previewUrl: `https://audio-ssl.itunes.apple.com/${index}.m4a`,
        })),
      ] }), { status: 200 });
    }
    if (url.includes("/rpc/stage_arena_question_set")) {
      stagedBody = JSON.parse(init.body);
      return new Response(JSON.stringify(stagedResponseId), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const res = responseRecorder();
    await handler({
      method: "POST", headers: { authorization: "Bearer user-token" },
      body: {
        roomId: "00000000-0000-4000-8000-000000000001",
        questions: [{ correctAnswer: "forged" }],
      },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(stagedBody.p_host_user_id, hostId);
    assert.equal(stagedBody.p_public_questions.length, 7);
    assert.ok(stagedBody.p_public_questions.every((question) => question.options.length === 4));
    assert.doesNotMatch(JSON.stringify(stagedBody.p_public_questions), /correctAnswer|correctTrack|previewUrl|itunes-\d+/i);
    assert.equal(res.body.questionSetId, stagedResponseId);
    assert.notEqual(res.body.questionSetId, stagedBody.p_question_set_id);
    assert.doesNotMatch(JSON.stringify(res.body), /previewUrl|correctAnswer|correctOptionId|artistName|trackId|itunes-/i);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  }
});
