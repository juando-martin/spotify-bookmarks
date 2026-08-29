// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";

const API_BASE = "https://api.spotify.com/v1";
const contextNameCache = new Map();

// Playback contexts we can bookmark and resume into. Spotify also reports
// "artist" and "show" (podcast) contexts, but those don't resume to an
// exact track+position the way playlists and albums do, so we ignore them.
const RESUMABLE_CONTEXT_TYPES = new Set(["playlist", "album"]);

async function apiFetch(path, options = {}, isRetry = false) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 && !isRetry) {
    // Token might have just gone stale; force one refresh + retry.
    return apiFetch(path, options, true);
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

  return {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms,
    track: {
      id: data.item.id,
      uri: data.item.uri,
      name: data.item.name,
      artists: (data.item.artists || []).map((a) => a.name).join(", "),
    },
    context: isResumable
      ? { type, id: data.context.uri.split(":").pop(), uri: data.context.uri }
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
  const name = res.ok ? (await res.json()).name : `Unknown ${type}`;
  contextNameCache.set(cacheKey, name);
  return name;
}

/**
 * Start/Resume Playback inside a specific context (playlist or album), at a
 * specific track, at a specific position within that track.
 */
export async function resumePlayback({ contextUri, trackUri, positionMs }) {
  const res = await apiFetch("/me/player/play", {
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
