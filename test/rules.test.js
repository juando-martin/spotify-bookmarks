// Copyright (c) 2026 Juan D. Martin
// Guards the three parallel bookmark-field lists against drift: the
// Firestore rules whitelist, EXPORT_FIELDS, and buildImportBookmark's
// output. A client that writes a field the deployed rules don't allow
// fails every save with "Missing or insufficient permissions", so this is
// the cheap check that would have caught it before deploy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { EXPORT_FIELDS, buildImportBookmark } from "../js/format.js";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

/** The field names inside the rules' `hasOnly([ ... ])` whitelist. */
function whitelistedFields() {
  const block = rules.match(/hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "firestore.rules should have a hasOnly([...]) field whitelist");
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test("firestore.rules whitelists a plausible bookmark field set", () => {
  const fields = whitelistedFields();
  assert.ok(fields.length >= 12, `expected >=12 whitelisted fields, got ${fields.length}`);
  assert.ok(fields.includes("updatedAt") && fields.includes("lastUsedAt"));
  assert.ok(fields.includes("contextId") && fields.includes("trackId"));
});

test("every EXPORT_FIELDS entry is allowed by the Firestore rules", () => {
  const allowed = new Set(whitelistedFields());
  for (const f of EXPORT_FIELDS) {
    assert.ok(allowed.has(f), `EXPORT_FIELDS has "${f}" but firestore.rules does not whitelist it`);
  }
});

test("buildImportBookmark only emits fields the Firestore rules allow", () => {
  const allowed = new Set(whitelistedFields());
  const sample = buildImportBookmark({
    contextType: "playlist",
    contextId: "P",
    contextUri: "spotify:playlist:P",
    trackId: "T",
    trackUri: "spotify:track:T",
  });
  for (const f of Object.keys(sample)) {
    assert.ok(allowed.has(f), `buildImportBookmark emits "${f}" but firestore.rules does not whitelist it`);
  }
});

test("every whitelisted field is actually validated in the rules", () => {
  // Each field gets either a `!('x' in d) || ...` clause or a
  // `!('x' in d) || d.x is timestamp` clause — a whitelisted field with no
  // `'x' in d` check anywhere would be accepted with any value/type.
  for (const f of whitelistedFields()) {
    assert.ok(
      new RegExp(`'${f}'\\s+in d`).test(rules),
      `firestore.rules whitelists "${f}" but never validates it`,
    );
  }
});
