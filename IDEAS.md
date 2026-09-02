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
  `format.js`; the draw functions + data-URL cache are in `tiles.js`
  (including representative-only `song` / `blank` draws for the Settings
  preview — the list itself resolves those to real track art / nothing).
  Studied in the "Playlist Tile Studio" artifact.
- **`trackImageUrl` on the bookmark** — the saved track's own album art,
  always stored (it's free, it's in every `/me/player` snapshot). Feeds the
  "Song art" tile style. New whitelisted field in `firestore.rules`
  (**re-paste + Publish**) and in `EXPORT_FIELDS`; old bookmarks lack it
  until re-saved (Song art then falls back to blank for them).
- **Rate-limit state machine extracted** — the 429 back-off (persisted
  deadline, escalation, cross-tab read, 1h cap) moved from module-level
  state in `spotifyApi.js` to `createRateLimiter({ now, storage })` in
  `js/rateLimit.js`, so it's testable with an injected clock and fake
  storage. `test/rateLimit.test.js` covers the gate, persistence,
  escalation, the "don't clear a backoff we just set" race, the streak
  calm-down, and cross-tab. Behaviour unchanged.
- **`test/rules.test.js`** — parses `firestore.rules` and asserts every
  `EXPORT_FIELDS` entry and every key `buildImportBookmark` emits is in the
  rules' `hasOnly([...])` whitelist, and that every whitelisted field is
  actually validated. Catches the "client added a field, forgot to publish
  the rules → every save 403s" class of bug (which happened once).
- **Dead-refresh-token → login view** — when `performRefresh` gets a
  non-OK (refresh token revoked/expired), `auth.js` now also fires a
  `myspot:sessionexpired` window event; `main.js` drops to the login view
  with "Your Spotify session expired — log in again" instead of leaving the
  app stuck behind a misleading "reload to try again".
- **Artist / no-context → bookmark the track's album** — playing from an
  artist page (`spotify:artist:…`, not resumable), from Liked Songs, or a
  bare track with no context used to leave "Bookmark this spot" disabled.
  Now `bookmarkableContext()` in `main.js` falls back to the current track's
  album: the button relabels to **"Bookmark this album"** and saves an
  ordinary `album_{id}` bookmark at that track + position (resume plays the
  album from there). `normalizePlaybackState` carries `track.albumId` /
  `albumUri` for this; no new bookmark shape, no rules change. Podcast
  episodes have no album so the button stays disabled (Spotify remembers
  episode position natively anyway). Auto-bookmark-on-switch is untouched —
  still playlist/album only.
- **oEmbed fallback for editorial playlists** — when the Web API 404s a
  playlist/album (`/playlists/{id}` is locked out for Development-Mode apps
  since Nov 2024), `getContextMeta()` falls back to
  `https://open.spotify.com/oembed?url=…` — the public, unauthenticated,
  CORS-open (`access-control-allow-origin: *`) endpoint blog embeds use,
  on a *separate* rate limit from `api.spotify.com`. It returns the real
  `title` and a 300px `thumbnail_url` (`i.scdn.co`), so Today's Top Hits,
  RapCaviar, mood/genre mixes etc. now get their real name **and** cover
  with no user action — stored in the existing `contextName` / `imageUrl`
  fields, no new Firestore field, no rules change. `parseOembed()` is pure
  + unit-tested in `js/format.js`; the fetch/orchestration is in
  `js/spotifyApi.js`. A one-shot `resolveContextName()` in `main.js` also
  names an unbookmarked editorial playlist on the Now playing card (off the
  poll tick, one attempt per context/session). `getContextMeta(…, {force})`
  now also clears a prior "unreadable" mark, so ↻ retries oEmbed too.
  What oEmbed still can't see: a genuinely private playlist, or a
  personalized mix (Discover Weekly / Daily Mix) that isn't public on
  open.spotify.com — those keep the generated tile + ✎ rename.

  This makes the user-uploaded custom tile image (proposal C / suggestion
  #1) mostly unnecessary — deferred unless the remaining niche (private /
  personalized playlists, or wanting different art than Spotify's) turns
  out to matter.
- **Runtime config (`config.json`)** — the Spotify Client ID and Firebase
  web config moved out of the JS bundle into `./config.json`, fetched and
  validated at startup (`js/runtimeConfig.js` → `applyRuntimeConfig()` in
  `js/config.js`). Rotating a revoked Client ID or switching Firebase
  projects is now a one-file edit + `git push`, no `npm run bump`.
  `config.json` is committed (Pages has no build step) and in `sw.js`
  `SHELL_FILES` so the worker can't cache a shell newer than its config;
  network-first still revalidates it every online load. An invalid or
  missing `config.json` (leftover `config.example.json` placeholder, typo'd
  key) shows a **"Setup needed"** screen in `index.html` listing the exact
  problems — no silent fallback to someone else's backend. `scopes` +
  poll-interval default stay in `js/config.js` (a scope change forces
  re-consent, so it's deliberately code). `test/runtimeConfig.test.js`
  covers `validateConfig`, `loadRuntimeConfig` (mocked fetch), and asserts
  the two shipped config files.
- **Per-bookmark ↻ refresh** — an icon next to ✎ re-asks Spotify for the
  playlist's real name + cover (`getContextMeta(..., { force: true })`
  bypasses the session cache + cooldown, not a confirmed 404 or the rate
  gate) and backfills `trackImageUrl` for an old bookmark via
  `GET /tracks/{id}`. Merges the changed fields with
  `updateBookmarkFields()` — no timestamp touch. Fixes a stuck "Unknown
  playlist" or a blank Song-art tile without replaying the playlist.
- **Per-bookmark tile override + custom upload (v56, refined v57)** — the
  global Settings → Playlist tile style is now a per-bookmark choice too,
  via the ✎ icon on each bookmark, which opens an inline panel
  (`.tracklist`'s convention, no modal) — v57 merged what was originally a
  separate 🖼 icon *into* ✎ (now "edit name & tile" in one place, dropping
  the old instant-inline-rename swap for a name field at the top of the
  same panel — save on blur/Enter, no separate Save/Cancel) after the icon
  row was sometimes wrapping to a third line with 3 icons live. The
  bookmark card header is now two lines — name alone, then type badge + 📌 +
  ↻ + ✎ — instead of one `flex-wrap` row, so an icon can no longer get
  pushed off onto its own line. `tileMode` is `spotify` (**default** — real Spotify
  art, falling back to the Settings style if there is none), `settings`
  (force the *current* Settings style, ignoring real art, tracking future
  Settings changes), `style` (pin one specific style, frozen), or `custom`
  (an uploaded image). Applies to albums too, not just playlists — an
  untouched album keeps showing real art since its `imageUrl` is always
  populated. Resolution is a pure `bookmarkTileSource()` in `js/format.js`
  (unit-tested); `tileStyleId` / `tileImageUrl` are always saved regardless
  of which mode is active, so switching modes and back doesn't lose a style
  pick or a re-upload. A 📌 badge marks a bookmark pinned away from the
  live Settings style (`style`/`custom`). Uploads are downscaled/cropped to
  a 200px square WebP (JPEG fallback) client-side before writing — three
  new whitelisted `firestore.rules` fields (`tileMode`, `tileStyleId`,
  `tileImageUrl`, the last capped at 300 KB), and additions to
  `EXPORT_FIELDS` / `buildImportBookmark`. A Song-art tile (via `style` or
  the pre-existing global Settings style) now also tracks the currently
  playing track live — a single targeted `<img>` swap each poll tick, no
  Firestore write, not a full re-render (so it can't clobber an open rename
  or tile panel) — fixing a staleness gap that existed before this feature
  too. The old `tileApply` Settings radio ("only when there's no cover" /
  "always") no longer gates rendering; it now only sets which `tileMode` a
  *brand-new* bookmark starts in. Disclosed, accepted regression: an
  existing bookmark saved under `tileApply: "always"` has no `tileMode`, so
  it reads as `spotify` after the upgrade and silently switches from
  always-generated to real-art-first — re-flipping the toggle only affects
  new bookmarks; an old one needs a per-bookmark edit to get `settings`
  back. Full design discussion in the session that shipped this.
- **Fixed English/Spanish mixing in the "used …" line (v57)** — `formatRelative()`
  built its default `Intl.RelativeTimeFormat` with `undefined` locale (the
  browser's own), so on a Spanish-language device the bookmark list showed
  "resumes at 2:40 · used hace 2 horas" — the app's own hardcoded-English
  copy next to a Spanish relative time. Fixed the default to `"en"`; every
  other string in this app is hardcoded English, so the fallback should be
  too. `now`/`fmt` stay injectable for tests, which already always passed
  an explicit `"en"` formatter and so didn't need any change.
- **iPhone home-screen install hardening (v61)** — the OAuth login round
  trip stashed the PKCE `code_verifier`/`state` in `sessionStorage`, which
  is scoped to a specific browsing context; on an installed iOS PWA, the
  cross-origin trip to `accounts.spotify.com` and back can land in plain
  Safari instead of the standalone app's own container, losing that stash
  and breaking login. Switched both that stash and the same-pattern
  `sb_pending_shortcut` stash in `main.js` to `localStorage` (origin-scoped,
  survives regardless of which container reopens it) — both values are
  still single-use and deleted right after consumption. Also added the
  `apple-mobile-web-app-capable` meta tag (`index.html`) as cheap insurance
  for standalone rendering, and documented Safari-only install steps + the
  "Resume last played" shortcut's non-support on iOS (Apple doesn't
  implement the manifest `shortcuts` member) in `README.md`. Confirmed
  already-fine and left untouched: `viewport-fit=cover` +
  `env(safe-area-inset-*)` (notch/home-indicator padding, `style.css`) and
  the update-banner-that-nukes-caches pattern (the standard workaround for
  iOS's slow/inconsistent service-worker update propagation) were already
  in place before this pass.
- **Previous-button restart, and a track-end catch-up poll (v62)** — two
  Now-playing-card changes. (1) `prevBtn` now behaves like a normal music
  player: past the first 5s of a track it restarts the track (`seek(0)`)
  instead of jumping to the actual previous track; within the first 5s it
  still calls Spotify's `/previous`. (2) Track changes now show up promptly
  even on a slow poll interval: each regular poll re-evaluates the fresh
  snapshot's remaining time and, once within two poll intervals of the
  track ending, arms a one-off `setTimeout` for ~1s after the expected end
  (`armTrackEndTimerIfClose`/`trackEndTimer` in `main.js`). Only arming
  that close in keeps the timer from ever being a dangling, multi-minute
  `setTimeout` for most of a track — and two poll intervals is wide enough
  that a regular poll is guaranteed to land inside it and do the arming,
  given continuous polling. Any user-initiated position change (previous/
  next/play/pause, manual seek-bar commit, resuming a bookmark) explicitly
  clears the armed timer, since each of those already schedules its own
  short reconciliation poll that re-arms against the corrected position —
  a stale timer firing in that short gap is harmless anyway (just one
  redundant poll), the explicit clear just avoids the noise.

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
