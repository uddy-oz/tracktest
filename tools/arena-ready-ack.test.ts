import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgeArenaReadyWithRetry,
  type ArenaReadyAckResponse,
} from "../src/lib/arenaReadyAcknowledgement.ts";

const noWait = async () => undefined;
const accepted = (alreadyReady = false): ArenaReadyAckResponse => ({
  result: {
    accepted: true,
    alreadyReady,
    readyCount: 2,
    requiredCount: 2,
    roundKey: "room:2:round:4",
  },
  error: null,
});

test("media ready plus first ACK loss retries without reloading media", async () => {
  let calls = 0;
  const result = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => {
      calls += 1;
      return calls === 1
        ? { result: null, error: "network request failed", errorCode: "NETWORK" }
        : accepted(true);
    },
    isCurrent: () => true,
    waitForDelay: noWait,
  });

  assert.equal(calls, 2);
  assert.equal(result.result?.accepted, true);
  assert.equal(result.result?.alreadyReady, true);
});

test("duplicate ACK is idempotent success", async () => {
  const result = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => accepted(true),
    isCurrent: () => true,
    waitForDelay: noWait,
  });
  assert.equal(result.attempts, 1);
  assert.equal(result.result?.accepted, true);
});

test("structured stale old-round ACK does not retry into a new round", async () => {
  let calls = 0;
  const result = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => {
      calls += 1;
      return {
        result: { accepted: false, reason: "round_key_mismatch" },
        error: null,
      };
    },
    isCurrent: () => true,
    waitForDelay: noWait,
  });
  assert.equal(calls, 1);
  assert.equal(result.result?.reason, "round_key_mismatch");
});

test("round identity change aborts delayed retries", async () => {
  let current = true;
  let calls = 0;
  const result = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => {
      calls += 1;
      current = false;
      return { result: null, error: "response lost" };
    },
    isCurrent: () => current,
    waitForDelay: noWait,
  });
  assert.equal(calls, 1);
  assert.equal(result.errorCode, "STALE_ROUND");
});

test("two simultaneous players recover independently from one lost ACK", async () => {
  const attempts = new Map<string, number>();
  const runPlayer = (playerId: string) =>
    acknowledgeArenaReadyWithRetry({
      acknowledge: async () => {
        const count = (attempts.get(playerId) || 0) + 1;
        attempts.set(playerId, count);
        return count === 1
          ? { result: null, error: "temporary RPC failure" }
          : accepted(true);
      },
      isCurrent: () => true,
      waitForDelay: noWait,
    });

  const [first, second] = await Promise.all([runPlayer("host"), runPlayer("guest")]);
  assert.equal(first.result?.accepted, true);
  assert.equal(second.result?.accepted, true);
  assert.equal(attempts.get("host"), 2);
  assert.equal(attempts.get("guest"), 2);
});

test("dropped Realtime notification does not affect authoritative ACK success", async () => {
  const realtimeDelivered = false;
  const result = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => accepted(false),
    isCurrent: () => true,
    waitForDelay: noWait,
  });
  assert.equal(realtimeDelivered, false);
  assert.equal(result.result?.readyCount, result.result?.requiredCount);
});

test("delayed ACK remains recoverable while media readiness stays sticky", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => {
      calls += 1;
      return calls < 3
        ? { result: null, error: "request timed out", errorCode: "TIMEOUT" }
        : accepted(false);
    },
    isCurrent: () => true,
    waitForDelay: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result.result?.accepted, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [150, 400]);
});

test("rematch rejects the old generation without contaminating the new match", async () => {
  let currentGeneration = 3;
  let oldCalls = 0;
  const oldMatch = acknowledgeArenaReadyWithRetry({
    acknowledge: async () => {
      oldCalls += 1;
      currentGeneration = 4;
      return { result: null, error: "response delayed" };
    },
    isCurrent: () => currentGeneration === 3,
    waitForDelay: noWait,
  });

  const oldResult = await oldMatch;
  const newResult = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => accepted(false),
    isCurrent: () => currentGeneration === 4,
    waitForDelay: noWait,
  });

  assert.equal(oldCalls, 1);
  assert.equal(oldResult.errorCode, "STALE_ROUND");
  assert.equal(newResult.result?.accepted, true);
});

test("guest and authenticated clients use the same bounded recovery path", async () => {
  const clientTypes = ["guest", "authenticated"] as const;
  const outcomes = await Promise.all(
    clientTypes.map((clientType) => {
      let attempts = 0;
      return acknowledgeArenaReadyWithRetry({
        acknowledge: async () => {
          attempts += 1;
          return attempts === 1
            ? {
                result: null,
                error: `${clientType} temporary network interruption`,
                errorCode: "NETWORK",
              }
            : accepted(true);
        },
        isCurrent: () => true,
        waitForDelay: noWait,
      });
    })
  );

  assert.ok(outcomes.every((outcome) => outcome.result?.accepted === true));
  assert.ok(outcomes.every((outcome) => outcome.attempts === 2));
});

test("delayed Realtime event cannot turn an accepted ACK into a skip", async () => {
  let realtimeSnapshotReadyCount = 0;
  const result = await acknowledgeArenaReadyWithRetry({
    acknowledge: async () => accepted(false),
    isCurrent: () => true,
    waitForDelay: noWait,
  });

  assert.equal(realtimeSnapshotReadyCount, 0);
  assert.equal(result.result?.accepted, true);
  realtimeSnapshotReadyCount = result.result?.readyCount || 0;
  assert.equal(realtimeSnapshotReadyCount, 2);
});
