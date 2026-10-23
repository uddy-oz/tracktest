import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type ThemeTokens = Record<string, string>;

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDirectory, "../src/index.css"), "utf8");
const semanticLayer = css.slice(css.indexOf("/* Semantic application theme layer */"));

function parseTokens(block: string): ThemeTokens {
  return Object.fromEntries(
    [...block.matchAll(/(--ui-[\w-]+):\s*(#[\da-fA-F]{6})\s*;/g)].map(
      ([, name, value]) => [name, value.toLowerCase()]
    )
  );
}

function getBlock(pattern: RegExp) {
  const match = semanticLayer.match(pattern);
  assert.ok(match, `Missing semantic theme block: ${pattern}`);
  return match[1];
}

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

const darkTokens = parseTokens(getBlock(/:root\s*\{([\s\S]*?)\n\}/));
const lightTokens = {
  ...darkTokens,
  ...parseTokens(
    getBlock(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)
  ),
};

const requiredPairs: Array<[string, string]> = [
  ["--ui-text", "--ui-canvas"],
  ["--ui-text", "--ui-surface"],
  ["--ui-text-secondary", "--ui-surface"],
  ["--ui-text-muted", "--ui-surface"],
  ["--ui-input-text", "--ui-input-bg"],
  ["--ui-input-placeholder", "--ui-input-bg"],
  ["--ui-primary-text", "--ui-primary-bg"],
  ["--ui-secondary-text", "--ui-secondary-bg"],
  ["--ui-danger-text", "--ui-surface"],
  ["--ui-warning-text", "--ui-surface"],
  ["--ui-info-text", "--ui-surface"],
  ["--ui-gold-text", "--ui-gold-surface"],
  ["--ui-silver-text", "--ui-silver-surface"],
  ["--ui-bronze-text", "--ui-bronze-surface"],
  ["--ui-platinum-text", "--ui-platinum-surface"],
  ["--ui-legendary-text", "--ui-legendary-surface"],
  ["--ui-duel-text", "--ui-surface"],
  ["--ui-group-text", "--ui-surface"],
  ["--ui-party-text", "--ui-surface"],
  ["--ui-championship-text", "--ui-surface"],
];

for (const [themeName, tokens] of [
  ["dark", darkTokens],
  ["light", lightTokens],
] as const) {
  test(`${themeName} semantic color pairs meet WCAG AA`, () => {
    for (const [foregroundName, backgroundName] of requiredPairs) {
      const foreground = tokens[foregroundName];
      const background = tokens[backgroundName];
      assert.ok(foreground, `${themeName} is missing ${foregroundName}`);
      assert.ok(background, `${themeName} is missing ${backgroundName}`);

      const ratio = contrast(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${themeName} ${foregroundName} on ${backgroundName} is ${ratio.toFixed(2)}:1`
      );
    }
  });
}

test("light Home badges use semantic text and tier colors", () => {
  assert.match(
    semanticLayer,
    /:root\[data-theme="light"\]\s+\.home-badge-pill strong\s*\{[^}]*color:\s*var\(--ui-text\)/s
  );
  assert.match(
    semanticLayer,
    /:root\[data-theme="light"\]\s+\.home-badge-pill small\s*\{[^}]*color:\s*var\(--badge-accent,\s*var\(--ui-text-secondary\)\)/s
  );
});

test("light multiplayer return controls define every interaction state", () => {
  for (const state of ["", ":hover:not\\(:disabled\\)", ":focus-visible", ":disabled"]) {
    assert.match(
      semanticLayer,
      new RegExp(
        `:root\\[data-theme="light"\\] \\.arena-modal-close${state}[^\\{]*\\{[^}]*color:\\s*var\\(--ui-`,
        "s"
      )
    );
  }
});

test("account badges stay grouped until the mobile menu breakpoint", () => {
  assert.match(
    semanticLayer,
    /\.account-button \.player-identity-badges\s*\{[^}]*flex-wrap:\s*nowrap/s
  );
  assert.match(
    css,
    /@media \(max-width: 940px\)\s*\{[\s\S]*?\.nav-menu-button\s*\{[\s\S]*?display:\s*grid/s
  );
});
