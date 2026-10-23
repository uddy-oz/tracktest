import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CatalogConfigurationError,
  createAppleMusicCatalogAdapter,
  withCatalogConfigurationFallback,
} from "../src/lib/appleMusicCatalogAdapter.ts";
import { mockCatalogAdapter } from "../src/lib/mockCatalogAdapter.ts";
import {
  createAppleMusicDeveloperToken,
  default as appleMusicHandler,
} from "../api/apple-music-catalog.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Apple catalog adapter is storefront-aware, normalizes metadata, and caches pages", async () => {
  const requests: string[] = [];
  let now = 1_000;
  const adapter = createAppleMusicCatalogAdapter({
    storefront: "gb",
    now: () => now,
    fetcher: async (input) => {
      requests.push(String(input));
      return jsonResponse({
        items: [
          {
            catalogId: {
              provider: "apple_music",
              kind: "artist",
              id: "42",
              storefront: "gb",
            },
            name: "  The Artist  ",
            genres: ["Pop"],
            artwork: { url: "https://example.test/art.jpg", rightsStatus: "restricted" },
            availability: {
              status: "available",
              storefronts: ["gb"],
              gameplayEnabled: false,
            },
            externalUrl: "https://music.apple.com/gb/artist/42",
          },
        ],
        nextCursor: "6",
        total: 12,
      });
    },
  });

  const first = await adapter.searchArtists("The Artist", { limit: 6 });
  const cached = await adapter.searchArtists("The Artist", { limit: 6 });

  assert.equal(requests.length, 1);
  assert.match(requests[0] || "", /storefront=gb/);
  assert.equal(first.items[0]?.name, "The Artist");
  assert.equal(first.items[0]?.availability.gameplayEnabled, false);
  assert.equal(first.nextCursor, "6");
  assert.equal(cached, first);

  now += 5 * 60 * 1000 + 1;
  await adapter.searchArtists("The Artist", { limit: 6 });
  assert.equal(requests.length, 2);
});

test("mock fallback is used only when Apple credentials are not configured", async () => {
  const unconfigured = createAppleMusicCatalogAdapter({
    fetcher: async () =>
      jsonResponse(
        {
          code: "APPLE_MUSIC_NOT_CONFIGURED",
          error: "Not configured",
        },
        503
      ),
  });
  const adapter = withCatalogConfigurationFallback(unconfigured, mockCatalogAdapter);
  const result = await adapter.searchArtists("Wizkid", { limit: 6 });
  assert.equal(result.items[0]?.name, "Wizkid");
  assert.equal(result.items[0]?.catalogId.provider, "stanzer_mock");

  await assert.rejects(
    () => unconfigured.searchArtists("Wizkid"),
    CatalogConfigurationError
  );

  const missingLocalEndpoint = createAppleMusicCatalogAdapter({
    fetcher: async () => jsonResponse({}),
  });
  const localFallback = withCatalogConfigurationFallback(
    missingLocalEndpoint,
    mockCatalogAdapter
  );
  const localResult = await localFallback.searchArtists("Davido", { limit: 6 });
  assert.equal(localResult.items[0]?.name, "Davido");
});

test("server-generated developer token is an ES256 JWT and private credentials stay server-side", () => {
  const previous = {
    team: process.env.APPLE_MUSIC_TEAM_ID,
    key: process.env.APPLE_MUSIC_KEY_ID,
    privateKey: process.env.APPLE_MUSIC_PRIVATE_KEY,
    configuredToken: process.env.APPLE_MUSIC_DEVELOPER_TOKEN,
  };
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });

  try {
    delete process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
    process.env.APPLE_MUSIC_TEAM_ID = "TEAM123456";
    process.env.APPLE_MUSIC_KEY_ID = "KEY1234567";
    process.env.APPLE_MUSIC_PRIVATE_KEY = privateKey.export({
      type: "pkcs8",
      format: "pem",
    }).toString();

    const token = createAppleMusicDeveloperToken(1_700_000_000);
    assert.ok(token);
    const [header, payload, signature] = token.split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "ES256");
    assert.equal(JSON.parse(Buffer.from(payload, "base64url").toString()).iss, "TEAM123456");

    const verifier = createVerify("SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    assert.equal(
      verifier.verify(
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url")
      ),
      true
    );
  } finally {
    if (previous.team === undefined) delete process.env.APPLE_MUSIC_TEAM_ID;
    else process.env.APPLE_MUSIC_TEAM_ID = previous.team;
    if (previous.key === undefined) delete process.env.APPLE_MUSIC_KEY_ID;
    else process.env.APPLE_MUSIC_KEY_ID = previous.key;
    if (previous.privateKey === undefined) delete process.env.APPLE_MUSIC_PRIVATE_KEY;
    else process.env.APPLE_MUSIC_PRIVATE_KEY = previous.privateKey;
    if (previous.configuredToken === undefined) delete process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
    else process.env.APPLE_MUSIC_DEVELOPER_TOKEN = previous.configuredToken;
  }
});

test("catalog server route contains no client token or audio-preview response path", () => {
  const source = readFileSync(
    new URL("../api/apple-music-catalog.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /VITE_APPLE_MUSIC_(?:TEAM|KEY|PRIVATE|TOKEN)/);
  assert.doesNotMatch(source, /\bpreviews?\b/i);
  assert.match(source, /gameplayEnabled:\s*false/);
});

test("unconfigured server route returns a safe 503 without contacting Apple", async () => {
  const keys = [
    "APPLE_MUSIC_DEVELOPER_TOKEN",
    "APPLE_MUSIC_TEAM_ID",
    "APPLE_MUSIC_KEY_ID",
    "APPLE_MUSIC_PRIVATE_KEY",
    "APPLE_MUSIC_PRIVATE_KEY_BASE64",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  const response = {
    statusCode: 0,
    body: null as unknown,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  try {
    await appleMusicHandler({ method: "GET", query: {} }, response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, {
      code: "APPLE_MUSIC_NOT_CONFIGURED",
      error: "Apple Music catalog credentials are not configured.",
    });
  } finally {
    keys.forEach((key) => {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("server proxy sanitizes Apple playlist tracks and never returns preview URLs", async () => {
  const previousToken = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.APPLE_MUSIC_DEVELOPER_TOKEN = "server-secret-token";
  let requestedUrl = "";
  let authorization = "";
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    authorization = String(new Headers(init?.headers).get("Authorization"));
    return jsonResponse({
      data: [
        {
          id: "song-1",
          type: "songs",
          attributes: {
            name: "Real Song",
            artistName: "Real Artist",
            durationInMillis: 201000,
            previews: [{ url: "https://audio.example.test/secret.m4a" }],
            artwork: { url: "https://image/{w}x{h}.{f}" },
          },
        },
      ],
      meta: { total: 1 },
    });
  }) as typeof fetch;
  const response = {
    statusCode: 0,
    body: null as unknown,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  try {
    await appleMusicHandler(
      {
        method: "GET",
        query: {
          action: "playlist-tracks",
          storefront: "gb",
          id: "pl.test",
          limit: "12",
        },
      },
      response
    );
    assert.equal(response.statusCode, 200);
    assert.match(requestedUrl, /\/v1\/catalog\/gb\/playlists\/pl.test\/tracks/);
    assert.equal(authorization, "Bearer server-secret-token");
    assert.equal(JSON.stringify(response.body).includes("secret.m4a"), false);
    assert.deepEqual(
      (response.body as { items: Array<{ name: string; availability: { gameplayEnabled: boolean } }> })
        .items.map((item) => [item.name, item.availability.gameplayEnabled]),
      [["Real Song", false]]
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
    else process.env.APPLE_MUSIC_DEVELOPER_TOKEN = previousToken;
  }
});

