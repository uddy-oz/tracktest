import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { collectHistoryPages, historyCursorFilter } from "../src/lib/historyPagination.ts";
import { dailyResetLabel, parseChallengePeriod } from "../src/lib/challengeClock.ts";

test("keyset history survives small server row caps beyond 1000 rows", async () => {
  const rows = Array.from({ length: 1305 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(1305-i).padStart(12,"0")}`, played_at: "2026-10-29T12:00:00.123456+00:00" }));
  let pages = 0;
  const result = await collectHistoryPages(async cursor => { pages++; return { data: rows.filter(r => !cursor || r.id < cursor.id).slice(0,17), error: null }; });
  assert.equal(result.data?.length,1305); assert.ok(pages>70);
  assert.ok(historyCursorFilter(rows[0]).includes(".123456+00:00"));
});
test("history rejects partial, repeated and invalid cursor results", async () => {
  const r = { id: "00000000-0000-4000-8000-000000000001", played_at: "2026-10-29T12:00:00Z" };
  assert.ok((await collectHistoryPages(async () => ({ data: [r], error: null }))).error);
  assert.ok((await collectHistoryPages(async () => ({ data: null, error: { message: "failed" } }))).error);
  assert.ok((await collectHistoryPages(async () => ({ data: [{...r,id:"malformed"}], error: null }))).error);
  assert.throws(() => historyCursorFilter({...r,id:"inject,(id.gt.1)"}));
});
test("server UTC periods and local reset labels handle DST", () => {
  const period = { version: 1, serverNow: "2026-03-08T12:00:00Z", periodStart: "2026-03-08T00:00:00Z", periodEnd: "2026-03-09T00:00:00Z" };
  assert.ok(parseChallengePeriod(period));
  assert.equal(parseChallengePeriod({...period,periodEnd:"2026-03-09T01:00:00Z"}),null);
  assert.match(dailyResetLabel("2026-03-08T00:00:00Z",true,"America/New_York"),/7:00.*EST/);
  assert.match(dailyResetLabel("2026-03-09T00:00:00Z",true,"America/New_York"),/8:00.*EDT/);
  assert.match(dailyResetLabel(period.periodEnd,false,"UTC"),/Offline estimate/);
});
test("release clock SQL has no experimental Solo or award mutations", () => {
  const clock = readFileSync("supabase/20261102_daily_challenge_clock.sql","utf8");
  assert.ok(!/verified_solo|award_achievement|quiz_results/.test(clock));
});
