// Copyright (c) 2026 Juan D. Martin
// Loads ./config.json at startup — the Spotify Client ID and the Firebase
// web config live there instead of in the bundle, so rotating either (a
// revoked Client ID, a move to a new Firebase project) is a one-file edit
// with no version bump.
//
// config.json is committed to the repo (GitHub Pages serves the repo
// directly, with no build step, so an untracked file would never deploy) and
// is listed in the service-worker shell cache, so it can never be newer than
// the code that reads it. config.example.json is the template a fork copies.
// None of these values is a true secret — see the header in js/config.js.

export const CONFIG_URL = "config.json";

/** Thrown when config.json is missing, unparseable, or fails validation. */
export class ConfigError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

// A Spotify Client ID is 32 hex characters — enough to reject an unfilled
// "YOUR_SPOTIFY_CLIENT_ID" placeholder left over from config.example.json.
const CLIENT_ID_RE = /^[0-9a-f]{32}$/i;
const REQUIRED_FIREBASE_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

/**
 * Validate a parsed config.json. Returns `{ spotify: { clientId }, firebase }`
 * on success; throws ConfigError (with every problem in `.problems`)
 * otherwise. Pure — no I/O, safe to unit-test.
 */
export function validateConfig(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const problems = [];

  const clientId =
    typeof obj.spotify?.clientId === "string" ? obj.spotify.clientId.trim() : "";
  if (!clientId) {
    problems.push("spotify.clientId is missing");
  } else if (!CLIENT_ID_RE.test(clientId)) {
    problems.push(
      "spotify.clientId doesn't look like a Spotify Client ID (expected 32 hex characters)",
    );
  }

  const firebase =
    obj.firebase && typeof obj.firebase === "object" && !Array.isArray(obj.firebase)
      ? obj.firebase
      : null;
  if (!firebase) {
    problems.push("firebase config object is missing");
  } else {
    for (const k of REQUIRED_FIREBASE_KEYS) {
      if (typeof firebase[k] !== "string" || !firebase[k].trim()) {
        problems.push(`firebase.${k} is missing`);
      }
    }
  }

  if (problems.length) {
    throw new ConfigError(
      `config.json is missing or invalid:\n- ${problems.join("\n- ")}`,
      problems,
    );
  }
  return { spotify: { clientId }, firebase: { ...firebase } };
}

/**
 * Fetch and validate ./config.json. Throws ConfigError on a missing file,
 * bad JSON, or a failed validation — main.js catches it and shows the setup
 * screen instead of the login view. `fetchImpl` / `url` are injectable for
 * tests.
 */
export async function loadRuntimeConfig({ fetchImpl = fetch, url = CONFIG_URL } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { cache: "no-cache" });
  } catch (err) {
    throw new ConfigError(`Couldn't load ${url} (${err.message}).`);
  }
  if (!res.ok) {
    throw new ConfigError(`Couldn't load ${url} (HTTP ${res.status}).`);
  }
  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new ConfigError(`${url} isn't valid JSON.`);
  }
  return validateConfig(raw);
}
