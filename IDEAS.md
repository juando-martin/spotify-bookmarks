# Improvement ideas

Loose backlog — not tracked anywhere, pick items off as we feel like it.

## Done

Original backlog: **#1–#10** and **#12** (album name from payload, saved
position on each bookmark, album-art thumbnails, relative timestamps, 429
backoff, pause polling when hidden, single-flight token refresh, device
awareness on Resume, Undo on Remove, "Resume last played" PWA shortcut,
unit tests). Only **#11** (podcasts) is left.

Added along the way:

- **Album support** — bookmark/resume albums, not just playlists.
- **Settings card** — auto-bookmark toggle + poll interval (per-device).
- **Most-recently-used ordering** — list sorts by last save/resume; a
  just-used bookmark jumps to the top instantly via a local mark rather
  than waiting for the Firestore `serverTimestamp` to read back.
- **Now playing card** — album art, album name, playlist name.
- **Transport controls** — ⏮ / ⏯ / ⏭ in the Now playing card
  (`/me/player/{next,previous,pause,play}`, optimistic play/pause flip).
- **Rename bookmarks** — ✎ inline edit, stored as `customName` (merge
  write so auto-bookmark can't wipe it). Fixes unnameable Spotify editorial
  playlists (Discover Weekly etc.) since the playlist ID is stable.
- **Resume device handling** — one idle device → just play there; 2+ →
  picker; none → "Open … in Spotify" deep link.
- **`playlist-read-private` / `-collaborative` scopes** — so private
  playlist names resolve.
- **Network-first service worker** — no double reload after deploys.
- **Version marker** — `APP_VERSION` in `js/version.js`, shown in the
  footer and logged to console; bump it with `CACHE_NAME` in `sw.js`.
- **Pure-logic extraction + unit tests** (#12) — `js/format.js` +
  `test/format.test.js`.
- Misc from the code review: overlapping `pollOnce` runs are now skipped
  (re-entrancy guard); a rejected token (401) forces a real refresh instead
  of re-reading the cached one; `enterApp()` failure surfaces an error
  instead of an unhandled rejection; `escapeHtml` is a pure regex and
  attribute-safe; `getContextName` doesn't cache a failed lookup;
  podcast-episode art fallback (`data.item.images`).

## Remaining

### 12 — DONE

Pure logic extracted to `js/format.js` (`contextKey`, `escapeHtml`,
`bookmarkName`, `formatDuration`, `formatRelative`, `spotifyWebUrl`,
`smallestImageUrl`, `normalizePlaybackState`, `bookmarkUsedMs`). Covered by
`test/format.test.js` (`node --test`, 20 tests, no deps). `getPlaybackState`
is now just fetch + `normalizePlaybackState`. `escapeHtml` is a pure regex
(no more `document.createElement`).

### 11. Podcast episode support

Spotify *can* resume a podcast episode at a position — play the episode URI
directly with `position_ms`, no `context_uri` / `offset` needed. Different
code path from playlist/album but a natural fit for "where was I".

- **Why:** podcasts are the archetypal "resume later" content.
- **Caveats:** Spotify already remembers episode position natively, so the
  value is partly redundant. Also `/me/player` only returns episode items
  when called with `?additional_types=episode` — that has to be added first
  or a playing podcast just reads as "nothing playing".
- **Size:** medium.
- **Files:** `js/spotifyApi.js` (`getPlaybackState` recognizes `episode`
  items / `show` context; `resumePlayback` branches on whether there's a
  context), `js/main.js`. `firestore.rules` unaffected.

## Not planned (considered, deliberately skipped)

- **Server-side / always-on polling** — covered by the "Always-on
  auto-bookmark" section in the README (park the page in a kiosk browser on
  a Pi with `?background`). A real backend only saves needing a device
  that stays powered on.
- **Confirm dialog on Remove** — the Undo toast is the chosen pattern.
- **Push / event-driven playback updates** — Spotify has no webhooks;
  everything polls. Not worth revisiting.
