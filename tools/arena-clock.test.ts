import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateServerClockOffset } from "../src/lib/arenaClock.ts";

test("competitive server clock parses the RPC timestamp and compensates for request latency", () => {
  assert.equal(
    calculateServerClockOffset("2026-10-26T12:00:00.000Z", 1000, 1200),
    Date.parse("2026-10-26T12:00:00.000Z") - 1100,
  );
});

test("competitive server clock rejects non-timestamp RPC responses", () => {
  assert.equal(calculateServerClockOffset(true, 1000, 1200), null);
  assert.equal(calculateServerClockOffset(null, 1000, 1200), null);
  assert.equal(calculateServerClockOffset("not a timestamp", 1000, 1200), null);
});
