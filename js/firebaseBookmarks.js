// Firestore-backed bookmark storage.
//
// Data model: bookmarks/{spotifyUserId}/contexts/{contextKey}
//   -> { contextType, contextId, contextUri, contextName, customName,
//        imageUrl, trackId, trackUri, trackName, artists, positionMs,
//        updatedAt, lastUsedAt }
//
// contextName = the playlist/album name as Spotify's API returned it (may be
//              "Unknown playlist" for editorial playlists a dev-mode app
//              can't read).
// customName  = a name the user typed to override contextName; null/absent
//              means "use contextName". Survives re-saves (writes are merged).
// updatedAt   = when the saved track/position last changed (a save).
// lastUsedAt  = when the bookmark was last touched in any way — a save OR a
//              Resume. The list is ordered by this, so the playlist/album
//              you most recently interacted with floats to the top.
//
// A "context" is a playlist or an album. `contextKey` is `${type}_${id}`
// (e.g. "playlist_37i9dQ...", "album_1DFixLW...") — the type prefix keeps
// playlist and album ID spaces from ever colliding. Using it as the
// document ID is what gives us "one bookmark per context, updated in
// place" for free — writing again with the same key just overwrites the
// existing doc instead of creating a new one.
//
// Security note: this app signs in to Firebase anonymously purely to
// satisfy a "request.auth != null" Firestore rule (see firestore.rules),
// which keeps the database from being writable by anyone on the open
// internet with your config values. It does NOT cryptographically bind a
// Firebase identity to a Spotify identity, so it will not stop one
// allowlisted Spotify Dashboard user from reading another's bookmarks if
// they deliberately guessed their Spotify user ID. For a personal app (or
// sharing with a small allowlist of friends/family, per the Spotify
// Development Mode cap) that's an acceptable tradeoff. If you later want
// real per-user isolation, that requires minting a Firebase custom token
// from a small backend (e.g. a Cloud Function) that verifies the Spotify
// access token server-side — out of scope for this static-hosting build.

import { FIREBASE_CONFIG } from "./config.js";
import { contextKey, bookmarkUsedMs } from "./format.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// contextKey lives in format.js (pure/testable); re-exported so callers can
// keep importing it from the bookmark module alongside the storage helpers.
export { contextKey };

let db = null;
let readyPromise = null;

function ensureReady() {
  if (!readyPromise) {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    const auth = getAuth(app);
    readyPromise = signInAnonymously(auth);
  }
  return readyPromise;
}

function contextDocRef(spotifyUserId, key) {
  return doc(db, "bookmarks", spotifyUserId, "contexts", key);
}

/**
 * Create or update the single bookmark for this context. Merged, not
 * replaced, so a user's customName (and any future field) survives an
 * auto-bookmark or a manual re-save — every core field is always supplied
 * here anyway, so merge and overwrite behave the same for those.
 */
export async function saveBookmark(spotifyUserId, bookmark) {
  await ensureReady();
  const key = contextKey(bookmark.contextType, bookmark.contextId);
  const now = serverTimestamp();
  await setDoc(
    contextDocRef(spotifyUserId, key),
    { ...bookmark, updatedAt: now, lastUsedAt: now },
    { merge: true },
  );
}

/** Bump a bookmark's lastUsedAt without touching its saved position. */
export async function touchBookmark(spotifyUserId, key) {
  await ensureReady();
  await setDoc(
    contextDocRef(spotifyUserId, key),
    { lastUsedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Set a user-chosen display name (or null to revert to the Spotify name). */
export async function renameBookmark(spotifyUserId, key, customName) {
  await ensureReady();
  await setDoc(
    contextDocRef(spotifyUserId, key),
    { customName: customName || null },
    { merge: true },
  );
}

/** All of this user's bookmarks, one per context, most recently used first. */
export async function listBookmarks(spotifyUserId) {
  await ensureReady();
  const snapshot = await getDocs(collection(db, "bookmarks", spotifyUserId, "contexts"));
  const bookmarks = [];
  snapshot.forEach((docSnap) => bookmarks.push({ id: docSnap.id, ...docSnap.data() }));
  bookmarks.sort((a, b) => bookmarkUsedMs(b) - bookmarkUsedMs(a));
  return bookmarks;
}

export async function removeBookmark(spotifyUserId, key) {
  await ensureReady();
  await deleteDoc(contextDocRef(spotifyUserId, key));
}
