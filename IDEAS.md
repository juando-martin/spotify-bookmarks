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

## Left

### 5. Export / import bookmarks

A JSON blob to copy out for backup or moving between Spotify accounts.
Download links are unreliable in an installed PWA, so a read-only textarea
to copy from and a paste-to-import field.

- **Size:** medium.
- **Files:** `js/firebaseBookmarks.js` (bulk read/write), `js/main.js`,
  `index.html`, `style.css`.

### 6. Bigger Resume target + a11y pass — DONE

Dropped "tap the whole row" — a stray tap while scrolling the list would
fire a disruptive, un-confirmable Resume. Instead: Resume is a full-width
primary button, Remove a small underlined link below it. a11y: toast is a
persistent `role="status" aria-live="polite"` region hidden via
`.toast:empty`; update banner is `role="alert"`; the seek slider sets
`aria-valuetext` ("1:23 of 3:45").

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
