import { POLL_INTERVAL_MS } from "./config.js";
import { APP_VERSION } from "./version.js";
import {
  bookmarkName,
  bookmarkUsedMs,
  escapeHtml,
  formatDuration,
  formatRelative,
  spotifyWebUrl,
} from "./format.js";
import { isLoggedIn, loginWithSpotify, logout, handleRedirectIfPresent } from "./auth.js";
import { getCurrentUser, getPlaybackState, getContextMeta, getDevices, resumePlayback, playbackControl } from "./spotifyApi.js";
import { saveBookmark, listBookmarks, removeBookmark, touchBookmark, renameBookmark, contextKey } from "./firebaseBookmarks.js";

const el = {
  loginView: document.getElementById("login-view"),
  appView: document.getElementById("app-view"),
  loginBtn: document.getElementById("login-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  userGreeting: document.getElementById("user-greeting"),
  nowPlaying: document.getElementById("now-playing"),
  transport: document.getElementById("transport"),
  prevBtn: document.getElementById("prev-btn"),
  nextBtn: document.getElementById("next-btn"),
  playPauseBtn: document.getElementById("playpause-btn"),
  iconPlay: document.querySelector("#playpause-btn .icon-play"),
  iconPause: document.querySelector("#playpause-btn .icon-pause"),
  bookmarkBtn: document.getElementById("bookmark-btn"),
  bookmarkStatus: document.getElementById("bookmark-status"),
  bookmarkList: document.getElementById("bookmark-list"),
  bookmarkEmpty: document.getElementById("bookmark-empty"),
  devicePicker: document.getElementById("device-picker"),
  devicePickerMsg: document.getElementById("device-picker-msg"),
  deviceList: document.getElementById("device-list"),
  deviceCancel: document.getElementById("device-cancel"),
  autoBookmarkToggle: document.getElementById("auto-bookmark-toggle"),
  pollIntervalSelect: document.getElementById("poll-interval-select"),
  updateBanner: document.getElementById("update-banner"),
  updateVersion: document.getElementById("update-version"),
  updateReload: document.getElementById("update-reload"),
  toast: document.getElementById("toast"),
};

// User-adjustable settings, persisted per-device in localStorage. Defaults
// apply when nothing is stored yet (auto-bookmark on, config's poll interval).
const SETTINGS_KEY = "playlist-resume-settings";

function loadSettings() {
  const defaults = { autoBookmark: true, pollIntervalMs: POLL_INTERVAL_MS };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      autoBookmark:
        typeof stored.autoBookmark === "boolean" ? stored.autoBookmark : defaults.autoBookmark,
      pollIntervalMs:
        Number.isFinite(stored.pollIntervalMs) && stored.pollIntervalMs >= 1000
          ? stored.pollIntervalMs
          : defaults.pollIntervalMs,
    };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / storage disabled — settings just won't persist */
  }
}

const settings = loadSettings();

// The kiosk / always-on setup (see README) launches with ?background to keep
// the poll loop running even when the page isn't the visible tab.
const KEEP_POLLING_WHEN_HIDDEN = new URLSearchParams(location.search).has("background");
// PWA shortcut intent — read before anything rewrites the URL.
const shortcutAction = new URLSearchParams(location.search).get("action");

let spotifyUserId = null;
let currentSnapshot = null; // latest playback snapshot (may have no resumable context)
let lastContextSnapshot = null; // last snapshot seen WHILE inside a playlist/album context
let pollHandle = null;
let pendingRemoval = null; // { bookmark, timer } — a Remove awaiting its Undo grace period
let updateReady = false; // a newer build is on the network; the banner is shown

// Bookmark id -> local timestamp of the last save/resume from this tab.
// Firestore's serverTimestamp can lag a beat on read-back, so we sort (and
// show "used just now") from this until the server value catches up.
const locallyUsedAt = new Map();
function markUsedNow(id) {
  locallyUsedAt.set(id, Date.now());
}

// contextKey -> user's customName, rebuilt on every refreshBookmarkList().
// Lets the Now playing card show your name for a playlist Spotify's API
// won't name (e.g. an editorial "Mix"), matching what the bookmark shows.
const customNameByContext = new Map();

/**
 * Show a transient toast. Pass { actionLabel, onAction } for an inline
 * button (e.g. Undo); ms controls how long it stays up.
 */
function showToast(message, { actionLabel, onAction, ms = 3500 } = {}) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(showToast._t);
  if (actionLabel && onAction) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      clearTimeout(showToast._t);
      el.toast.hidden = true;
      onAction();
    });
    el.toast.append(" ", btn);
  }
  showToast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function setBookmarkStatus(message, kind) {
  el.bookmarkStatus.textContent = message || "";
  el.bookmarkStatus.className = "status" + (kind ? ` ${kind}` : "");
}

function renderTransport() {
  if (!el.transport) return; // stale cached HTML without the transport markup
  const playing = !!currentSnapshot?.isPlaying;
  el.transport.hidden = !currentSnapshot;
  // toggleAttribute, not .hidden — .hidden isn't reflected on SVG elements.
  el.iconPlay.toggleAttribute("hidden", playing);
  el.iconPause.toggleAttribute("hidden", !playing);
  el.playPauseBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function renderNowPlaying() {
  renderTransport();

  if (!currentSnapshot) {
    el.nowPlaying.textContent = "Nothing playing right now.";
    el.bookmarkBtn.disabled = true;
    return;
  }

  const { track, context, isPlaying } = currentSnapshot;

  const metaLines = [
    escapeHtml(`${track.artists}${isPlaying ? "" : " (paused)"}`),
  ];
  if (track.albumName) {
    metaLines.push(`Album · ${escapeHtml(track.albumName)}`);
  }
  if (!context) {
    metaLines.push("Not in a playlist or album context");
  } else if (context.type === "playlist") {
    // Prefer the name you gave the matching bookmark (Spotify's API won't
    // name an editorial "Mix"), then Spotify's own name.
    const key = contextKey(context.type, context.id);
    const name = customNameByContext.get(key) || context.name;
    metaLines.push(name ? `Playlist · ${escapeHtml(name)}` : "In a playlist");
  }
  // An album context adds nothing — the "Album ·" line above already names it.

  const art = track.imageUrl
    ? `<img class="np-art" src="${escapeHtml(track.imageUrl)}" alt="" width="64" height="64" />`
    : `<div class="np-art np-art-empty" aria-hidden="true"></div>`;

  el.nowPlaying.innerHTML = `
    ${art}
    <div class="np-text">
      <span class="track-name">${escapeHtml(track.name)}</span>
      ${metaLines.map((line) => `<span class="track-meta">${line}</span>`).join("")}
    </div>
  `;
  el.bookmarkBtn.disabled = !context;
}

async function buildBookmarkFromSnapshot(snapshot) {
  const { type, id, uri, name } = snapshot.context;

  // The bookmark's thumbnail is the playlist/album *cover*. For an album,
  // the playing track's art is already that cover — no extra call. For a
  // playlist, fetch it (cached); fall back to the track art if it can't be
  // read (e.g. an editorial playlist).
  let contextName = name;
  let coverUrl = null;
  if (type === "album") {
    coverUrl = snapshot.track.imageUrl ?? null;
  } else {
    const meta = await getContextMeta(type, id);
    contextName = contextName ?? meta.name;
    coverUrl = meta.imageUrl;
  }

  return {
    contextType: type,
    contextId: id,
    contextUri: uri,
    contextName: contextName ?? `Unknown ${type}`,
    imageUrl: coverUrl ?? snapshot.track.imageUrl ?? null,
    trackId: snapshot.track.id,
    trackUri: snapshot.track.uri,
    trackName: snapshot.track.name,
    artists: snapshot.track.artists,
    positionMs: snapshot.progressMs,
  };
}

/** Effective "last used" ms: the later of the server value and this tab's local mark. */
function usedAtMs(bm) {
  return Math.max(bookmarkUsedMs(bm), locallyUsedAt.get(bm.id) ?? 0);
}

async function refreshBookmarkList() {
  const all = await listBookmarks(spotifyUserId);
  // Drop local "just used" marks the server value has now caught up to.
  for (const b of all) {
    if ((locallyUsedAt.get(b.id) ?? 0) <= bookmarkUsedMs(b)) locallyUsedAt.delete(b.id);
  }
  customNameByContext.clear();
  for (const b of all) {
    if (b.customName) customNameByContext.set(b.id, b.customName); // b.id is the contextKey
  }
  // Hide a bookmark that's mid-Undo so a background re-render doesn't resurrect it.
  const bookmarks = pendingRemoval
    ? all.filter((b) => b.id !== pendingRemoval.bookmark.id)
    : all;
  // Re-sort with local marks applied (listBookmarks only sees the server value).
  bookmarks.sort((a, b) => usedAtMs(b) - usedAtMs(a));

  el.bookmarkList.innerHTML = "";
  el.bookmarkEmpty.hidden = bookmarks.length > 0;

  for (const bm of bookmarks) {
    const li = document.createElement("li");
    li.className = "bookmark-item";

    const usedMs = usedAtMs(bm);
    const usedDate = usedMs ? new Date(usedMs) : null;
    const detail = [];
    if (Number.isFinite(bm.positionMs)) detail.push(`resumes at ${formatDuration(bm.positionMs)}`);
    if (usedDate) detail.push(`used ${formatRelative(usedDate)}`);

    const art = bm.imageUrl
      ? `<img class="bookmark-art" src="${escapeHtml(bm.imageUrl)}" alt="" width="52" height="52" loading="lazy" />`
      : `<div class="bookmark-art bookmark-art-empty" aria-hidden="true"></div>`;
    li.innerHTML = `
      <div class="bookmark-main">
        ${art}
        <div class="bookmark-text">
          <div class="context-name">
            <span class="context-name-text">${escapeHtml(bookmarkName(bm))}</span>
            <span class="context-type">${escapeHtml(bm.contextType)}</span>
            <button class="rename-btn" title="Rename" aria-label="Rename">✎</button>
          </div>
          <div class="track-line">${escapeHtml(bm.trackName)} — ${escapeHtml(bm.artists)}</div>
          <div class="updated"${usedDate ? ` title="${escapeHtml(usedDate.toLocaleString())}"` : ""}>${escapeHtml(detail.join(" · "))}</div>
        </div>
      </div>
      <div class="bookmark-actions">
        <button class="resume-btn">Resume</button>
        <button class="remove-btn">Remove</button>
      </div>
    `;
    li.querySelector(".resume-btn").addEventListener("click", () => onResume(bm));
    li.querySelector(".remove-btn").addEventListener("click", () => onRemove(bm, li));
    li.querySelector(".rename-btn").addEventListener("click", () => startRename(bm, li));
    el.bookmarkList.appendChild(li);
  }
}

/** Swap a bookmark's name line for an inline text editor. */
function startRename(bm, li) {
  const row = li.querySelector(".context-name");
  const currentName = bm.customName || bm.contextName || "";
  row.innerHTML = `
    <input class="rename-input" type="text" maxlength="120" value="${escapeHtml(currentName)}" />
    <button class="rename-save">Save</button>
    <button class="rename-cancel">Cancel</button>
  `;
  const input = row.querySelector(".rename-input");
  input.focus();
  input.select();

  const cancel = () => refreshBookmarkList();
  const save = async () => {
    const value = input.value.trim();
    // Store null when it's blank or just matches Spotify's own name.
    const customName = value && value !== bm.contextName ? value : null;
    try {
      await renameBookmark(spotifyUserId, bm.id, customName);
    } catch (err) {
      console.error(err);
      showToast("Couldn't rename that bookmark.");
    }
    await refreshBookmarkList();
  };

  row.querySelector(".rename-cancel").addEventListener("click", cancel);
  row.querySelector(".rename-save").addEventListener("click", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
    else if (e.key === "Escape") cancel();
  });
}

async function onTransport(action) {
  // Optimistic play/pause flip so the button feels instant.
  if ((action === "play" || action === "pause") && currentSnapshot) {
    currentSnapshot.isPlaying = action === "play";
    renderTransport();
  }
  try {
    await playbackControl(action);
  } catch (err) {
    console.error(err);
    showToast(/\b404\b/.test(err.message)
      ? "No active device — open Spotify somewhere first."
      : "Playback control failed.");
  }
  setTimeout(pollOnce, 1000); // reconcile with Spotify's real state
}

function onPlayPause() {
  onTransport(currentSnapshot?.isPlaying ? "pause" : "play");
}

async function onResume(bookmark, deviceId) {
  try {
    await resumePlayback({
      contextUri: bookmark.contextUri,
      trackUri: bookmark.trackUri,
      positionMs: bookmark.positionMs,
      deviceId,
    });
    hideDevicePicker();
    showToast(`Resumed ${bookmarkName(bookmark)} at ${bookmark.trackName}`);
    // Resuming counts as "using" the bookmark — bump it to the top of the list
    // immediately (local mark), then persist lastUsedAt.
    markUsedNow(bookmark.id);
    await refreshBookmarkList();
    try {
      await touchBookmark(spotifyUserId, bookmark.id);
    } catch (err) {
      console.error("Failed to bump lastUsedAt:", err);
    }
    // Give Spotify a moment to update state, then refresh the display.
    setTimeout(pollOnce, 1500);
  } catch (err) {
    console.error(err);
    // 404 from the play endpoint = no active device.
    if (!deviceId && /\b404\b/.test(err.message)) {
      const devices = (await getDevices().catch(() => [])).filter((d) => !d.is_restricted);
      if (devices.length === 1) {
        // Only one place it could go — just start it there.
        return onResume(bookmark, devices[0].id);
      }
      showResumeTargets(bookmark, devices); // 0 -> "open Spotify", 2+ -> pick one
      return;
    }
    showToast("Couldn't resume playback.");
  }
}

function showResumeTargets(bookmark, devices) {
  el.deviceList.innerHTML = "";
  if (devices.length) {
    el.devicePickerMsg.textContent = "Nothing is playing right now — pick where to start.";
    for (const d of devices) {
      const btn = document.createElement("button");
      btn.className = "device-btn";
      btn.textContent = d.is_active ? `${d.name} (active)` : d.name;
      btn.addEventListener("click", () => onResume(bookmark, d.id));
      el.deviceList.appendChild(wrapLi(btn));
    }
  } else {
    el.devicePickerMsg.textContent =
      "No Spotify device is available. Open Spotify, then tap Resume again.";
    const link = document.createElement("a");
    link.className = "device-btn";
    link.href = spotifyWebUrl(bookmark.contextUri);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `Open ${bookmarkName(bookmark)} in Spotify`;
    el.deviceList.appendChild(wrapLi(link));
  }
  el.devicePicker.hidden = false;
  el.devicePicker.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function wrapLi(child) {
  const li = document.createElement("li");
  li.appendChild(child);
  return li;
}

function hideDevicePicker() {
  el.devicePicker.hidden = true;
  el.deviceList.innerHTML = "";
}

/** Finalize a pending Remove now (its grace period elapsed, or we're leaving). */
function commitRemoval() {
  if (!pendingRemoval) return;
  const { bookmark, timer } = pendingRemoval;
  clearTimeout(timer);
  pendingRemoval = null;
  locallyUsedAt.delete(bookmark.id);
  removeBookmark(spotifyUserId, bookmark.id).catch((err) => {
    console.error(err);
    showToast("Couldn't remove that bookmark.");
    refreshBookmarkList();
  });
}

function onRemove(bookmark, li) {
  commitRemoval(); // flush any earlier pending removal first
  li.remove();
  const timer = setTimeout(commitRemoval, 5000);
  pendingRemoval = { bookmark, timer };
  showToast(`Removed “${bookmarkName(bookmark)}”`, {
    actionLabel: "Undo",
    ms: 5000,
    onAction: () => {
      if (pendingRemoval?.bookmark.id === bookmark.id) {
        clearTimeout(pendingRemoval.timer);
        pendingRemoval = null;
      }
      refreshBookmarkList();
    },
  });
}

async function onManualBookmark() {
  if (!currentSnapshot?.context) return;
  el.bookmarkBtn.disabled = true;
  setBookmarkStatus("Saving…");
  try {
    const bookmark = await buildBookmarkFromSnapshot(currentSnapshot);
    await saveBookmark(spotifyUserId, bookmark);
    markUsedNow(contextKey(bookmark.contextType, bookmark.contextId));
    setBookmarkStatus(`Saved: ${bookmark.trackName}`, "success");
    await refreshBookmarkList();
  } catch (err) {
    console.error(err);
    setBookmarkStatus("Couldn't save bookmark.", "error");
  } finally {
    el.bookmarkBtn.disabled = !currentSnapshot?.context;
  }
}

let polling = false;

/** Runs on every poll tick: updates the display and auto-bookmarks on context switch. */
async function pollOnce() {
  // A tick can outlast the interval (429 backoff, a slow name lookup). Skip
  // overlapping runs so two of them can't both fire the auto-bookmark.
  if (polling) return;
  polling = true;
  try {
    await runPoll();
  } finally {
    polling = false;
  }
}

async function runPoll() {
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
  if (settings.autoBookmark && previousKey && previousKey !== newKey) {
    try {
      const bookmark = await buildBookmarkFromSnapshot(lastContextSnapshot);
      await saveBookmark(spotifyUserId, bookmark);
      markUsedNow(previousKey);
      await refreshBookmarkList();
    } catch (err) {
      console.error("Auto-bookmark failed:", err);
    }
  }

  currentSnapshot = snapshot;
  lastContextSnapshot = snapshot?.context ? snapshot : null;

  // Resolve the Spotify name for the Now playing card (albums already carry
  // it; playlists need one API lookup, cached in memory). renderNowPlaying
  // layers your custom bookmark name on top of this.
  if (snapshot?.context && !snapshot.context.name) {
    try {
      snapshot.context.name = (
        await getContextMeta(snapshot.context.type, snapshot.context.id)
      ).name;
    } catch {
      /* leave name null — the card falls back to "In a playlist" */
    }
  }

  renderNowPlaying();
}

function startPolling() {
  stopPolling();
  // Don't burn API calls polling a hidden tab; visibilitychange resumes it.
  if (document.hidden && !KEEP_POLLING_WHEN_HIDDEN) return;
  pollOnce();
  pollHandle = setInterval(pollOnce, settings.pollIntervalMs);
}

function stopPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (!KEEP_POLLING_WHEN_HIDDEN && isLoggedIn()) stopPolling();
    return;
  }
  checkForUpdate(); // re-check whenever the app comes back to the foreground
  if (KEEP_POLLING_WHEN_HIDDEN || !isLoggedIn()) return;
  startPolling(); // fires an immediate catch-up poll
}

// The service worker is network-first, but an installed PWA can keep running
// an old build until it's fully relaunched. Compare the running APP_VERSION
// with the one on the network and offer a one-tap reload if they differ.
async function checkForUpdate() {
  if (updateReady) return;
  try {
    const res = await fetch("js/version.js", { cache: "no-store" });
    if (!res.ok) return;
    const match = (await res.text()).match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
    if (match && match[1] !== APP_VERSION) {
      updateReady = true;
      el.updateVersion.textContent = ` (v${match[1]})`;
      el.updateBanner.hidden = false;
    }
  } catch {
    /* offline or blocked — nothing to do */
  }
}

async function applyUpdate() {
  el.updateReload.disabled = true;
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* ignore — reload below still helps */
  }
  location.reload();
}

async function enterApp() {
  el.loginView.hidden = true;
  el.appView.hidden = false;

  const me = await getCurrentUser();
  spotifyUserId = me.id;
  el.userGreeting.textContent = `Hi, ${me.display_name || me.id}`;

  await refreshBookmarkList();
  startPolling();

  if (shortcutAction === "resume-last") await resumeLastBookmark();
}

async function resumeLastBookmark() {
  try {
    const bookmarks = await listBookmarks(spotifyUserId);
    if (!bookmarks.length) {
      showToast("No bookmarks to resume yet.");
      return;
    }
    await onResume(bookmarks[0]); // list is most-recently-used first
  } catch (err) {
    console.error("Resume-last shortcut failed:", err);
    showToast("Couldn't resume your last bookmark.");
  }
}

function enterLoggedOut() {
  stopPolling();
  commitRemoval();
  hideDevicePicker();
  el.loginView.hidden = false;
  el.appView.hidden = true;
}

async function init() {
  const versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  console.info(`Playlist Resume v${APP_VERSION}`);

  el.updateReload.addEventListener("click", applyUpdate);
  checkForUpdate();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed:", err));
  }

  el.loginBtn.addEventListener("click", loginWithSpotify);
  el.logoutBtn.addEventListener("click", () => {
    commitRemoval(); // finish any pending Remove while we still have the user id
    logout();
    spotifyUserId = null;
    enterLoggedOut();
  });
  el.bookmarkBtn.addEventListener("click", onManualBookmark);
  el.deviceCancel.addEventListener("click", hideDevicePicker);
  el.prevBtn.addEventListener("click", () => onTransport("previous"));
  el.nextBtn.addEventListener("click", () => onTransport("next"));
  el.playPauseBtn.addEventListener("click", onPlayPause);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Strip the one-shot shortcut param so a manual reload doesn't re-fire it.
  if (shortcutAction) {
    const params = new URLSearchParams(location.search);
    params.delete("action");
    const qs = params.toString();
    history.replaceState({}, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
  }

  el.autoBookmarkToggle.checked = settings.autoBookmark;
  el.autoBookmarkToggle.addEventListener("change", () => {
    settings.autoBookmark = el.autoBookmarkToggle.checked;
    saveSettings();
  });

  el.pollIntervalSelect.value = String(settings.pollIntervalMs);
  el.pollIntervalSelect.addEventListener("change", () => {
    const ms = parseInt(el.pollIntervalSelect.value, 10);
    if (!Number.isFinite(ms)) return;
    settings.pollIntervalMs = ms;
    saveSettings();
    if (pollHandle) startPolling(); // apply the new cadence immediately
  });

  try {
    await handleRedirectIfPresent();
  } catch (err) {
    console.error(err);
    setBookmarkStatus(err.message, "error");
  }

  if (isLoggedIn()) {
    try {
      await enterApp();
    } catch (err) {
      console.error("Failed to start the app:", err);
      setBookmarkStatus("Couldn't reach Spotify — reload to try again.", "error");
    }
  } else {
    enterLoggedOut();
  }
}

init();
