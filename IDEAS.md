# Improvement ideas

<!-- Copyright (c) 2026 Juan D. Martin -->

Loose backlog — not tracked anywhere, pick items off as we feel like it.

## Done

Original backlog #1–#10 and #12, plus, added along the way: album support;
Settings card (auto-bookmark toggle + poll interval); most-recently-used
ordering with an instant local mark; Now playing card (album art, album +
playlist name, and — later — your custom bookmark name); transport controls
(⏮ / ⏯ / ⏭); rename bookmarks (`customName`, merge write); Resume device
handling (lone device auto-plays, picker for several, "Open in Spotify" deep
link for none); `playlist-read-*` scopes; bookmark thumbnail = playlist/album
cover; version marker + "update available" banner; a real fix for the
GitHub-Pages stale-cache problem (SW revalidates with `cache: no-cache`,
`updateViaCache: none`); `js/format.js` + unit tests.

## Planned (next)

### 1. Firestore offline persistence

Enable `persistentLocalCache` in `getFirestore()`. Bookmark writes queue and
retry across connectivity blips (bookmarking on a flaky phone connection
actually sticks), and list reads come from IndexedDB then revalidate.

- **Size:** tiny (one config change) + test that a save while offline lands
  when the connection returns.
- **Files:** `js/firebaseBookmarks.js`.

### 2. Negative-cache unreadable playlists

An editorial "Mix" whose `GET /playlists/{id}` 404s currently costs one API
call on every poll tick (the Now-playing name resolution). Add a per-session
set of "known unreadable" context keys — or a short backoff — so we stop
re-asking.

- **Size:** small.
- **Files:** `js/spotifyApi.js` (`getContextMeta`).

### 3. Harden the Firestore rules

`allow write: if request.auth != null` lets any allowlisted user write any
shape/size of data. Add validation to `firestore.rules`: `hasOnly([...])`
the known fields, cap string lengths, sanity-check `positionMs`. No backend
— it just limits what a friends-and-family account can do to your quota.

- **Size:** small (rules only; re-paste + Publish in the Firebase console).
- **Files:** `firestore.rules`.

### 4. Now playing progress bar — DONE

Seek bar under the transport controls: `durationMs` from the payload,
`estimatedMs` advances 1×/s between polls and resyncs each poll, dragging
calls `PUT /me/player/seek`. `normalizePlaybackState` carries `durationMs`.

### 7. `npm run bump` — DONE

`scripts/bump.mjs` rewrites `APP_VERSION` in `js/version.js` and
`CACHE_NAME` in `sw.js` together. `npm run bump` = current + 1;
`npm run bump -- N` sets it.

## Done since

- **"Keep an already-bookmarked context updated"** setting (`followBookmark`,
  off by default) — advances a bookmark's spot on each track change while you
  play a context you've bookmarked. `runPoll` tracks `lastTrackId` and a
  `bookmarkedContexts` Set built in `refreshBookmarkList`.
- **Foldable Settings card** — `<details class="card">`, collapsed by
  default, open state remembered in `localStorage`. (Caret is a JS-toggled
  `<span>` — a `[open] > … ::after` transform wouldn't apply on `<details>`.)

## Later / maybe

- **#5 Export / import bookmarks** — a JSON blob to copy out for backup or
  moving accounts. Download links are unreliable in an installed PWA, so
  probably a copy/paste textarea.
- **#6 Tap the whole bookmark row to Resume** (bigger touch target) + a
  small a11y pass (`aria-live` on the toast, `role="alert"` on the update
  banner).
- **#11 Podcast episode support** — Spotify remembers episode position
  natively (low payoff), and `/me/player` needs `?additional_types=episode`
  before a playing podcast even shows up.

## Not planned (considered, deliberately skipped)

- **Server-side / always-on polling** — the README's "Always-on
  auto-bookmark" (kiosk browser on a Pi with `?background`) covers this. A
  real backend only saves needing a device that stays powered on.
- **Real per-user isolation** — needs a backend to mint Firebase custom
  tokens from verified Spotify identities. Against the no-backend design;
  rule hardening (#3) is the pragmatic middle ground.
- **Confirm dialog on Remove** — the Undo toast is the chosen pattern.
- **Push / event-driven playback updates** — Spotify has no webhooks;
  everything polls.
