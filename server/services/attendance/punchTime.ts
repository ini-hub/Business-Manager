/**
 * Decides which clock a punch is timed by.
 *
 * A device timestamp is forgeable and always will be — the phone's clock belongs
 * to the person being measured. The rules below cannot make it trustworthy, only
 * auditable: both times are always kept, the difference is recorded, and a claim
 * the server had to override is flagged for a human.
 */

export type PunchTimeInput = {
  /** What the device said, if anything. */
  clientCapturedAt?: Date | null;
  /** When the request actually reached us. Always known. */
  serverReceivedAt: Date;
  /** True only for a punch replayed from the offline queue. */
  queued?: boolean;
  /** How stale a queued punch may be before its own timestamp is refused. */
  maxAgeMinutes: number;
};

export type PunchTimeResult = {
  effectiveAt: Date;
  timeSource: "client" | "server";
  /** Positive means the device clock was behind the server's. */
  clockSkewSeconds: number | null;
  divergenceFlagged: boolean;
};

export function resolvePunchTime(input: PunchTimeInput): PunchTimeResult {
  const server = input.serverReceivedAt;
  const client = input.clientCapturedAt ?? null;

  const clockSkewSeconds = client
    ? Math.round((server.getTime() - client.getTime()) / 1000)
    : null;

  // An online request never picks its own arrival time. Letting it would make the
  // whole feature decorative: anyone could post 08:55 at half past eleven.
  if (!input.queued || !client) {
    return { effectiveAt: server, timeSource: "server", clockSkewSeconds, divergenceFlagged: false };
  }

  const ageMinutes = (server.getTime() - client.getTime()) / 60_000;

  // Future-dated, or staler than the store accepts. Fall back to the server clock
  // — the conservative answer, since it can only ever make a punch later — and
  // flag it, because the device asked for something it was not given.
  if (ageMinutes < 0 || ageMinutes > input.maxAgeMinutes) {
    return { effectiveAt: server, timeSource: "server", clockSkewSeconds, divergenceFlagged: true };
  }

  // A genuinely offline punch, replayed within the window the store allows.
  return { effectiveAt: client, timeSource: "client", clockSkewSeconds, divergenceFlagged: false };
}
