export function calculateServerClockOffset(
  serverTimestamp: unknown,
  requestStartedAt: number,
  requestFinishedAt: number,
): number | null {
  if (typeof serverTimestamp !== "string") return null;

  const serverTime = Date.parse(serverTimestamp);
  if (!Number.isFinite(serverTime)) return null;

  const requestMidpoint = requestStartedAt + (requestFinishedAt - requestStartedAt) / 2;
  return serverTime - requestMidpoint;
}
