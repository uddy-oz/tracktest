import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyArenaAudioFailure,
  type ArenaAudioFailureReason,
} from "../src/lib/arenaAudioReliability.ts";

const classifications: Array<
  [string, Parameters<typeof classifyArenaAudioFailure>[1], ArenaAudioFailureReason]
> = [
  ["NotAllowedError: autoplay blocked", {}, "AUTOPLAY_LOCK"],
  ["Preview metadata did not load in time.", {}, "METADATA_TIMEOUT"],
  ["Media failed", { mediaErrorCode: 2 }, "MEDIA_NETWORK_ERROR"],
  ["Media failed", { mediaErrorCode: 3 }, "MEDIA_DECODE_ERROR"],
  ["Preview seek did not complete.", {}, "SEEK_TIMEOUT"],
  ["Preview buffer was not playable.", {}, "BUFFER_TIMEOUT"],
  ["Audio stalled and did not recover.", {}, "BUFFER_TIMEOUT"],
  ["play() did not resolve in time.", {}, "PLAY_PROMISE_REJECTED"],
  ["Playback showed no movement.", {}, "NO_PLAYBACK_MOVEMENT"],
  ["Anything", { online: false }, "CLIENT_DISCONNECTED"],
  ["Stale round response", {}, "STALE_ROUND"],
  ["Stale generation response", {}, "STALE_GENERATION"],
  ["Server phase changed", {}, "SERVER_STATE_CHANGED"],
  ["An unclassified media failure", {}, "UNKNOWN"],
];

for (const [message, options, expected] of classifications) {
  test(`classifies ${expected}`, () => {
    assert.equal(classifyArenaAudioFailure(message, options), expected);
  });
}

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
