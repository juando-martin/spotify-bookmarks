// Thin wrapper around the Spotify Web API endpoints this app needs.

import { getAccessToken } from "./auth.js";

const API_BASE = "https://api.spotify.com/v1";
const playlistNameCache = new Map();

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
 * or a normalized snapshot describing the current track + playlist context.
 */
export async function getPlaybackState() {
  const res = await apiFetch("/me/player");
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Failed to fetch playback state: ${res.status}`);

  const data = await res.json();
  if (!data || !data.item) return null;

  const isPlaylist = data.context && data.context.type === "playlist";
  const playlistId = isPlaylist ? data.context.uri.split(":").pop() : null;

  return {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms,
    track: {
      id: data.item.id,
      uri: data.item.uri,
      name: data.item.name,
      artists: (data.item.artists || []).map((a) => a.name).join(", "),
    },
    playlist: isPlaylist
      ? { id: playlistId, uri: data.context.uri }
      : null,
  };
}

/** Playlist display name, cached in memory for the session. */
export async function getPlaylistName(playlistId) {
  if (playlistNameCache.has(playlistId)) {
    return playlistNameCache.get(playlistId);
  }
  const res = await apiFetch(`/playlists/${playlistId}?fields=name`);
  const name = res.ok ? (await res.json()).name : "Unknown playlist";
  playlistNameCache.set(playlistId, name);
  return name;
}

/**
 * Start/Resume Playback inside a specific playlist, at a specific track,
 * at a specific position within that track.
 */
export async function resumePlayback({ playlistUri, trackUri, positionMs }) {
  const res = await apiFetch("/me/player/play", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context_uri: playlistUri,
      offset: { uri: trackUri },
      position_ms: positionMs || 0,
    }),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to resume playback: ${res.status} ${text}`);
  }
}
