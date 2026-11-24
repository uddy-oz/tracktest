import assert from "node:assert/strict";
import { test } from "node:test";
import { formatScoreCardText, readScoreInvite, scoreShareLink } from "../src/lib/scoreCard.ts";

test("a score invitation opens Solo discovery, not a replay", () => {
  const link = new URL(scoreShareLink({
    mode: "Solo", album: "Loseyi Professor", artist: "Asake", score: 1250,
    unit: "points", playerName: "Uddy",
  }));
  assert.equal(link.origin + link.pathname, "https://stanzer.app/play");
  assert.deepEqual(readScoreInvite(link.search), {
    album: "Loseyi Professor", title: "Uddy challenged you", score: "1,250", unit: "points",
  });
  assert.equal(formatScoreCardText({
    mode: "Solo", album: "Give or Take", artist: "GIVĒON", score: 1250, unit: "points",
  }), "I scored 1,250 points on Give or Take by GIVĒON in StanZer Solo.");
});

test("guest and long album links round trip without adding extra parameters", () => {
  const album = "Échos & Réponses? # ".repeat(11).trim();
  const link = new URL(scoreShareLink({mode: "Duel", album, artist: "Artist", score: 2, unit: "round points"}));
  assert.deepEqual(readScoreInvite(link.search), {
    album, title: "Guest Player challenged you", score: "2", unit: "round points",
  });
  assert.equal(readScoreInvite("?album=Test&score=NaN&from=Demo")?.score, null);
});

test("multiplayer invitations retain the displayed scoring unit", () => {
  assert.match(formatScoreCardText({
    mode: "Play With Friends", album: "Example", artist: "Example Artist", score: 3, unit: "round points",
  }), /3 round points/);
});
