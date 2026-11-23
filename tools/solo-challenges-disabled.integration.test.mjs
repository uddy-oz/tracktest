import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const { LOCAL_URL: url, LOCAL_ANON: anon, LOCAL_SERVICE: service, CHALLENGE_LOCAL_CONTAINER: container } = process.env;
const configured = Boolean(url && anon && service && container);
if (configured) {
  assert.equal(new URL(url).origin, "http://127.0.0.1:54321");
  assert.match(container, /^supabase_db_stanzer-pr2-local-supabase-\d+$/);
}

test("disabling installed challenge functions denies direct API requests", {skip: !configured}, async () => {
  const opts = {auth:{persistSession:false, autoRefreshToken:false}};
  const client = createClient(url, anon, opts);
  const admin = createClient(url, service, opts);
  const {data, error} = await client.auth.signInAnonymously();
  assert.ifError(error);
  const token = data.session.access_token;
  const id = "00000000-0000-4000-8000-000000000000";
  const cases = {
    get_solo_challenge: {p_challenge:id},
    create_solo_challenge: {p_album:{}, p_score:0, p_correct:0, p_questions:[]},
    begin_solo_challenge: {p_challenge:id},
    open_solo_challenge_question: {p_attempt:id,p_index:0},
    reveal_solo_challenge_answer: {p_attempt:id,p_index:0},
  };
  const sql = (input) => execFileSync("docker", ["exec","-i",container,"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"], {input,encoding:"utf8"}).trim();
  const get = "public.get_solo_challenge(uuid)";
  const play = "public.create_solo_challenge(jsonb,integer,integer,jsonb),public.begin_solo_challenge(uuid),public.open_solo_challenge_question(uuid,integer),public.reveal_solo_challenge_answer(uuid,integer)";
  const access = (role, fn) => `has_function_privilege('${role}','${fn}','execute')`;
  let disabled = false;
  try {
    assert.equal(sql(`select ${access("anon",get)};`),"t","Test requires the enabled isolated QA stack");
    sql(readFileSync(new URL("../supabase/operations/disable_solo_challenges.sql", import.meta.url),"utf8"));
    disabled = true;
    for (const key of [anon, token]) {
      for (const [name, args] of Object.entries(cases)) {
        const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
          method:"POST",headers:{apikey:anon,authorization:`Bearer ${key}`,"content-type":"application/json"},
          body:JSON.stringify(args),
        });
        const body = await response.json();
        assert.ok(["42501","PGRST202"].includes(body.code),`${name} was not denied at the API boundary (${response.status}, ${body.code})`);
      }
    }
  } finally {
    // Restore the reviewed grants on this disposable local test stack only.
    if (disabled) sql(`begin; grant execute on function ${get} to anon, authenticated; grant execute on function ${play} to authenticated; notify pgrst,'reload schema'; commit;`);
    const {error:cleanupError} = await admin.auth.admin.deleteUser(data.user.id);
    assert.ifError(cleanupError);
  }
});
