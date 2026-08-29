// ---------------------------------------------------------------------------
// Fill these in after you complete the Spotify Developer Dashboard and
// Firebase setup steps in README.md. Nothing here is a true secret (this is
// a client-side PKCE app, and Firebase web config is meant to be public —
// access is controlled by Firestore security rules, not by hiding this
// object) but it does have to be YOUR real values or nothing will work.
// ---------------------------------------------------------------------------

export const SPOTIFY_CONFIG = {
  // From developer.spotify.com/dashboard -> your app -> Client ID
  clientId: "YOUR_SPOTIFY_CLIENT_ID",

  // Must exactly match a Redirect URI registered on the Spotify app.
  // Once deployed to GitHub Pages this will look like:
  //   https://<your-username>.github.io/spotify-bookmarks/
  redirectUri: window.location.origin + window.location.pathname,

  // Scopes needed to read playback state and start/resume playback.
  scopes: [
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-modify-playback-state",
  ].join(" "),
};

// From the Firebase console -> Project settings -> General -> Your apps -> SDK setup and configuration
export const FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// How often to poll Spotify's "now playing" endpoint, in milliseconds.
// 5s is a reasonable balance between responsiveness and rate limits.
export const POLL_INTERVAL_MS = 5000;
