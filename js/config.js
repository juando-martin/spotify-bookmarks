// Copyright (c) 2026 Juan D. Martin
// ---------------------------------------------------------------------------
// Static config, plus the bridge that fills in the runtime values.
//
// The two values that change over a deployment's life — the Spotify Client
// ID and the Firebase web config — are NOT baked in here any more. They load
// from ./config.json at startup (see js/runtimeConfig.js), so rotating a
// revoked Client ID or moving to a new Firebase project is a one-file edit
// with no version bump. main.js calls applyRuntimeConfig() once, before auth
// or Firestore read either object.
//
// Nothing here or in config.json is a true secret: this is a client-side
// PKCE app (no client secret) and the Firebase web config is meant to be
// public — access is controlled by firestore.rules, not by hiding it.
// ---------------------------------------------------------------------------

export const SPOTIFY_CONFIG = {
  // Filled in by applyRuntimeConfig() from config.json's spotify.clientId.
  clientId: null,

  // Always the app's own URL — must exactly match a Redirect URI registered
  // on the Spotify app. Computed here, never configured.
  redirectUri: window.location.origin + window.location.pathname,

  // Scopes: read playback state, start/resume playback, and read the names
  // of your own private / collaborative playlists (public ones need no
  // scope, but Spotify returns 404 — not 403 — for private ones without it,
  // which is why the playlist name would otherwise come back blank).
  // Changing this list means existing logins must log out and back in to
  // re-consent, so it stays in code, not in config.json.
  scopes: [
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
  ].join(" "),
};

// Filled in by applyRuntimeConfig() from config.json's firebase object.
export const FIREBASE_CONFIG = {};

/**
 * Copy a validated runtime config (the resolved value of loadRuntimeConfig()
 * in js/runtimeConfig.js) into the exported objects above. Called once by
 * main.js during startup, before anything reads them.
 */
export function applyRuntimeConfig({ spotify, firebase }) {
  SPOTIFY_CONFIG.clientId = spotify.clientId;
  Object.assign(FIREBASE_CONFIG, firebase);
}

// How often to poll Spotify's "now playing" endpoint, in milliseconds.
// 5s is a reasonable balance between responsiveness and rate limits.
// Settings overrides this per device; this is only the pre-touch default.
export const POLL_INTERVAL_MS = 5000;
