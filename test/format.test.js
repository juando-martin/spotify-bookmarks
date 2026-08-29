// Copyright (c) 2026 Juan D. Martin
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contextKey,
  escapeHtml,
  bookmarkName,
  formatDuration,
  formatRelative,
  spotifyWebUrl,
  smallestImageUrl,
  normalizePlaybackState,
  bookmarkUsedMs,
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

// --- normalizePlaybackState ------------------------------------------------

const trackItem = {
  id: "t1",
  uri: "spotify:track:t1",
  name: "Bird on the Wire",
  duration_ms: 198_000,
  artists: [{ name: "Leonard Cohen" }],
  album: { name: "Songs from a Room", images: [{ url: "art64", width: 64 }, { url: "art640", width: 640 }] },
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
      durationMs: 198_000,
      imageUrl: "art64",
    },
    context: { type: "playlist", id: "PL123", uri: "spotify:playlist:PL123", name: null },
  });
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
