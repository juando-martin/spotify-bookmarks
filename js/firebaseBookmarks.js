// Firestore-backed bookmark storage.
//
// Data model: bookmarks/{spotifyUserId}/playlists/{playlistId}
//   -> { playlistId, playlistName, trackId, trackUri, trackName,
//        artists, positionMs, updatedAt }
//
// Using the playlist ID as the document ID is what gives us "one bookmark
// per playlist, updated in place" for free — writing again with the same
// playlistId just overwrites the existing doc instead of creating a new one.
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

function playlistDocRef(spotifyUserId, playlistId) {
  return doc(db, "bookmarks", spotifyUserId, "playlists", playlistId);
}

/** Create or overwrite the single bookmark for this playlist. */
export async function saveBookmark(spotifyUserId, bookmark) {
  await ensureReady();
  await setDoc(playlistDocRef(spotifyUserId, bookmark.playlistId), {
    ...bookmark,
    updatedAt: serverTimestamp(),
  });
}

/** All of this user's bookmarks, one per playlist, newest first. */
export async function listBookmarks(spotifyUserId) {
  await ensureReady();
  const snapshot = await getDocs(collection(db, "bookmarks", spotifyUserId, "playlists"));
  const bookmarks = [];
  snapshot.forEach((docSnap) => bookmarks.push({ id: docSnap.id, ...docSnap.data() }));
  bookmarks.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
  return bookmarks;
}

export async function removeBookmark(spotifyUserId, playlistId) {
  await ensureReady();
  await deleteDoc(playlistDocRef(spotifyUserId, playlistId));
}
