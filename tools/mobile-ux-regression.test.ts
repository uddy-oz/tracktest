import assert from "node:assert/strict";
import test from "node:test";
import { readApplicationCss, readProjectFile } from "./css-test-utils.ts";

test("Home presents one clear pair of game-mode actions", () => {
  const source = readProjectFile("src/Components/HomePage.tsx");

  assert.equal(source.match(/Start Single Player/g)?.length, 1);
  assert.equal(source.match(/Enter Multiplayer/g)?.length, 1);
  assert.doesNotMatch(source, /home-mode-grid/);
});

test("Multiplayer exposes invite joining before room creation modes", () => {
  const source = readProjectFile("src/Components/ArenaPage.tsx");
  const joinIndex = source.lastIndexOf('className="arena-code-entry"');
  const modeIndex = source.lastIndexOf('className="arena-mode-grid"');

  assert.ok(joinIndex > -1);
  assert.ok(modeIndex > -1);
  assert.ok(joinIndex < modeIndex);
  assert.match(source, /Have an invite\?/);
  assert.match(source, /Create a room/);
});

test("mobile layout prioritizes search and keeps room modes compact", () => {
  const css = readApplicationCss();
  const phaseTwo = css.slice(
    css.indexOf("/* Design audit phase 2: mobile-first discovery")
  );

  assert.match(phaseTwo, /\.single-player-search-panel[\s\S]*order:\s*2/);
  assert.match(phaseTwo, /\.single-player-card[\s\S]*order:\s*3/);
  assert.match(
    phaseTwo,
    /\.arena-mode-grid[\s\S]*grid-template-columns:\s*repeat\(2,/
  );
  assert.match(
    phaseTwo,
    /\.nav-links[\s\S]*grid-template-columns:\s*repeat\(2,/
  );
});

test("mobile navigation identifies the current page and supports Escape", () => {
  const source = readProjectFile("src/Components/Navbar.tsx");

  assert.match(source, /aria-current=/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /menuButtonRef\.current\?\.focus\(\)/);
});
