import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const { LOCAL_URL: url, LOCAL_ANON: anon, LOCAL_SERVICE: service } = process.env;
const configured = Boolean(url && anon && service);
if (configured) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
const opts = {auth:{persistSession:false,autoRefreshToken:false}};
const admin = configured ? createClient(url, service, opts) : null;
const userIds = [];
const albumId = "itunes:US:123";
const clip = "https://audio-ssl.itunes.apple.com/friends-fixture.m4a";

async function value(promise) {
  const {data,error} = await promise;
  assert.ifError(error);
  return data;
}

async function player(label, guest = false) {
  const client = createClient(url, anon, opts);
  let login;
  if (guest) login = await value(client.auth.signInAnonymously());
  else {
    const email = `friends-${randomUUID()}@example.test`;
    const password = `Friends-${randomUUID()}-Aa9!`;
    await value(admin.auth.admin.createUser({email,password,email_confirm:true}));
    login = await value(client.auth.signInWithPassword({email,password}));
  }
  const id=login.user.id;
  userIds.push(id);
  if(!guest) await value(admin.from("profiles").insert({id,username:"qa_"+id.slice(0,8),display_name:label}));
  return { client, id, label, guest };
}

async function create(host, roomIsPrivate) {
  return value(host.client.rpc("create_friends_room", {
    selected_album_id:albumId, selected_album_name:"Friends fixture", selected_artist_name:"Test artist",
    selected_artwork_url:null, room_is_private:roomIsPrivate, player_display_name:host.label, player_username:null,
  }));
}

function room(id, actor = admin) {
  return value(actor.from("arena_rooms").select("*").eq("id",id).single());
}

function join(state, actor) {
  const args={player_display_name:actor.label,player_username:null};
  return state.is_private
    ? actor.client.rpc("join_arena_room_by_invite",{...args,target_invite_code:state.invite_code})
    : actor.client.rpc("join_public_arena_room",{...args,target_room_id:state.id});
}

async function stage(state, host) {
  const id=randomUUID();
  const options=Array.from({length:4},(_,i)=>({id:`${i}`,name:`Option ${i}`}));
  const questions=Array.from({length:5},()=>({questionId:randomUUID(),questionSetId:id,options}));
  const keys=questions.map(q=>({questionId:q.questionId,correctOptionId:"0",correctAnswer:"Option 0",correctTrackId:"0",previewUrl:clip,clipStartSeconds:8}));
  return value(admin.rpc("stage_arena_question_set",{
    p_room_id:state.id,p_host_user_id:host.id,p_mode:state.mode,p_round_number:state.round_number,
    p_question_set_id:id,p_target_question_count:5,p_public_questions:questions,p_reserve_questions:[],p_question_keys:keys,
  }));
}

const activate=(actor, state, id, players)=>actor.client.rpc("activate_friends_question_set",{
  target_room_id:state.id,target_question_set_id:id,expected_album_id:state.album_id,expected_player_ids:players.map(p=>p.id),
});
const ready=(state, actor)=>value(actor.client.rpc("set_arena_lobby_ready",{target_room_id:state.id,target_ready:true}));

async function start(state, host, members, id) {
  for(const p of members)await ready(state,p);
  await value(activate(host,state,id,members));
  const prepared=await room(state.id);
  assert.equal(prepared.status,"starting");
  assert.equal(prepared.mode,members.length===2?"duel":"group_lobby");
  assert.equal(prepared.competitive_required_ready_count,members.length);
  assert.equal(prepared.invite_code,state.invite_code);
  assert.equal(prepared.album_id,state.album_id);
  assert.equal(prepared.host_user_id,host.id);
  for(const p of members){
    assert.deepEqual((await room(state.id,p.client)).quiz_questions,prepared.quiz_questions);
    await value(p.client.rpc("acknowledge_competitive_lobby_audio_ready",{
      target_room_id:state.id,target_round_id:prepared.competitive_round_id,target_preview_url:clip,
    }));
  }
  const result=await value(host.client.rpc("start_prepared_competitive_arena_room",{target_room_id:state.id}));
  assert.equal(result.started,true);
  const active=await room(state.id);
  assert.equal(active.status,"active");
  assert.ok(active.competitive_answer_starts_at);
  for(const p of members){
    assert.equal((await room(state.id,p.client)).competitive_answer_starts_at,active.competitive_answer_starts_at);
  }
  return active;
}

async function verifyScoringAndAward(active, host, opponent, badgeId) {
  const delay = Date.parse(active.competitive_answer_starts_at) - Date.now() + 150;
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  const args = {target_room_id:active.id,target_round_id:active.competitive_round_id,target_question_index:0,target_answer:"0"};
  assert.equal((await value(host.client.rpc("submit_competitive_arena_answer",args))).roundWon,true);
  assert.equal((await value(opponent.client.rpc("submit_competitive_arena_answer",args))).accepted,false);
  // The first answer used the real clock and scorer; finish the remaining
  // fixture rounds without waiting out their audio and reveal timers.
  const finishedAt = new Date().toISOString();
  await value(admin.from("arena_room_players").update({
    result_status:"completed", finished_at:finishedAt, total_questions:5, rounds_played:5,
  }).eq("room_id",active.id));
  await value(admin.from("arena_room_players").update({final_score:1,correct_answers:1})
    .eq("room_id",active.id).eq("user_id",host.id));
  await value(admin.from("arena_rooms").update({status:"finished",finished_at:finishedAt}).eq("id",active.id));
  const awards=await value(host.client.from("player_achievements").select("badge_id").eq("user_id",host.id));
  assert.ok(awards.some(a=>a.badge_id===badgeId),`Missing expected ${badgeId}`);
  assert.ok(!awards.some(a=>a.badge_id===(badgeId==="first-1v1-win"?"first-lobby-win":"first-1v1-win")));
}

test("same code starts as a Duel then expands to a Group in a rematch", {skip:!configured}, async()=>{
  const host=await player("Duo host"), guest=await player("Duo guest",true), third=await player("Third");
  const id=await create(host,true);
  const original=await room(id);
  assert.equal(original.max_players,10);
  assert.ok(original.unified_friends && original.invite_code);
  assert.equal(await value(join(original,guest)),id);
  const set=await stage(original,host);
  assert.match((await activate(guest,original,set,[host,guest])).error?.message||"",/Only the host/);
  assert.match((await activate(host,original,set,[host,guest])).error?.message||"",/ready up/);
  assert.equal((await room(id)).mode,"group_lobby","a failed start must undo format selection");
  const active=await start(original,host,[host,guest],set);
  assert.match((await join(active,third)).error?.message||"",/no longer waiting/);
  const forfeited=await value(guest.client.rpc("forfeit_arena_room",{target_room_id:id}));
  assert.equal(forfeited,true);
  const history=await value(admin.from("quiz_results").select("id,game_mode,arena_round_number").eq("arena_room_id",id));
  assert.equal(history.length,1);
  assert.equal(history[0].game_mode,"duel");
  await value(host.client.rpc("reset_arena_room_for_rematch",{target_room_id:id}));
  const reopened=await room(id);
  assert.equal(reopened.mode,"group_lobby");
  assert.equal(reopened.invite_code,original.invite_code);
  assert.equal(reopened.round_number,original.round_number+1);
  assert.equal(await value(join(reopened,third)),id);
  const newSet=await stage(reopened,host);
  assert.match((await activate(host,reopened,newSet,[host,guest])).error?.message||"",/roster changed/);
  const group=await start(reopened,host,[host,guest,third],newSet);
  assert.equal(group.mode,"group_lobby");
  const historyAfter=await value(admin.from("public_profile_recent_results").select("id,game_mode").eq("id",history[0].id).single());
  assert.equal(historyAfter.game_mode,"duel","the same room's next format must not rewrite old results");
  await verifyScoringAndAward(group,host,guest,"first-lobby-win");
});

test("a completed two-player Friends match awards Duel credit", {skip:!configured}, async()=>{
  const host=await player("Scoring host"), opponent=await player("Scoring guest",true);
  const state=await room(await create(host,false));
  await value(join(state,opponent));
  const active=await start(state,host,[host,opponent],await stage(state,host));
  await verifyScoringAndAward(active,host,opponent,"first-1v1-win");
});

test("a third join and two-player start cannot both win the same waiting-room race", {skip:!configured}, async()=>{
  const host=await player("Race host"), opponent=await player("Race ready",true), third=await player("Race third",true);
  const state=await room(await create(host,true));
  await value(join(state,opponent));
  const id=await stage(state,host);
  await ready(state,host);
  await ready(state,opponent);
  const [starting,joining]=await Promise.all([activate(host,state,id,[host,opponent]),join(state,third)]);
  const live=await room(state.id);
  if(starting.error){
    assert.match(starting.error.message,/roster changed/);
    assert.ifError(joining.error);
    assert.equal(live.status,"waiting");
    assert.equal(live.mode,"group_lobby");
  }else{
    assert.match(joining.error?.message||"",/no longer waiting/);
    assert.equal(live.status,"starting");
    assert.equal(live.mode,"duel");
    assert.equal(await value(activate(host,state,id,[host,opponent])),true);
  }
  assert.equal(live.invite_code,state.invite_code);
});

test("Friends reconnect preserves membership and an active Group hands off its departing host", {skip:!configured}, async()=>{
  const host=await player("Original host"), next=await player("Next host"), guest=await player("Reconnect guest",true);
  const waiting=await room(await create(host,true));
  await value(join(waiting,next));
  await value(join(waiting,guest));
  const active=await start(waiting,host,[host,next,guest],await stage(waiting,host));
  const membership=()=>value(guest.client.from("arena_room_players").select("id,presence_status")
    .eq("room_id",waiting.id).eq("user_id",guest.id).single());
  const before=await membership();
  await value(admin.from("arena_room_players").update({presence_status:"reconnecting"}).eq("id",before.id));
  await value(guest.client.rpc("heartbeat_arena_room_presence",{target_room_id:waiting.id}));
  assert.deepEqual(await membership(),{id:before.id,presence_status:"connected"});
  await value(host.client.rpc("leave_arena_room",{target_room_id:waiting.id}));
  const after=await room(waiting.id,guest.client);
  assert.equal(after.host_user_id,next.id);
  assert.equal(after.status,"active");
  assert.equal(after.mode,"group_lobby");
  assert.equal(after.invite_code,waiting.invite_code);
  assert.equal(after.competitive_round_id,active.competitive_round_id);
});

for (const size of [5,10]) test(`public Friends room starts with ${size} and retains its public code`,{skip:!configured},async()=>{
  const host=await player(`Host ${size}`);
  const state=await room(await create(host,false));
  assert.ok(state.invite_code && !state.is_private);
  const lookup=await value(host.client.rpc("get_arena_invite",{target_invite_code:state.invite_code}));
  assert.equal(lookup[0].room_id,state.id);
  const members=[host];
  for(let i=1;i<size-1;i++){
    const guest=await player(`Guest ${i}`,true);
    assert.equal(await value(join(state,guest)),state.id);
    members.push(guest);
  }
  const last=await player("Last",true);
  if(size===10){
    const overflow=await player("Overflow",true);
    const results=await Promise.all([join(state,last),join(state,overflow)]);
    assert.equal(results.filter(r=>!r.error).length,1);
    assert.match(results.find(r=>r.error).error.message,/already full/);
    members.push(results[0].error?overflow:last);
  }else{
    await value(join(state,last));
    members.push(last);
  }
  assert.equal((await room(state.id)).invite_code,state.invite_code);
  await start(state,host,members,await stage(state,host));
});

test("private invitation rejects late joins after a Friends match starts", {skip:!configured}, async()=>{
  const host=await player("Invite host");
  const guest=await player("Invite guest",true);
  const late=await player("Late invite");
  const state=await room(await create(host,true));
  assert.equal(await value(join(state,guest)),state.id);
  await start(state,host,[host,guest],await stage(state,host));
  assert.match((await join(state,late)).error?.message ?? "",/no longer waiting/i);
});

test("the private invite reports expired waiting rooms and rejects guest joins", {skip:!configured}, async()=>{
  const host=await player("Expired host");
  const guest=await player("Expired guest",true);
  const state=await room(await create(host,true));
  await value(admin.from("arena_rooms").update({expires_at:"2000-01-01T00:00:00Z"}).eq("id",state.id));
  const invite=await value(guest.client.rpc("get_arena_invite",{target_invite_code:state.invite_code}));
  assert.ok(Date.parse(invite[0].expires_at)<Date.now());
  assert.match((await join(state,guest)).error?.message ?? "",/expired/i);
});

test("a full private Party room refuses an invitation", {skip:!configured}, async()=>{
  const host=await player("Party host",true);
  const member=await player("Party member");
  const second=await player("Party second member",true);
  const overflow=await player("Party overflow",true);
  const id=await value(host.client.rpc("create_arena_room",{
    room_mode:"party_mode",selected_album_id:albumId,selected_album_name:"Party fixture",
    selected_artist_name:"Test artist",selected_artwork_url:null,requested_max_players:3,
    room_is_private:true,player_display_name:host.label,player_username:null,
  }));
  const state=await room(id);
  assert.equal(await value(join(state,member)),state.id);
  assert.equal(await value(join(state,second)),state.id);
  assert.match((await join(state,overflow)).error?.message ?? "",/full/i);
});

after(async()=>{
  for(const id of userIds.reverse()) await value(admin.auth.admin.deleteUser(id));
});
