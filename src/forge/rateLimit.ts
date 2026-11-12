/**
 * Rate-limit handling for Atlassian REST calls: retry on 429/503 honouring `Retry-After`,
 * exponential backoff with jitter otherwise, and a concurrency cap so one batch never
 * fires more than a handful of requests at once.
 *
 * Pure — no `@forge/*` imports — so it is unit-tested with a fake fetch and a fake clock.
 * The Forge wiring lives in `./http.ts`.
 *
 * Policy, deliberately conservative:
 * - Only 429 and 503 are retried. Atlassian documents both as rate-limit signals.
 *   4xx/5xx of other kinds return as they are; callers already treat them as "unknown, don't flag".
 * - After the retries are exhausted the last response is returned, not thrown, so a long
 *   rate-limit episode degrades to "no finding" rather than a crashed batch.
 * - A total wait budget bounds the time one request can spend sleeping, because the Forge
 *   function running the batch has its own timeout (verify the real value in T06).
 */

export interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
}

export interface RetryOptions {
  /** Total attempts including the first. Default 4. */
  maxAttempts?: number;
  /** First backoff delay when the server gives no `Retry-After`. Default 500 ms. */
  baseDelayMs?: number;
  /** Cap for a single computed backoff delay (before jitter). Default 10 s. */
  maxDelayMs?: number;
  /** Total time one request may spend waiting across all retries. Default 30 s. */
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Source of jitter in [0, 1). Injected for tests. */
  random?: () => number;
  onRetry?: (info: { status: number; attempt: number; delayMs: number }) => void;
}

export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export const DEFAULTS = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  budgetMs: 30_000,
} as const;

/** Parse a `Retry-After` header (delay-seconds or HTTP-date) into milliseconds to wait. */
export function retryAfterMs(header: string | null | undefined, nowMs: number): number | undefined {
  if (!header) return undefined;
  const s = header.trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  // HTTP-date always carries a month name; without letters `Date.parse` would read "-3" as a year.
  if (!/[A-Za-z]/.test(s)) return undefined;
  const at = Date.parse(s);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - nowMs);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `request` until it returns a non-rate-limited response or the retry policy is exhausted.
 * Network errors (rejections) are not retried; they propagate to the caller.
 */
export async function withRetry<R extends ResponseLike>(request: () => Promise<R>, opts: RetryOptions = {}): Promise<R> {
  const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const budgetMs = opts.budgetMs ?? DEFAULTS.budgetMs;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;

  let waitedMs = 0;
  for (let attempt = 1; ; attempt += 1) {
    const res = await request();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxAttempts) return res;

    const hinted = retryAfterMs(res.headers.get("retry-after"), now());
    // Exponential schedule capped at maxDelayMs, then jittered to 0.5x–1.5x so parallel
    // batches hitting the same limit do not retry in lockstep.
    const scheduled = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * (0.5 + random());
    const delayMs = hinted ?? scheduled;
    if (waitedMs + delayMs > budgetMs) return res;

    opts.onRetry?.({ status: res.status, attempt, delayMs });
    await sleep(delayMs);
    waitedMs += delayMs;
  }
}

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** A FIFO semaphore: at most `maxConcurrent` tasks run at once; the rest queue. */
export function createLimiter(maxConcurrent: number): Limiter {
  if (!(maxConcurrent >= 1)) throw new Error(`createLimiter: maxConcurrent must be >= 1, got ${maxConcurrent}`);
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) await new Promise<void>((resume) => waiting.push(resume));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
