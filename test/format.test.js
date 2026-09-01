// Copyright (c) 2026 Juan D. Martin
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contextKey,
  escapeHtml,
  bookmarkName,
  bookmarkMatches,
  formatDuration,
  formatRelative,
  spotifyWebUrl,
  smallestImageUrl,
  parseOembed,
  normalizePlaybackState,
  bookmarkUsedMs,
  buildImportBookmark,
  rateLimitWaitSeconds,
  hashCode,
  monogram,
} from "../js/format.js";

test("contextKey joins type and id with an underscore", () => {
  assert.equal(contextKey("playlist", "37i9dQ"), "playlist_37i9dQ");
  assert.equal(contextKey("album", "1DFixLW"), "album_1DFixLW");
});

test("escapeHtml neutralizes markup and quotes", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  assert.equal(escapeHtml("a & <b>"), "a &amp; &lt;b&gt;"); // & escaped once, not doubled
});

test("escapeHtml renders null/undefined as empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
});

test("bookmarkName prefers customName, then contextName, then a placeholder", () => {
  assert.equal(bookmarkName({ customName: "My mix", contextName: "Discover Weekly" }), "My mix");
  assert.equal(bookmarkName({ contextName: "Discover Weekly" }), "Discover Weekly");
  assert.equal(bookmarkName({ customName: "", contextName: "Real name" }), "Real name");
  assert.equal(bookmarkName({}), "Unnamed");
  assert.equal(bookmarkName({ customName: null, contextName: null }), "Unnamed");
});

test("formatDuration renders m:ss and h:mm:ss", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(154_000), "2:34");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(3_600_000), "1:00:00");
  assert.equal(formatDuration(3_661_000), "1:01:01");
});

test("formatDuration clamps junk to 0:00 and rounds to the nearest second", () => {
  assert.equal(formatDuration(-5000), "0:00");
  assert.equal(formatDuration(NaN), "0:00");
  assert.equal(formatDuration(undefined), "0:00");
  assert.equal(formatDuration("nope"), "0:00");
  assert.equal(formatDuration(1499), "0:01");
  assert.equal(formatDuration(1500), "0:02");
});

test("formatRelative picks the right unit relative to an injected 'now'", () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const en = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ago = (ms) => formatRelative(new Date(now - ms), now, en);

  assert.equal(ago(30_000), "just now"); // < 1 minute
  assert.equal(ago(5 * 60_000), "5 minutes ago");
  assert.equal(ago(3 * 3_600_000), "3 hours ago");
  assert.equal(ago(24 * 3_600_000), "yesterday"); // numeric: "auto"
  assert.equal(ago(3 * 86_400_000), "3 days ago");
  assert.equal(ago(400 * 86_400_000), "last year");
});

test("formatRelative handles a slightly-future timestamp without throwing", () => {
  const now = Date.now();
  assert.equal(formatRelative(new Date(now + 5_000), now), "just now");
});

test("spotifyWebUrl converts a context URI to an open.spotify.com link", () => {
  assert.equal(spotifyWebUrl("spotify:playlist:37i9dQ"), "https://open.spotify.com/playlist/37i9dQ");
  assert.equal(spotifyWebUrl("spotify:album:1DFixLW"), "https://open.spotify.com/album/1DFixLW");
});

test("spotifyWebUrl falls back to the site root for bad input", () => {
  assert.equal(spotifyWebUrl(""), "https://open.spotify.com");
  assert.equal(spotifyWebUrl(null), "https://open.spotify.com");
  assert.equal(spotifyWebUrl("not-a-uri"), "https://open.spotify.com");
  assert.equal(spotifyWebUrl("spotify:playlist"), "https://open.spotify.com");
});

test("smallestImageUrl returns the URL of the narrowest image", () => {
  const images = [
    { url: "big", width: 640 },
    { url: "small", width: 64 },
    { url: "medium", width: 300 },
  ];
  assert.equal(smallestImageUrl(images), "small");
});

test("smallestImageUrl copes with missing data", () => {
  assert.equal(smallestImageUrl([]), null);
  assert.equal(smallestImageUrl(null), null);
  assert.equal(smallestImageUrl(undefined), null);
  assert.equal(smallestImageUrl([{ url: "only" }]), "only"); // no width
  assert.equal(smallestImageUrl([{ width: 64 }]), null); // no url
});

test("parseOembed pulls the title and thumbnail from an oEmbed body", () => {
  assert.deepEqual(
    parseOembed({
      title: "Today’s Top Hits",
      thumbnail_url: "https://i.scdn.co/image/ab67",
      thumbnail_width: 300,
    }),
    { name: "Today’s Top Hits", imageUrl: "https://i.scdn.co/image/ab67", noCover: false },
  );
});

test("parseOembed keeps the name when there's no usable thumbnail", () => {
  assert.deepEqual(parseOembed({ title: "  RapCaviar  " }), {
    name: "RapCaviar",
    imageUrl: null,
    noCover: true,
  });
  // a non-https thumbnail is dropped, not trusted
  assert.deepEqual(parseOembed({ title: "X", thumbnail_url: "http://insecure/img" }), {
    name: "X",
    imageUrl: null,
    noCover: true,
  });
});

test("parseOembed returns false when there's nothing usable", () => {
  assert.equal(parseOembed(null), false);
  assert.equal(parseOembed("nope"), false);
  assert.equal(parseOembed({}), false);
  assert.equal(parseOembed({ title: "   " }), false);
  assert.equal(parseOembed({ thumbnail_url: "" }), false);
});

// --- normalizePlaybackState ------------------------------------------------

const trackItem = {
  id: "t1",
  uri: "spotify:track:t1",
  name: "Bird on the Wire",
  duration_ms: 198_000,
  artists: [{ name: "Leonard Cohen" }],
  album: {
    id: "AL777",
    uri: "spotify:album:AL777",
    name: "Songs from a Room",
    images: [{ url: "art64", width: 64 }, { url: "art640", width: 640 }],
  },
};

test("normalizePlaybackState returns null when there is nothing to show", () => {
  assert.equal(normalizePlaybackState(null), null);
  assert.equal(normalizePlaybackState({}), null);
  assert.equal(normalizePlaybackState({ item: null }), null);
});

test("normalizePlaybackState maps a track playing inside a playlist", () => {
  const snap = normalizePlaybackState({
    is_playing: true,
    progress_ms: 154_000,
    item: trackItem,
    context: { type: "playlist", uri: "spotify:playlist:PL123" },
  });
  assert.deepEqual(snap, {
    isPlaying: true,
    progressMs: 154_000,
    track: {
      id: "t1",
      uri: "spotify:track:t1",
      name: "Bird on the Wire",
      artists: "Leonard Cohen",
      albumName: "Songs from a Room",
      albumId: "AL777",
      albumUri: "spotify:album:AL777",
      durationMs: 198_000,
      imageUrl: "art64",
    },
    context: { type: "playlist", id: "PL123", uri: "spotify:playlist:PL123", name: null },
  });
});

test("normalizePlaybackState keeps the track's album id/uri for the bookmark fallback", () => {
  const artistCtx = normalizePlaybackState({
    is_playing: true,
    progress_ms: 5_000,
    item: trackItem,
    context: { type: "artist", uri: "spotify:artist:AR1" },
  });
  assert.equal(artistCtx.context, null); // artist isn't resumable
  assert.equal(artistCtx.track.albumId, "AL777");
  assert.equal(artistCtx.track.albumUri, "spotify:album:AL777");

  // a podcast episode has no album — the fallback fields stay null
  const episode = normalizePlaybackState({
    is_playing: true,
    progress_ms: 0,
    item: { id: "e1", uri: "spotify:episode:e1", name: "Ep", artists: [] },
    context: { type: "show", uri: "spotify:show:s1" },
  });
  assert.equal(episode.track.albumId, null);
  assert.equal(episode.track.albumUri, null);
});

test("normalizePlaybackState carries track duration, null when absent", () => {
  const withDur = normalizePlaybackState({ is_playing: true, progress_ms: 0, item: trackItem, context: null });
  assert.equal(withDur.track.durationMs, 198_000);
  const noDur = normalizePlaybackState({
    is_playing: true, progress_ms: 0, context: null,
    item: { id: "x", uri: "spotify:track:x", name: "n", artists: [] },
  });
  assert.equal(noDur.track.durationMs, null);
});

test("normalizePlaybackState carries the album name into an album context", () => {
  const snap = normalizePlaybackState({
    is_playing: false,
    progress_ms: 0,
    item: trackItem,
    context: { type: "album", uri: "spotify:album:AL999" },
  });
  assert.equal(snap.isPlaying, false);
  assert.deepEqual(snap.context, {
    type: "album",
    id: "AL999",
    uri: "spotify:album:AL999",
    name: "Songs from a Room",
  });
});

test("normalizePlaybackState leaves context null for non-resumable contexts", () => {
  for (const type of ["artist", "show", "collection", undefined]) {
    const snap = normalizePlaybackState({
      is_playing: true,
      progress_ms: 1,
      item: trackItem,
      context: type ? { type, uri: `spotify:${type}:x` } : undefined,
    });
    assert.equal(snap.context, null, `type=${type}`);
  }
});

test("normalizePlaybackState falls back to item.images for podcast episodes", () => {
  const snap = normalizePlaybackState({
    is_playing: true,
    progress_ms: 42,
    item: {
      id: "e1",
      uri: "spotify:episode:e1",
      name: "Episode 1",
      images: [{ url: "ep-small", width: 64 }, { url: "ep-big", width: 640 }],
    },
    context: { type: "show", uri: "spotify:show:s1" },
  });
  assert.equal(snap.track.imageUrl, "ep-small");
  assert.equal(snap.track.albumName, null);
  assert.equal(snap.track.artists, "");
  assert.equal(snap.context, null);
});

test("normalizePlaybackState joins multiple artists", () => {
  const snap = normalizePlaybackState({
    is_playing: true,
    progress_ms: 0,
    item: { ...trackItem, artists: [{ name: "A" }, { name: "B" }, { name: "C" }] },
    context: null,
  });
  assert.equal(snap.track.artists, "A, B, C");
});

// --- bookmarkUsedMs ------------------------------------------------------------

const ts = (ms) => ({ toMillis: () => ms });

test("bookmarkUsedMs prefers lastUsedAt, then updatedAt, then 0", () => {
  assert.equal(bookmarkUsedMs({ lastUsedAt: ts(100), updatedAt: ts(50) }), 100);
  assert.equal(bookmarkUsedMs({ updatedAt: ts(50) }), 50);
  assert.equal(bookmarkUsedMs({}), 0);
  assert.equal(bookmarkUsedMs({ lastUsedAt: null, updatedAt: undefined }), 0);
});

test("bookmarkUsedMs sorts a list most-recently-used first", () => {
  const list = [
    { id: "a", lastUsedAt: ts(10) },
    { id: "b", lastUsedAt: ts(30) },
    { id: "c", updatedAt: ts(20) },
  ];
  list.sort((x, y) => bookmarkUsedMs(y) - bookmarkUsedMs(x));
  assert.deepEqual(list.map((b) => b.id), ["b", "c", "a"]);
});

// --- buildImportBookmark -----------------------------------------------------

const goodEntry = {
  contextType: "playlist",
  contextId: "PL1",
  contextUri: "spotify:playlist:PL1",
  contextName: "My Mix",
  customName: "Dido Mix",
  imageUrl: "https://i.scdn.co/image/abc",
  trackImageUrl: "https://i.scdn.co/image/track1",
  trackId: "T1",
  trackUri: "spotify:track:T1",
  trackName: "Thank You",
  artists: "Dido",
  positionMs: 154000,
};

test("buildImportBookmark passes a well-formed entry through", () => {
  assert.deepEqual(buildImportBookmark(goodEntry), goodEntry);
});

test("buildImportBookmark rejects entries that can't be a bookmark", () => {
  assert.equal(buildImportBookmark(null), null);
  assert.equal(buildImportBookmark("x"), null);
  assert.equal(buildImportBookmark({ ...goodEntry, contextType: "artist" }), null);
  assert.equal(buildImportBookmark({ ...goodEntry, contextId: undefined }), null);
  assert.equal(buildImportBookmark({ ...goodEntry, trackUri: 42 }), null);
});

test("buildImportBookmark fills defaults and clamps oddities", () => {
  const b = buildImportBookmark({
    contextType: "album",
    contextId: "AL1",
    contextUri: "spotify:album:AL1",
    trackId: "T2",
    trackUri: "spotify:track:T2",
    positionMs: -5,
  });
  assert.equal(b.contextName, "Unknown album");
  assert.equal(b.customName, null);
  assert.equal(b.imageUrl, null);
  assert.equal(b.trackImageUrl, null);
  assert.equal(b.trackName, "");
  assert.equal(b.artists, "");
  assert.equal(b.positionMs, 0);

  assert.equal(buildImportBookmark({ ...goodEntry, positionMs: 1e12 }).positionMs, 86400000);
  assert.equal(buildImportBookmark({ ...goodEntry, contextName: "x".repeat(500) }).contextName, "Unknown playlist");
});

test("buildImportBookmark output has only the whitelisted fields", () => {
  const b = buildImportBookmark({ ...goodEntry, junk: "drop me", updatedAt: 1 });
  assert.deepEqual(Object.keys(b).sort(), [
    "artists", "contextId", "contextName", "contextType", "contextUri",
    "customName", "imageUrl", "positionMs", "trackId", "trackImageUrl",
    "trackName", "trackUri",
  ]);
});

// --- bookmarkMatches --------------------------------------------------------

test("bookmarkMatches searches name, track and artists, case-insensitively", () => {
  const bm = { customName: "Dido Mix", contextName: "Unknown playlist", trackName: "Thank You", artists: "Dido" };
  assert.equal(bookmarkMatches(bm, ""), true);         // blank matches everything
  assert.equal(bookmarkMatches(bm, "  "), true);
  assert.equal(bookmarkMatches(bm, "dido"), true);     // custom name
  assert.equal(bookmarkMatches(bm, "THANK"), true);    // track, case-insensitive
  assert.equal(bookmarkMatches(bm, "you"), true);
  assert.equal(bookmarkMatches(bm, "coldplay"), false);
});

test("bookmarkMatches falls back to contextName and tolerates missing fields", () => {
  assert.equal(bookmarkMatches({ contextName: "Discover Weekly" }, "weekly"), true);
  assert.equal(bookmarkMatches({}, "anything"), false);
  assert.equal(bookmarkMatches({}, ""), true);
});

// --- rateLimitWaitSeconds -------------------------------------------------

test("rateLimitWaitSeconds honours Retry-After in full when it exceeds the floor", () => {
  assert.equal(rateLimitWaitSeconds(300, 1), 300);      // 5 min, first 429
  assert.equal(rateLimitWaitSeconds(3600, 1), 3600);    // 1 h
  assert.equal(rateLimitWaitSeconds(7200, 1), 7200);    // 2 h — no upper clamp
});

test("rateLimitWaitSeconds never returns less than Retry-After", () => {
  for (const ra of [31, 45, 100, 500, 2000, 9000, 50000]) {
    for (const streak of [1, 2, 3, 5, 8]) {
      assert.ok(
        rateLimitWaitSeconds(ra, streak) >= ra,
        `wait(${ra}, ${streak}) = ${rateLimitWaitSeconds(ra, streak)} < ${ra}`,
      );
    }
  }
});

test("rateLimitWaitSeconds caps a garbage Retry-After at 24h", () => {
  assert.equal(rateLimitWaitSeconds(999999999, 1), 86400);
});

test("rateLimitWaitSeconds falls back to the escalating floor when Retry-After is absent or junk", () => {
  for (const missing of [undefined, null, NaN, 0, -5, "nope"]) {
    assert.equal(rateLimitWaitSeconds(missing, 1), 60);
  }
});

test("rateLimitWaitSeconds doubles the floor on each consecutive 429", () => {
  assert.equal(rateLimitWaitSeconds(0, 1), 60);
  assert.equal(rateLimitWaitSeconds(0, 2), 120);
  assert.equal(rateLimitWaitSeconds(0, 3), 240);
  assert.equal(rateLimitWaitSeconds(0, 4), 480);
  assert.equal(rateLimitWaitSeconds(0, 5), 960);
  assert.equal(rateLimitWaitSeconds(0, 6), 1920);
  assert.equal(rateLimitWaitSeconds(0, 7), 3840);
});

test("rateLimitWaitSeconds caps the escalating floor at ~64 min however long the streak", () => {
  assert.equal(rateLimitWaitSeconds(0, 8), 3840);
  assert.equal(rateLimitWaitSeconds(0, 20), 3840);
  assert.equal(rateLimitWaitSeconds(0, 1000), 3840);
});

test("rateLimitWaitSeconds takes the larger of Retry-After and the escalating floor", () => {
  assert.equal(rateLimitWaitSeconds(100, 4), 480);   // floor 480 > asked 100
  assert.equal(rateLimitWaitSeconds(600, 4), 600);   // asked 600 > floor 480
  assert.equal(rateLimitWaitSeconds(5000, 7), 5000); // asked 5000 > floor 3840
});

test("rateLimitWaitSeconds treats a missing or bad streak as the first 429", () => {
  assert.equal(rateLimitWaitSeconds(0, undefined), 60);
  assert.equal(rateLimitWaitSeconds(0, 0), 60);
  assert.equal(rateLimitWaitSeconds(0, -3), 60);
  assert.equal(rateLimitWaitSeconds(0, 1.9), 60); // floored to 1
});

test("rateLimitWaitSeconds never returns below the 30s floor", () => {
  assert.ok(rateLimitWaitSeconds(1, 1) >= 30);
  assert.ok(rateLimitWaitSeconds(0, 1) >= 30);
});

// --- hashCode ---

test("hashCode is deterministic and returns a uint32", () => {
  const a = hashCode("Discover Weekly");
  assert.equal(a, hashCode("Discover Weekly"));
  assert.ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff);
});

test("hashCode separates similar strings", () => {
  assert.notEqual(hashCode("Daily Mix 1"), hashCode("Daily Mix 2"));
  assert.notEqual(hashCode(""), hashCode(" "));
});

test("hashCode tolerates non-string input", () => {
  assert.equal(hashCode(null), hashCode(""));
  assert.equal(hashCode(undefined), hashCode(""));
});

// --- monogram ---

test("monogram takes the initials of the first two words", () => {
  assert.equal(monogram("Discover Weekly"), "DW");
  assert.equal(monogram("deep focus"), "DF");
  assert.equal(monogram("Release Radar Extra"), "RR");
});

test("monogram keeps a trailing number so numbered mixes stay distinct", () => {
  assert.equal(monogram("Daily Mix 1"), "D1");
  assert.equal(monogram("Daily Mix 4"), "D4");
});

test("monogram uses the first two letters of a single word", () => {
  assert.equal(monogram("Anima"), "AN");
  assert.equal(monogram("jazz"), "JA");
});

test("monogram splits on punctuation", () => {
  assert.equal(monogram("R&B"), "RB");
  assert.equal(monogram("90s Rock"), "9R");
  assert.equal(monogram("Chill/Lofi"), "CL");
});

test("monogram falls back to '?' for blank or symbol-only names", () => {
  assert.equal(monogram(""), "?");
  assert.equal(monogram("   "), "?");
  assert.equal(monogram("!!!"), "?");
  assert.equal(monogram(null), "?");
});

test("monogram keeps non-Latin names", () => {
  assert.equal(monogram("ローファイ"), "ローファイ".slice(0, 2));
});
