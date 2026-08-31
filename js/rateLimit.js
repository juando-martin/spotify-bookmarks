// Copyright (c) 2026 Juan D. Martin
// The 429 back-off state machine, split out of spotifyApi.js so it can be
// unit-tested with an injected clock and a fake storage (see
// test/rateLimit.test.js). This is the code that turned a brief rate limit
// into a multi-day lockout when it was wrong, so it earns its tests.
//
// Behaviour:
//  - a 429 sets a deadline; every request short-circuits until it passes,
//    so the app goes silent instead of hammering a limited API;
//  - the wait honours Retry-After in full and doubles on each repeat 429
//    (see rateLimitWaitSeconds in format.js);
//  - the deadline is persisted so a reload / service-worker update still
//    waits it out, and re-read on every check so a 429 in one tab pauses
//    the others;
//  - a deadline recovered from storage is trusted for at most an hour, so a
//    stale far-future value can't strand the app forever.

import { rateLimitWaitSeconds } from "./format.js";

const KEY = "myspot:rl";
const OLD_KEY = "myspot:rateLimitedUntil"; // pre-v42 — drop any stale value
const PERSISTED_MAX_MS = 3_600_000;
// The streak only resets after this long with no 429 at all: one endpoint
// being limited while others answer must not let those 200s reset the
// escalation on every poll.
const CALM_MS = 5 * 60_000;

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]      - clock, defaults to Date.now
 * @param {Storage}      [opts.storage]  - defaults to globalThis.localStorage
 */
const USE_DEFAULT_STORAGE = Symbol("default-storage");

export function createRateLimiter({ now = () => Date.now(), storage = USE_DEFAULT_STORAGE } = {}) {
  const store =
    storage === USE_DEFAULT_STORAGE
      ? (typeof globalThis !== "undefined" ? globalThis.localStorage : null) ?? null
      : storage;
  const read = (k) => {
    try {
      return store ? store.getItem(k) : null;
    } catch {
      return null;
    }
  };
  const write = (k, v) => {
    try {
      store && store.setItem(k, v);
    } catch {
      /* private mode / storage disabled — in-memory only */
    }
  };
  const del = (k) => {
    try {
      store && store.removeItem(k);
    } catch {
      /* ignore */
    }
  };

  del(OLD_KEY);

  const capped = (raw) =>
    Number.isFinite(raw) && raw > now() ? Math.min(raw, now() + PERSISTED_MAX_MS) : 0;

  let deadline = capped(Number(read(KEY)));
  let streak = 0;
  let lastHitAt = 0;

  function setDeadline(ts) {
    deadline = ts;
    if (ts > now()) write(KEY, String(ts));
    else del(KEY);
  }

  // The effective deadline: the later of our value and whatever another tab
  // has persisted (capped).
  function effectiveDeadline() {
    const stored = capped(Number(read(KEY)));
    if (stored > deadline) deadline = stored;
    return deadline;
  }

  return {
    /** ms until it's safe to hit the API again (0 when clear). */
    waitMs() {
      return Math.max(0, effectiveDeadline() - now());
    },

    /** true when a request should be short-circuited right now. */
    blocked() {
      return now() < effectiveDeadline();
    },

    /** Call after any ok response. Clears an elapsed deadline (never one we
     *  just set — that would be racing ahead of our own back-off) and drops
     *  the escalation streak once the 429s have actually stopped. */
    onOk() {
      if (deadline > now()) return;
      if (deadline) setDeadline(0);
      if (now() - lastHitAt > CALM_MS) streak = 0;
    },

    /** Call on a 429. `retryAfter` is the header value in seconds (NaN if
     *  absent). Returns the wait applied, in seconds. */
    on429(retryAfter) {
      streak += 1;
      lastHitAt = now();
      const waitS = rateLimitWaitSeconds(retryAfter, streak);
      setDeadline(now() + waitS * 1000);
      return waitS;
    },

    /** Test/debug view of internal state. */
    _state() {
      return { deadline, streak, lastHitAt };
    },
  };
}
