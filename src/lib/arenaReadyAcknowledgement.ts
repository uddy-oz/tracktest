export type ArenaReadyAckResult = {
  accepted: boolean;
  alreadyReady?: boolean;
  reason?: string | null;
  readyCountBefore?: number;
  readyCount?: number;
  requiredCount?: number;
  roundNumber?: number;
  matchGeneration?: number;
  roundKey?: string;
  serverPhase?: string;
  membershipId?: string | null;
  acknowledgementExisted?: boolean;
};

export type ArenaReadyAckResponse = {
  result: ArenaReadyAckResult | null;
  error: string | null;
  errorCode?: string | null;
};

export type ArenaReadyAckAttempt = {
  attemptNumber: number;
  delayMs: number;
};

export type ArenaReadyAckRetryResult = ArenaReadyAckResponse & {
  attempts: number;
};

const DEFAULT_ACK_DELAYS_MS = [0, 150, 400, 900] as const;

function wait(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

export async function acknowledgeArenaReadyWithRetry({
  acknowledge,
  isCurrent,
  onAttempt,
  delaysMs = DEFAULT_ACK_DELAYS_MS,
  waitForDelay = wait,
}: {
  acknowledge: (attemptNumber: number) => Promise<ArenaReadyAckResponse>;
  isCurrent: () => boolean;
  onAttempt?: (attempt: ArenaReadyAckAttempt) => void;
  delaysMs?: readonly number[];
  waitForDelay?: (delayMs: number) => Promise<void>;
}): Promise<ArenaReadyAckRetryResult> {
  let lastResponse: ArenaReadyAckResponse = {
    result: null,
    error: "Audio readiness acknowledgement did not run.",
  };

  for (let index = 0; index < delaysMs.length; index += 1) {
    if (!isCurrent()) {
      return {
        result: null,
        error: "stale_round",
        errorCode: "STALE_ROUND",
        attempts: index,
      };
    }

    const delayMs = delaysMs[index];
    if (delayMs > 0) await waitForDelay(delayMs);
    if (!isCurrent()) {
      return {
        result: null,
        error: "stale_round",
        errorCode: "STALE_ROUND",
        attempts: index,
      };
    }

    const attemptNumber = index + 1;
    onAttempt?.({ attemptNumber, delayMs });
    lastResponse = await acknowledge(attemptNumber);

    if (lastResponse.result?.accepted) {
      return { ...lastResponse, attempts: attemptNumber };
    }

    // Structured server rejections are authoritative. Network/PostgREST
    // errors are retryable because a lost response may follow a committed ACK.
    if (!lastResponse.error && lastResponse.result) {
      return { ...lastResponse, attempts: attemptNumber };
    }
  }

  return { ...lastResponse, attempts: delaysMs.length };
}
