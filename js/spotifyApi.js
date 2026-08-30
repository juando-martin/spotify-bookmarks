// Copyright (c) 2026 Juan D. Martin
// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";
import { normalizePlaybackState, smallestImageUrl } from "./format.js";

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
let rateLimitedUntil = 0;

/** Milliseconds until it's safe to hit the API again (0 when clear). */
export const rateLimitedForMs = () => Math.max(0, rateLimitedUntil - Date.now());

async function apiFetch(path, options = {}, attempt = 0) {
  if (Date.now() < rateLimitedUntil) {
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

  if (res.status === 401 && attempt === 0) {
    // Token rejected — force a refresh (not just a re-read of the cached
    // one, which the 30s expiry margin would otherwise hand back) and retry.
    await getAccessToken(true).catch(() => {});
    return apiFetch(path, options, attempt + 1);
  }

  if (res.status === 429) {
    // Don't retry — just note when it's safe to make requests again. Every
    // apiFetch above short-circuits until then, so the poll loop pauses
    // instead of hammering. Minimum 20s so Spotify's rolling window can
    // actually reset (a poll every 5s would keep it pinned open).
    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitS = Math.min(Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 20), 120);
    rateLimitedUntil = Date.now() + waitS * 1000;
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
 * Playlist/album metadata — `{ name, imageUrl }` — cached in memory for the
 * session. imageUrl is the playlist/album *cover* (not any track's art).
 * Both fields are null when it can't be read (a transient error, or an
 * editorial playlist a Development-Mode app isn't allowed to fetch); the
 * caller decides what to fall back to.
 */
export async function getContextMeta(type, id) {
  const cacheKey = `${type}:${id}`;
  if (contextMetaCache.has(cacheKey)) {
    return contextMetaCache.get(cacheKey);
  }
  if (unreadableContexts.has(cacheKey)) {
    return { name: null, imageUrl: null };
  }
  if ((contextMetaCooldown.get(cacheKey) ?? 0) > Date.now()) {
    return { name: null, imageUrl: null }; // failed recently — don't re-hit it yet
  }
  const path =
    type === "playlist" ? `/playlists/${id}?fields=name,images` : `/albums/${id}`;
  const res = await apiFetch(path);
  if (res.status === 404) {
    unreadableContexts.add(cacheKey); // persistent — stop asking this session
    return { name: null, imageUrl: null };
  }
  if (!res.ok) {
    // A real hiccup (not a 429 — that's the global backoff's job, and it's
    // not this context's fault) — back it off so a stuck poll loop doesn't
    // re-request it every few seconds.
    if (res.status !== 429) {
      contextMetaCooldown.set(cacheKey, Date.now() + 10 * 60_000);
    }
    return { name: null, imageUrl: null };
  }
  contextMetaCooldown.delete(cacheKey);
  const data = await res.json();
  const meta = { name: data.name || null, imageUrl: smallestImageUrl(data.images) };
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
