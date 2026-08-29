import { POLL_INTERVAL_MS } from "./config.js";
import { isLoggedIn, loginWithSpotify, logout, handleRedirectIfPresent } from "./auth.js";
import { getCurrentUser, getPlaybackState, getContextName, resumePlayback } from "./spotifyApi.js";
import { saveBookmark, listBookmarks, removeBookmark, contextKey } from "./firebaseBookmarks.js";

const el = {
  loginView: document.getElementById("login-view"),
  appView: document.getElementById("app-view"),
  loginBtn: document.getElementById("login-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  userGreeting: document.getElementById("user-greeting"),
  nowPlaying: document.getElementById("now-playing"),
  bookmarkBtn: document.getElementById("bookmark-btn"),
  bookmarkStatus: document.getElementById("bookmark-status"),
  bookmarkList: document.getElementById("bookmark-list"),
  bookmarkEmpty: document.getElementById("bookmark-empty"),
  toast: document.getElementById("toast"),
};

let spotifyUserId = null;
let currentSnapshot = null; // latest playback snapshot (may have no resumable context)
let lastContextSnapshot = null; // last snapshot seen WHILE inside a playlist/album context
let pollHandle = null;

function showToast(message, ms = 3500) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function setBookmarkStatus(message, kind) {
  el.bookmarkStatus.textContent = message || "";
  el.bookmarkStatus.className = "status" + (kind ? ` ${kind}` : "");
}

function renderNowPlaying() {
  if (!currentSnapshot) {
    el.nowPlaying.textContent = "Nothing playing right now.";
    el.bookmarkBtn.disabled = true;
    return;
  }

  const { track, context, isPlaying } = currentSnapshot;
  const contextLabel = context
    ? `In ${context.type}`
    : "Not in a playlist or album context";
  el.nowPlaying.innerHTML = `
    <span class="track-name">${escapeHtml(track.name)}</span>
    <span class="track-meta">${escapeHtml(track.artists)}${isPlaying ? "" : " (paused)"}</span>
    <span class="track-meta">${contextLabel}</span>
  `;
  el.bookmarkBtn.disabled = !context;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function buildBookmarkFromSnapshot(snapshot) {
  const { type, id, uri } = snapshot.context;
  const contextName = await getContextName(type, id);
  return {
    contextType: type,
    contextId: id,
    contextUri: uri,
    contextName,
    trackId: snapshot.track.id,
    trackUri: snapshot.track.uri,
    trackName: snapshot.track.name,
    artists: snapshot.track.artists,
    positionMs: snapshot.progressMs,
  };
}

async function refreshBookmarkList() {
  const bookmarks = await listBookmarks(spotifyUserId);
  el.bookmarkList.innerHTML = "";
  el.bookmarkEmpty.hidden = bookmarks.length > 0;

  for (const bm of bookmarks) {
    const li = document.createElement("li");
    li.className = "bookmark-item";
    const updated = bm.updatedAt?.toDate ? bm.updatedAt.toDate().toLocaleString() : "";
    li.innerHTML = `
      <div class="context-name">${escapeHtml(bm.contextName)}<span class="context-type">${escapeHtml(bm.contextType)}</span></div>
      <div class="track-line">${escapeHtml(bm.trackName)} — ${escapeHtml(bm.artists)}</div>
      <div class="updated">Last updated ${escapeHtml(updated)}</div>
      <div class="bookmark-actions">
        <button class="resume-btn">Resume</button>
        <button class="remove-btn">Remove</button>
      </div>
    `;
    li.querySelector(".resume-btn").addEventListener("click", () => onResume(bm));
    li.querySelector(".remove-btn").addEventListener("click", () => onRemove(bm));
    el.bookmarkList.appendChild(li);
  }
}

async function onResume(bookmark) {
  try {
    await resumePlayback({
      contextUri: bookmark.contextUri,
      trackUri: bookmark.trackUri,
      positionMs: bookmark.positionMs,
    });
    showToast(`Resumed ${bookmark.contextName} at ${bookmark.trackName}`);
    // Give Spotify a moment to update state, then refresh the display.
    setTimeout(pollOnce, 1500);
  } catch (err) {
    showToast(err.message.includes("404")
      ? "Couldn't resume — open Spotify on a device first, then try again."
      : "Couldn't resume playback.");
    console.error(err);
  }
}

async function onRemove(bookmark) {
  try {
    await removeBookmark(spotifyUserId, bookmark.id);
    await refreshBookmarkList();
  } catch (err) {
    console.error(err);
    showToast("Couldn't remove that bookmark.");
  }
}

async function onManualBookmark() {
  if (!currentSnapshot?.context) return;
  el.bookmarkBtn.disabled = true;
  setBookmarkStatus("Saving…");
  try {
    const bookmark = await buildBookmarkFromSnapshot(currentSnapshot);
    await saveBookmark(spotifyUserId, bookmark);
    setBookmarkStatus(`Saved: ${bookmark.trackName}`, "success");
    await refreshBookmarkList();
  } catch (err) {
    console.error(err);
    setBookmarkStatus("Couldn't save bookmark.", "error");
  } finally {
    el.bookmarkBtn.disabled = !currentSnapshot?.context;
  }
}

/** Runs on every poll tick: updates the display and auto-bookmarks on context switch. */
async function pollOnce() {
  let snapshot;
  try {
    snapshot = await getPlaybackState();
  } catch (err) {
    console.error("Poll failed:", err);
    return;
  }

  const contextKeyOf = (snap) =>
    snap?.context ? contextKey(snap.context.type, snap.context.id) : null;
  const previousKey = contextKeyOf(lastContextSnapshot);
  const newKey = contextKeyOf(snapshot);

  // Left a context (switched playlist/album, went to a non-resumable
  // context, or stopped) — auto-save wherever we last were.
  if (previousKey && previousKey !== newKey) {
    try {
      const bookmark = await buildBookmarkFromSnapshot(lastContextSnapshot);
      await saveBookmark(spotifyUserId, bookmark);
      await refreshBookmarkList();
    } catch (err) {
      console.error("Auto-bookmark failed:", err);
    }
  }

  currentSnapshot = snapshot;
  lastContextSnapshot = snapshot?.context ? snapshot : null;

  renderNowPlaying();
}

function startPolling() {
  stopPolling();
  pollOnce();
  pollHandle = setInterval(pollOnce, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}

async function enterApp() {
  el.loginView.hidden = true;
  el.appView.hidden = false;

  const me = await getCurrentUser();
  spotifyUserId = me.id;
  el.userGreeting.textContent = `Hi, ${me.display_name || me.id}`;

  await refreshBookmarkList();
  startPolling();
}

function enterLoggedOut() {
  stopPolling();
  el.loginView.hidden = false;
  el.appView.hidden = true;
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed:", err));
  }

  el.loginBtn.addEventListener("click", loginWithSpotify);
  el.logoutBtn.addEventListener("click", () => {
    logout();
    spotifyUserId = null;
    enterLoggedOut();
  });
  el.bookmarkBtn.addEventListener("click", onManualBookmark);

  try {
    await handleRedirectIfPresent();
  } catch (err) {
    console.error(err);
    setBookmarkStatus(err.message, "error");
  }

  if (isLoggedIn()) {
    await enterApp();
  } else {
    enterLoggedOut();
  }
}

init();
