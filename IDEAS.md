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
- **Rate-limit lockout — resolved (v37–v47).** A pre-v36 429 death-spiral
  (`apiFetch` retried a doomed request 3× per 5 s poll and *kept retrying
  through the 429s*, which makes Spotify escalate the penalty) grew into
  repeated multi-hour — then multi-day — lockouts, ending in an IP/account
  -level flag (login CAPTCHA) that needed a fresh Spotify Client ID plus
  quiet time to clear. The code side is now closed; steady state is a
  single `GET /me/player` per poll. What landed:
  - **No retry on a 429.** It sets a global deadline; every `apiFetch`
    short-circuits and `pollOnce()` no-ops until it passes, so the app goes
    fully silent and Spotify's window resets instead of being pinned open.
    `rateLimitedForMs()` is exported for the poll check; a toast explains
    the pause ≤ once a minute.
  - **`Retry-After` honoured in full** — no ceiling, 30 s floor, 24 h
    sanity cap on the header value. Each further 429 before the window
    clears doubles the wait (60 s → … → ~64 min); the streak only resets
    after 5 min with no 429, so one still-healthy endpoint can't keep
    clearing it. Math is `rateLimitWaitSeconds()` in `format.js` (9 unit
    tests).
  - **Deadline persisted** to `localStorage` `myspot:rl`, re-read on every
    check (a 429 in one tab pauses the others), capped at +1 h when
    recovered from storage so a stale far-future value can't strand the
    app. A success clears it only if it has already elapsed (no racing a
    just-set backoff).
  - **Poll loop cut to `/me/player`.** The Now playing card was spending a
    `/playlists/{id}` request every tick to resolve a playlist name (not in
    the `/me/player` payload) — the bulk of steady-state traffic and the
    call that kept 429-ing. The name now comes from the bookmark
    (`customName` / `contextName`); an un-bookmarked playlist shows "In a
    playlist". `buildBookmarkFromSnapshot` still fetches `/playlists/{id}`
    once per new bookmark, skipped once a real name + cover are stored.
  - **Catalogue search + "Pick a track" behind a hidden flag**
    (`LIST_TOOLS_ENABLED`; `?listtools=1` or
    `localStorage["myspot:listTools"]="1"`, off by default). Both hit
    `/search` / `/playlists/{id}/tracks` in bursts — the quickest way to
    trip abuse detection on a dev-mode app. Code and tests untouched, only
    the UI is gated; the cover-art deep-link stays.
  - **Per-context cooldown** in `getContextMeta`: a 404 for the session, a
    429 for 15 min, any other failure for 10 min.
- **`getContextMeta` reports `noCover`** — `true` for a 404 or an empty
  `images` array (Spotify confirmed there's no cover), left unset when the
  lookup just didn't complete. `buildBookmarkFromSnapshot` uses it to store
  `imageUrl: null` for an editorial playlist (albums still fall back to
  track art, which *is* the cover), so the bookmark list can tell "no
  cover" from "have a cover" without a new Firestore field.
- **Playlist tiles** (`js/tiles.js`) — a playlist Spotify won't give the
  app artwork for gets a tile as a `data:` URL straight into the existing
  `<img>`. **Settings → Playlist tile:** a style (six generated —
  Flat, Gradient, Aurora, Equalizer, Risograph, Hairline — drawn from the
  context id for colour/shape and the name for the monogram; or the
  pseudo-styles **Song art** = the saved track's album art, **Blank** =
  nothing) and an *apply* radio (**only when there's no cover** (default),
  or **always**, overriding Spotify's cover). All render-time and
  per-device (`settings.tileStyle` / `.tileApply`), so changing either just
  repaints — nothing stored per bookmark, no migration. Albums are never
  tiled. `monogram()` + `hashCode()` are pure and unit-tested in
  `format.js`; the draw functions + data-URL cache are in `tiles.js`.
  Studied in the "Playlist Tile Studio" artifact.
- **`trackImageUrl` on the bookmark** — the saved track's own album art,
  always stored (it's free, it's in every `/me/player` snapshot). Feeds the
  "Song art" tile style. New whitelisted field in `firestore.rules`
  (**re-paste + Publish**) and in `EXPORT_FIELDS`; old bookmarks lack it
  until re-saved (Song art then falls back to blank for them).

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

- **Un-hiding the list tools** — `LIST_TOOLS_ENABLED` (catalogue search +
  "Pick a track") is expected to stay **off** by default indefinitely, not
  as a temporary measure. The tap-the-cover-tile → open in Spotify → pick a
  song there → come back and update flow covers the same need without the
  `/search` and `/playlists/{id}/tracks` burst traffic that keeps getting a
  Development-Mode app rate-limited. The code stays in place for anyone who
  flips the flag.
- **Server-side / always-on polling** — the README's "Always-on
  auto-bookmark" (kiosk browser on a Pi with `?background`) covers this.
- **Real per-user isolation** — needs a backend to mint Firebase custom
  tokens from verified Spotify identities. Rule hardening was the pragmatic
  middle ground.
- **Confirm dialog on Remove** — the Undo toast is the chosen pattern.
- **Push / event-driven playback updates** — Spotify has no webhooks.
