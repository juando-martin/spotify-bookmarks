// Copyright (c) 2026 Juan D. Martin
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "../js/rateLimit.js";

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, String(v)]));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

/** A limiter with a movable clock and a fake storage. */
function harness(init) {
  let t = 1_000_000;
  const storage = fakeStorage(init);
  const rl = createRateLimiter({ now: () => t, storage });
  return { rl, storage, advance: (ms) => (t += ms), now: () => t };
}

const MIN = 60_000;

test("clear by default — nothing blocks", () => {
  const { rl } = harness();
  assert.equal(rl.blocked(), false);
  assert.equal(rl.waitMs(), 0);
});

test("a 429 with no Retry-After blocks for the 60s floor, then escalates", () => {
  const { rl, advance } = harness();
  assert.equal(rl.on429(NaN), 60);
  assert.equal(rl.blocked(), true);
  assert.equal(rl.waitMs(), 60_000);

  advance(60_000);
  assert.equal(rl.blocked(), false);
  assert.equal(rl.on429(NaN), 120); // doubles
  advance(120_000);
  assert.equal(rl.on429(NaN), 240);
});

test("Retry-After is honoured in full", () => {
  const { rl } = harness();
  assert.equal(rl.on429(1800), 1800);
  assert.equal(rl.waitMs(), 1_800_000);
});

test("the deadline is persisted to storage", () => {
  const { rl, storage, now } = harness();
  rl.on429(300);
  assert.equal(Number(storage.getItem("myspot:rl")), now() + 300_000);
});

test("a fresh limiter recovers the deadline from storage", () => {
  const { rl } = harness({ "myspot:rl": 2_000_000 }); // clock starts at 1_000_000
  assert.equal(rl.blocked(), true);
  assert.equal(rl.waitMs(), 1_000_000);
});

test("a recovered deadline is capped at 1h from now", () => {
  const { rl } = harness({ "myspot:rl": 1_000_000 + 10 * 60 * MIN }); // +10h
  assert.equal(rl.waitMs(), 3_600_000);
});

test("a stale (past) stored deadline is ignored", () => {
  const { rl } = harness({ "myspot:rl": 5 });
  assert.equal(rl.blocked(), false);
  assert.equal(rl.waitMs(), 0);
});

test("onOk clears an elapsed deadline but never one we just set", () => {
  const { rl, storage, advance } = harness();
  rl.on429(NaN); // 60s
  rl.onOk(); // still inside the window — must not clear
  assert.equal(rl.blocked(), true);
  assert.ok(storage.getItem("myspot:rl"));

  advance(61_000);
  rl.onOk(); // window elapsed
  assert.equal(rl.blocked(), false);
  assert.equal(storage.getItem("myspot:rl"), null);
});

test("the escalation streak only resets after 5 quiet minutes", () => {
  const { rl, advance } = harness();
  rl.on429(NaN); // streak 1 -> 60s
  advance(61_000);
  rl.onOk(); // < 5 min since the 429 — streak kept
  assert.equal(rl.on429(NaN), 120); // streak 2

  advance(6 * MIN);
  rl.onOk(); // > 5 min quiet — streak resets
  assert.equal(rl.on429(NaN), 60); // first-429 wait again
});

test("blocked() re-reads storage so another tab's 429 pauses this one", () => {
  const { rl, storage, now } = harness();
  assert.equal(rl.blocked(), false);
  storage.setItem("myspot:rl", String(now() + 30_000));
  assert.equal(rl.blocked(), true);
});

test("the pre-v42 storage key is dropped on creation", () => {
  const { storage } = harness({ "myspot:rateLimitedUntil": 9_999_999_999_999 });
  assert.equal(storage.getItem("myspot:rateLimitedUntil"), null);
});

test("works with no storage at all (private mode)", () => {
  let t = 0;
  const rl = createRateLimiter({ now: () => t, storage: null });
  assert.equal(rl.on429(NaN), 60);
  assert.equal(rl.blocked(), true);
  t += 60_000;
  assert.equal(rl.blocked(), false);
});
