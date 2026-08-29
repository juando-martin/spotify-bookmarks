// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";
import { normalizePlaybackState, smallestImageUrl } from "./format.js";

const API_BASE = "https://api.spotify.com/v1";
const contextMetaCache = new Map();

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
  const path =
    type === "playlist" ? `/playlists/${id}?fields=name,images` : `/albums/${id}`;
  const res = await apiFetch(path);
  if (!res.ok) return { name: null, imageUrl: null }; // don't cache — could be transient
  const data = await res.json();
  const meta = { name: data.name || null, imageUrl: smallestImageUrl(data.images) };
  if (meta.name || meta.imageUrl) contextMetaCache.set(cacheKey, meta);
  return meta;
}

/** Spotify Connect devices this account can see (active or idle). */
export async function getDevices() {
  const res = await apiFetch("/me/player/devices");
  if (!res.ok) return [];
  const data = await res.json();
  return data.devices || []; // [{ id, name, type, is_active, is_restricted }]
}

/**
 * Start/Resume Playback inside a specific context (playlist or album), at a
 * specific track, at a specific position within that track. Pass deviceId to
 * target (and transfer playback to) a specific idle device.
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
      offset: { uri: trackUri },
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
