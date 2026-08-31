// Copyright (c) 2026 Juan D. Martin
// The runtime config loader: validateConfig() (pure) and loadRuntimeConfig()
// (a fetch, mocked here). Also guards the two config files that ship in the
// repo — config.json must be valid, config.example.json must match its shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateConfig, loadRuntimeConfig, ConfigError } from "../js/runtimeConfig.js";

const GOOD = {
  spotify: { clientId: "4200a9cd06554ab98c15a4b094a2fb66" },
  firebase: {
    // validateConfig only checks these are non-empty strings — keep the
    // fixture obviously fake so secret scanners don't flag the test file.
    apiKey: "fake-firebase-api-key",
    authDomain: "demo.firebaseapp.com",
    projectId: "demo",
    storageBucket: "demo.firebasestorage.app",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef",
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

/** A fetch stand-in that resolves with the given status/body. */
function fakeFetch({ ok = true, status = 200, body = GOOD, throws } = {}) {
  return async () => {
    if (throws) throw new Error(throws);
    return {
      ok,
      status,
      json: async () => {
        if (typeof body === "string") throw new SyntaxError("bad json");
        return body;
      },
    };
  };
}

test("validateConfig accepts a well-formed config", () => {
  const out = validateConfig(clone(GOOD));
  assert.equal(out.spotify.clientId, GOOD.spotify.clientId);
  assert.equal(out.firebase.projectId, "demo");
});

test("validateConfig trims a padded clientId", () => {
  const cfg = clone(GOOD);
  cfg.spotify.clientId = `  ${GOOD.spotify.clientId}  `;
  assert.equal(validateConfig(cfg).spotify.clientId, GOOD.spotify.clientId);
});

test("validateConfig rejects a missing clientId", () => {
  const cfg = clone(GOOD);
  delete cfg.spotify.clientId;
  assert.throws(() => validateConfig(cfg), (e) => e instanceof ConfigError && e.problems.includes("spotify.clientId is missing"));
});

test("validateConfig rejects the example placeholder clientId", () => {
  const cfg = clone(GOOD);
  cfg.spotify.clientId = "YOUR_SPOTIFY_CLIENT_ID";
  assert.throws(() => validateConfig(cfg), (e) => e instanceof ConfigError && /32 hex/.test(e.message));
});

test("validateConfig rejects a missing firebase object", () => {
  const cfg = clone(GOOD);
  delete cfg.firebase;
  assert.throws(() => validateConfig(cfg), (e) => e.problems.includes("firebase config object is missing"));
});

test("validateConfig lists every missing firebase key", () => {
  const cfg = { spotify: GOOD.spotify, firebase: { apiKey: "x" } };
  try {
    validateConfig(cfg);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.deepEqual(
      e.problems,
      ["firebase.authDomain is missing", "firebase.projectId is missing", "firebase.appId is missing"],
    );
  }
});

test("validateConfig tolerates junk input", () => {
  for (const bad of [null, undefined, 42, "nope", []]) {
    assert.throws(() => validateConfig(bad), ConfigError);
  }
});

test("loadRuntimeConfig resolves on a good fetch", async () => {
  const out = await loadRuntimeConfig({ fetchImpl: fakeFetch() });
  assert.equal(out.spotify.clientId, GOOD.spotify.clientId);
});

test("loadRuntimeConfig throws ConfigError on a 404", async () => {
  await assert.rejects(
    loadRuntimeConfig({ fetchImpl: fakeFetch({ ok: false, status: 404 }) }),
    (e) => e instanceof ConfigError && /HTTP 404/.test(e.message),
  );
});

test("loadRuntimeConfig throws ConfigError when fetch itself fails", async () => {
  await assert.rejects(
    loadRuntimeConfig({ fetchImpl: fakeFetch({ throws: "network down" }) }),
    (e) => e instanceof ConfigError && /network down/.test(e.message),
  );
});

test("loadRuntimeConfig throws ConfigError on non-JSON", async () => {
  await assert.rejects(
    loadRuntimeConfig({ fetchImpl: fakeFetch({ body: "<html>" }) }),
    (e) => e instanceof ConfigError && /valid JSON/.test(e.message),
  );
});

test("loadRuntimeConfig surfaces validation problems from a fetched body", async () => {
  await assert.rejects(
    loadRuntimeConfig({ fetchImpl: fakeFetch({ body: { spotify: {}, firebase: {} } }) }),
    (e) => e instanceof ConfigError && e.problems.length > 0,
  );
});

test("the committed config.json is valid", () => {
  const raw = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  assert.doesNotThrow(() => validateConfig(raw));
});

test("config.example.json is valid JSON with the same shape as config.json", () => {
  const example = JSON.parse(readFileSync(new URL("../config.example.json", import.meta.url), "utf8"));
  const real = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(example).sort(), Object.keys(real).sort());
  assert.deepEqual(Object.keys(example.firebase).sort(), Object.keys(real.firebase).sort());
  // The example must NOT validate — it's placeholders, so a fork that
  // forgets to fill it in hits the setup screen.
  assert.throws(() => validateConfig(example), ConfigError);
});
