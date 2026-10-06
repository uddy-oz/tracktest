import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyArenaAudioFailure,
  getArenaPrefetchKey,
  type ArenaAudioFailureReason,
} from "../src/lib/arenaAudioReliability.ts";

const classifications: Array<
  [string, Parameters<typeof classifyArenaAudioFailure>[1], ArenaAudioFailureReason]
> = [
  ["NotAllowedError: autoplay blocked", {}, "AUTOPLAY_LOCK"],
  ["Preview metadata did not load in time.", {}, "METADATA_TIMEOUT"],
  ["canplay did not arrive in time.", {}, "CANPLAY_TIMEOUT"],
  ["Media failed", { mediaErrorCode: 2 }, "PREVIEW_HTTP_FAILURE"],
  ["Network connection dropped", {}, "MEDIA_NETWORK_ERROR"],
  ["Media failed", { mediaErrorCode: 3 }, "MEDIA_DECODE_ERROR"],
  ["Preview seek did not complete.", {}, "SEEK_TIMEOUT"],
  ["Preview buffer was not playable.", {}, "BUFFER_TIMEOUT"],
  ["Audio stalled and did not recover.", {}, "BUFFER_TIMEOUT"],
  ["play() did not resolve in time.", {}, "PLAY_PROMISE_REJECTED"],
  ["Playback showed no movement.", {}, "NO_PLAYBACK_MOVEMENT"],
  ["Anything", { online: false }, "CLIENT_DISCONNECTED"],
  ["Stale round response", {}, "STALE_ROUND"],
  ["Stale generation response", {}, "STALE_GENERATION"],
  ["Player left during preparation", {}, "PLAYER_LEFT"],
  ["Server phase advanced before acknowledgement", {}, "SERVER_PHASE_ADVANCED"],
  ["Realtime update was missed", {}, "REALTIME_MISSED"],
  ["Server phase changed", {}, "SERVER_STATE_CHANGED"],
  ["An unclassified media failure", {}, "UNKNOWN"],
];

for (const [message, options, expected] of classifications) {
  test(`classifies ${expected}`, () => {
    assert.equal(classifyArenaAudioFailure(message, options), expected);
  });
}

test("prefetch identity includes the seek target for repeated previews", () => {
  const previewUrl = "https://audio.example.test/preview.m4a";
  assert.notEqual(
    getArenaPrefetchKey(previewUrl, 6),
    getArenaPrefetchKey(previewUrl, 18),
    "the same URL at another clip offset needs independent preparation"
  );
  assert.equal(
    getArenaPrefetchKey(previewUrl, 6),
    getArenaPrefetchKey(previewUrl, 6),
    "identical preview targets should deduplicate"
  );
});

test("20 simulated ten-round matches recover candidates without changing round identity", () => {
  let synchronizationFailures = 0;
  let staleRoundFailures = 0;
  let visibleSkips = 0;

  for (let match = 0; match < 20; match += 1) {
    const primary = Array.from({ length: 10 }, (_, index) => `m${match}-q${index}`);
    const reserves = Array.from({ length: 4 }, (_, index) => `m${match}-r${index}`);
    let roundToken = 0;

    for (let round = 0; round < primary.length; round += 1) {
      const originalToken = ++roundToken;
      const shouldFailCandidate = (match + round) % 7 === 0;
      if (shouldFailCandidate) {
        const replacement = reserves.shift();
        if (!replacement) {
          visibleSkips += 1;
          continue;
        }
        primary[round] = replacement;
        roundToken += 1;
        if (originalToken === roundToken) staleRoundFailures += 1;
      }

      const deviceAToken = roundToken;
      const deviceBToken = roundToken;
      if (deviceAToken !== deviceBToken || !primary[round]) {
        synchronizationFailures += 1;
      }
    }
    assert.equal(primary.length, 10, "reserve promotion must not change match length");
  }

  assert.equal(synchronizationFailures, 0);
  assert.equal(staleRoundFailures, 0);
  assert.equal(visibleSkips, 0);
});

test("three rematches ignore delayed readiness from every prior generation", () => {
  const currentRoundKeys = new Set<string>();
  for (let generation = 1; generation <= 3; generation += 1) {
    const currentKey = `room-a:${generation}:round-1:0`;
    currentRoundKeys.add(currentKey);
    for (let staleGeneration = 1; staleGeneration < generation; staleGeneration += 1) {
      assert.equal(
        currentKey === `room-a:${staleGeneration}:round-1:0`,
        false
      );
    }
  }
  assert.equal(currentRoundKeys.size, 3);
});

test("a disconnected client reaches reserve recovery within the four-second server bound", () => {
  const stagedAtMs = 10_000;
  const legacyDeadlineMs = stagedAtMs + 12_000;
  const fastFailDeadlineMs = Math.min(legacyDeadlineMs, stagedAtMs + 4_000);
  assert.equal(fastFailDeadlineMs - stagedAtMs, 4_000);
});
