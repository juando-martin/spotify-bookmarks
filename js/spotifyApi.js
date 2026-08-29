// Copyright (c) 2026 Juan D. Martin
// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";
import { normalizePlaybackState, smallestImageUrl } from "./format.js";

const API_BASE = "https://api.spotify.com/v1";
const contextMetaCache = new Map();
// Contexts that returned 404 this session (editorial playlists a dev-mode
// app can't read) — don't re-ask them on every poll tick.
const unreadableContexts = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiFetch(path, options = {}, attempt = 0) {
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

  // Rate limited — Spotify's Retry-After header is in seconds. Wait it out
  // (capped, so a poll can never hang for long) and retry a few times
  // rather than hammering and digging the hole deeper.
  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    const waitMs = Math.min(Number.isFinite(retryAfter) ? retryAfter : 2, 15) * 1000;
    await sleep(waitMs);
    return apiFetch(path, options, attempt + 1);
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
  const path =
    type === "playlist" ? `/playlists/${id}?fields=name,images` : `/albums/${id}`;
  const res = await apiFetch(path);
  if (res.status === 404) {
    unreadableContexts.add(cacheKey); // persistent — stop asking this session
    return { name: null, imageUrl: null };
  }
  if (!res.ok) return { name: null, imageUrl: null }; // transient — retry next time
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
