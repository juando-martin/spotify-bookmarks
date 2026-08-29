// Firestore-backed bookmark storage.
//
// Data model: bookmarks/{spotifyUserId}/contexts/{contextKey}
//   -> { contextType, contextId, contextUri, contextName, trackId,
//        trackUri, trackName, artists, positionMs, updatedAt }
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

/** `${type}_${id}` — the document ID for a bookmark's context. */
export function contextKey(contextType, contextId) {
  return `${contextType}_${contextId}`;
}

function contextDocRef(spotifyUserId, key) {
  return doc(db, "bookmarks", spotifyUserId, "contexts", key);
}

/** Create or overwrite the single bookmark for this context. */
export async function saveBookmark(spotifyUserId, bookmark) {
  await ensureReady();
  const key = contextKey(bookmark.contextType, bookmark.contextId);
  await setDoc(contextDocRef(spotifyUserId, key), {
    ...bookmark,
    updatedAt: serverTimestamp(),
  });
}

/** All of this user's bookmarks, one per context, newest first. */
export async function listBookmarks(spotifyUserId) {
  await ensureReady();
  const snapshot = await getDocs(collection(db, "bookmarks", spotifyUserId, "contexts"));
  const bookmarks = [];
  snapshot.forEach((docSnap) => bookmarks.push({ id: docSnap.id, ...docSnap.data() }));
  bookmarks.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
  return bookmarks;
}

export async function removeBookmark(spotifyUserId, key) {
  await ensureReady();
  await deleteDoc(contextDocRef(spotifyUserId, key));
}
