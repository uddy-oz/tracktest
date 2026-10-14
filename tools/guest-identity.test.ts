import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "@supabase/supabase-js";
import {
  createGuestRoomHandle,
  getFallbackGuestName,
  getGuestId,
  getGuestIdFromRoomHandle,
  getGuestName,
  getSafeGuestDisplayName,
  isInternalGuestId,
  normalizeGuestDisplayName,
  resolveUniqueGuestName,
  validateGuestDisplayName,
} from "../src/lib/authIdentity.ts";

function anonymousUser(metadata: Record<string, unknown>) {
  return {
    id: "anonymous-user-id",
    is_anonymous: true,
    app_metadata: { provider: "anonymous" },
    user_metadata: metadata,
  } as User;
}

test("guest names are player supplied, normalized, and validated", () => {
  assert.equal(normalizeGuestDisplayName("  Michael   Jordan  "), "Michael Jordan");
  assert.deepEqual(validateGuestDisplayName(" Michael "), {
    ok: true,
    error: "",
    value: "Michael",
  });
  assert.equal(validateGuestDisplayName("<script>").ok, false);
  assert.equal(validateGuestDisplayName("guest_123456").ok, false);
  assert.equal(validateGuestDisplayName("StanZer").ok, false);
  assert.equal(validateGuestDisplayName("a".repeat(25)).ok, false);
});

test("custom metadata remains stable for the lifetime of an anonymous identity", () => {
  const user = anonymousUser({
    guest_id: "guest_123456",
    guest_name: "Michael",
    guest_name_source: "player",
    display_name: "Michael",
  });

  assert.equal(getGuestId(user), "guest_123456");
  assert.equal(getGuestName(user), "Michael");
  assert.equal(getGuestName(user), "Michael");
});

test("legacy guest handles never become visible display names", () => {
  const user = anonymousUser({ guest_name: "guest_654321" });

  assert.equal(getGuestId(user), "guest_654321");
  assert.equal(getGuestName(user), null);
  assert.equal(getSafeGuestDisplayName("guest_654321"), "Guest Player");
  assert.equal(getFallbackGuestName(), "Guest Player");
});

test("legacy generated names require player confirmation", () => {
  const legacyUser = anonymousUser({
    guest_id: "guest_111222",
    guest_name: "Maya",
    display_name: "Maya",
  });

  assert.equal(getGuestName(legacyUser), null);
});

test("two guests with the same preferred name are unique inside a lobby", () => {
  const hostName = resolveUniqueGuestName("Michael", []);
  const joinedName = resolveUniqueGuestName(
    "Michael",
    [hostName]
  );

  assert.equal(hostName, "Michael");
  assert.equal(joinedName, "Michael 2");
  assert.equal(
    resolveUniqueGuestName("Michael", [hostName]),
    joinedName
  );
});

test("registered display names are respected while resolving guest collisions", () => {
  const guestName = resolveUniqueGuestName(
    "Daniel",
    ["Daniel", "Maya", "Sophie"]
  );

  assert.equal(guestName, "Daniel 2");
  assert.equal(
    getSafeGuestDisplayName("Uddy The Creator"),
    "Uddy The Creator"
  );
});

test("reconnects, rematches, and host departure preserve the assigned guest name", () => {
  const assignedName = resolveUniqueGuestName(
    "Olivia",
    ["Olivia"]
  );

  assert.equal(
    resolveUniqueGuestName(assignedName, ["Olivia"]),
    assignedName
  );
  assert.equal(resolveUniqueGuestName(assignedName, []), assignedName);
});

test("internal guest handles are recognized narrowly and never used as display text", () => {
  const roomHandle = createGuestRoomHandle("guest_000042");

  assert.equal(isInternalGuestId("guest_000042"), true);
  assert.equal(isInternalGuestId("guest_player"), false);
  assert.equal(isInternalGuestId("Johnny"), false);
  assert.equal(getGuestIdFromRoomHandle(roomHandle), "guest_000042");
  assert.equal(getGuestIdFromRoomHandle("guest_000042"), null);
  assert.equal(getSafeGuestDisplayName(null), "Guest Player");
});
