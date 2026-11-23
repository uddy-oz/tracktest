import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const { LOCAL_URL: url, LOCAL_ANON: anon, LOCAL_SERVICE: service, CHALLENGE_LOCAL_CONTAINER: container } = process.env;
const configured = Boolean(url && anon && service && container);
if (configured) {
  assert.equal(new URL(url).origin, "http://127.0.0.1:54321");
  assert.match(container, /^supabase_db_stanzer-pr2-local-supabase-\d+$/);
}

const opts = {auth: {persistSession: false, autoRefreshToken: false}};

async function value(request) {
  const {data,error} = await request;
  assert.ifError(error);
  return data;
}

test("private ordered challenge snapshots via genuine guest and registered sessions", {skip: !configured}, async () => {
  const admin = createClient(url, service, opts);
  const publicClient = createClient(url, anon, opts);
  const host = createClient(url, anon, opts);
  const guest = createClient(url, anon, opts);
  const email = `challenge-${randomUUID()}@example.test`;
  const password = randomUUID() + "-A9!";
  const users = [];
  try {
    const {user: registered} = await value(admin.auth.admin.createUser({email,password,email_confirm:true}));
    users.push(registered.id);
    await value(host.auth.signInWithPassword({email,password}));
    const {user: guestUser} = await value(guest.auth.signInAnonymously({options:{data:{guest_name:"QA Challenge Guest"}}}));
    users.push(guestUser.id);
    assert.equal(guestUser.is_anonymous,true);
    const album = {id:"itunes:US:123", title:"Synthetic Album",artist:"Synthetic Artist",year:"2026",imageUrl:""};
    const questions = Array.from({length:5}, (_, i) => ({
      options:[`${i} A`,`${i} B`,`${i} C`,`${i} D`],
      previewUrl:`https://audio-ssl.itunes.apple.com/qa-${i}.m4a`,offset:i/2,correctIndex:i%4,
    }));
    const args = {p_album:album,p_score:3300,p_correct:4,p_questions:questions};
    const challenge = await value(host.rpc("create_solo_challenge",args));
    const invite = await value(publicClient.rpc("get_solo_challenge",{p_challenge:challenge}));
    assert.deepEqual(Object.keys(invite).sort(),["album","correct","expiresAt","id","playerName","questionCount","score"]);
    assert.deepEqual(invite.album,album);
    assert.equal(invite.questionCount,5);
    assert.equal(invite.score,3300);
    for (let i=0;i<4;i++) {
      assert.deepEqual(await value(publicClient.rpc("get_solo_challenge",{p_challenge:challenge})),invite);
    }
    const guestChallenge = await value(guest.rpc("create_solo_challenge",args));
    assert.equal((await value(publicClient.rpc("get_solo_challenge",{p_challenge:guestChallenge}))).playerName,"QA Challenge Guest");
    assert.ok((await publicClient.rpc("create_solo_challenge",args)).error);
    assert.ok((await publicClient.rpc("begin_solo_challenge",{p_challenge:challenge})).error);
    assert.ok((await guest.rpc("create_solo_challenge",{...args,p_score:4001})).error);
    assert.ok((await guest.rpc("create_solo_challenge",{...args,p_questions:[{...questions[0],previewUrl:"https://example.test/clip.m4a"},...questions.slice(1)]})).error);
    assert.ok((await guest.rpc("create_solo_challenge",{...args,p_questions:[{...questions[0],correctIndex:4},...questions.slice(1)]})).error);
    const attempt = await value(guest.rpc("begin_solo_challenge",{p_challenge:challenge}));
    const open = (actor,index) => actor.rpc("open_solo_challenge_question",{p_attempt:attempt,p_index:index});
    const reveal = (actor,index) => actor.rpc("reveal_solo_challenge_answer",{p_attempt:attempt,p_index:index});
    assert.ok((await open(publicClient,0)).error);
    assert.ok((await open(host,0)).error);
    assert.ok((await open(guest,1)).error);
    assert.ok((await reveal(guest,0)).error);
    assert.ok((await reveal(host,0)).error);
    for(let i=0;i<questions.length;i++){
      const {correctIndex,...clip} = questions[i];
      assert.deepEqual(await value(open(guest,i)),clip);
      assert.deepEqual(await value(open(guest,i)),clip);
      await new Promise(resolve=>setTimeout(resolve,2100));
      assert.equal(await value(reveal(guest,i)),correctIndex);
      assert.ok((await reveal(guest,i)).error);
    }
    assert.notEqual(await value(guest.rpc("begin_solo_challenge",{p_challenge:challenge})),attempt);
    assert.ok((await guest.schema("solo_challenge_private").from("challenges").select()).error);
    assert.ok((await guest.schema("solo_challenge_private").from("challenges").update({score:0}).eq("id",challenge)).error);
    assert.deepEqual(await value(publicClient.rpc("get_solo_challenge",{p_challenge:challenge})),invite);
    assert.equal(await value(publicClient.rpc("get_solo_challenge",{p_challenge:randomUUID()})),null);
    assert.match(challenge,/^[0-9a-f-]{36}$/i);
    execFileSync("docker",["exec",container,"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-c",
      `update solo_challenge_private.challenges set expires_at=now()-interval '1 minute' where id='${challenge}'`],{stdio:"ignore"});
    assert.equal(await value(publicClient.rpc("get_solo_challenge",{p_challenge:challenge})),null);
    assert.ok((await guest.rpc("begin_solo_challenge",{p_challenge:challenge})).error);
    assert.ok((await open(guest,0)).error);
    const replacement = await value(host.rpc("create_solo_challenge",args));
    assert.notEqual(replacement,challenge);
    assert.equal((await value(publicClient.rpc("get_solo_challenge",{p_challenge:replacement}))).score,3300);
  } finally {
    for (const id of users) await value(admin.auth.admin.deleteUser(id));
  }
});
