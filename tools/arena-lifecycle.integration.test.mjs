import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOCAL_URL;
const anonKey = process.env.LOCAL_ANON;
const serviceKey = process.env.LOCAL_SERVICE;
const configured = Boolean(url && anonKey && serviceKey);
const identities = [];

const admin = configured
  ? createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

async function registeredIdentity(label) {
  const email = `arena-lifecycle-${randomUUID()}@example.test`;
  const password = `StanZer-${randomUUID()}-Aa9!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const identity = { client, user: login.data.user, label };
  identities.push(identity);
  return identity;
}

async function guestIdentity(label = "Guest") {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  const result = await client.auth.signInAnonymously();
  if (result.error) throw result.error;
  const identity = { client, user: result.data.user, label };
  identities.push(identity);
  return identity;
}

async function createRoom(host, mode, maxPlayers) {
  const { data, error } = await host.client.rpc("create_arena_room", {
    room_mode: mode,
    selected_album_id: "itunes:us:integration-test",
    selected_album_name: "Lifecycle Test Album",
    selected_artist_name: "StanZer Test",
    selected_artwork_url: null,
    requested_max_players: maxPlayers,
    room_is_private: false,
    player_display_name: host.label,
    player_username: null,
  });
  if (error) throw error;
  return data;
}

async function joinRoom(player, roomId) {
  const { error } = await player.client.rpc("join_public_arena_room", {
    target_room_id: roomId,
    player_display_name: player.label,
    player_username: null,
  });
  if (error) throw error;
}

async function activateRoom(mode, roomId, players) {
  if (mode !== "party_mode") {
    for (const player of players) {
      const { error } = await player.client.rpc("set_arena_lobby_ready", {
        target_room_id: roomId,
        target_ready: true,
      });
      if (error) throw error;
    }
  }

  const { error } = await admin
    .from("arena_rooms")
    .update({
      status: "active",
      started_at: new Date().toISOString(),
      quiz_questions: Array.from({ length: 5 }, () => ({})),
    })
    .eq("id", roomId);
  if (error) throw error;
}

async function roomAndPlayers(roomId) {
  const [{ data: room, error: roomError }, { data: players, error: playerError }] =
    await Promise.all([
      admin.from("arena_rooms").select("*").eq("id", roomId).single(),
      admin.from("arena_room_players").select("*").eq("room_id", roomId),
    ]);
  if (roomError) throw roomError;
  if (playerError) throw playerError;
  return { room, players };
}

async function agePresence(roomId, userId, seconds) {
  const { error } = await admin
    .from("arena_room_players")
    .update({ presence_updated_at: new Date(Date.now() - seconds * 1000).toISOString() })
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function reconcile(player, roomId) {
  const { data, error } = await player.client.rpc(
    "reconcile_arena_room_presence",
    { target_room_id: roomId }
  );
  if (error) throw error;
  return data;
}

if (!configured) {
  test("Arena lifecycle integration requires isolated local Supabase credentials", {
    skip: "Set LOCAL_URL, LOCAL_ANON, and LOCAL_SERVICE from local Supabase status.",
  }, () => {});
} else {
  after(async () => {
    for (const identity of identities) {
      try {
        await identity.client.auth.signOut();
        await admin.auth.admin.deleteUser(identity.user.id);
      } catch {
        // The local Supabase reset remains the final cleanup boundary.
      }
    }
  });

  test("either Duel participant can leave; repeated leave does not duplicate results", async () => {
    const host = await registeredIdentity("Duel Host");
    const opponent = await registeredIdentity("Duel Opponent");
    const roomId = await createRoom(host, "duel", 2);
    await joinRoom(opponent, roomId);
    await activateRoom("duel", roomId, [host, opponent]);

    const { error: leaveError } = await host.client.rpc("leave_arena_room", {
      target_room_id: roomId,
    });
    if (leaveError) throw leaveError;
    const { error: duplicateLeaveError } = await host.client.rpc("leave_arena_room", {
      target_room_id: roomId,
    });
    if (duplicateLeaveError) throw duplicateLeaveError;

    const { room, players } = await roomAndPlayers(roomId);
    assert.equal(room.status, "finished");
    assert.equal(players.find((player) => player.user_id === host.user.id).result_status, "forfeit");
    assert.equal(players.find((player) => player.user_id === opponent.user.id).result_status, "win_by_forfeit");
    const { count, error } = await admin
      .from("quiz_results")
      .select("id", { count: "exact", head: true })
      .eq("arena_room_id", roomId);
    if (error) throw error;
    assert.equal(count, 2, "progression result must remain unique per player and match");

    const { error: postgameLeaveError } = await opponent.client.rpc("leave_arena_room", {
      target_room_id: roomId,
    });
    if (postgameLeaveError) throw postgameLeaveError;
    const afterPostgameLeave = await roomAndPlayers(roomId);
    assert.equal(afterPostgameLeave.room.status, "finished");
    assert.equal(
      afterPostgameLeave.players.find((player) => player.user_id === opponent.user.id).result_status,
      "win_by_forfeit",
      "leaving the results view must not overwrite the completed win"
    );
  });

  test("private invite preview uses the host guest display name", async () => {
    const host = await guestIdentity("QA Guest Invite");
    const roomId = await host.client.rpc("create_arena_room", {
      room_mode: "duel",
      selected_album_id: "itunes:us:invite-name-test",
      selected_album_name: "Invite Name Test",
      selected_artist_name: "StanZer Test",
      selected_artwork_url: null,
      requested_max_players: 2,
      room_is_private: true,
      player_display_name: host.label,
      player_username: "guest_test_invite",
    });
    if (roomId.error) throw roomId.error;

    const { data, error } = await host.client.rpc("get_arena_invite", {
      target_invite_code: (
        await admin.from("arena_rooms").select("invite_code").eq("id", roomId.data).single()
      ).data.invite_code,
    });
    if (error) throw error;
    assert.equal(data[0].host_display_name, host.label);
    assert.equal(data[0].player_count, 1);
  });

  test("stale Duel host resolves to the connected opponent after reconnect grace", async () => {
    const host = await registeredIdentity("Stale Duel Host");
    const opponent = await registeredIdentity("Duel Opponent");
    const roomId = await createRoom(host, "duel", 2);
    await joinRoom(opponent, roomId);
    await activateRoom("duel", roomId, [host, opponent]);
    await agePresence(roomId, host.user.id, 60);

    const result = await reconcile(opponent, roomId);
    assert.equal(result.hostClosed, false);
    assert.equal(result.departedCount, 1);
    const { room, players } = await roomAndPlayers(roomId);
    assert.equal(room.status, "finished");
    assert.equal(players.find((player) => player.user_id === host.user.id).result_status, "forfeit");
    assert.equal(players.find((player) => player.user_id === opponent.user.id).result_status, "win_by_forfeit");
  });

  test("Group Lobby hands off an absent host; short reconnect restores presence", async () => {
    const host = await registeredIdentity("Group Host");
    const nextHost = await registeredIdentity("Next Host");
    const player = await registeredIdentity("Group Player");
    const roomId = await createRoom(host, "group_lobby", 3);
    await joinRoom(nextHost, roomId);
    await joinRoom(player, roomId);
    await activateRoom("group_lobby", roomId, [host, nextHost, player]);
    await agePresence(roomId, host.user.id, 60);

    const result = await reconcile(player, roomId);
    assert.equal(result.departedCount, 1);
    const { room, players } = await roomAndPlayers(roomId);
    assert.equal(room.status, "active");
    assert.equal(room.host_user_id, nextHost.user.id);
    assert.equal(players.find((entry) => entry.user_id === host.user.id).result_status, "forfeit");

    const reconnectHost = await registeredIdentity("Reconnecting Host");
    const reconnectOpponent = await registeredIdentity("Reconnect Opponent");
    const reconnectRoom = await createRoom(reconnectHost, "duel", 2);
    await joinRoom(reconnectOpponent, reconnectRoom);
    await activateRoom("duel", reconnectRoom, [reconnectHost, reconnectOpponent]);
    await agePresence(reconnectRoom, reconnectHost.user.id, 20);
    await reconcile(reconnectOpponent, reconnectRoom);
    const { error: heartbeatError } = await reconnectHost.client.rpc(
      "heartbeat_arena_room_presence",
      { target_room_id: reconnectRoom }
    );
    if (heartbeatError) throw heartbeatError;
    const { players: reconnectPlayers } = await roomAndPlayers(reconnectRoom);
    assert.equal(
      reconnectPlayers.find((entry) => entry.user_id === reconnectHost.user.id).presence_status,
      "connected"
    );
  });

  test("Party host departure and disconnect both cancel, never transfer audio authority", async () => {
    const host = await registeredIdentity("Party Host");
    const participant = await registeredIdentity("Party Participant");
    const roomId = await createRoom(host, "party_mode", 3);
    await joinRoom(participant, roomId);
    await activateRoom("party_mode", roomId, [host, participant]);

    const { error } = await host.client.rpc("leave_arena_room", {
      target_room_id: roomId,
    });
    if (error) throw error;
    const { room } = await roomAndPlayers(roomId);
    assert.equal(room.status, "cancelled");
    assert.equal(room.close_reason, "host_ended");

    const staleHost = await registeredIdentity("Disconnected Party Host");
    const anotherParticipant = await registeredIdentity("Party Participant");
    const staleRoom = await createRoom(staleHost, "party_mode", 3);
    await joinRoom(anotherParticipant, staleRoom);
    await activateRoom("party_mode", staleRoom, [staleHost, anotherParticipant]);
    await agePresence(staleRoom, staleHost.user.id, 60);
    const result = await reconcile(anotherParticipant, staleRoom);
    assert.equal(result.hostClosed, true);
    const { room: cancelledRoom } = await roomAndPlayers(staleRoom);
    assert.equal(cancelledRoom.status, "cancelled");
    assert.equal(cancelledRoom.close_reason, "host_disconnected");
  });

  test("guest session can leave a Duel fairly when local anonymous Auth is enabled", async (t) => {
    const host = await registeredIdentity("Guest Test Host");
    let guest;
    try {
      guest = await guestIdentity();
    } catch (error) {
      if (error?.code === "anonymous_provider_disabled") {
        t.skip("This local Supabase Auth instance has anonymous sign-ins disabled.");
        return;
      }
      throw error;
    }
    const roomId = await createRoom(host, "duel", 2);
    await joinRoom(guest, roomId);
    await activateRoom("duel", roomId, [host, guest]);
    const { error } = await guest.client.rpc("leave_arena_room", {
      target_room_id: roomId,
    });
    if (error) throw error;
    const { players } = await roomAndPlayers(roomId);
    assert.equal(players.find((player) => player.user_id === guest.user.id).result_status, "forfeit");
    assert.equal(players.find((player) => player.user_id === host.user.id).result_status, "win_by_forfeit");
  });
}
