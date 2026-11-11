import { describe, expect, it } from "vitest";
import { createLimiter, retryAfterMs, withRetry, type ResponseLike } from "../src/forge/rateLimit";

/** A fake fetch that replays a scripted list of responses and records calls. */
function scripted(statuses: Array<number | { status: number; retryAfter?: string }>) {
  const calls: number[] = [];
  const fetch = async (): Promise<ResponseLike> => {
    const i = Math.min(calls.length, statuses.length - 1);
    calls.push(i);
    const s = statuses[i];
    const status = typeof s === "number" ? s : s.status;
    const retryAfter = typeof s === "number" ? undefined : s.retryAfter;
    return { status, headers: { get: (n) => (n.toLowerCase() === "retry-after" && retryAfter !== undefined ? retryAfter : null) } };
  };
  return { fetch, calls };
}

/** Deterministic clock + sleep: sleeping advances the clock instead of waiting. */
function fakeTime(startMs = 1_700_000_000_000) {
  let now = startMs;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

describe("retryAfterMs", () => {
  it("parses delay-seconds", () => {
    expect(retryAfterMs("7", 0)).toBe(7000);
    expect(retryAfterMs(" 0 ", 0)).toBe(0);
  });
  it("parses an HTTP date relative to now", () => {
    const now = Date.parse("Wed, 11 Nov 2026 21:00:00 GMT");
    expect(retryAfterMs("Wed, 11 Nov 2026 21:00:05 GMT", now)).toBe(5000);
    // A date in the past means "retry now", never a negative wait.
    expect(retryAfterMs("Wed, 11 Nov 2026 20:59:00 GMT", now)).toBe(0);
  });
  it("ignores garbage and missing headers", () => {
    expect(retryAfterMs(null, 0)).toBeUndefined();
    expect(retryAfterMs("soon", 0)).toBeUndefined();
    expect(retryAfterMs("-3", 0)).toBeUndefined();
  });
});

describe("withRetry", () => {
  it("returns a 2xx immediately without sleeping", async () => {
    const t = fakeTime();
    const s = scripted([200]);
    const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now });
    expect(res.status).toBe(200);
    expect(s.calls.length).toBe(1);
    expect(t.sleeps).toEqual([]);
  });

  it("does not retry 404 or 500 — only 429 and 503 signal rate limiting", async () => {
    for (const status of [404, 500, 400]) {
      const t = fakeTime();
      const s = scripted([status, 200]);
      const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now });
      expect(res.status).toBe(status);
      expect(s.calls.length).toBe(1);
    }
  });

  it("honours Retry-After in seconds on a 429", async () => {
    const t = fakeTime();
    const s = scripted([{ status: 429, retryAfter: "2" }, 200]);
    const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now });
    expect(res.status).toBe(200);
    expect(s.calls.length).toBe(2);
    expect(t.sleeps).toEqual([2000]);
  });

  it("honours Retry-After as an HTTP date on a 503", async () => {
    const t = fakeTime(Date.parse("Wed, 11 Nov 2026 21:00:00 GMT"));
    const s = scripted([{ status: 503, retryAfter: "Wed, 11 Nov 2026 21:00:03 GMT" }, 200]);
    const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now });
    expect(res.status).toBe(200);
    expect(t.sleeps).toEqual([3000]);
  });

  it("backs off exponentially with jitter when no Retry-After is given", async () => {
    const t = fakeTime();
    const s = scripted([429, 429, 429, 200]);
    // random() = 0.5 → jitter factor exactly 1.0, so delays are the bare schedule.
    const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now, random: () => 0.5, baseDelayMs: 500 });
    expect(res.status).toBe(200);
    expect(s.calls.length).toBe(4);
    expect(t.sleeps).toEqual([500, 1000, 2000]);
  });

  it("caps the schedule at maxDelayMs and keeps jitter within 0.5x–1.5x of it", async () => {
    for (const r of [0, 1]) {
      const t = fakeTime();
      const s = scripted([429, 429, 429, 429, 429, 200]);
      await withRetry(s.fetch, { sleep: t.sleep, now: t.now, random: () => r, baseDelayMs: 1000, maxDelayMs: 3000, maxAttempts: 6, budgetMs: 60_000 });
      const factor = 0.5 + r;
      expect(t.sleeps).toEqual([1000 * factor, 2000 * factor, 3000 * factor, 3000 * factor, 3000 * factor]);
    }
  });

  it("gives up after maxAttempts and returns the last rate-limited response", async () => {
    const t = fakeTime();
    const s = scripted([429]);
    const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now, random: () => 0.5, maxAttempts: 3 });
    expect(res.status).toBe(429);
    expect(s.calls.length).toBe(3);
    expect(t.sleeps.length).toBe(2);
  });

  it("gives up without sleeping when the server asks to wait longer than the budget allows", async () => {
    const t = fakeTime();
    const s = scripted([{ status: 429, retryAfter: "120" }, 200]);
    const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now, budgetMs: 30_000 });
    expect(res.status).toBe(429);
    expect(s.calls.length).toBe(1);
    expect(t.sleeps).toEqual([]);
  });

  it("counts accumulated waits against the budget", async () => {
    const t = fakeTime();
    const s = scripted([{ status: 429, retryAfter: "8" }, { status: 429, retryAfter: "8" }, 200]);
    const res = await withRetry(s.fetch, { sleep: t.sleep, now: t.now, budgetMs: 10_000 });
    expect(res.status).toBe(429);
    expect(t.sleeps).toEqual([8000]);
  });

  it("reports each retry to onRetry", async () => {
    const t = fakeTime();
    const s = scripted([{ status: 429, retryAfter: "1" }, 503, 200]);
    const seen: Array<{ status: number; attempt: number; delayMs: number }> = [];
    await withRetry(s.fetch, { sleep: t.sleep, now: t.now, random: () => 0.5, onRetry: (i) => seen.push(i) });
    expect(seen).toEqual([
      { status: 429, attempt: 1, delayMs: 1000 },
      { status: 503, attempt: 2, delayMs: 1000 },
    ]);
  });

  it("lets network errors propagate instead of retrying them", async () => {
    const t = fakeTime();
    const boom = async (): Promise<ResponseLike> => {
      throw new Error("ECONNRESET");
    };
    await expect(withRetry(boom, { sleep: t.sleep, now: t.now })).rejects.toThrow("ECONNRESET");
  });
});

describe("createLimiter", () => {
  it("never runs more than maxConcurrent tasks at once and runs them all", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    const task = (i: number) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      done.push(i);
      return i;
    };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => limit(task(i))));
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(done.length).toBe(10);
    expect(peak).toBe(3);
  });

  it("releases the slot when a task throws", async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await limit(async () => "ok")).toBe("ok");
  });

  it("preserves FIFO order for waiting tasks", async () => {
    const limit = createLimiter(1);
    const order: string[] = [];
    const mk = (n: string) => limit(async () => { order.push(n); });
    await Promise.all([mk("a"), mk("b"), mk("c")]);
    expect(order).toEqual(["a", "b", "c"]);
  });
});
