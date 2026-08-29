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

/** A bookmark doc's server-side "last used" time in ms (0 if never set). */
export function bookmarkUsedMs(bm) {
  return bm.lastUsedAt?.toMillis?.() ?? bm.updatedAt?.toMillis?.() ?? 0;
}
