# Improvement ideas

<!-- Copyright (c) 2026 Juan D. Martin -->

Loose backlog — not tracked anywhere, pick items off as we feel like it.

## Done

Original backlog #1–#12, plus everything added along the way:

- Album support; bookmark thumbnail = playlist/album cover.
- Settings card: auto-bookmark-on-switch toggle, poll interval (3–60 s),
  "keep an already-bookmarked context updated on each track change"
  (`followBookmark`, off by default). Card is a foldable `<details>`,
  collapsed by default, open state remembered per device.
- Most-recently-used ordering with an instant local mark.
- Now playing card: album art, album + playlist name, your custom bookmark
  name, ⏮ / ⏯ / ⏭ transport controls, and a seek bar (`PUT /me/player/seek`).
- Rename bookmarks (`customName`, merge write so auto-bookmark can't wipe it).
- Resume device handling: lone idle device auto-plays, picker for several,
  "Open in Spotify" deep link for none.
- `playlist-read-private` / `-collaborative` scopes.
- Firestore: persistent local cache (offline-durable writes), hardened
  create/update rules (field whitelist + size caps), editorial-playlist
  404s negative-cached per session.
- Version marker + "update available" banner; a real fix for the
  GitHub-Pages stale-cache problem (`cache: no-cache` in the SW,
  `updateViaCache: none`, Reload button clears everything).
- `js/format.js` + unit tests; `npm run bump`; copyright headers.

## Done since

- **Catalogue search** — "Find a playlist or album" foldable card;
  `searchContexts()` hits `/search?type=playlist,album` (debounced 300 ms),
  tapping a result plays it from the start (`resumePlayback` now takes an
  optional trackUri; without one it sends `offset: { position: 0 }`).
  `setupFoldable()` helper shared with the Settings card.
- **Bookmark filter** — a search box in the bookmarks card; `renderBookmarks()`
  filters `allBookmarks` client-side via `bookmarkMatches()` (in `format.js`,
  unit-tested) on name / track / artist. `refreshBookmarkList` now caches the
  fetched list so filtering is a pure re-render.
- **#5 Export / import bookmarks** — "Backup & restore" `<details>` at the
  bottom of the bookmarks card. *Export & copy* → `{app, version, exportedAt,
  bookmarks[]}` to the clipboard (+ a textarea fallback). *Import* parses
  that or a bare array; `buildImportBookmark` (in `js/format.js`,
  unit-tested) sanitizes each entry to the rule-whitelisted fields, then
  `saveBookmark` per entry (overwrites same-context). Backup is the point —
  no per-bookmark export, no sharing.
- **#6 Bigger Resume target + a11y pass** — dropped "tap the whole row" (a
  stray tap while scrolling would fire a disruptive, un-confirmable Resume).
  Instead: Resume is a full-width primary button, Remove a small underlined
  link below it. a11y: toast is a persistent `role="status"
  aria-live="polite"` region hidden via `.toast:empty`; update banner is
  `role="alert"`; the seek slider sets `aria-valuetext` ("1:23 of 3:45").
- **Renamed the app to "My Spot"** (from "Playlist Resume" / short_name
  "Resume") — `manifest.json`, `<title>`, `<h1>`, the console line, the
  README heading. Repo name (`spotify-bookmarks`), `CACHE_NAME` prefix and
  `localStorage` keys deliberately left alone.
- **New icon** — white bookmark with an equaliser knockout on a
  Spotify-green field. `icons/icon.svg` is the source; `icon-192.png` /
  `icon-512.png` are rendered from it (`magick -background "#1ed760"
  icon.svg -resize NxN …`). Picked from a 5-concept comparison page.
- **"Pick a track"** — a per-bookmark toggle expands the playlist/album
  tracklist inline (`getContextTracks()` in `spotifyApi.js`, capped
  100/50); tapping a track plays it in that context from 0:00. `expandedId`
  + an `expandedTracks` cache in `main.js` survive list re-renders.
  Editorial playlists 404 -> a "can't load" message.

## Left

### 11. Podcast episode support

Spotify *can* resume an episode at a position (play the episode URI with
`position_ms`, no context). But `/me/player` only returns episode items with
`?additional_types=episode`, and Spotify already remembers episode position
natively — so low payoff.

- **Size:** medium.
- **Files:** `js/format.js` (`normalizePlaybackState`), `js/spotifyApi.js`,
  `js/main.js`.

## Not planned (considered, deliberately skipped)

- **Server-side / always-on polling** — the README's "Always-on
  auto-bookmark" (kiosk browser on a Pi with `?background`) covers this.
- **Real per-user isolation** — needs a backend to mint Firebase custom
  tokens from verified Spotify identities. Rule hardening was the pragmatic
  middle ground.
- **Confirm dialog on Remove** — the Undo toast is the chosen pattern.
- **Push / event-driven playback updates** — Spotify has no webhooks.
