import assert from "node:assert/strict";
import { test } from "node:test";
import { getArenaAlbumError, prepareArenaLobbyStart } from "../src/lib/arenaLobbyStart.ts";
import type { ArenaRoom, ArenaRoomPlayer, DuelQuizQuestion } from "../src/lib/arenaRooms.ts";

const player = (userId: string) => ({
  userId, leftAt: null, finishedAt: null, forfeitedAt: null, resultStatus: "active",
}) as ArenaRoomPlayer;
const room = (changes: Partial<ArenaRoom> = {}) => ({
  id: "room", hostUserId: "host", mode: "duel", status: "waiting", albumId: "album",
  roundNumber: 1, maxPlayers: 2, quizQuestions: [], players: [player("host"), player("opponent")],
  ...changes,
}) as ArenaRoom;
const host = { id: "host", is_anonymous: false };
const tracks = Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, name: `Track ${i}`, previewUrl: `https://example.test/${i}` }));
const questions = [{ correctTrack: tracks[0], options: tracks.slice(0, 4), correctAnswer: tracks[0].name, clipStartSeconds: 9 }] as DuelQuizQuestion[];

function fixture(snapshot = room(), trackCount = 6) {
  const calls: string[] = [];
  const events: { event: string; details: Record<string, unknown> }[] = [];
  const deps = {
    fetchRoom: async () => ({ room: snapshot, error: null }),
    loadTracks: async (albumId: string) => { calls.push(`album:${albumId}`); return tracks.slice(0, trackCount); },
    buildQuestions: () => ({ questions, targetQuestionCount: questions.length }),
    beforeActivate: async () => { calls.push("unlock"); },
    activateRoom: async (_id: string, shared: DuelQuizQuestion[], mode: string) => {
      calls.push(`rpc:${mode}`);
      return { room: { ...snapshot, status: mode === "party_mode" ? "active" : "starting", quizQuestions: shared }, error: null as string | null };
    },
    log: (event: string, details: Record<string, unknown>) => events.push({ event, details }),
  };
  return { deps, calls, events };
}

test("reported four-track EP rejects before RPC with an actionable reason", async () => {
  const f = fixture(room(), 4);
  const result = await prepareArenaLobbyStart("room", host, f.deps);
  assert.equal(result.room, null);
  assert.match(result.error!, /4 playable tracks.*at least 5/);
  assert.deepEqual(f.calls, ["album:album"]);
  assert.equal(f.events.at(-1)?.details.stage, "load-album");
  assert.equal(getArenaAlbumError(5), "");
});

for (const guestOpponent of [false, true]) {
  test(`permanent host + ${guestOpponent ? "guest without profile" : "permanent"} opponent stages on one start`, async () => {
    const f = fixture(room({ players: [player("host"), player(guestOpponent ? "guest" : "opponent")] }));
    const result = await prepareArenaLobbyStart("room", host, f.deps);
    assert.equal(result.room?.status, "starting");
    assert.deepEqual(f.calls, ["album:album", "unlock", "rpc:duel"]);
    assert.equal(f.events[1].details.memberCount, 2);
  });
}

test("guest joining just before start is included by the fresh server snapshot", async () => {
  const f = fixture(room({ players: [player("host"), player("just-joined")] }));
  assert.equal((await prepareArenaLobbyStart("room", host, f.deps)).error, null);
});

for (const change of [{ leftAt: "now" }, { finishedAt: "now" }, { resultStatus: "forfeit" }]) {
  test(`departed/finished guest cannot satisfy player count: ${JSON.stringify(change)}`, async () => {
    const f = fixture(room({ players: [player("host"), { ...player("guest"), ...change }] }));
    assert.match((await prepareArenaLobbyStart("room", host, f.deps)).error!, /2 active players/);
    assert.equal(f.calls.length, 0);
  });
}

test("refreshed/reconnected host resumes server staging without replacing questions", async () => {
  const f = fixture(room({ status: "starting", quizQuestions: questions }));
  const result = await prepareArenaLobbyStart("room", host, f.deps);
  assert.equal(result.room?.quizQuestions, questions);
  assert.equal(f.calls.length, 0);
});

for (const albumId of ["album", "new-album"]) {
  test(`rematch generation loads its selected album: ${albumId}`, async () => {
    const f = fixture(room({ roundNumber: 2, albumId }));
    const result = await prepareArenaLobbyStart("room", host, f.deps);
    assert.equal(result.room?.roundNumber, 2);
    assert.equal(f.calls[0], `album:${albumId}`);
  });
}

for (const mode of ["group_lobby", "party_mode"] as const) {
  test(`${mode} retains its existing start path`, async () => {
    const f = fixture(room({ mode, maxPlayers: 10, players: [player("host"), player("guest"), player("third")] }));
    const result = await prepareArenaLobbyStart("room", host, f.deps);
    assert.equal(result.error, null);
    assert.equal(f.calls.at(-1), `rpc:${mode}`);
  });
}

test("RPC failure never manufactures shared questions or a started room", async () => {
  const f = fixture();
  f.deps.activateRoom = async () => ({ room: null as unknown as ArenaRoom, error: "Membership changed." });
  const result = await prepareArenaLobbyStart("room", host, f.deps);
  assert.equal(result.room, null);
  assert.match(result.error!, /Membership changed/);
  assert.equal(f.events.at(-1)?.details.stage, "prepare-rpc");
});

test("thrown network errors become visible start failures", async () => {
  const f = fixture();
  f.deps.loadTracks = async () => { throw new Error("Network unavailable."); };
  assert.match((await prepareArenaLobbyStart("room", host, f.deps)).error!, /Could not start match.*Network/);
});

test("only the host can initiate the start", async () => {
  const f = fixture();
  assert.match((await prepareArenaLobbyStart("room", { id: "guest" }, f.deps)).error!, /Only the host/);
  assert.equal(f.calls.length, 0);
});
