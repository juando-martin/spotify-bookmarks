// Copyright (c) 2026 Juan D. Martin
import { POLL_INTERVAL_MS, applyRuntimeConfig } from "./config.js";
import { loadRuntimeConfig, ConfigError } from "./runtimeConfig.js";
import { APP_VERSION } from "./version.js";
import {
  bookmarkableContext,
  bookmarkMatches,
  bookmarkName,
  bookmarkTileSource,
  bookmarkUsedMs,
  buildImportBookmark,
  escapeHtml,
  EXPORT_FIELDS,
  formatDuration,
  formatRelative,
  spotifyWebUrl,
  TILE_STYLE_IDS,
} from "./format.js";
import { isLoggedIn, loginWithSpotify, logout, handleRedirectIfPresent } from "./auth.js";
import { getCurrentUser, getPlaybackState, getContextMeta, getContextTracks, getTrackImage, getDevices, resumePlayback, playbackControl, seek, searchContexts, rateLimitedForMs } from "./spotifyApi.js";
import { saveBookmark, listBookmarks, removeBookmark, touchBookmark, renameBookmark, updateBookmarkFields, contextKey } from "./firebaseBookmarks.js";
import { tileDataUrl, TILE_STYLES, DEFAULT_TILE_STYLE } from "./tiles.js";

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
  seekRow: document.getElementById("seek-row"),
  seek: document.getElementById("seek"),
  seekElapsed: document.getElementById("seek-elapsed"),
  seekTotal: document.getElementById("seek-total"),
  bookmarkBtn: document.getElementById("bookmark-btn"),
  bookmarkStatus: document.getElementById("bookmark-status"),
  bookmarkList: document.getElementById("bookmark-list"),
  bookmarkEmpty: document.getElementById("bookmark-empty"),
  bookmarkFilter: document.getElementById("bookmark-filter"),
  bookmarkNoMatch: document.getElementById("bookmark-no-match"),
  exportBtn: document.getElementById("export-btn"),
  exportText: document.getElementById("export-text"),
  importText: document.getElementById("import-text"),
  importBtn: document.getElementById("import-btn"),
  importStatus: document.getElementById("import-status"),
  devicePicker: document.getElementById("device-picker"),
  devicePickerMsg: document.getElementById("device-picker-msg"),
  deviceList: document.getElementById("device-list"),
  deviceCancel: document.getElementById("device-cancel"),
  settingsCard: document.getElementById("settings-card"),
  searchCard: document.getElementById("search-card"),
  searchInput: document.getElementById("context-search"),
  searchResults: document.getElementById("search-results"),
  autoBookmarkToggle: document.getElementById("auto-bookmark-toggle"),
  followBookmarkToggle: document.getElementById("follow-bookmark-toggle"),
  pollIntervalSelect: document.getElementById("poll-interval-select"),
  tileStyleInputs: document.querySelectorAll('input[name="tile-style"]'),
  tileApplyInputs: document.querySelectorAll('input[name="tile-apply"]'),
  tilePreview: document.getElementById("tile-preview"),
  configErrorView: document.getElementById("config-error-view"),
  configErrorProblems: document.getElementById("config-error-problems"),
  updateBanner: document.getElementById("update-banner"),
  updateVersion: document.getElementById("update-version"),
  updateReload: document.getElementById("update-reload"),
  toast: document.getElementById("toast"),
};

// User-adjustable settings, persisted per-device in localStorage. Defaults
// apply when nothing is stored yet (auto-bookmark on, config's poll interval).
const SETTINGS_KEY = "playlist-resume-settings";

// Playlist tile: which image to draw by default. tileStyle is one of the
// six generated styles, or the two pseudo-styles "song" (the saved track's
// album art) and "blank" (nothing). tileApply no longer gates rendering
// directly (see bookmarkTileSource in format.js / IDEAS.md #12) — it now
// only picks which tileMode a *newly created* bookmark starts in: "always"
// -> "settings" (force this style even when Spotify has a cover), "nocover"
// -> "spotify" (real art first, falling back to this style).
const TILE_APPLY = ["always", "nocover"];

// The same 8 choices as the Settings style picker, for the per-bookmark
// tile panel's "Pick a style" list — TILE_STYLES (generated) plus the two
// pseudo-styles, in the same order as index.html's Settings radios.
const TILE_PANEL_STYLES = [...TILE_STYLES, { id: "song", label: "Song art" }, { id: "blank", label: "Blank" }];

// The bookmark-list art tile, in CSS px — sized to match the height of the
// four text lines beside it (name, type+icons, track, resume/used) now that
// they're their own lines rather than one wrapping row. Passed into
// tileDataUrl() too so a generated style is drawn crisp at this size rather
// than upscaled from its old 52px default.
const BOOKMARK_ART_SIZE = 76;

function loadSettings() {
  const defaults = {
    autoBookmark: true,
    followBookmark: false,
    pollIntervalMs: POLL_INTERVAL_MS,
    tileStyle: DEFAULT_TILE_STYLE,
    tileApply: "nocover",
  };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    let tileStyle = TILE_STYLE_IDS.includes(stored.tileStyle) ? stored.tileStyle : defaults.tileStyle;
    let tileApply = TILE_APPLY.includes(stored.tileApply) ? stored.tileApply : null;
    if (!tileApply) {
      // Migrate the old 3-way tileScope (never | nocover | all).
      if (stored.tileScope === "all") tileApply = "always";
      else if (stored.tileScope === "never") {
        tileStyle = "blank";
        tileApply = "nocover";
      } else tileApply = defaults.tileApply;
    }
    return {
      autoBookmark:
        typeof stored.autoBookmark === "boolean" ? stored.autoBookmark : defaults.autoBookmark,
      followBookmark:
        typeof stored.followBookmark === "boolean" ? stored.followBookmark : defaults.followBookmark,
      pollIntervalMs:
        Number.isFinite(stored.pollIntervalMs) && stored.pollIntervalMs >= 1000
          ? stored.pollIntervalMs
          : defaults.pollIntervalMs,
      tileStyle,
      tileApply,
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
// PWA shortcut intent — read before anything rewrites the URL. If we're not
// logged in yet, the login redirect to Spotify and back loses any query
// param (the fixed redirectUri carries none), so stash it the same way
// auth.js stashes the PKCE verifier/state across that same round trip —
// localStorage, not sessionStorage, since a cross-origin redirect like this
// can come back into a different browsing context (e.g. plain Safari
// instead of an iOS home-screen PWA's own container), and sessionStorage
// wouldn't survive that but localStorage (origin-scoped) does. Read back in
// enterApp() via consumePendingShortcutAction().
const SHORTCUT_ACTION_KEY = "sb_pending_shortcut";
const shortcutAction = new URLSearchParams(location.search).get("action");
if (shortcutAction) {
  try {
    localStorage.setItem(SHORTCUT_ACTION_KEY, shortcutAction);
  } catch {
    /* private mode / storage disabled — shortcut just won't survive a login redirect */
  }
}

/** The pending shortcut action, if any — from the URL, else a login redirect
 *  earlier stashed in localStorage. One-shot: always clears the stash. */
function consumePendingShortcutAction() {
  let action = shortcutAction;
  try {
    if (!action) action = localStorage.getItem(SHORTCUT_ACTION_KEY);
    localStorage.removeItem(SHORTCUT_ACTION_KEY);
  } catch {
    /* private mode / storage disabled */
  }
  return action;
}

// Hidden flag — the catalogue search and the inline "Pick a track" list both
// hit endpoints (/search, /playlists/{id}/tracks) that burn through a
// Development-Mode app's small rate-limit budget in bursts. Off by default.
// Turn on for a session with  ?listtools=1  in the URL, or persist it with
//   localStorage.setItem("myspot:listTools", "1")
// in the browser console (use "0" to hide them again). The code for both
// features is left intact — only the UI that reaches them is gated.
const LIST_TOOLS_ENABLED = (() => {
  try {
    const flag = new URLSearchParams(location.search).get("listtools");
    if (flag === "1" || flag === "0") localStorage.setItem("myspot:listTools", flag);
    return localStorage.getItem("myspot:listTools") === "1";
  } catch {
    return false;
  }
})();

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
// Every bookmarked contextKey, rebuilt on every refreshBookmarkList() — used
// by the "keep an active bookmark updated" setting.
const bookmarkedContexts = new Set();
let lastTrackId = null;

// contextKey -> a playlist name resolveContextName() looked up for a playlist
// we're playing but haven't bookmarked, so the Now playing card can name an
// editorial mix. contextNameTried caps it at one attempt per context/session.
const contextNameHints = new Map();
const contextNameTried = new Set();

// The one bookmark whose tracklist is expanded, and a per-context cache of
// fetched tracks ("loading" | Track[] | null). Survives list re-renders.
let expandedId = null;
const expandedTracks = new Map();

// The one bookmark whose edit panel (name + tile source) is open. Survives
// list re-renders the same way expandedId does (independent of it — a user
// can have both a tracklist and an edit panel open on different bookmarks).
let editPanelId = null;

/**
 * Show a transient toast. Pass { actionLabel, onAction } for an inline
 * button (e.g. Undo); ms controls how long it stays up. The element is an
 * aria-live region and is hidden via `.toast:empty` (not the [hidden]
 * attribute) so screen readers reliably announce each new message.
 */
function hideToast() {
  clearTimeout(showToast._t);
  el.toast.textContent = "";
}

function showToast(message, { actionLabel, onAction, ms = 3500 } = {}) {
  clearTimeout(showToast._t);
  el.toast.textContent = message;
  if (actionLabel && onAction) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      hideToast();
      onAction();
    });
    el.toast.append(" ", btn);
  }
  showToast._t = setTimeout(hideToast, ms);
}

function setBookmarkStatus(message, kind) {
  el.bookmarkStatus.textContent = message || "";
  el.bookmarkStatus.className = "status" + (kind ? ` ${kind}` : "");
}

// Progress bar: `estimatedMs` advances once a second between polls so the bar
// moves smoothly, and resyncs to the real value on every poll.
let estimatedMs = 0;
let seekDragging = false;
let progressTicker = null;

function renderTransport() {
  if (!el.transport) return; // stale cached HTML without the transport markup
  const playing = !!currentSnapshot?.isPlaying;
  el.transport.hidden = !currentSnapshot;
  // toggleAttribute, not .hidden — .hidden isn't reflected on SVG elements.
  el.iconPlay.toggleAttribute("hidden", playing);
  el.iconPause.toggleAttribute("hidden", !playing);
  el.playPauseBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  renderProgress();
}

function renderProgress() {
  if (!el.seekRow) return;
  const dur = currentSnapshot?.track?.durationMs || 0;
  el.seekRow.hidden = !currentSnapshot || !dur;
  if (el.seekRow.hidden) return;

  el.seek.max = String(dur);
  el.seekTotal.textContent = formatDuration(dur);
  if (seekDragging) return; // don't fight the user

  const at = Math.min(Math.max(estimatedMs, 0), dur);
  el.seek.value = String(at);
  el.seek.setAttribute("aria-valuetext", `${formatDuration(at)} of ${formatDuration(dur)}`);
  el.seekElapsed.textContent = formatDuration(at);
  const pct = dur ? (at / dur) * 100 : 0;
  el.seek.style.background =
    `linear-gradient(to right, var(--accent) ${pct}%, #3a3a3a ${pct}%)`;
}

function startProgressTicker() {
  if (progressTicker) return;
  progressTicker = setInterval(() => {
    if (currentSnapshot?.isPlaying && !seekDragging) {
      estimatedMs += 1000;
      renderProgress();
    }
  }, 1000);
}

function stopProgressTicker() {
  clearInterval(progressTicker);
  progressTicker = null;
}

// One-off catch-up poll scheduled ~1s after the current track is expected to
// end, so a track change shows up promptly instead of waiting for the next
// regular poll tick (which can be up to a minute away on a slow interval).
// Only armed once we're within two poll intervals of the end: regular
// polling is periodic with period pollIntervalMs, so a window that wide is
// guaranteed to have a regular poll land inside it before the track ends
// (which is what arms this), and it keeps this timer from ever being a
// dangling, multi-minute-long setTimeout for most of a track's length.
let trackEndTimer = null;

function clearTrackEndTimer() {
  if (trackEndTimer) clearTimeout(trackEndTimer);
  trackEndTimer = null;
}

// Re-evaluated from a fresh snapshot on every regular poll, and cleared by
// any user-initiated position change (transport controls, manual seek,
// resuming a bookmark) — those already schedule their own short reconciling
// poll, which lands here again and re-arms against the corrected position.
function armTrackEndTimerIfClose(snapshot) {
  clearTrackEndTimer();
  const dur = snapshot?.track?.durationMs;
  const pos = snapshot?.progressMs;
  if (!snapshot?.isPlaying || !dur || pos == null) return;
  const remaining = dur - pos;
  if (remaining <= 2 * settings.pollIntervalMs) {
    trackEndTimer = setTimeout(pollOnce, Math.max(0, remaining) + 1000);
  }
}

function renderNowPlaying() {
  renderTransport();

  if (!currentSnapshot) {
    el.nowPlaying.textContent = "Nothing playing right now.";
    el.bookmarkBtn.disabled = true;
    el.bookmarkBtn.textContent = "Bookmark this spot";
    return;
  }

  const { track, context, isPlaying } = currentSnapshot;

  const metaLines = [
    escapeHtml(`${track.artists}${isPlaying ? "" : " (paused)"}`),
  ];
  if (track.albumName) {
    metaLines.push(`Album · ${escapeHtml(track.albumName)}`);
  }
  const albumFallback = !context && bookmarkableContext(currentSnapshot);
  if (!context) {
    metaLines.push(
      albumFallback
        ? "No playlist or album context — bookmarking saves this track's album"
        : "Nothing here to bookmark",
    );
  } else if (context.type === "playlist") {
    // A playlist's name isn't in the /me/player payload and we no longer
    // spend a poll-loop request to look it up. Use the name you gave the
    // matching bookmark, else the name stored on it when it was saved, else
    // a name resolveContextName() fetched once (Web API, then oEmbed); a
    // playlist that's none of those just shows "In a playlist".
    const key = contextKey(context.type, context.id);
    const name =
      customNameByContext.get(key) ||
      context.name ||
      storedBookmarkField(key, "contextName") ||
      contextNameHints.get(key);
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
  el.bookmarkBtn.disabled = !(context || albumFallback);
  el.bookmarkBtn.textContent = albumFallback ? "Bookmark this album" : "Bookmark this spot";
}

/** The contextName / imageUrl already stored for this context, if any — so a
 *  re-save doesn't clobber a good value when the API lookup is failing. */
function storedBookmarkField(key, field) {
  const bm = allBookmarks.find((b) => b.id === key);
  const v = bm?.[field];
  if (field === "contextName" && typeof v === "string" && v.startsWith("Unknown ")) return null;
  return v || null;
}

async function buildBookmarkFromSnapshot(snapshot) {
  const { type, id, uri, name } = bookmarkableContext(snapshot);
  const key = contextKey(type, id);
  // Only a brand-new bookmark gets a tileMode assigned here — every re-save
  // (auto-bookmark, follow-bookmark, a manual re-save) must never stomp a
  // choice made later via the per-bookmark tile panel. Omitting the field
  // from a merge-write leaves whatever's already stored untouched.
  const isNewBookmark = !allBookmarks.some((b) => b.id === key);

  // The bookmark's thumbnail is the playlist/album *cover*. For an album the
  // playing track's art is already that cover. For a playlist we need one
  // /playlists/{id} request — but only the first time: once a bookmark has a
  // real name and a cover stored, reuse them instead of re-hitting the API
  // on every auto-/follow-bookmark.
  let contextName = name;
  let coverUrl = null;
  if (type === "album") {
    coverUrl = snapshot.track.imageUrl ?? null;
  } else {
    const storedName = storedBookmarkField(key, "contextName");
    const storedCover = storedBookmarkField(key, "imageUrl");
    if (storedName && storedCover) {
      contextName = contextName ?? storedName;
      coverUrl = storedCover;
    } else {
      const meta = await getContextMeta(type, id);
      contextName = contextName ?? meta.name ?? storedName;
      // Real cover if Spotify gave us one. If it confirmed there's none (an
      // editorial playlist), store null so the list knows there's no cover
      // and draws a generated tile instead. A lookup that just didn't
      // complete keeps whatever was already stored.
      coverUrl = meta.imageUrl ?? (meta.noCover ? null : storedCover);
    }
  }

  return {
    contextType: type,
    contextId: id,
    contextUri: uri,
    contextName: contextName ?? `Unknown ${type}`,
    // Playlists with no readable cover stay null on purpose (the list draws
    // a tile); albums fall back to the track art, which *is* the cover.
    imageUrl: coverUrl ?? (type === "album" ? snapshot.track.imageUrl ?? null : null),
    // The saved track's own art, always — the tile setting can show this
    // instead of a generated tile for a playlist with no cover.
    trackImageUrl: snapshot.track.imageUrl ?? null,
    trackId: snapshot.track.id,
    trackUri: snapshot.track.uri,
    trackName: snapshot.track.name,
    artists: snapshot.track.artists,
    positionMs: snapshot.progressMs ?? 0, // Spotify can report null at a track boundary
    // See isNewBookmark above — this key is only present on first creation.
    ...(isNewBookmark
      ? { tileMode: settings.tileApply === "always" ? "settings" : "spotify" }
      : {}),
  };
}

/** Effective "last used" ms: the later of the server value and this tab's local mark. */
function usedAtMs(bm) {
  return Math.max(bookmarkUsedMs(bm), locallyUsedAt.get(bm.id) ?? 0);
}

let allBookmarks = [];

async function refreshBookmarkList() {
  allBookmarks = await listBookmarks(spotifyUserId);
  // Drop local "just used" marks the server value has now caught up to.
  for (const b of allBookmarks) {
    if ((locallyUsedAt.get(b.id) ?? 0) <= bookmarkUsedMs(b)) locallyUsedAt.delete(b.id);
  }
  customNameByContext.clear();
  bookmarkedContexts.clear();
  for (const b of allBookmarks) {
    bookmarkedContexts.add(b.id); // b.id is the contextKey
    if (b.customName) customNameByContext.set(b.id, b.customName);
  }
  renderBookmarks();
}

/** The currently playing track's art, when `bm`'s context is the one that's
 *  actually playing right now — undefined otherwise (bookmarkTileSource
 *  then falls back to the bookmark's saved trackImageUrl). */
function liveTrackImageUrlFor(bm) {
  const ctx = currentSnapshot?.context;
  if (!ctx || contextKey(ctx.type, ctx.id) !== bm.id) return undefined;
  return currentSnapshot.track.imageUrl;
}

/**
 * The image for a bookmark's tile — resolved via bookmarkTileSource()
 * (js/format.js) from its per-bookmark tileMode/tileStyleId/tileImageUrl
 * override, the global Settings style, and (when this bookmark's context is
 * the one currently playing) the live track's art. Applies to playlists and
 * albums alike (an untouched album bookmark's tileMode reads as "spotify",
 * and its imageUrl is always populated, so it keeps showing real art).
 */
function bookmarkArtUrl(bm) {
  const source = bookmarkTileSource(bm, {
    globalStyle: settings.tileStyle,
    liveTrackImageUrl: liveTrackImageUrlFor(bm),
    defaultStyle: DEFAULT_TILE_STYLE,
  });
  if (source.kind === "image") return source.url;
  if (source.kind === "generated") {
    return tileDataUrl(source.style, bm.contextId || bm.id, bookmarkName(bm), BOOKMARK_ART_SIZE);
  }
  return null;
}

const TILE_PREVIEW_NAMES = ["Discover Weekly", "Deep Focus", "Rainy Day"];

/** Redraw the sample under the style picker in Settings. */
function updateTilePreview() {
  if (!el.tilePreview) return;
  const mode = settings.tileStyle;
  if (mode === "song" || mode === "blank") {
    const note =
      mode === "song" ? "each bookmark shows the saved track's album art" : "the tile is left empty";
    el.tilePreview.innerHTML =
      `<img src="${tileDataUrl(mode, "x", "", 44)}" alt="" width="44" height="44" />` +
      `<span class="tile-preview-note">${escapeHtml(note.charAt(0).toUpperCase() + note.slice(1))}.</span>`;
    return;
  }
  el.tilePreview.innerHTML = TILE_PREVIEW_NAMES.map((n) => {
    const url = tileDataUrl(mode, n, n, 44);
    return `<img src="${url}" alt="" width="44" height="44" />`;
  }).join("");
}

/** Render allBookmarks, applying the filter box and the local-mark sort. */
function renderBookmarks() {
  const q = el.bookmarkFilter.value.trim().toLowerCase();
  el.bookmarkFilter.hidden = allBookmarks.length === 0;

  let bookmarks = pendingRemoval
    ? allBookmarks.filter((b) => b.id !== pendingRemoval.bookmark.id)
    : allBookmarks.slice();
  if (q) bookmarks = bookmarks.filter((b) => bookmarkMatches(b, q));
  bookmarks.sort((a, b) => usedAtMs(b) - usedAtMs(a));

  el.bookmarkList.innerHTML = "";
  el.bookmarkEmpty.hidden = allBookmarks.length > 0;
  el.bookmarkNoMatch.hidden = !(q && allBookmarks.length > 0 && bookmarks.length === 0);

  for (const bm of bookmarks) {
    const li = document.createElement("li");
    li.className = "bookmark-item";
    li.dataset.contextKey = bm.id; // used by updateLiveTileArt() to target this row without a full re-render

    const usedMs = usedAtMs(bm);
    const usedDate = usedMs ? new Date(usedMs) : null;
    const detail = [];
    if (Number.isFinite(bm.positionMs)) detail.push(`resumes at ${formatDuration(bm.positionMs)}`);
    if (usedDate) detail.push(`used ${formatRelative(usedDate)}`);

    const artUrl = bookmarkArtUrl(bm);
    const artInner = artUrl
      ? `<img class="bookmark-art" src="${escapeHtml(artUrl)}" alt="" width="${BOOKMARK_ART_SIZE}" height="${BOOKMARK_ART_SIZE}" loading="lazy" />`
      : `<div class="bookmark-art bookmark-art-empty" aria-hidden="true"></div>`;
    const art =
      `<a class="art-link" href="${escapeHtml(spotifyWebUrl(bm.contextUri))}" target="_blank" rel="noopener"` +
      ` title="Open in Spotify" aria-label="Open ${escapeHtml(bookmarkName(bm))} in Spotify">` +
      `${artInner}<span class="art-badge" aria-hidden="true">↗</span></a>`;
    const expanded = bm.id === expandedId;
    const editOpen = bm.id === editPanelId;
    const tileFrozen = bm.tileMode === "style" || bm.tileMode === "custom";
    li.innerHTML = `
      <div class="bookmark-main">
        ${art}
        <div class="bookmark-text">
          <div class="context-name-text">${escapeHtml(bookmarkName(bm))}</div>
          <div class="context-meta-row">
            <span class="context-type">${escapeHtml(bm.contextType)}</span>
            ${tileFrozen ? `<span class="tile-frozen-badge" title="Tile pinned — won't change if you edit Settings" aria-label="Tile pinned">📌</span>` : ""}
            <button class="refresh-btn" title="Refresh name & artwork from Spotify" aria-label="Refresh name and artwork">↻</button>
            <button class="edit-btn" title="Edit name & tile image" aria-label="Edit name and tile image" aria-expanded="${editOpen}">✎</button>
          </div>
          <div class="track-line">${escapeHtml(bm.trackName)} — ${escapeHtml(bm.artists)}</div>
          <div class="updated"${usedDate ? ` title="${escapeHtml(usedDate.toLocaleString())}"` : ""}>${escapeHtml(detail.join(" · "))}</div>
        </div>
      </div>
      ${editOpen ? `<div class="edit-panel"></div>` : ""}
      <div class="bookmark-actions">
        <button class="resume-btn">Resume</button>
        <div class="bookmark-subactions">
          ${LIST_TOOLS_ENABLED ? `<button class="tracks-btn" aria-expanded="${expanded}">${expanded ? "Hide tracks" : "Pick a track"}</button>` : ""}
          <button class="remove-btn">Remove</button>
        </div>
      </div>
      ${expanded ? `<div class="tracklist"></div>` : ""}
    `;
    li.querySelector(".resume-btn").addEventListener("click", () => onResume(bm));
    li.querySelector(".remove-btn").addEventListener("click", () => onRemove(bm, li));
    li.querySelector(".refresh-btn").addEventListener("click", () => refreshBookmarkInfo(bm));
    li.querySelector(".edit-btn").addEventListener("click", () => toggleEditPanel(bm));
    li.querySelector(".tracks-btn")?.addEventListener("click", () => toggleTracks(bm));
    if (editOpen) renderEditPanelInto(li.querySelector(".edit-panel"), bm);
    if (expanded) renderTracksInto(li.querySelector(".tracklist"), bm);
    el.bookmarkList.appendChild(li);
  }
}

async function toggleTracks(bm) {
  if (expandedId === bm.id) {
    expandedId = null;
    renderBookmarks();
    return;
  }
  expandedId = bm.id;
  if (!expandedTracks.has(bm.id)) {
    expandedTracks.set(bm.id, "loading");
    renderBookmarks();
    let tracks = null;
    try {
      tracks = await getContextTracks(bm.contextType, bm.contextId);
    } catch (err) {
      console.error("Track list failed:", err);
    }
    if (tracks === null) {
      expandedTracks.delete(bm.id); // transient error — allow a retry
    } else {
      expandedTracks.set(bm.id, tracks); // Track[] | { forbidden: true }
    }
  }
  if (expandedId === bm.id) renderBookmarks();
}

function renderTracksInto(container, bm) {
  const state = expandedTracks.get(bm.id);
  if (state === "loading") {
    container.textContent = "Loading tracks…";
    return;
  }
  if (state === null || state === undefined) {
    container.textContent =
      rateLimitedForMs() > 0
        ? "Spotify is rate-limiting the app — try again in a minute."
        : "Couldn't load the tracks — try again in a moment.";
    return;
  }
  if (state.forbidden) {
    container.textContent =
      "Spotify won't share this playlist's tracks with the app (editorial / algorithmic playlists).";
    return;
  }
  if (!state.length) {
    container.textContent = "This one has no tracks.";
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "track-rows";
  for (const t of state) {
    const row = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "track-row";
    btn.innerHTML =
      `<span class="track-row-name">${escapeHtml(t.name)}</span>` +
      `<span class="track-row-artist">${escapeHtml(t.artists)}</span>`;
    btn.addEventListener("click", () => onPlayTrack(bm, t));
    row.appendChild(btn);
    ul.appendChild(row);
  }
  container.replaceChildren(ul);
  if (state.length >= (bm.contextType === "album" ? 50 : 100)) {
    const note = document.createElement("p");
    note.className = "tracklist-note";
    note.textContent = `Showing the first ${state.length}.`;
    container.appendChild(note);
  }
}

function toggleEditPanel(bm) {
  editPanelId = editPanelId === bm.id ? null : bm.id;
  renderBookmarks();
}

const TILE_MODE_LABELS = {
  spotify: "Spotify's image",
  settings: "Settings style (whatever's picked below in Settings)",
  style: "Pick a style…",
  custom: "Upload an image",
};

/** Render the per-bookmark edit panel: a name field, then the tile-source
 *  picker (4 mode radios, plus the style-grid and upload sub-controls for
 *  the two config-bearing modes — always shown, so a stored pick survives
 *  switching away, but dimmed and disabled unless their mode is active). */
function renderEditPanelInto(container, bm) {
  const mode = bm.tileMode || "spotify";
  const styleId = bm.tileStyleId || DEFAULT_TILE_STYLE;
  const styleActive = mode === "style";
  const customActive = mode === "custom";
  const currentName = bm.customName || bm.contextName || "";

  container.innerHTML = `
    <div class="edit-name-row">
      <input type="text" class="edit-name-input" maxlength="120" value="${escapeHtml(currentName)}" placeholder="Bookmark name" />
    </div>
    <p class="setting-hint">Tap away or press Enter to save the name.</p>
    <div class="tile-panel-modes">
      ${Object.entries(TILE_MODE_LABELS)
        .map(
          ([m, label]) => `
        <label>
          <input type="radio" name="tile-mode-${escapeHtml(bm.id)}" value="${m}" ${mode === m ? "checked" : ""} />
          <span>${escapeHtml(label)}</span>
        </label>`,
        )
        .join("")}
    </div>
    <div class="tile-style-grid" ${styleActive ? "" : 'aria-disabled="true"'}>
      ${TILE_PANEL_STYLES.map(
        ({ id, label }) => `
        <label class="tile-style-option">
          <input type="radio" name="tile-style-${escapeHtml(bm.id)}" value="${id}"
                 ${styleId === id ? "checked" : ""} ${styleActive ? "" : "disabled"} />
          <span>${escapeHtml(label)}</span>
        </label>`,
      ).join("")}
    </div>
    <div class="tile-upload" ${customActive ? "" : 'aria-disabled="true"'}>
      ${
        bm.tileImageUrl
          ? `<img class="tile-upload-preview" src="${escapeHtml(bm.tileImageUrl)}" alt="" width="52" height="52" />`
          : `<div class="tile-upload-preview tile-upload-empty" aria-hidden="true"></div>`
      }
      <input type="file" accept="image/*" class="tile-upload-input" ${customActive ? "" : "disabled"} />
    </div>
  `;

  wireEditNameInput(container.querySelector(".edit-name-input"), bm);
  for (const input of container.querySelectorAll(`input[name="tile-mode-${CSS.escape(bm.id)}"]`)) {
    input.addEventListener("change", () => onTileModeChange(bm, input.value));
  }
  for (const input of container.querySelectorAll(`input[name="tile-style-${CSS.escape(bm.id)}"]`)) {
    input.addEventListener("change", () => onTileStyleChange(bm, input.value));
  }
  container
    .querySelector(".tile-upload-input")
    ?.addEventListener("change", (e) => onTileUpload(bm, e.target.files?.[0]));
}

/** Save on blur (Enter blurs too — no separate Save button, this panel isn't
 *  a modal you commit out of). Escape resets the field first; the reset
 *  value then computes back to the same customName, so the blur it triggers
 *  is a no-op save (skipped below) rather than an extra write. */
function wireEditNameInput(input, bm) {
  const save = async () => {
    const value = input.value.trim();
    const customName = value && value !== bm.contextName ? value : null;
    if (customName === (bm.customName || null)) return; // unchanged — skip the write and the re-render
    try {
      await renameBookmark(spotifyUserId, bm.id, customName);
    } catch (err) {
      console.error(err);
      showToast("Couldn't rename that bookmark.");
    }
    await refreshBookmarkList();
  };
  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      input.value = bm.customName || bm.contextName || "";
      input.blur();
    }
  });
}

async function onTileModeChange(bm, mode) {
  try {
    await updateBookmarkFields(spotifyUserId, bm.id, { tileMode: mode });
  } catch (err) {
    console.error("Tile mode change failed:", err);
    showToast("Couldn't save that.");
  }
  await refreshBookmarkList();
}

async function onTileStyleChange(bm, styleId) {
  try {
    await updateBookmarkFields(spotifyUserId, bm.id, { tileStyleId: styleId });
  } catch (err) {
    console.error("Tile style change failed:", err);
    showToast("Couldn't save that.");
  }
  await refreshBookmarkList();
}

const TILE_UPLOAD_SIZE = 200; // px, square — plenty for a 52px (up to ~2x dpr) list tile
const TILE_UPLOAD_MAX_CHARS = 300000; // matches firestore.rules' tileImageUrl cap

/** Read a picked file, center-crop to square, and downscale/compress it into
 *  a small data: URL — WebP when the browser can encode it, JPEG otherwise. */
async function downscaleToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = TILE_UPLOAD_SIZE;
    canvas.height = TILE_UPLOAD_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, TILE_UPLOAD_SIZE, TILE_UPLOAD_SIZE);
    const webp = canvas.toDataURL("image/webp", 0.82);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    bitmap.close?.();
  }
}

async function onTileUpload(bm, file) {
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await downscaleToDataUrl(file);
  } catch (err) {
    console.error("Tile upload read failed:", err);
    showToast("Couldn't read that image.");
    return;
  }
  if (!dataUrl || dataUrl.length > TILE_UPLOAD_MAX_CHARS) {
    showToast("That image is too large — try a different one.");
    return;
  }
  try {
    await updateBookmarkFields(spotifyUserId, bm.id, { tileMode: "custom", tileImageUrl: dataUrl });
  } catch (err) {
    console.error("Tile upload save failed:", err);
    showToast("Couldn't save that image.");
    return;
  }
  await refreshBookmarkList();
}

/** Keep a Song-art tile in sync with the currently playing track on every
 *  poll tick — a single targeted <img> swap, not a full renderBookmarks()
 *  (which would blow away an open rename or tile panel). No Firestore
 *  write: the saved trackImageUrl still only changes via the usual save
 *  paths (auto-/follow-/manual bookmark). */
function updateLiveTileArt() {
  const ctx = currentSnapshot?.context;
  if (!ctx) return;
  const key = contextKey(ctx.type, ctx.id);
  const bm = allBookmarks.find((b) => b.id === key);
  if (!bm) return;
  const source = bookmarkTileSource(bm, {
    globalStyle: settings.tileStyle,
    liveTrackImageUrl: liveTrackImageUrlFor(bm),
    defaultStyle: DEFAULT_TILE_STYLE,
  });
  if (source.kind !== "image" || !source.url) return;
  for (const li of el.bookmarkList.children) {
    if (li.dataset.contextKey === key) {
      const img = li.querySelector("img.bookmark-art");
      if (img) img.src = source.url;
      break;
    }
  }
}

async function onPlayTrack(bm, track) {
  try {
    await resumePlayback({ contextUri: bm.contextUri, trackUri: track.uri, positionMs: 0 });
    showToast(`Playing ${track.name}`);
    setTimeout(pollOnce, 1500);
  } catch (err) {
    console.error(err);
    showToast(
      /\b404\b/.test(err.message)
        ? "No active device — open Spotify somewhere first."
        : "Couldn't play that track.",
    );
  }
}

// Manual "refresh info" — re-ask Spotify for a playlist's real name and
// cover (forcing past the session cache and cooldown), and backfill the
// saved track's art for a bookmark that predates the trackImageUrl field.
// Fixes a stuck "Unknown playlist" or a blank Song-art tile without having
// to play the playlist and switch away.
let refreshingBookmarkId = null;
async function refreshBookmarkInfo(bm) {
  if (refreshingBookmarkId) return;
  refreshingBookmarkId = bm.id;
  try {
    const patch = {};
    if (bm.contextType === "playlist") {
      const meta = await getContextMeta(bm.contextType, bm.contextId, { force: true });
      if (meta.name && meta.name !== bm.contextName) patch.contextName = meta.name;
      if (meta.imageUrl && meta.imageUrl !== bm.imageUrl) patch.imageUrl = meta.imageUrl;
    }
    if (bm.trackId && !bm.trackImageUrl) {
      const art = await getTrackImage(bm.trackId);
      if (art) patch.trackImageUrl = art;
    }

    if (Object.keys(patch).length === 0) {
      showToast(
        rateLimitedForMs() > 0
          ? "Spotify is rate-limiting the app — try again in a minute."
          : "Nothing new from Spotify for that one.",
      );
      return;
    }
    await updateBookmarkFields(spotifyUserId, bm.id, patch);
    await refreshBookmarkList();
    showToast("Updated from Spotify.");
  } catch (err) {
    console.error("Refresh info failed:", err);
    showToast("Couldn't refresh that bookmark.");
  } finally {
    refreshingBookmarkId = null;
  }
}

const RESTART_THRESHOLD_MS = 5000;

async function onTransport(action) {
  // Optimistic play/pause flip so the button feels instant.
  if ((action === "play" || action === "pause") && currentSnapshot) {
    currentSnapshot.isPlaying = action === "play";
    renderTransport();
  }
  // Any user-initiated transport action invalidates whatever end-of-track
  // catch-up poll was armed — the reconciliation poll below will re-arm it
  // against the new state.
  clearTrackEndTimer();

  // Previous-track behavior like most players: past the first few seconds,
  // "previous" restarts the current track instead of jumping back a track.
  const restartInstead =
    action === "previous" && currentSnapshot?.track && estimatedMs > RESTART_THRESHOLD_MS;
  try {
    if (restartInstead) {
      await seek(0);
      estimatedMs = 0;
      renderProgress();
    } else {
      await playbackControl(action);
    }
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
  clearTrackEndTimer(); // jumping to a bookmarked spot invalidates it too
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

// --- Foldable <details> cards ----------------------------------------------

function setupFoldable(detailsEl, caretEl, storageKey) {
  const sync = () => {
    if (caretEl) caretEl.textContent = detailsEl.open ? "⌃" : "⌄";
  };
  try {
    detailsEl.open = localStorage.getItem(storageKey) === "1";
  } catch {
    /* storage disabled */
  }
  sync();
  detailsEl.addEventListener("toggle", () => {
    sync();
    try {
      localStorage.setItem(storageKey, detailsEl.open ? "1" : "0");
    } catch {
      /* storage disabled */
    }
  });
}

// --- Catalogue search ------------------------------------------------------

let searchTimer = null;

function onSearchInput() {
  clearTimeout(searchTimer);
  const q = el.searchInput.value.trim();
  if (!q) {
    el.searchResults.replaceChildren();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 300);
}

async function runSearch(q) {
  let results;
  try {
    results = await searchContexts(q);
  } catch (err) {
    console.error("Search failed:", err);
    return;
  }
  if (el.searchInput.value.trim() !== q) return; // a newer query is pending
  renderSearchResults(results);
}

function renderSearchResults(results) {
  el.searchResults.replaceChildren();
  if (!results.length) {
    const li = document.createElement("li");
    li.className = "search-empty";
    li.textContent = "No matches";
    el.searchResults.appendChild(li);
    return;
  }
  for (const r of results) {
    const li = document.createElement("li");
    li.className = "search-result";
    const art = r.imageUrl
      ? `<img class="search-art" src="${escapeHtml(r.imageUrl)}" alt="" width="40" height="40" loading="lazy" />`
      : `<div class="search-art search-art-empty" aria-hidden="true"></div>`;
    li.innerHTML = `
      ${art}
      <span class="search-text">
        <span class="search-name">${escapeHtml(r.name)}</span>
        <span class="search-sub">${escapeHtml(r.subtitle)}</span>
      </span>
    `;
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    const go = () => onPlayContext(r);
    li.addEventListener("click", go);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
    el.searchResults.appendChild(li);
  }
}

async function onPlayContext(item) {
  try {
    await resumePlayback({ contextUri: item.uri });
    showToast(`Playing ${item.name}`);
    el.searchResults.replaceChildren();
    el.searchInput.value = "";
    setTimeout(pollOnce, 1500);
  } catch (err) {
    console.error(err);
    if (/\b404\b/.test(err.message)) {
      const devices = (await getDevices().catch(() => [])).filter((d) => !d.is_restricted);
      showToast(
        devices.length
          ? "Open Spotify on a device, then try again."
          : "No Spotify device is available — open Spotify first.",
      );
    } else {
      showToast("Couldn't start that.");
    }
  }
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
  if (expandedId === bookmark.id) expandedId = null;
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
  if (!bookmarkableContext(currentSnapshot)) return;
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
    renderNowPlaying(); // re-sync the button's disabled state AND label
  }
}

// --- Backup & restore -------------------------------------------------------

function setImportStatus(message, kind) {
  el.importStatus.textContent = message || "";
  el.importStatus.className = "status" + (kind ? ` ${kind}` : "");
}

async function onExport() {
  const all = await listBookmarks(spotifyUserId);
  const payload = {
    app: "playlist-resume",
    version: 1,
    exportedAt: new Date().toISOString(),
    bookmarks: all.map((b) =>
      Object.fromEntries(EXPORT_FIELDS.map((f) => [f, b[f] ?? (f === "positionMs" ? 0 : null)])),
    ),
  };
  const json = JSON.stringify(payload, null, 2);
  el.exportText.value = json;
  el.exportText.hidden = false;
  try {
    await navigator.clipboard.writeText(json);
    showToast(`Copied ${payload.bookmarks.length} bookmark${payload.bookmarks.length === 1 ? "" : "s"}`);
  } catch {
    el.exportText.focus();
    el.exportText.select();
    showToast("Select all and copy the text below");
  }
}

async function onImport() {
  let parsed;
  try {
    parsed = JSON.parse(el.importText.value);
  } catch {
    setImportStatus("That isn't valid JSON.", "error");
    return;
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.bookmarks;
  const valid = Array.isArray(list) ? list.map(buildImportBookmark).filter(Boolean) : [];
  if (!valid.length) {
    setImportStatus("No usable bookmarks found in that text.", "error");
    return;
  }

  el.importBtn.disabled = true;
  setImportStatus(`Importing ${valid.length}…`);
  let ok = 0;
  for (const bm of valid) {
    try {
      await saveBookmark(spotifyUserId, bm);
      markUsedNow(contextKey(bm.contextType, bm.contextId));
      ok += 1;
    } catch (err) {
      console.error("Import of one bookmark failed:", err);
    }
  }
  el.importBtn.disabled = false;
  setImportStatus(
    `Imported ${ok}${ok < list.length ? ` of ${list.length} (${list.length - ok} skipped)` : ""}.`,
    ok ? "success" : "error",
  );
  if (ok) el.importText.value = "";
  await refreshBookmarkList();
}

let polling = false;
let rateLimitToastAt = 0;

/** Runs on every poll tick: updates the display and auto-bookmarks on context switch. */
async function pollOnce() {
  // A tick can outlast the interval (429 backoff, a slow name lookup). Skip
  // overlapping runs so two of them can't both fire the auto-bookmark.
  if (polling) return;
  // Spotify is rate-limiting the app — sit completely still so its window
  // can reset. The interval keeps firing; these ticks just no-op.
  if (rateLimitedForMs() > 0) {
    if (Date.now() - rateLimitToastAt > 60_000) {
      const mins = Math.ceil(rateLimitedForMs() / 60_000);
      showToast(
        `Spotify is rate-limiting the app — holding off ${mins > 1 ? `~${mins} min` : "a moment"} so it can recover.`,
      );
      rateLimitToastAt = Date.now();
    }
    return;
  }
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

  // Playing inside a context that's already bookmarked, and the track just
  // changed — advance that bookmark to the new spot (opt-in setting).
  const newTrackId = snapshot?.track?.id ?? null;
  if (
    settings.followBookmark &&
    newKey &&
    lastTrackId &&
    newTrackId &&
    newTrackId !== lastTrackId &&
    bookmarkedContexts.has(newKey)
  ) {
    try {
      const bookmark = await buildBookmarkFromSnapshot(snapshot);
      await saveBookmark(spotifyUserId, bookmark);
      markUsedNow(newKey);
      await refreshBookmarkList();
    } catch (err) {
      console.error("Follow-bookmark update failed:", err);
    }
  }
  lastTrackId = newTrackId;

  currentSnapshot = snapshot;
  lastContextSnapshot = snapshot?.context ? snapshot : null;
  if (!seekDragging) estimatedMs = snapshot?.progressMs ?? 0; // resync the progress bar
  armTrackEndTimerIfClose(snapshot);

  // No per-tick /playlists lookup for the name any more — that one request,
  // fired every poll for any playlist without a stored name, was the bulk of
  // the app's steady-state API traffic and the call that kept 429-ing.
  // renderNowPlaying() falls back to the bookmarked name (or "In a playlist").
  renderNowPlaying();
  updateLiveTileArt();
  resolveContextName(snapshot); // one-shot, off the poll critical path
}

// One name lookup for a playlist we're playing but haven't bookmarked, so the
// Now playing card can name it (getContextMeta tries the Web API, then
// open.spotify.com/oembed for an editorial mix). Not awaited by the poll
// loop, capped at one attempt per context per session, and skipped entirely
// once a bookmark for it exists.
async function resolveContextName(snapshot) {
  const ctx = snapshot?.context;
  if (!ctx || ctx.type !== "playlist") return;
  const key = contextKey(ctx.type, ctx.id);
  if (
    contextNameTried.has(key) ||
    bookmarkedContexts.has(key) ||
    customNameByContext.has(key) ||
    storedBookmarkField(key, "contextName")
  ) {
    return;
  }
  contextNameTried.add(key);
  try {
    const meta = await getContextMeta(ctx.type, ctx.id);
    if (!meta.name) return;
    contextNameHints.set(key, meta.name);
    const now = currentSnapshot?.context;
    if (now && contextKey(now.type, now.id) === key) renderNowPlaying();
  } catch (err) {
    console.error("Context-name lookup failed:", err);
  }
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
  clearTrackEndTimer();
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
  el.updateReload.textContent = "Updating…";
  // Nuke every layer that could serve a stale build: the Cache Storage
  // caches, then the service worker registrations. The reload then hits the
  // network with no worker in the way.
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* ignore */
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
  startProgressTicker();

  if (consumePendingShortcutAction() === "resume-last") await resumeLastBookmark();
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
  stopProgressTicker();
  commitRemoval();
  hideDevicePicker();
  clearTimeout(searchTimer);
  el.searchInput.value = "";
  el.searchResults.replaceChildren();
  el.bookmarkFilter.value = "";
  expandedId = null;
  expandedTracks.clear();
  editPanelId = null;
  contextNameHints.clear();
  contextNameTried.clear();
  el.loginView.hidden = false;
  el.appView.hidden = true;
}

// auth.js fires this once when a token refresh is rejected (refresh token
// revoked or expired) — it has already cleared the stored tokens. Drop to
// the login view and say why; a reload would just fail the same way.
let sessionExpiryHandled = false;
function handleSessionExpired() {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;
  spotifyUserId = null;
  enterLoggedOut();
  showToast("Your Spotify session expired — log in again.", { ms: 8000 });
}

// config.json failed to load or validate — without the Spotify Client ID and
// Firebase config the app can't reach either service. Show the setup screen
// (index.html) with the specific problems, rather than a login button that
// can't work. A fixed config.json takes effect on the next load.
function showConfigError(err) {
  console.error("Configuration error:", err);
  el.loginView.hidden = true;
  el.appView.hidden = true;
  if (!el.configErrorView) {
    // Cached HTML from before this screen existed — say it in a toast.
    showToast("config.json is missing or invalid — see the README.", { ms: 12000 });
    return;
  }
  el.configErrorView.hidden = false;
  const problems = err instanceof ConfigError ? err.problems : [];
  if (el.configErrorProblems) {
    el.configErrorProblems.innerHTML = problems
      .map((p) => `<li>${escapeHtml(p)}</li>`)
      .join("");
    el.configErrorProblems.hidden = problems.length === 0;
  }
}

const COPYRIGHT = "© 2026 Juan D. Martin";

async function init() {
  const versionEl = document.getElementById("app-version");
  if (versionEl) versionEl.textContent = `${COPYRIGHT} · v${APP_VERSION}`;
  console.info(`My Spot v${APP_VERSION} — ${COPYRIGHT}`);

  el.updateReload.addEventListener("click", applyUpdate);
  checkForUpdate();

  if ("serviceWorker" in navigator) {
    // updateViaCache: "none" — never serve sw.js itself from the HTTP cache,
    // so a new worker is always detected on the next load.
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .catch((err) => console.error("SW registration failed:", err));
  }

  // Everything past here needs the Spotify Client ID and Firebase config from
  // ./config.json. If it's missing or malformed, show the setup screen and
  // stop — the update banner and SW are already wired above, so pushing a
  // fixed config.json still gets picked up.
  try {
    applyRuntimeConfig(await loadRuntimeConfig());
  } catch (err) {
    showConfigError(err);
    return;
  }

  el.loginBtn.addEventListener("click", loginWithSpotify);
  el.logoutBtn.addEventListener("click", () => {
    commitRemoval(); // finish any pending Remove while we still have the user id
    logout();
    spotifyUserId = null;
    enterLoggedOut();
  });
  el.bookmarkBtn.addEventListener("click", onManualBookmark);
  el.bookmarkFilter.addEventListener("input", renderBookmarks);
  el.bookmarkFilter.addEventListener("search", renderBookmarks); // "x" clear
  el.exportBtn.addEventListener("click", onExport);
  el.importBtn.addEventListener("click", onImport);
  el.deviceCancel.addEventListener("click", hideDevicePicker);
  el.prevBtn.addEventListener("click", () => onTransport("previous"));
  el.nextBtn.addEventListener("click", () => onTransport("next"));
  el.playPauseBtn.addEventListener("click", onPlayPause);

  el.seek.addEventListener("input", () => {
    seekDragging = true;
    const ms = Number(el.seek.value);
    const dur = currentSnapshot?.track?.durationMs || 1;
    el.seekElapsed.textContent = formatDuration(ms);
    el.seek.setAttribute("aria-valuetext", `${formatDuration(ms)} of ${formatDuration(dur)}`);
    el.seek.style.background =
      `linear-gradient(to right, var(--accent) ${(ms / dur) * 100}%, #3a3a3a ${(ms / dur) * 100}%)`;
  });
  el.seek.addEventListener("change", async () => {
    const ms = Number(el.seek.value);
    estimatedMs = ms;
    seekDragging = false;
    clearTrackEndTimer(); // stale until the reconciliation poll below re-arms it
    try {
      await seek(ms);
    } catch (err) {
      console.error(err);
      showToast(/\b404\b/.test(err.message) ? "No active device to seek." : "Couldn't seek.");
    }
    setTimeout(pollOnce, 800);
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("myspot:sessionexpired", handleSessionExpired);

  // Strip one-shot query params so a manual reload doesn't re-fire them
  // (the shortcut action, and the ?listtools flag once it's been persisted).
  {
    const params = new URLSearchParams(location.search);
    let changed = false;
    for (const k of ["action", "listtools"]) {
      if (params.has(k)) {
        params.delete(k);
        changed = true;
      }
    }
    if (changed) {
      const qs = params.toString();
      history.replaceState({}, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }
  }

  // Foldable <details> cards remember their open state per device.
  setupFoldable(el.settingsCard, document.getElementById("fold-caret"), "playlist-resume-settings-open");
  if (LIST_TOOLS_ENABLED) {
    setupFoldable(el.searchCard, document.getElementById("search-caret"), "playlist-resume-search-open");
    el.searchInput.addEventListener("input", onSearchInput);
    el.searchInput.addEventListener("search", onSearchInput); // "x" clear button
  } else {
    el.searchCard.hidden = true;
  }

  el.autoBookmarkToggle.checked = settings.autoBookmark;
  el.autoBookmarkToggle.addEventListener("change", () => {
    settings.autoBookmark = el.autoBookmarkToggle.checked;
    saveSettings();
  });

  el.followBookmarkToggle.checked = settings.followBookmark;
  el.followBookmarkToggle.addEventListener("change", () => {
    settings.followBookmark = el.followBookmarkToggle.checked;
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

  for (const input of el.tileStyleInputs) {
    input.checked = input.value === settings.tileStyle;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      settings.tileStyle = input.value;
      saveSettings();
      updateTilePreview();
      renderBookmarks(); // tiles are chosen at render time — just repaint
    });
  }
  for (const input of el.tileApplyInputs) {
    input.checked = input.value === settings.tileApply;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      settings.tileApply = input.value;
      saveSettings();
      renderBookmarks();
    });
  }
  updateTilePreview();

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
      // If the session expired mid-startup, handleSessionExpired already
      // switched to the login view — don't tell the user to reload.
      if (isLoggedIn()) {
        setBookmarkStatus("Couldn't reach Spotify — reload to try again.", "error");
      }
    }
  } else {
    enterLoggedOut();
  }
}

init();
