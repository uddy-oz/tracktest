import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "@supabase/supabase-js";
import {
  FRIENDLY_GUEST_NAMES,
  createGuestName,
  createGuestRoomHandle,
  getFallbackGuestName,
  getGuestId,
  getGuestIdFromRoomHandle,
  getGuestName,
  getSafeGuestDisplayName,
  isInternalGuestId,
  resolveUniqueGuestName,
} from "../src/lib/authIdentity.ts";

function anonymousUser(metadata: Record<string, unknown>) {
  return {
    id: "anonymous-user-id",
    is_anonymous: true,
    app_metadata: { provider: "anonymous" },
    user_metadata: metadata,
  } as User;
}

test("friendly guest generation uses the approved first-name pool", () => {
  const excludedNames = FRIENDLY_GUEST_NAMES.slice(0, -1);
  const generatedName = createGuestName(excludedNames);

  assert.equal(generatedName, FRIENDLY_GUEST_NAMES.at(-1));
  assert.ok(!isInternalGuestId(generatedName));
});

test("friendly metadata remains stable for the lifetime of an anonymous identity", () => {
  const user = anonymousUser({
    guest_id: "guest_123456",
    guest_name: "Maya",
    display_name: "Maya",
  });

  assert.equal(getGuestId(user), "guest_123456");
  assert.equal(getGuestName(user), "Maya");
  assert.equal(getGuestName(user), "Maya");
});

test("legacy guest handles receive a deterministic friendly fallback", () => {
  const user = anonymousUser({ guest_name: "guest_654321" });
  const expectedName = getFallbackGuestName("guest_654321");

  assert.equal(getGuestId(user), "guest_654321");
  assert.equal(getGuestName(user), expectedName);
  assert.equal(getSafeGuestDisplayName("guest_654321", "guest_654321"), expectedName);
});

test("two guests with the same preferred name are unique inside a lobby", () => {
  const hostName = resolveUniqueGuestName("Johnny", [], "guest_111111");
  const joinedName = resolveUniqueGuestName(
    "Johnny",
    [hostName],
    "guest_222222"
  );

  assert.equal(hostName, "Johnny");
  assert.notEqual(joinedName, hostName);
  assert.equal(
    resolveUniqueGuestName("Johnny", [hostName], "guest_222222"),
    joinedName
  );
});

test("registered display names are respected while resolving guest collisions", () => {
  const guestName = resolveUniqueGuestName(
    "Daniel",
    ["Daniel", "Maya", "Sophie"],
    "guest_333333"
  );

  assert.ok(!["daniel", "maya", "sophie"].includes(guestName.toLowerCase()));
  assert.equal(
    getSafeGuestDisplayName("Uddy The Creator", "guest_333333"),
    "Uddy The Creator"
  );
});

test("reconnects, rematches, and host departure preserve the assigned guest name", () => {
  const guestId = "guest_444444";
  const assignedName = resolveUniqueGuestName(
    "Olivia",
    ["Olivia"],
    guestId
  );

  assert.equal(
    resolveUniqueGuestName(assignedName, ["Olivia"], guestId),
    assignedName
  );
  assert.equal(resolveUniqueGuestName(assignedName, [], guestId), assignedName);
});

test("internal guest handles are recognized narrowly and never used as display text", () => {
  const roomHandle = createGuestRoomHandle("guest_000042");

  assert.equal(isInternalGuestId("guest_000042"), true);
  assert.equal(isInternalGuestId("guest_player"), false);
  assert.equal(isInternalGuestId("Johnny"), false);
  assert.equal(getGuestIdFromRoomHandle(roomHandle), "guest_000042");
  assert.equal(getGuestIdFromRoomHandle("guest_000042"), null);
  assert.notEqual(
    getSafeGuestDisplayName(null, "guest_000042"),
    "guest_000042"
  );
});
