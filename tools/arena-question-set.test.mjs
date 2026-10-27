import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTrustedQuestionSet,
  parseITunesAlbumId,
  playableTracksFromLookup,
} from "../api/arena-question-set.js";

function tracks(count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    id: `itunes-${1000 + index}`,
    name: `Track ${index + 1}`,
    artistName: "Test Artist",
    previewUrl: `https://audio-ssl.itunes.apple.com/preview-${index}.m4a`,
    durationSeconds: 30,
  }));
}

function seededRandom() {
  let state = 123456789;
  return () => {
    state = (state * 1103515245 + 12345) % 0x80000000;
    return state / 0x80000000;
  };
}

function seededUuid() {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

test("question count follows the supported album size rule", () => {
  for (const [count, expected] of [[5, 5], [8, 5], [10, 6], [14, 8], [18, 10], [22, 12], [30, 12]]) {
    const result = buildTrustedQuestionSet({
      tracks: tracks(count), mode: "duel", roundNumber: 1,
      questionSetId: "set", random: seededRandom(), uuid: seededUuid(),
    });
    assert.equal(result.targetQuestionCount, expected);
    assert.equal(result.questions.length, expected);
    assert.ok(result.reserveQuestions.length <= 4);
  }
});

test("public snapshots contain no answer or catalog identity and use opaque option ids", () => {
  const result = buildTrustedQuestionSet({
    tracks: tracks(), mode: "group_lobby", roundNumber: 2,
    questionSetId: "set", random: seededRandom(), uuid: seededUuid(),
  });
  const publicJson = JSON.stringify([...result.questions, ...result.reserveQuestions]);
  assert.doesNotMatch(publicJson, /correctAnswer|correctOptionId|correctTrack|previewUrl|itunes-\d+/i);
  for (const question of [...result.questions, ...result.reserveQuestions]) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map(({ id }) => id)).size, 4);
    assert.ok(question.options.every(({ id }) => !/^itunes-/.test(id)));
    const key = result.keys.find(({ questionId }) => questionId === question.questionId);
    assert.ok(question.options.some(({ id, name }) => id === key.correctOptionId && name === key.correctAnswer));
    assert.ok(question.clipStartSeconds >= 6 && question.clipStartSeconds <= 22);
  }
  assert.equal(result.questions.length, result.targetQuestionCount);
  assert.ok(result.keys.every(({ previewUrl }) => previewUrl.startsWith("https://audio-ssl.itunes.apple.com/")));
});

test("Party question sets do not include competitive reserve rounds", () => {
  const result = buildTrustedQuestionSet({
    tracks: tracks(12), mode: "party_mode", roundNumber: 1,
    questionSetId: "set", random: seededRandom(), uuid: seededUuid(),
  });
  assert.equal(result.reserveQuestions.length, 0);
});

test("catalog lookup verifies album identity, deduplicates, and rejects unsafe or incomplete previews", () => {
  const results = [
    { wrapperType: "collection", collectionId: 42 },
    { wrapperType: "track", trackId: 9, trackName: "  Track <b>One</b> ", artistName: " Artist ", previewUrl: "https://audio-ssl.itunes.apple.com/a.m4a" },
    { wrapperType: "track", trackId: 9, trackName: "Duplicate", previewUrl: "https://audio-ssl.itunes.apple.com/b.m4a" },
    { wrapperType: "track", trackId: 10, trackName: "Unsafe", previewUrl: "http://audio-ssl.itunes.apple.com/a.m4a" },
    { wrapperType: "track", trackId: 11, trackName: "No preview", previewUrl: "" },
    { wrapperType: "track", trackId: 12, trackName: "" , previewUrl: "https://audio-ssl.itunes.apple.com/a.m4a" },
  ];
  const result = playableTracksFromLookup(results, "42");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Track One");
  assert.equal(result[0].artistName, "Artist");
  assert.throws(() => playableTracksFromLookup(results, "43"), /could not be verified/);
});

test("album identifier parsing is storefront-aware and rejects malformed identifiers", () => {
  assert.deepEqual(parseITunesAlbumId("itunes:gb:12345"), { country: "gb", collectionId: "12345" });
  assert.deepEqual(parseITunesAlbumId("12345"), { country: "us", collectionId: "12345" });
  assert.throws(() => parseITunesAlbumId("https://example.com/12345"), /identifier is invalid/);
});
