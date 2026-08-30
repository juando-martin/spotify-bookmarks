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
  100/50, no nested `fields=` param, `spotify:local:` items skipped);
  tapping a track plays it in that context from 0:00. `expandedId` + an
  `expandedTracks` cache in `main.js` survive list re-renders. Returns
  `{ forbidden: true }` for a real 404 (editorial playlist) vs `null` for a
  transient error, so the message is accurate and a transient failure can
  be retried.
- **Open a bookmark in Spotify** — the 52px cover-art tile is an `<a>` to
  `spotifyWebUrl(contextUri)` (`open.spotify.com/<kind>/<id>`), with a green
  ↗ badge, `target="_blank" rel="noopener"`, an `aria-label`, and a
  focus-visible outline. Phone → the Spotify app; desktop → the web player.
  The get-out for editorial playlists "Pick a track" can't enumerate.
- **Rate-limit recovery** — the app was death-spiralling on a 429: pre-fix
  `apiFetch` retried a doomed request 3× per 5s poll and *kept retrying
  through the 429s*, which makes Spotify extend the ban. Now: a 429 sets
  `rateLimitedUntil` (≥ 20s, ≤ 120s) and there's **no retry**; every
  `apiFetch` short-circuits and `pollOnce()` no-ops entirely while it's
  set, so the app goes silent and Spotify's window resets. `getContextMeta`
  also cools a failing context down (404 for the session, other errors for
  10 min). A toast explains the pause, ≤ once a minute.
  `rateLimitedForMs()` exported for the poll check.
- **Cut the poll loop down to `/me/player`** — the Now playing card was
  spending one `/playlists/{id}` request *every poll tick* to resolve a
  playlist's name (playlists don't carry it in `/me/player`). That was the
  bulk of steady-state traffic and the exact call that kept returning 429.
  Removed: the name now comes from the bookmark (`customName` /
  `contextName`), and a playlist you haven't bookmarked just shows "In a
  playlist". `buildBookmarkFromSnapshot` still does one `/playlists/{id}`
  per *new* playlist bookmark, but skips it once a real name + cover are
  stored, so auto-/follow-bookmark stop re-hitting it. Steady state is now
  just `GET /me/player` per interval.
- **Editorial-playlist bookmarks follow the song's art** — when Spotify
  confirms a playlist has no cover we can read (`getContextMeta` now
  returns `noCover: true` for a 404 or an empty `images`, vs leaving it
  unset for a lookup that just failed), the bookmark's thumbnail tracks the
  currently-bookmarked track's album art instead of freezing the first one.
  Refreshes on the next save/auto-/follow-bookmark; a transient lookup
  failure still keeps the stored image.
- **Catalogue search + "Pick a track" behind a hidden flag** — both hit
  low-quota endpoints (`/search`, `/playlists/{id}/tracks`) in bursts and
  are the easiest way to trip Spotify's abuse detection on a dev-mode app.
  The code and tests are untouched; only the UI that reaches them is gated
  on `LIST_TOOLS_ENABLED` (off by default; `?listtools=1` for a session or
  `localStorage["myspot:listTools"]="1"` to persist). The cover-art tile
  still deep-links into Spotify regardless.
- **Rate-limit lockout, part 2** — a brief 429 was turning into a
  multi-hour lockout. Two causes: (a) the backoff was capped at 120 s,
  so a long `Retry-After` (Spotify sends minutes-to-an-hour for a
  badly-limited app) was ignored and we'd poke the API again
  mid-penalty, resetting its clock; (b) `rateLimitedUntil` was
  in-memory only, so every reload — including the ones done to "check
  the new version" — reset it to 0 and fired a poll straight into the
  penalty window. Now: honour `Retry-After` in full (floor 30 s,
  ceiling 1 h), and persist the deadline in `localStorage`
  (`myspot:rateLimitedUntil`) so a reload or SW update still waits it
  out. Toast shows the rough hold time.

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
