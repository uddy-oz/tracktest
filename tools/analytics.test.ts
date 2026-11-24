import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsArenaMode, analyticsProperties, campaignProperties, captureAnalytics } from "../src/lib/analytics.ts";
import { lookupSharedAlbum } from "../src/lib/spotifyApi.ts";

test("only bounded catalog identifiers, recognized dimensions and valid timings are projected", () => {
  const input = {
    mode: "friends" as const, email: "not-collected@example.test", score: 123,
    room_code: "PRIVATE", current_url: "https://stanzer.app/?from=Private",
    album_id: "itunes:US:10906", artist_id: "110", startup_ms: 1500.4, after_countdown_ms: -1,
  };
  assert.deepEqual(analyticsProperties(input), {mode: "friends", album_id: "itunes:US:10906", artist_id: "110", startup_ms: 1500});
  assert.deepEqual(analyticsProperties({album_id: "not-a-catalog-id", artist_id: "someone", startup_ms: Infinity}), {});
});

test("campaign dimensions cannot echo arbitrary parameter contents", () => {
  assert.deepEqual(analyticsProperties(campaignProperties("?source=score_share&utm_source=reddit&utm_medium=social&utm_campaign=private@example.test&from=Private&score=123")), {
    source: "score_share", medium: "social", campaign: "other",
  });
});

test("arena modes distinguish Party, Friends, and historical modes", () => {
  assert.equal(analyticsArenaMode({mode: "group_lobby", unifiedFriends: true}), "friends");
  assert.equal(analyticsArenaMode({mode: "party_mode", unifiedFriends: true}), "party");
  assert.equal(analyticsArenaMode({mode: "duel"}), "duel");
  assert.equal(analyticsArenaMode({mode: "group_lobby"}), "group");
});

test("default non-browser execution never sends an event", () => {
  assert.doesNotThrow(() => captureAnalytics("visit"));
});

test("exact album lookup only accepts the requested collection from the catalog", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    assert.equal(url.hostname, "itunes.apple.com");
    assert.equal(url.searchParams.get("id"), "3021");
    assert.equal(url.searchParams.get("country"), "CA");
    return Response.json({results: [
      {wrapperType: "collection", collectionId: 7, collectionName: "Some other edition"},
      {wrapperType: "collection", collectionId: 3021, artistId: 12, collectionName: "Correct edition"},
    ]});
  });
  const signal = new AbortController().signal;
  assert.equal(await lookupSharedAlbum("https://untrusted.test", signal), null);
  assert.equal((await lookupSharedAlbum("itunes:CA:3021", signal))?.title, "Correct edition");
  assert.equal(fetch.mock.callCount(), 1);
});
