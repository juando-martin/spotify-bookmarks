// Copyright (c) 2026 Juan D. Martin
// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";
import { normalizePlaybackState, smallestImageUrl, rateLimitWaitSeconds } from "./format.js";

const API_BASE = "https://api.spotify.com/v1";
const contextMetaCache = new Map();
// Contexts that returned 404 this session (editorial playlists a dev-mode
// app can't read) — don't re-ask them on every poll tick.
const unreadableContexts = new Set();
// cacheKey -> timestamp to retry after, for non-404 getContextMeta failures.
const contextMetaCooldown = new Map();

// Spotify rate-limits per app on a rolling window. When we hit a 429, stop
// making requests entirely until the window passes — retrying each call
// individually just digs the hole deeper and freezes the whole app.
//
// The deadline is persisted: a reload (or a service-worker update) would
// otherwise reset it to 0 and immediately fire a poll straight into the
// penalty window, which keeps the app flagged and the window from ever
// resetting. This is what turned a brief 429 into a multi-hour lockout.
const RATE_LIMIT_KEY = "myspot:rl";
// A deadline recovered from storage (a reload, or another tab) is only
// trusted for up to an hour from now: we can't be sure it's still real,
// and probing a genuinely-limited API once an hour is harmless. A 429 this
// session set live still holds its full Retry-After in memory.
const PERSISTED_MAX_MS = 3_600_000;

try {
  localStorage.removeItem("myspot:rateLimitedUntil"); // pre-v42 key — drop stale values
} catch {
  /* ignore */
}

const cappedPersisted = (raw) =>
  Number.isFinite(raw) && raw > Date.now()
    ? Math.min(raw, Date.now() + PERSISTED_MAX_MS)
    : 0;

let rateLimitedUntil = 0;
try {
  rateLimitedUntil = cappedPersisted(Number(localStorage.getItem(RATE_LIMIT_KEY)));
} catch {
  /* private mode / storage disabled — in-memory only */
}

function setRateLimitedUntil(ts) {
  rateLimitedUntil = ts;
  try {
    if (ts > Date.now()) localStorage.setItem(RATE_LIMIT_KEY, String(ts));
    else localStorage.removeItem(RATE_LIMIT_KEY);
  } catch {
    /* ignore */
  }
}

// The effective deadline: the later of this context's value and whatever
// another tab has persisted (capped — see PERSISTED_MAX_MS). Reading
// storage on every check, not just at load, means a 429 in one tab pauses
// every other open tab too.
function rateLimitDeadline() {
  try {
    const stored = cappedPersisted(Number(localStorage.getItem(RATE_LIMIT_KEY)));
    if (stored > rateLimitedUntil) rateLimitedUntil = stored;
  } catch {
    /* ignore */
  }
  return rateLimitedUntil;
}

// How persistent the 429s are. Spotify ratchets a misbehaving app's
// penalty up the longer it keeps seeing traffic, so we ratchet our own
// wait up to match — each 429 doubles the floor. The streak only really
// clears once we've gone RATE_LIMIT_CALM_MS with no 429 at all: a single
// endpoint being limited (e.g. /playlists while /me/player still answers)
// must not let those steady 200s reset the escalation every poll.
const RATE_LIMIT_CALM_MS = 5 * 60_000;
let rateLimitStreak = 0;
let lastRateLimitAt = 0;

/** Milliseconds until it's safe to hit the API again (0 when clear). */
export const rateLimitedForMs = () => Math.max(0, rateLimitDeadline() - Date.now());

async function apiFetch(path, options = {}, attempt = 0) {
  if (Date.now() < rateLimitDeadline()) {
    return new Response(null, { status: 429, statusText: "Rate limited (backing off)" });
  }

  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.ok && rateLimitedUntil <= Date.now()) {
    // Not racing ahead of a backoff we just set. Clear the deadline, but
    // only drop the escalation streak once the 429s have actually stopped
    // for a while — otherwise one healthy endpoint resets it every poll.
    if (rateLimitedUntil) setRateLimitedUntil(0);
    if (Date.now() - lastRateLimitAt > RATE_LIMIT_CALM_MS) rateLimitStreak = 0;
  }

  if (res.status === 401 && attempt === 0) {
    // Token rejected — force a refresh (not just a re-read of the cached
    // one, which the 30s expiry margin would otherwise hand back) and retry.
    await getAccessToken(true).catch(() => {});
    return apiFetch(path, options, attempt + 1);
  }

  if (res.status === 429) {
    // Don't retry — just note when it's safe to make requests again. Every
    // apiFetch above short-circuits until then, so the poll loop pauses
    // instead of hammering. rateLimitWaitSeconds() (in format.js, unit-
    // tested) honours Retry-After in full and escalates each repeat 429;
    // poking the API before it's up just re-arms Spotify's penalty, which
    // is how the app stayed locked out for hours. A clean response resets
    // the streak.
    rateLimitStreak += 1;
    lastRateLimitAt = Date.now();
    const waitS = rateLimitWaitSeconds(
      Number(res.headers.get("Retry-After")),
      rateLimitStreak,
    );
    setRateLimitedUntil(Date.now() + waitS * 1000);
    console.warn(`Spotify rate limit — pausing all requests for ${waitS}s`);
  }

  return res;
}

/** Who's logged in — needed as the key for storing bookmarks per user. */
export async function getCurrentUser() {
  const res = await apiFetch("/me");
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  return res.json(); // { id, display_name, ... }
}

/**
 * Get Playback State. Returns null when nothing is playing (204 No Content)
 * or when the item isn't playable, otherwise the normalized snapshot from
 * normalizePlaybackState() (see js/format.js).
 */
export async function getPlaybackState() {
  const res = await apiFetch("/me/player");
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to fetch playback state: ${res.status}`);
  return normalizePlaybackState(await res.json());
}

/**
 * Playlist/album metadata — `{ name, imageUrl, noCover }` — cached in memory
 * for the session. imageUrl is the playlist/album *cover* (not any track's
 * art), null when there isn't one or it can't be read.
 *
 * `noCover` is true only when Spotify *confirmed* there's no usable cover —
 * a 200 with no images, or a 404 (an editorial playlist a Development-Mode
 * app can't fetch). It stays false/undefined when the lookup simply didn't
 * complete (transient error, on cooldown), so the caller can tell "there
 * will never be a cover, fall back for good" from "try again later".
 */
export async function getContextMeta(type, id) {
  const cacheKey = `${type}:${id}`;
  if (contextMetaCache.has(cacheKey)) {
    return contextMetaCache.get(cacheKey);
  }
  if (unreadableContexts.has(cacheKey)) {
    return { name: null, imageUrl: null, noCover: true };
  }
  if ((contextMetaCooldown.get(cacheKey) ?? 0) > Date.now()) {
    return { name: null, imageUrl: null }; // failed recently — status unknown
  }
  const path =
    type === "playlist" ? `/playlists/${id}?fields=name,images` : `/albums/${id}`;
  const res = await apiFetch(path);
  if (res.status === 404) {
    unreadableContexts.add(cacheKey); // persistent — stop asking this session
    return { name: null, imageUrl: null, noCover: true };
  }
  if (!res.ok) {
    // Back this context off so a stuck poll loop doesn't re-request it every
    // few seconds. 429 gets the *longer* cooldown, not a pass: the global
    // backoff is only ~60s, and if just this endpoint is limited (playback
    // state still flows) we'd otherwise poke this one playlist once a minute
    // forever, each poke re-arming Spotify's penalty. The name is worth far
    // less than getting unstuck — the card falls back to "In a playlist".
    contextMetaCooldown.set(
      cacheKey,
      Date.now() + (res.status === 429 ? 15 * 60_000 : 10 * 60_000),
    );
    return { name: null, imageUrl: null }; // status unknown — don't treat as "no cover"
  }
  contextMetaCooldown.delete(cacheKey);
  const data = await res.json();
  const imageUrl = smallestImageUrl(data.images);
  const meta = { name: data.name || null, imageUrl, noCover: !imageUrl };
  if (meta.name || meta.imageUrl) contextMetaCache.set(cacheKey, meta);
  return meta;
}

/**
 * Search the catalogue for playlists and albums matching `query`. Returns a
 * flat list of `{ type, id, uri, name, subtitle, imageUrl }` (playlists
 * first). Empty on a blank query or an error.
 */
export async function searchContexts(query) {
  const q = query.trim();
  if (!q) return [];
  const res = await apiFetch(
    `/search?type=playlist,album&limit=6&q=${encodeURIComponent(q)}`,
  );
  if (!res.ok) return [];
  const data = await res.json();

  const playlists = (data.playlists?.items || []).filter(Boolean).map((p) => ({
    type: "playlist",
    id: p.id,
    uri: p.uri,
    name: p.name,
    subtitle: p.owner?.display_name ? `Playlist · ${p.owner.display_name}` : "Playlist",
    imageUrl: smallestImageUrl(p.images),
  }));
  const albums = (data.albums?.items || []).filter(Boolean).map((a) => ({
    type: "album",
    id: a.id,
    uri: a.uri,
    name: a.name,
    subtitle: `Album · ${(a.artists || []).map((x) => x.name).join(", ")}`,
    imageUrl: smallestImageUrl(a.images),
  }));
  return [...playlists, ...albums].slice(0, 8);
}

/**
 * The tracks of a playlist or album, as `{ uri, name, artists }`. Capped at
 * the first 100 (playlist) / 50 (album). Returns:
 *   Track[]              on success (possibly empty)
 *   { forbidden: true }  on 404 — an editorial playlist this app can't read
 *   null                 on any other error (transient — worth retrying)
 */
export async function getContextTracks(type, id) {
  const path =
    type === "playlist"
      ? `/playlists/${id}/tracks?limit=100`
      : `/albums/${id}/tracks?limit=50`;
  const res = await apiFetch(path);
  if (!res.ok) {
    console.error(`getContextTracks(${type}, ${id}) -> ${res.status}`);
    return res.status === 404 ? { forbidden: true } : null;
  }
  const data = await res.json();
  const raw =
    type === "playlist" ? (data.items || []).map((i) => i && i.track) : data.items || [];
  return raw
    .filter((t) => t && t.uri && !t.uri.startsWith("spotify:local:"))
    .map((t) => ({
      uri: t.uri,
      name: t.name || "",
      artists: (t.artists || []).map((a) => a.name).join(", "),
    }));
}

/** Spotify Connect devices this account can see (active or idle). */
export async function getDevices() {
  const res = await apiFetch("/me/player/devices");
  if (!res.ok) return [];
  const data = await res.json();
  return data.devices || []; // [{ id, name, type, is_active, is_restricted }]
}

/**
 * Start/Resume Playback inside a context (playlist or album). With trackUri
 * it starts at that track + position; without one it starts from the top of
 * the context. Pass deviceId to target (and transfer to) a specific device.
 */
export async function resumePlayback({ contextUri, trackUri, positionMs, deviceId }) {
  const path = deviceId
    ? `/me/player/play?device_id=${encodeURIComponent(deviceId)}`
    : "/me/player/play";
  const res = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context_uri: contextUri,
      offset: trackUri ? { uri: trackUri } : { position: 0 },
      position_ms: positionMs || 0,
    }),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to resume playback: ${res.status} ${text}`);
  }
}

/**
 * Transport controls for whatever is currently playing. action is one of
 * "next", "previous", "pause", "play" (play resumes the current track).
 */
export async function playbackControl(action) {
  const method = action === "next" || action === "previous" ? "POST" : "PUT";
  const res = await apiFetch(`/me/player/${action}`, { method });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Playback ${action} failed: ${res.status} ${text}`);
  }
}

/** Seek within the current track. */
export async function seek(positionMs) {
  const ms = Math.max(0, Math.round(positionMs));
  const res = await apiFetch(`/me/player/seek?position_ms=${ms}`, { method: "PUT" });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Seek failed: ${res.status} ${text}`);
  }
}
