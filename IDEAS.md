# Improvement ideas

Loose backlog — not prioritized formally, not tracked anywhere. Pick items
off as we feel like it. Each note says what, why, rough size, and which
files it touches.

**Done so far:** #1, #2, #3, #4, #5, #6, #7, #8, #9, #10. Also folded in along the way:
`escapeHtml` escapes quotes (attribute-safe); `getContextName` doesn't cache
a failed lookup; the Now playing card shows album art + album name + playlist
name (needed the `playlist-read-private` / `-collaborative` scopes); the
service worker is network-first so deploys no longer need a double reload;
a just-used bookmark jumps to the top of the list instantly (local mark)
instead of waiting for the Firestore serverTimestamp to read back.

---

## Quick wins

### 1. Album name from the playback payload (no extra API call) — DONE

`getContextName()` currently does `GET /albums/{id}` just to read the title —
and that response carries the album's entire tracklist. But when the context
is an album, the name is already sitting in the playback state we just
fetched: `data.item.album.name`. Playlists still need the lookup (playlist
name isn't in the playback payload).

- **Why:** removes one Spotify API call per album bookmark; smaller payloads.
- **Size:** small.
- **Files:** `js/spotifyApi.js` (`getPlaybackState` returns the album name in
  the snapshot; `buildBookmarkFromSnapshot` / `getContextName` skip the fetch
  when it's already known).

### 2. Show the saved position on each bookmark — DONE

The list shows track + artist but not *where* in the track the bookmark
sits. Add e.g. "resumes at 2:34" from the `positionMs` we already store.

- **Why:** reassurance that the bookmark captured the right spot.
- **Size:** small (just formatting).
- **Files:** `js/main.js` (`refreshBookmarkList`), `style.css`.

### 3. Album art thumbnails in the list — DONE

`item.album.images` is in the playback payload. Store the smallest image URL
on the bookmark doc and render it as a thumbnail in the list.

- **Why:** biggest visual upgrade for the least code — the list becomes
  scannable at a glance instead of a wall of text.
- **Size:** small–medium (~15–20 lines + a new stored field).
- **Files:** `js/spotifyApi.js` (carry image URL in snapshot),
  `js/main.js` (`buildBookmarkFromSnapshot`, `refreshBookmarkList`),
  `style.css`. New optional field `imageUrl` on the bookmark — old docs
  without it just render no thumbnail.

### 4. Relative timestamps — DONE

"3 hours ago" instead of the full locale date string on each bookmark.

- **Why:** easier to read; the exact datetime rarely matters.
- **Size:** tiny (a small `formatRelative()` helper, or `Intl.RelativeTimeFormat`).
- **Files:** `js/main.js`.

---

## Robustness

### 5. Handle Spotify 429 (rate limiting) — DONE

`apiFetch()` retries once on 401 but does nothing special on 429. With a
short poll interval — or the always-on client and the phone polling at the
same time — Spotify can throttle us. Respect the `Retry-After` header and
back off instead of hammering.

- **Why:** avoids a throttle spiral; correctness under load.
- **Size:** small–medium.
- **Files:** `js/spotifyApi.js` (`apiFetch`).

### 6. Pause polling when the tab is hidden — DONE (?background opts out)

On mobile the poll loop keeps making API calls in a backgrounded tab (and
gets throttled unpredictably by the browser anyway). Pause on
`visibilitychange`, and fire one immediate catch-up poll when the tab
becomes visible again.

- **Why:** fewer wasted API calls; more predictable behavior on phones.
- **Size:** small.
- **Files:** `js/main.js`.
- **Gotcha:** the always-on / kiosk setup in the README launches Chromium
  with background-throttling disabled and the window "visible", so it
  wouldn't be affected — but double-check that assumption when implementing
  (may want an explicit opt-out, e.g. a query param or setting).

### 7. Dedupe concurrent token refresh — DONE

If two requests hit token expiry at the same moment (e.g. a poll tick and a
Resume), both POST to `/api/token`. Cache the in-flight refresh promise and
have both await it.

- **Why:** avoids a redundant token request and a possible race on stored
  tokens.
- **Size:** tiny.
- **Files:** `js/auth.js` (`getAccessToken` / `refreshAccessToken`).

---

## UX friction

### 8. Device awareness on Resume — DONE

The most common real-world failure is "Couldn't resume — open Spotify on a
device first." Call `GET /me/player/devices`. If there's an inactive device,
offer "Play on <device name>" (transfer playback + start). If there's
genuinely nothing, keep the current honest error.

- **Why:** turns the single biggest friction point into a one-tap fix.
- **Size:** medium.
- **Files:** `js/spotifyApi.js` (new `getDevices`, maybe `transferPlayback`),
  `js/main.js` (`onResume` flow + a little UI).

### 9. Undo (or confirm) on Remove — DONE (5s grace + Undo toast)

Removing a bookmark is silent and immediate — one mis-tap and it's gone.
Either a confirm step, or (nicer) an "Undo" action in the toast that
re-saves the just-deleted doc for a few seconds.

- **Why:** protects against accidental taps.
- **Size:** small.
- **Files:** `js/main.js` (`onRemove`, `showToast` — toast needs an optional
  action button).

---

## Bigger / optional

### 10. Manifest shortcut: "Resume last played" — DONE

Add a `shortcuts` entry to `manifest.json` so long-pressing the home-screen
icon offers "Resume last played" — deep-links into the app with a param that
auto-resumes the top (most-recently-used) bookmark without touching the UI.

- **Why:** the fastest possible path back into your music.
- **Size:** medium.
- **Files:** `manifest.json`, `js/main.js` (handle the deep-link param on
  load).

### 11. Podcast episode support

Spotify *can* resume a podcast episode at a position — play the episode URI
directly with `position_ms`, no `context_uri` / `offset` needed. Different
code path from playlist/album but a natural fit for "where was I."

- **Why:** podcasts are the archetypal "resume later" content.
- **Size:** medium.
- **Files:** `js/spotifyApi.js` (`getPlaybackState` recognizes `episode`
  items / `show` context; `resumePlayback` branches on whether there's a
  context), `js/main.js`, `firestore.rules` is unaffected. Note Spotify
  already remembers episode position natively, so value is partly redundant.

### 12. Unit tests for the pure logic

The app has no tests. The testable parts are the pure functions: playback
snapshot normalization, `contextKey`, the most-recently-used sort
comparator. Extract them if needed and add a small test file (e.g. `node
--test`, no framework).

- **Why:** guardrail for the normalization logic, which is the most
  fiddly / most likely to silently break on a Spotify payload change.
- **Size:** small–medium.
- **Files:** new `test/` dir; possibly minor refactors in `js/spotifyApi.js`
  / `js/firebaseBookmarks.js` to make the pure bits importable in Node.

---

## Remaining

#11 (podcast episodes), #12 (unit tests).
