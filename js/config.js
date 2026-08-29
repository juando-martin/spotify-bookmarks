// Copyright (c) 2026 Juan D. Martin
// ---------------------------------------------------------------------------
// Fill these in after you complete the Spotify Developer Dashboard and
// Firebase setup steps in README.md. Nothing here is a true secret (this is
// a client-side PKCE app, and Firebase web config is meant to be public —
// access is controlled by Firestore security rules, not by hiding this
// object) but it does have to be YOUR real values or nothing will work.
// ---------------------------------------------------------------------------

export const SPOTIFY_CONFIG = {
  // From developer.spotify.com/dashboard -> your app -> Client ID
  clientId: "53c3a5a987b74363a2c18beff257a65f",

  // Must exactly match a Redirect URI registered on the Spotify app.
  // Once deployed to GitHub Pages this will look like:
  //   https://<your-username>.github.io/spotify-bookmarks/
  redirectUri: window.location.origin + window.location.pathname,

  // Scopes: read playback state, start/resume playback, and read the names
  // of your own private / collaborative playlists (public ones need no
  // scope, but Spotify returns 404 — not 403 — for private ones without it,
  // which is why the playlist name would otherwise come back blank).
  // Changing this list means existing logins must log out and back in to
  // re-consent.
  scopes: [
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
  ].join(" "),
};

// From the Firebase console -> Project settings -> General -> Your apps -> SDK setup and configuration
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCtjNEnrjI4fuW2FFC_TSjvU1WYliLDTUE",
  authDomain: "spotify-bookmarks-9c71d.firebaseapp.com",
  projectId: "spotify-bookmarks-9c71d",
  storageBucket: "spotify-bookmarks-9c71d.firebasestorage.app",
  messagingSenderId: "812556382600",
  appId: "1:812556382600:web:c26b880d32987775350a3d",
};

// How often to poll Spotify's "now playing" endpoint, in milliseconds.
// 5s is a reasonable balance between responsiveness and rate limits.
export const POLL_INTERVAL_MS = 5000;
