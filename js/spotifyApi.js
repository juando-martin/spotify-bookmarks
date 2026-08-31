// Copyright (c) 2026 Juan D. Martin
// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";
import { normalizePlaybackState, smallestImageUrl } from "./format.js";
import { createRateLimiter } from "./rateLimit.js";

const API_BASE = "https://api.spotify.com/v1";
const contextMetaCache = new Map();
// Contexts that returned 404 this session (editorial playlists a dev-mode
// app can't read) — don't re-ask them on every poll tick.
const unreadableContexts = new Set();
// cacheKey -> timestamp to retry after, for non-404 getContextMeta failures.
const contextMetaCooldown = new Map();

// Spotify rate-limits per app on a rolling window. On a 429 we stop making
// requests entirely until it passes — retrying individual calls just digs
// the hole deeper and freezes the whole app. The state machine (persisted
// deadline, escalation, cross-tab read, 1h cap on a recovered value) lives
// in ./rateLimit.js, unit-tested.
const limiter = createRateLimiter();

/** Milliseconds until it's safe to hit the API again (0 when clear). */
export const rateLimitedForMs = () => limiter.waitMs();

async function apiFetch(path, options = {}, attempt = 0) {
  if (limiter.blocked()) {
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

  if (res.ok) limiter.onOk();

  if (res.status === 401 && attempt === 0) {
    // Token rejected — force a refresh (not just a re-read of the cached
    // one, which the 30s expiry margin would otherwise hand back) and retry.
    await getAccessToken(true).catch(() => {});
    return apiFetch(path, options, attempt + 1);
  }

  if (res.status === 429) {
    // Don't retry — just record when it's safe again. Every apiFetch above
    // short-circuits until then, so the poll loop pauses instead of
    // hammering; poking the API before it's up re-arms Spotify's penalty.
    const waitS = limiter.on429(Number(res.headers.get("Retry-After")));
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
 *
 * `force` (used by the manual "refresh info" action) bypasses the session
 * cache and the failure cooldown — but not a confirmed 404, and not the
 * global rate-limit gate.
 */
export async function getContextMeta(type, id, { force = false } = {}) {
  const cacheKey = `${type}:${id}`;
  if (!force && contextMetaCache.has(cacheKey)) {
    return contextMetaCache.get(cacheKey);
  }
  if (unreadableContexts.has(cacheKey)) {
    return { name: null, imageUrl: null, noCover: true };
  }
  if (!force && (contextMetaCooldown.get(cacheKey) ?? 0) > Date.now()) {
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
 * The album art (smallest) for a single track, or null. Only used by the
 * manual "refresh info" action to backfill `trackImageUrl` on a bookmark
 * saved before that field existed.
 */
export async function getTrackImage(trackId) {
  if (!trackId) return null;
  const res = await apiFetch(`/tracks/${encodeURIComponent(trackId)}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return smallestImageUrl(data?.album?.images);
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
