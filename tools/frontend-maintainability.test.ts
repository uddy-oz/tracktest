import assert from "node:assert/strict";
import test from "node:test";
import { readApplicationCss, readProjectFile } from "./css-test-utils.ts";

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
