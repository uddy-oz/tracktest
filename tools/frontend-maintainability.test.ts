import assert from "node:assert/strict";
import test from "node:test";
import { getAlbumDisplayTitle } from "../src/lib/albumDisplay.ts";
import { readApplicationCss, readProjectFile } from "./css-test-utils.ts";

test("historical missing album titles get a display-only fallback", () => {
  for (const title of [null, undefined, "", "   ", "\ufffd"]) {
    assert.equal(getAlbumDisplayTitle(title), "Unknown album");
  }
  assert.equal(getAlbumDisplayTitle("After Hours"), "After Hours");
  assert.equal(getAlbumDisplayTitle("?"), "?");
  assert.equal(getAlbumDisplayTitle("? (Deluxe)"), "? (Deluxe)");
});

test("CSS entrypoint preserves the established cascade across focused modules", () => {
  const entrypoint = readProjectFile("src/index.css");
  const imports = [...entrypoint.matchAll(/@import\s+["']([^"']+)["']/g)].map(
    ([, path]) => path
  );

  assert.deepEqual(imports, [
    "./styles/legacy.css",
    "./styles/foundation.css",
    "./styles/gameplay.css",
    "./styles/theme.css",
  ]);

  const css = readApplicationCss();
  const foundationIndex = css.indexOf("/* Apple-inspired shared foundation: Phase 1 */");
  const gameplayIndex = css.indexOf("/* Active gameplay ergonomics and complete theme contrast */");
  const themeIndex = css.indexOf("/* Semantic application theme layer */");

  assert.ok(foundationIndex > -1);
  assert.ok(gameplayIndex > foundationIndex);
  assert.ok(themeIndex > gameplayIndex);
});

test("offscreen catalog artwork uses deferred loading and asynchronous decoding", () => {
  for (const path of [
    "src/Components/AlbumSearch.tsx",
    "src/Components/CatalogDiscovery.tsx",
    "src/Components/ArenaPage.tsx",
  ]) {
    const source = readProjectFile(path);
    assert.match(
      source,
      /loading="lazy"[\s\S]{0,80}decoding="async"/,
      `${path} must defer and asynchronously decode offscreen artwork`
    );
  }
});

test("dashboard progression summaries are memoized by their source stats", () => {
  const home = readProjectFile("src/Components/HomePage.tsx");
  const singlePlayer = readProjectFile("src/Components/SinglePlayerPage.tsx");

  assert.match(home, /featuredBadges[\s\S]*useMemo\([\s\S]*identityBadges, stats/);
  assert.match(singlePlayer, /recentResults[\s\S]*useMemo\([\s\S]*identityBadges, stats/);
});

test("Arena gameplay actions occupy a named grid area instead of covering navigation", () => {
  const css = readProjectFile("src/styles/gameplay.css");
  const actions = css.match(/\.arena-game-modal \.duel-room-actions\s*\{([^}]+)\}/)?.[1];
  assert.ok(actions);
  assert.match(actions, /grid-area:\s*actions/);
  assert.match(actions, /position:\s*static/);
  assert.doesNotMatch(actions, /position:\s*(absolute|fixed)/);
  assert.match(css, /"hero actions"/);
  assert.match(readProjectFile("src/Components/ArenaPage.tsx"), /gameplay-actions" role="group" aria-label="Game controls"/);
});

test("short and zoomed gameplay can scroll without clipping answers", () => {
  const css = readProjectFile("src/styles/gameplay.css");
  const overlay = css.match(/\.arena-mode-overlay\.arena-game-overlay\s*\{([^}]+)\}/)?.[1];
  assert.ok(overlay);
  assert.match(overlay, /inset:\s*var\(--nav-height\) 0 0/);
  assert.match(overlay, /overflow-y:\s*auto/);
  const game = css.match(/\.arena-game-modal \.duel-room-screen\.duel-game-screen\s*\{([^}]+)\}/)?.[1];
  assert.match(game || "", /height:\s*auto/);
  assert.match(game || "", /overflow:\s*visible/);
  assert.match(css, /\.arena-game-modal \.group-live-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.arena-game-modal \.audio-preview-wrapper \.clip-button\s*\{[^}]*position:\s*static/s);
  assert.match(readProjectFile("src/styles/foundation.css"), /body\s*\{\s*min-width:\s*0/);
});

test("mode hover supplies a themed surface and separates pointer and keyboard feedback", () => {
  const css = readProjectFile("src/styles/foundation.css");
  const hover = css.match(/\.arena-mode-card:hover:not\(:disabled\)\s*\{([^}]+)\}/)?.[1];
  assert.match(hover || "", /background:/);
  assert.match(hover || "", /var\(--arena-glass-surface\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.arena-mode-card:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.arena-mode-card/);
});

test("autoplay warning uses actual play rejection and retry invokes the existing gesture unlock", () => {
  const controller = readProjectFile("src/lib/arenaAudioController.ts");
  const arena = readProjectFile("src/Components/ArenaPage.tsx");
  assert.match(controller, /autoplayBlocked:\s*details.name === "NotAllowedError"/);
  assert.match(controller, /if \(details.name === "NotAllowedError"\)\s*\{\s*this.mediaUnlocked = false;/);
  assert.match(controller, /result.status === "failed" && result.autoplayBlocked/);
  assert.match(arena, /playResult.status === "failed" && playResult.autoplayBlocked\s*\? "Your browser blocked/);
  const retry = arena.slice(arena.indexOf('// Invoke the existing unlock directly'));
  assert.match(retry, /unlockFromUserGesture\(\)\.then/);
  assert.match(retry, /activeQuestionRunKeyRef.current !== roundKey/);
  assert.match(retry, /void startDuelAnswerRound\(true\)/);
});
