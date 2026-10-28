import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const dbContainer = process.env.LOCAL_DB_CONTAINER;
const dbName = process.env.LOCAL_DB_NAME || 'postgres';
const serviceKey = process.env.LOCAL_SERVICE;

assert.ok(supabaseUrl && anonKey && dbContainer && serviceKey,
  'Set LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, LOCAL_SERVICE, and LOCAL_DB_CONTAINER.');
const parsedUrl = new URL(supabaseUrl);
assert.ok(['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname),
  'Refusing to test against a non-loopback Supabase URL.');
assert.ok(dbContainer.startsWith('supabase_db_stanzer-pr2-local-supabase-'),
  'Refusing to toggle a database outside the isolated StanZer local Supabase container.');
assert.ok(dbName === 'postgres' || /^stanz_maintenance_validation_[0-9]+$/.test(dbName),
  'Refusing to toggle an unexpected local database.');

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sql = (statement) => execFileSync('docker', [
  'exec', dbContainer, 'psql', '-X', '-q', '-U', 'postgres', '-d', dbName,
  '-v', 'ON_ERROR_STOP=1', '-c', statement,
], { stdio: 'ignore' });

const maintenance = (enabled) => sql(
  'begin; select pg_catalog.pg_advisory_xact_lock(246013579, 8731); ' +
  `update arena_private.runtime_controls set enabled = ${enabled}, updated_at = clock_timestamp() ` +
  `where control_name = 'multiplayer_maintenance'; commit;`
);

function guestClient(label) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.auth.signInAnonymously({ options: { data: { display_name: label } } })
    .then(({ data, error }) => {
      assert.ifError(error);
      assert.ok(data.session && data.user?.is_anonymous, 'Expected a local anonymous Auth session.');
      return { client, userId: data.user.id };
    });
}

async function registeredClient() {
  const email = `maintenance-${randomUUID()}@example.test`;
  const password = `Local-${randomUUID()}-Aa9!`;
  const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(createdUser.error);
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  assert.ifError(login.error);
  assert.ok(login.data.session && !login.data.user.is_anonymous);
  return { client, userId: login.data.user.id };
}

function expectMaintenance(result, operation) {
  assert.ok(result.error, `${operation} unexpectedly succeeded while locked.`);
  assert.equal(result.error.code, '55000', `${operation} did not reach the maintenance guard.`);
  assert.match(result.error.message, /maintenance|temporarily paused/i,
    `${operation} failed for an unexpected reason: ${result.error.message}`);
}

async function createRoom(client, mode, isPrivate = false) {
  const result = await client.rpc('create_arena_room', {
    room_mode: mode,
    selected_album_id: 'maintenance-regression',
    selected_album_name: 'Maintenance Regression Fixture',
    selected_artist_name: 'Local Test',
    selected_artwork_url: null,
    requested_max_players: mode === 'duel' ? 2 : mode === 'group_lobby' ? 3 : 10,
    room_is_private: isPrivate,
    player_display_name: `Gate ${mode}`,
    player_username: null,
  });
  assert.ifError(result.error);
  assert.ok(result.data, `Expected ${mode} creation while maintenance is disabled.`);
  return result.data;
}

async function roomInvite(host, roomId) {
  const result = await host.from('arena_rooms').select('invite_code').eq('id', roomId).single();
  assert.ifError(result.error);
  assert.ok(result.data.invite_code);
  return result.data.invite_code;
}

async function closeRoom(client, roomId) {
  const { error } = await client.rpc('leave_arena_room', { target_room_id: roomId });
  assert.ifError(error);
}

const created = [];
let lockMayBeOpen = false;
let identities = [];

try {
  const [duelHost, groupHost, partyHost, publicHost, privateHost, guest] = await Promise.all([
    guestClient('Gate Duel'), guestClient('Gate Group'), guestClient('Gate Party'),
    guestClient('Gate Public'), guestClient('Gate Private'), guestClient('Gate Guest'),
  ]);
  identities = [duelHost, groupHost, partyHost, publicHost, privateHost, guest];
  const registered = await registeredClient();
  const lockedRegistered = await registeredClient();
  identities.push(registered, lockedRegistered);

  maintenance(true);
  for (const [identity, mode] of [[duelHost, 'duel'], [groupHost, 'group_lobby'], [partyHost, 'party_mode']]) {
    expectMaintenance(await identity.client.rpc('create_arena_room', {
      room_mode: mode,
      selected_album_id: 'maintenance-regression',
      selected_album_name: 'Maintenance Regression Fixture',
      selected_artist_name: 'Local Test',
      selected_artwork_url: null,
      requested_max_players: mode === 'duel' ? 2 : mode === 'group_lobby' ? 3 : 10,
      room_is_private: false,
      player_display_name: `Gate ${mode}`,
      player_username: null,
    }), `${mode} guest room creation`);
  }

  // Exercise normal create/join behavior while open, then close again before
  // asserting the same authenticated endpoints fail under the installed gate.
  maintenance(false);
  lockMayBeOpen = true;
  const publicRoom = await createRoom(publicHost.client, 'duel');
  const privateRoom = await createRoom(privateHost.client, 'group_lobby', true);
  const partyRoom = await createRoom(partyHost.client, 'party_mode');
  created.push([publicHost.client, publicRoom], [privateHost.client, privateRoom], [partyHost.client, partyRoom]);

  const publicJoin = await guest.client.rpc('join_public_arena_room', {
    target_room_id: publicRoom,
    player_display_name: 'Gate Guest',
    player_username: null,
  });
  assert.ifError(publicJoin.error);
  assert.equal(publicJoin.data, publicRoom, 'Public join should work while the gate is open.');
  await closeRoom(guest.client, publicRoom);
  const registeredJoin = await registered.client.rpc('join_public_arena_room', {
    target_room_id: publicRoom, player_display_name: 'Registered Gate Player', player_username: null,
  });
  assert.ifError(registeredJoin.error);
  await closeRoom(registered.client, publicRoom);

  const inviteCode = await roomInvite(privateHost.client, privateRoom);
  const privateJoin = await guest.client.rpc('join_arena_room_by_invite', {
    target_invite_code: inviteCode,
    player_display_name: 'Gate Guest',
    player_username: null,
  });
  assert.ifError(privateJoin.error);
  assert.equal(privateJoin.data, privateRoom, 'Private join should work while the gate is open.');
  await closeRoom(guest.client, privateRoom);

  const blockedPublicRoom = await createRoom(duelHost.client, 'duel');
  const blockedPrivateRoom = await createRoom(groupHost.client, 'group_lobby', true);
  created.push([duelHost.client, blockedPublicRoom], [groupHost.client, blockedPrivateRoom]);
  const blockedInviteCode = await roomInvite(groupHost.client, blockedPrivateRoom);

  const preparedJoin = await registered.client.rpc('join_public_arena_room', {
    target_room_id: publicRoom,
    player_display_name: 'Registered Gate Player', player_username: null,
  });
  assert.ifError(preparedJoin.error);
  const readyPlayers = await admin.from('arena_room_players').update({
    lobby_ready: true, is_ready: true, presence_status: 'connected',
    presence_updated_at: new Date().toISOString(),
  }).eq('room_id', publicRoom).is('left_at', null);
  assert.ifError(readyPlayers.error);
  // A synthetic, answer-free RPC fixture, not a music playback test.
  const stagedFixture = await admin.from('arena_rooms').update({
    status: 'starting', competitive_round_phase: 'preparing_audio',
    quiz_questions: Array.from({ length: 5 }, () => ({ questionId: randomUUID(), options: [] })),
  }).eq('id', publicRoom);
  assert.ifError(stagedFixture.error);

  maintenance(true);
  lockMayBeOpen = false;
  const lockedCreateUsers = await Promise.all([
    guestClient('Locked Duel'), guestClient('Locked Group'), guestClient('Locked Party'),
  ]);
  identities.push(...lockedCreateUsers);
  for (const [identity, mode] of [[lockedCreateUsers[0], 'duel'], [lockedCreateUsers[1], 'group_lobby'], [lockedCreateUsers[2], 'party_mode']]) {
    expectMaintenance(await identity.client.rpc('create_arena_room', {
      room_mode: mode,
      selected_album_id: 'maintenance-regression',
      selected_album_name: 'Maintenance Regression Fixture',
      selected_artist_name: 'Local Test',
      selected_artwork_url: null,
      requested_max_players: mode === 'duel' ? 2 : mode === 'group_lobby' ? 3 : 10,
      room_is_private: false,
      player_display_name: `Gate ${mode}`,
      player_username: null,
    }), `${mode} room creation`);
  }

  expectMaintenance(await guest.client.rpc('join_public_arena_room', {
    target_room_id: blockedPublicRoom,
    player_display_name: 'Gate Guest',
    player_username: null,
  }), 'authenticated guest public join');
  expectMaintenance(await guest.client.rpc('join_arena_room_by_invite', {
    target_invite_code: blockedInviteCode,
    player_display_name: 'Gate Guest',
    player_username: null,
  }), 'authenticated guest private join');
  expectMaintenance(await lockedRegistered.client.rpc('join_public_arena_room', {
    target_room_id: blockedPublicRoom,
    player_display_name: 'Registered Gate Player', player_username: null,
  }), 'registered player public join');
  expectMaintenance(await lockedRegistered.client.rpc('join_arena_room_by_invite', {
    target_invite_code: blockedInviteCode,
    player_display_name: 'Registered Gate Player', player_username: null,
  }), 'registered player private join');
  expectMaintenance(await publicHost.client.rpc('start_prepared_competitive_arena_room', {
    target_room_id: publicRoom,
  }), 'prepared competitive starting-to-active RPC');
  expectMaintenance(await admin.from('arena_rooms').update({ status: 'active' }).eq('id', partyRoom),
    'Party waiting-to-active service API');
  for (const mode of ['duel', 'group_lobby', 'party_mode']) {
    expectMaintenance(await lockedRegistered.client.rpc('create_arena_room', {
      room_mode: mode, selected_album_id: 'maintenance-regression',
      selected_album_name: 'Maintenance Regression Fixture', selected_artist_name: 'Local Test',
      selected_artwork_url: null, requested_max_players: mode === 'duel' ? 2 : 3,
      room_is_private: false, player_display_name: 'Registered Gate Player', player_username: null,
    }), `${mode} registered room creation`);
  }

  const directInsert = await guest.client.from('arena_rooms').insert({
    host_user_id: guest.userId,
    mode: 'duel',
    status: 'waiting',
    album_id: 'maintenance-regression',
    album_name: 'Direct Write Must Fail',
    max_players: 2,
  });
  assert.ok(directInsert.error, 'Legacy direct table insertion unexpectedly succeeded.');

  maintenance(false);
  lockMayBeOpen = true;
  const startAfterUnlock = await publicHost.client.rpc('start_prepared_competitive_arena_room', {
    target_room_id: publicRoom,
  });
  assert.ifError(startAfterUnlock.error);
  assert.equal(startAfterUnlock.data.started, true, 'Prepared start should resume when unlocked.');
  maintenance(true);
  lockMayBeOpen = false;
  await closeRoom(publicHost.client, publicRoom);
  const finishedRoom = await admin.from('arena_rooms').select('status').eq('id', publicRoom).single();
  assert.ifError(finishedRoom.error);
  assert.equal(finishedRoom.data.status, 'finished', 'An existing active match must be able to finish while locked.');

  const testSql = join(dirname(fileURLToPath(import.meta.url)), '..',
    'supabase', 'tests', '20261030_arena_maintenance_gate.sql');
  execFileSync('docker', ['cp', testSql, `${dbContainer}:/tmp/20261030_arena_maintenance_gate_test.sql`], {
    stdio: 'ignore',
  });
  execFileSync('docker', [
    'exec', dbContainer, 'psql', '-X', '-U', 'postgres', '-d', dbName,
    '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/20261030_arena_maintenance_gate_test.sql',
  ], { stdio: 'inherit' });
  console.log('Local Auth/PostgREST and SQL maintenance checks passed for registered users, guests, all three modes, public/private joins, starts, and unlock/relock.');
} finally {
  if (lockMayBeOpen) {
    try { maintenance(true); } catch { /* preserve the original test failure */ }
  }
  for (const [client, roomId] of created) {
    try { await closeRoom(client, roomId); } catch { /* test rooms are disposable */ }
  }
  for (const { client } of identities) {
    try { await client.auth.signOut(); } catch { /* anonymous sessions are disposable */ }
  }
  for (const { userId } of identities) {
    const result = await admin.auth.admin.deleteUser(userId);
    assert.ifError(result.error);
  }
}
