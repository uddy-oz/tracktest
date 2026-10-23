import assert from "node:assert/strict";
import test from "node:test";
import { getTrappedFocusIndex } from "../src/lib/dialogAccessibility.ts";
import { readApplicationCss, readProjectFile } from "./css-test-utils.ts";

test("dialog focus wraps in both directions", () => {
  assert.equal(getTrappedFocusIndex(-1, 3, "forward"), 0);
  assert.equal(getTrappedFocusIndex(0, 3, "forward"), 1);
  assert.equal(getTrappedFocusIndex(2, 3, "forward"), 0);
  assert.equal(getTrappedFocusIndex(-1, 3, "backward"), 2);
  assert.equal(getTrappedFocusIndex(0, 3, "backward"), 2);
  assert.equal(getTrappedFocusIndex(2, 3, "backward"), 1);
  assert.equal(getTrappedFocusIndex(0, 0, "forward"), -1);
});

test("all custom dialog owners use the shared accessibility behavior", () => {
  for (const path of [
    "src/Components/GuestNameModal.tsx",
    "src/Components/AuthPage.tsx",
    "src/Components/Leaderboard.tsx",
    "src/Components/ProfilePage.tsx",
    "src/Components/ArenaPage.tsx",
  ]) {
    assert.match(
      readProjectFile(path),
      /useAccessibleDialog/,
      `${path} must use the shared dialog behavior`
    );
  }
});

test("mobile gameplay statistics use bounded grids without horizontal scrolling", () => {
  const css = readApplicationCss();
  const auditLayer = css.slice(
    css.indexOf("/* Design audit phase 1: accessible mode text")
  );

  assert.match(
    auditLayer,
    /\.quiz-live \.quiz-status[\s\S]*grid-template-columns:\s*repeat\(4,/
  );
  assert.match(
    auditLayer,
    /@media \(max-width: 520px\)[\s\S]*\.quiz-live \.quiz-status[\s\S]*repeat\(2,/
  );
  assert.match(
    auditLayer,
    /\.arena-game-modal \.quiz-status[\s\S]*repeat\(3,/
  );
  assert.doesNotMatch(auditLayer, /overflow-x:\s*(auto|scroll)/);
});

test("countdown and answer sizing remain prominent after the stats fix", () => {
  const css = readApplicationCss();
  const countdownLayer = css.slice(css.indexOf("/* Active gameplay countdown sizing */"));

  assert.match(countdownLayer, /width:\s*clamp\(120px,\s*14vh,\s*140px\)/);
  assert.match(countdownLayer, /width:\s*clamp\(104px,\s*14vh,\s*122px\)/);
  assert.match(css, /min-height:\s*clamp\(60px,\s*8vh,\s*76px\)/);
});
