import assert from "node:assert/strict";
import test from "node:test";
import { readApplicationCss, readProjectFile } from "./css-test-utils.ts";

test("competitive navigation uses compact accessible controls", () => {
  const source = readProjectFile("src/Components/Leaderboard.tsx");

  assert.match(source, /aria-label="Leaderboard scope"/);
  assert.match(source, /aria-label="Ranking mode"/);
  assert.match(source, /className="multiplayer-category-select"/);
  assert.match(source, /MULTIPLAYER_LEADERBOARD_CATEGORIES\.map/);
  assert.doesNotMatch(source, /className="multiplayer-category-tabs"/);
  assert.doesNotMatch(source, />\s*Back Home\s*</);
});

test("public profiles collapse secondary records without hiding data", () => {
  const source = readProjectFile("src/Components/ProfilePage.tsx");

  assert.match(source, /profile-secondary-records/);
  assert.match(source, /open=\{!isPublicProfile\}/);
  assert.match(source, /Artist Mastery/);
  assert.match(source, /Best Album Scores/);
  assert.match(source, /Recent Quiz Results/);
});

test("badge cards expose collectible state and accessible detail labels", () => {
  const card = readProjectFile("src/Components/BadgeCard.tsx");
  const popup = readProjectFile("src/Components/BadgeEarnedPopup.tsx");

  assert.match(card, /className="badge-state"/);
  assert.match(card, /Open details/);
  assert.match(popup, /role="status"/);
  assert.match(popup, /aria-atomic="true"/);
});

test("phase three styles include podium, mobile profile, and reduced motion rules", () => {
  const css = readApplicationCss();
  const phaseThree = css.slice(
    css.indexOf("/* Design audit phase 3: competitive experience. */")
  );

  assert.match(phaseThree, /\.rank-first/);
  assert.match(phaseThree, /\.leaderboard-current-user/);
  assert.match(phaseThree, /\.profile-secondary-records/);
  assert.match(phaseThree, /@media \(max-width: 520px\)/);
  assert.match(phaseThree, /@media \(prefers-reduced-motion: reduce\)/);
});
