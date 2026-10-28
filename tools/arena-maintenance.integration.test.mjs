import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const dbContainer = process.env.LOCAL_DB_CONTAINER;

assert.ok(supabaseUrl && anonKey && dbContainer,
  'Set LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, and LOCAL_DB_CONTAINER.');
const parsedUrl = new URL(supabaseUrl);
assert.ok(['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname),
  'Refusing to test against a non-loopback Supabase URL.');
assert.ok(dbContainer.startsWith('supabase_db_stanzer-pr2-local-supabase-'),
  'Refusing to toggle a database outside the isolated StanZer local Supabase container.');

const sql = (statement) => execFileSync('docker', [
  'exec', dbContainer, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-c', statement,
], { stdio: 'ignore' });

const maintenance = (enabled) => sql(
  `update arena_private.runtime_controls set enabled = ${enabled} ` +
  `where control_name = 'multiplayer_maintenance'`
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

function expectMaintenance(result, operation) {
  assert.ok(result.error, `${operation} unexpectedly succeeded while locked.`);
  assert.match(result.error.message, /temporarily unavailable for maintenance/i,
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

  const directInsert = await guest.client.from('arena_rooms').insert({
    host_user_id: guest.userId,
    mode: 'duel',
    status: 'waiting',
    album_id: 'maintenance-regression',
    album_name: 'Direct Write Must Fail',
    max_players: 2,
  });
  assert.ok(directInsert.error, 'Legacy direct table insertion unexpectedly succeeded.');

  console.log('Local Supabase Auth/PostgREST maintenance checks passed: guest room creation, public/private join, all three modes, unlocked operation, and direct-write denial.');
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
}

const testSql = join(dirname(fileURLToPath(import.meta.url)), '..',
  'supabase', 'tests', '20261030_arena_maintenance_gate.sql');
execFileSync('docker', ['cp', testSql, `${dbContainer}:/tmp/20261030_arena_maintenance_gate_test.sql`], {
  stdio: 'ignore',
});
execFileSync('docker', [
  'exec', dbContainer, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/20261030_arena_maintenance_gate_test.sql',
], { stdio: 'inherit' });
console.log('Local SQL trigger/privilege regression checks passed and rolled back their fixtures.');
