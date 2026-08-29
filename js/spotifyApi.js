// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";

const API_BASE = "https://api.spotify.com/v1";
const contextNameCache = new Map();

// Playback contexts we can bookmark and resume into. Spotify also reports
// "artist" and "show" (podcast) contexts, but those don't resume to an
// exact track+position the way playlists and albums do, so we ignore them.
const RESUMABLE_CONTEXT_TYPES = new Set(["playlist", "album"]);

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
    // Token might have just gone stale; force one refresh + retry.
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

/** Pick the smallest image URL from a Spotify images array, or null. */
function smallestImageUrl(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const smallest = images.reduce((a, b) =>
    (a.width || Infinity) <= (b.width || Infinity) ? a : b,
  );
  return smallest.url || null;
}

/** Who's logged in — needed as the key for storing bookmarks per user. */
export async function getCurrentUser() {
  const res = await apiFetch("/me");
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  return res.json(); // { id, display_name, ... }
}

/**
 * Get Playback State. Returns null when nothing is playing (204 No Content),
 * or a normalized snapshot describing the current track + playback context.
 * `context` is set only for resumable contexts (playlist or album); it's
 * null for anything else (a bare track, an artist radio, a podcast, …).
 */
export async function getPlaybackState() {
  const res = await apiFetch("/me/player");
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to fetch playback state: ${res.status}`);

  const data = await res.json();
  if (!data || !data.item) return null;

  const type = data.context?.type;
  const isResumable = RESUMABLE_CONTEXT_TYPES.has(type);
  const album = data.item.album || {};

  return {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms,
    track: {
      id: data.item.id,
      uri: data.item.uri,
      name: data.item.name,
      artists: (data.item.artists || []).map((a) => a.name).join(", "),
      albumName: album.name ?? null,
      // Art rides along in this payload (album.images for tracks,
      // item.images for podcast episodes), so thumbnails cost no extra call.
      imageUrl: smallestImageUrl(album.images || data.item.images),
    },
    context: isResumable
      ? {
          type,
          id: data.context.uri.split(":").pop(),
          uri: data.context.uri,
          // An album's name is already in the playback payload; a playlist's
          // isn't, so that one stays null and getContextName() fetches it.
          name: type === "album" ? album.name ?? null : null,
        }
      : null,
  };
}

/** Playlist/album display name, cached in memory for the session. */
export async function getContextName(type, id) {
  const cacheKey = `${type}:${id}`;
  if (contextNameCache.has(cacheKey)) {
    return contextNameCache.get(cacheKey);
  }
  const path =
    type === "playlist" ? `/playlists/${id}?fields=name` : `/albums/${id}`;
  const res = await apiFetch(path);
  if (!res.ok) return `Unknown ${type}`; // transient — don't cache a failure
  const name = (await res.json()).name;
  contextNameCache.set(cacheKey, name);
  return name;
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
