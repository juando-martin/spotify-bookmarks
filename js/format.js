// Copyright (c) 2026 Juan D. Martin
// Pure helpers — no DOM, no network, no module-load side effects — so they
// can be unit-tested in Node (see test/format.test.js) and reused across
// the app. Anything here must stay a pure function of its arguments.

/** `${type}_${id}` — the Firestore document ID for a bookmark's context. */
export function contextKey(contextType, contextId) {
  return `${contextType}_${contextId}`;
}

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a string for safe interpolation into HTML text or a "…"-quoted attribute. */
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** What to call a bookmark: the user's custom name, else Spotify's, else a placeholder. */
export function bookmarkName(bm) {
  return bm.customName || bm.contextName || "Unnamed";
}

/**
 * FNV-1a hash of a string -> uint32. Deterministic; seeds the generated
 * placeholder tile drawn for a playlist with no cover art (see js/tiles.js).
 */
export function hashCode(str) {
  let h = 2166136261;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A 1-2 character monogram for a name: initials of the first two words, a
 * leading initial + trailing number ("Daily Mix 4" -> "D4"), or the first
 * two letters of a single word. Non-Latin names fall back to their first two
 * characters. Blank -> "?".
 */
export function monogram(name) {
  const s = String(name ?? "").trim();
  if (!s) return "?";
  const parts = s.split(/[\s\-–—_/&,.()]+/).filter(Boolean);
  if (parts.length === 1) {
    const only = parts[0].replace(/[^\p{L}\p{N}]/gu, "");
    return (only.slice(0, 2) || "?").toUpperCase();
  }
  const last = parts[parts.length - 1];
  if (last.length <= 2 && /[0-9]/.test(last)) {
    return (parts[0][0] + last).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Does a bookmark match a filter string? Matches its name, track, or artists. */
export function bookmarkMatches(bm, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return `${bookmarkName(bm)} ${bm.trackName || ""} ${bm.artists || ""}`
    .toLowerCase()
    .includes(q);
}

/** Milliseconds -> "m:ss" (or "h:mm:ss" past an hour). Clamps junk to "0:00". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const RELATIVE_UNITS = [
  ["year", 31536000000],
  ["month", 2592000000],
  ["week", 604800000],
  ["day", 86400000],
  ["hour", 3600000],
  ["minute", 60000],
];

const defaultRelativeFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/**
 * A Date -> "3 hours ago" / "yesterday" / "just now". `now` and `fmt` are
 * injectable for tests; the app uses the current time and the system locale.
 */
export function formatRelative(date, now = Date.now(), fmt = defaultRelativeFmt) {
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (abs >= unitMs) return fmt.format(Math.round(diff / unitMs), unit);
  }
  return "just now";
}

/** spotify:playlist:xxx -> https://open.spotify.com/playlist/xxx (opens the app if installed). */
export function spotifyWebUrl(uri) {
  const [scheme, kind, id] = String(uri || "").split(":");
  return scheme === "spotify" && kind && id
    ? `https://open.spotify.com/${kind}/${id}`
    : "https://open.spotify.com";
}

/** Smallest image URL from a Spotify images array, or null. */
export function smallestImageUrl(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const smallest = images.reduce((a, b) =>
    (a.width || Infinity) <= (b.width || Infinity) ? a : b,
  );
  return smallest.url || null;
}

/**
 * Pull `{ name, imageUrl, noCover }` out of an `open.spotify.com/oembed`
 * response body — the fallback metadata source for editorial / algorithmic
 * playlists the Web API returns 404 for (see getContextMeta). Returns `false`
 * when the body has nothing usable.
 */
export function parseOembed(data) {
  if (!data || typeof data !== "object") return false;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const name = title || null;
  const thumb = typeof data.thumbnail_url === "string" ? data.thumbnail_url : "";
  const imageUrl = thumb.startsWith("https://") ? thumb : null;
  return name || imageUrl ? { name, imageUrl, noCover: !imageUrl } : false;
}

// Playback contexts we can bookmark and resume into. Spotify also reports
// "artist" and "show" (podcast) contexts, but those don't resume to an exact
// track + position the way playlists and albums do, so we ignore them.
export const RESUMABLE_CONTEXT_TYPES = new Set(["playlist", "album"]);

/**
 * Turn a raw `GET /me/player` body into the normalized snapshot the app
 * uses, or null when there's nothing playable. `context` is set only for a
 * resumable context (playlist or album).
 */
export function normalizePlaybackState(data) {
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
      durationMs: data.item.duration_ms ?? null,
      // Art rides along in this payload (album.images for tracks,
      // item.images for podcast episodes), so thumbnails cost no extra call.
      imageUrl: smallestImageUrl(album.images || data.item.images),
    },
    context: isResumable
      ? {
          type,
          id: data.context.uri.split(":").pop(),
          uri: data.context.uri,
          // An album's name is already in the payload; a playlist's isn't,
          // so that one stays null and getContextMeta() fetches it.
          name: type === "album" ? album.name ?? null : null,
        }
      : null,
  };
}

/**
 * How long (in seconds) to stop hitting the Spotify API after a 429.
 *
 *   retryAfter — the response's `Retry-After` header in seconds. Any
 *                non-finite or non-positive value counts as "not sent".
 *   streak     — consecutive 429s with no successful call in between
 *                (1 for the first). Each one doubles an escalating floor:
 *                60, 120, 240 … capped at 3840s (~64 min) from streak 7 on.
 *
 * The result is always >= the server's Retry-After (honoured in full, with
 * only a 24h sanity cap against a garbage header) and never below 30s. The
 * escalation and the floor can only ever lengthen the wait, never shorten
 * what Spotify asked for.
 */
export function rateLimitWaitSeconds(retryAfter, streak) {
  const asked =
    Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 86400) : 0;
  const n = Math.max(1, Math.floor(Number(streak) || 1));
  const escalated = 60 * 2 ** Math.min(n - 1, 6); // 60 … 3840
  return Math.max(asked, escalated, 30);
}

/** A bookmark doc's server-side "last used" time in ms (0 if never set). */
export function bookmarkUsedMs(bm) {
  return bm.lastUsedAt?.toMillis?.() ?? bm.updatedAt?.toMillis?.() ?? 0;
}

// The bookmark fields carried in a backup export (no timestamps — those are
// set fresh on import).
export const EXPORT_FIELDS = [
  "contextType", "contextId", "contextUri", "contextName", "customName",
  "imageUrl", "trackImageUrl", "trackId", "trackUri", "trackName", "artists",
  "positionMs",
];

/**
 * Sanitize one entry from an imported backup into exactly the fields the
 * Firestore rules allow (matching their type/size checks), or null if it's
 * not a usable bookmark.
 */
export function buildImportBookmark(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.contextType;
  if (type !== "playlist" && type !== "album") return null;

  const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);
  const contextId = str(raw.contextId, 100);
  const contextUri = str(raw.contextUri, 200);
  const trackId = str(raw.trackId, 100);
  const trackUri = str(raw.trackUri, 200);
  if (!contextId || !contextUri || !trackId || !trackUri) return null;

  const pos = Number(raw.positionMs);
  return {
    contextType: type,
    contextId,
    contextUri,
    contextName: str(raw.contextName, 300) || `Unknown ${type}`,
    customName: str(raw.customName, 200) || null,
    imageUrl: str(raw.imageUrl, 500) || null,
    trackImageUrl: str(raw.trackImageUrl, 500) || null,
    trackId,
    trackUri,
    trackName: str(raw.trackName, 500) || "",
    artists: str(raw.artists, 1000) || "",
    positionMs: Number.isFinite(pos) && pos >= 0 ? Math.min(pos, 86400000) : 0,
  };
}
