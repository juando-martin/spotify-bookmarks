# Playlist Resume

Bookmark exactly where you are in a Spotify playlist or album — track +
position — and jump back in later with the queue continuing normally.
Installable on Android as a home-screen PWA.

Static site (plain ES modules, no build step), hosted on GitHub Pages, with
Firestore for bookmark storage and Spotify's Web API + PKCE OAuth for
playback. Running your own copy needs your own Spotify app credentials, a
Firebase project, and a hosted URL — the four setup steps below, once, then
it's a normal `git push` to deploy.

## Features

- **Bookmark & resume** the exact track + position inside a playlist or
  album. Resume drops you back there with the queue continuing normally.
- **Auto-bookmark on switch** — leaving a playlist/album saves where you
  were, automatically (toggle in Settings).
- **Now playing card** — album art, track / album / playlist name, and
  **⏮ / ⏯ / ⏭** transport controls for the active device.
- **Bookmark list** — album-art thumbnail, saved position ("resumes at
  2:34"), last-used relative time, ordered most-recently-used first.
- **Rename** any bookmark (✎). Needed for Spotify's editorial "Mix"
  playlists, whose real name the Web API won't hand back; your name then
  shows on the Now playing card too.
- **Resume device handling** — one idle device just plays; several show a
  picker; none shows an "Open in Spotify" deep link.
- **Undo** on Remove (5-second grace period).
- **"Resume last played"** PWA shortcut (long-press the home-screen icon).
- **Settings** — auto-bookmark toggle and poll interval (3–60 s), per
  device.
- **Update banner** — flags a newer deployed build and reloads past a stuck
  cache in one tap; the running version also shows in the footer.

Deeper detail on each, plus the constraints, is in
[Notes / known constraints](#notes--known-constraints).

## Setup

Do these once. If you're picking this up mid-way, start at step 1 (or step 3
if credentials are already in `js/config.js` and only hosting is left).

### 1. Spotify Developer Dashboard

1. Go to https://developer.spotify.com/dashboard and log in with your
   Spotify account.
2. Click **Create app**. Fill in a name/description (anything).
3. For **Redirect URI**, use your future GitHub Pages URL (see step 3) —
   typically:
   ```
   https://<your-github-username>.github.io/spotify-bookmarks/
   ```
   You can add this now and come back to fix it if the exact URL changes.
4. Under **Which API/SDKs are you planning to use?**, check **Web API**.
5. Save. Open the app's **Settings** and copy the **Client ID** — paste it
   into `js/config.js` as `SPOTIFY_CONFIG.clientId`.
6. Note: new Spotify apps start in **Development Mode**, capped at ~25
   allowlisted users (Dashboard → your app → **User Management**). That's
   fine for personal use; add a few emails there if you want to share with
   friends/family.

### 2. Firebase project

1. Go to https://console.firebase.google.com and create a free project.
2. In the project, go to **Build → Firestore Database → Create database**.
   Start in production mode (we'll set rules explicitly next).
3. Go to **Firestore Database → Rules**, paste in the contents of
   `firestore.rules` from this repo, and click **Publish**.
4. Go to **Build → Authentication → Sign-in method**, and enable the
   **Anonymous** provider. (The app uses anonymous auth purely as a gate
   against random internet writes — see the comment at the top of
   `js/firebaseBookmarks.js` for what this does and doesn't protect.)
5. Go to **Project settings → General → Your apps**, click the web icon
   (`</>`) to register a web app (no Firebase Hosting needed), and copy the
   resulting config object's values into `js/config.js`'s `FIREBASE_CONFIG`.

### 3. GitHub Pages hosting

GitHub Pages on the **free** plan only works with **public** repos (private
repo Pages needs GitHub Pro/Team/Enterprise). That's fine here — `js/config.js`
only ever holds a Spotify Client ID and a Firebase web config, both meant to
be public, not secrets — so keep the repo public unless you're on a paid plan.

From the Linux laptop, initialize and commit first:
```bash
cd ~/workspace/spotify-bookmarks
git init
git add .
git commit -m "Initial scaffold: Spotify playlist resume PWA"
git branch -M main
```

Then create the GitHub repo and push. If you have the `gh` CLI installed,
this does both in one step (prompts you to log in the first time):
```bash
gh repo create spotify-bookmarks --public --source=. --remote=origin --push
```

Without `gh`, create an empty repo at github.com/new (name it
`spotify-bookmarks`, public, **don't** initialize it with a README — this
folder already has one), then:
```bash
git remote add origin https://github.com/<your-github-username>/spotify-bookmarks.git
git push -u origin main
```

Once pushed, go to the repo's **Settings → Pages**, set **Source** to the
`main` branch and folder `/ (root)`, and save. GitHub gives you a URL like
`https://<username>.github.io/spotify-bookmarks/`. Make sure this **exactly**
matches (including trailing slash) the Redirect URI registered in Spotify
(step 1.3) and used implicitly by `js/config.js` (it's computed from
`window.location`, so nothing to edit there — just make sure the Dashboard's
Redirect URI matches the real deployed URL).

### 4. Fill in config and test

1. Edit `js/config.js`: set `SPOTIFY_CONFIG.clientId` and all of
   `FIREBASE_CONFIG`.
2. Commit and push again.
3. Visit the GitHub Pages URL from your phone browser (or the laptop),
   click **Log in with Spotify**, and approve access.
4. Play something from a playlist or album on any Spotify device, hit
   **Bookmark this spot**, switch to a different playlist/album/podcast, and
   confirm a bookmark appears in the list with the right track name and a
   `PLAYLIST` or `ALBUM` tag.
5. Tap **Resume** on a bookmark — playback should jump to that exact track,
   inside that playlist or album, and a confirmation toast should appear.
6. On Android Chrome, open the site, tap the **⋮** menu → **Add to Home
   screen** to install it as a standalone app.

## Notes / known constraints

- Spotify's `Start/Resume Playback` endpoint requires an **active device**.
  When Resume finds none:
  - exactly one known (idle) device → it just starts there;
  - two or more → a picker to choose;
  - none at all → an **"Open … in Spotify"** link (deep-links to the
    bookmarked playlist/album via `open.spotify.com`, which hands off to the
    app on a phone). Open it, then tap Resume again — the phone is now a
    device, so it plays straight away.
- Each bookmark shows the saved position ("resumes at 2:34") and when it was
  last used as a relative time ("used 3 hours ago"; hover/long-press for the
  exact timestamp).
- The Now playing card has **⏮ / ⏯ / ⏭** transport buttons and a **seek
  bar** (shown only when something's on a device). They control whatever
  device is active — same "needs an active device" caveat as Resume.
  Play/pause flips optimistically; the seek bar advances once a second
  between polls and resyncs on each poll; dragging it seeks the device.
- **Remove** deletes after a 5-second grace period with an **Undo** in the
  toast; the delete only actually hits Firestore once that window passes.
- Only **playlist** and **album** contexts can be bookmarked. Spotify also
  reports "artist" (e.g. artist radio / an artist page) and "show" (podcast)
  contexts, but those don't resume to an exact track + position reliably, so
  **Bookmark this spot** stays disabled for them ("Not in a playlist or
  album context"). Playing a bare track with no context also can't be
  bookmarked.
- Bookmarks are keyed one-per-context: re-bookmarking the same playlist or
  album overwrites its previous bookmark in place. A playlist and an album
  are always separate bookmarks even in the unlikely event their IDs match
  (the stored key is prefixed with the type).
- The bookmark list is ordered most-recently-used first, where "used" means
  either saved (manual or auto) or resumed. Bookmarks created before this
  ordering existed fall back to their save time.
- A bookmark's thumbnail is the **playlist or album cover**. For an album
  that's free (it's the playing track's art, already in the payload); for a
  playlist it's one extra `GET /playlists/{id}` (cached for the session). If
  the cover can't be read — an editorial playlist — it falls back to the
  bookmarked track's album art. The Now playing card still shows the current
  *track's* art, not the cover. Bookmarks saved before this show whatever
  they stored until re-saved.
- Reading a **private or collaborative** playlist's name needs the
  `playlist-read-private` / `playlist-read-collaborative` scopes (in
  `js/config.js`). If you added these to an existing install, **log out and
  back in** once to re-consent, or playlist names stay blank ("In a
  playlist").
- Spotify-owned **editorial / algorithmic** playlists (Discover Weekly,
  Daily Mix, Release Radar, artist/mood Mixes, …) can't be read via the Web
  API for Development-Mode apps, so their name won't resolve — the bookmark
  shows "Unknown playlist" and the Now playing card shows "In a playlist".
  Bookmarking and resuming still work; only the display name is missing.
- Every bookmark has a **✎ rename** control next to its name. The custom
  name is stored per bookmark (`customName`), shown instead of Spotify's
  (clear the field to fall back), and survives re-saves and auto-bookmarks.
  While that context is playing, the Now playing card shows the custom name
  too. This is the fix for the editorial-playlist case above: the playlist
  ID is stable (Discover Weekly keeps the same URI forever, only its
  contents rotate), so a name you set once sticks.
- If Spotify rate-limits a request (HTTP 429), the API wrapper waits out the
  `Retry-After` delay (capped at 15s) and retries up to 3 times rather than
  hammering.
- The **Settings** card (a foldable `<details>`, collapsed by default, state
  remembered per device) has:
  - **Auto-bookmark when I switch playlist or album** — on by default; saves
    where you were when you leave a context. Manual **Bookmark this spot**
    works regardless.
  - **Keep an already-bookmarked playlist/album updated as it plays** — off
    by default; when the current context is one you've bookmarked, its
    saved spot advances on every track change (one Firestore write per song
    while you listen).
  - **Check Spotify every** 3–60 s — lower is tighter precision at the cost
    of more API calls. Auto-bookmark-on-switch can be up to one interval
    behind the actual moment.
  All three are stored per-device in `localStorage`; `POLL_INTERVAL_MS` in
  `js/config.js` is only the pre-touch default for the interval.
- Polling only runs **while the app is the visible tab**. It's paused on
  `visibilitychange` when hidden and does one immediate catch-up poll when
  you come back, so backgrounding the app (or closing the PWA) means
  switches made in the meantime aren't auto-captured. Manual bookmarking and
  Resume are unaffected. The always-on setup below passes `?background` to
  opt out of this pause. See "Always-on auto-bookmark" if you want 24/7.
- The PWA exposes a **"Resume last played"** shortcut (long-press the
  home-screen icon on Android, right-click the taskbar icon on desktop) that
  opens the app and immediately resumes your most-recently-used bookmark —
  it just loads `./?action=resume-last`.
- The running version shows in the footer (`v21`, …) and is logged to the
  console on load. On every load and every time the app returns to the
  foreground it fetches `js/version.js` from the network; if that's newer
  than the running build it shows an **"Update available"** banner whose
  **Reload** button clears the caches, unregisters the service worker, and
  reloads. Bump `APP_VERSION` in `js/version.js` **and** `CACHE_NAME` in
  `sw.js` together on every deploy.
- GitHub Pages serves shell files with `Cache-Control: max-age=600` and no
  revalidation, so a plain `fetch()` (even from a "network-first" worker)
  gets a 10-minute-stale copy. The service worker works around this: it
  fetches every shell file with `cache: "no-cache"` (a conditional request —
  cheap 304s, fresh 200s), `install` uses `cache: "reload"`, and it's
  registered with `updateViaCache: "none"` so `sw.js` itself is never
  HTTP-cached. Deploys made **before v21** don't have this and may still
  need a manual close-and-reopen once to reach v21.
- The Firestore security model is intentionally simple for a personal /
  small-allowlist app: any signed-in (anonymous) client can read or delete
  any bookmark. It does **not** isolate one allowlisted user's bookmarks
  from another's — see the comment block at the top of
  `js/firebaseBookmarks.js`. The `create` / `update` rules do validate shape
  and size (known fields only, string length caps, `positionMs` range) so an
  allowlisted account can't write junk or oversized documents. **Re-paste
  `firestore.rules` and Publish** after pulling a change to that file.
- Firestore runs with a **persistent local cache** (IndexedDB). Bookmark
  writes queue and retry through connectivity blips, and the list loads from
  cache first, then revalidates. Falls back to memory-only where IndexedDB
  isn't available.
- Names/covers for playlists that return 404 (Spotify's editorial Mixes) are
  negative-cached for the session, so the app doesn't re-request them on
  every poll.

## File layout

```
index.html              Single-page UI
style.css                Styling
manifest.json            PWA manifest (Android "Add to Home Screen")
sw.js                     Service worker — network-first shell cache (offline fallback only)
firestore.rules           Firestore security rules to paste into the Firebase console
js/config.js              YOUR Spotify + Firebase config (fill in per steps above)
js/pkce.js                PKCE code_verifier/code_challenge helpers
js/auth.js                Spotify OAuth login/redirect/token refresh (shared single-flight)
js/spotifyApi.js          Spotify Web API wrapper (playback state, resume, transport, devices, playlist/album meta; 429 backoff)
js/format.js              Pure helpers: formatting + playback-state normalization (unit-tested)
js/firebaseBookmarks.js   Firestore bookmark storage (one doc per playlist/album per user)
js/version.js             APP_VERSION string — bump with sw.js CACHE_NAME each deploy
js/main.js                Wires it all together: UI, polling loop, auto-bookmark
test/format.test.js       Unit tests for js/format.js
icons/                    App icons for the PWA manifest
```

## Development

No build step — it's plain ES modules served as files. To run the unit tests
(they cover `js/format.js`: formatting helpers, `normalizePlaybackState`,
the bookmark sort key):

```bash
npm test        # == node --test  (needs Node 18+, no dependencies)
```

Before each deploy, bump the version (keeps `APP_VERSION` in `js/version.js`
and `CACHE_NAME` in `sw.js` in step — the update banner and cache-busting
depend on it):

```bash
npm run bump          # current + 1
npm run bump -- 30    # set explicitly
```

To try it locally, serve the folder over HTTP (module scripts need it) and
register the Spotify redirect URI for that origin, e.g.
`python3 -m http.server 8777` then visit `http://127.0.0.1:8777/`.

## Always-on auto-bookmark (optional)

The app only polls while it's the visible tab, so auto-bookmark-on-switch
only catches switches you make while looking at it. If you want it to run
around the clock without writing any backend code, park the already-deployed
page — with `?background` so it never pauses — in a browser on an always-on
machine (a Raspberry Pi, a NAS, an old laptop). That machine just becomes a
persistent client — same code, same Firestore, nothing new to deploy.

1. On the always-on machine, launch Chromium pointed at the deployed URL
   with `?background` (so the app keeps polling even when the window isn't
   the visible tab) and background throttling disabled:

   ```bash
   chromium --kiosk "https://<your-username>.github.io/spotify-bookmarks/?background" \
     --user-data-dir="$HOME/.spotify-bookmarks-profile" \
     --disable-background-timer-throttling \
     --disable-backgrounding-occluded-windows \
     --disable-renderer-backgrounding
   ```

   On a headless Pi, wrap it in a virtual display: `xvfb-run -a chromium …`
   (package names: `chromium` or `chromium-browser`, plus `xvfb`).

2. The first time, complete the **Log in with Spotify** flow in that browser
   once. The `--user-data-dir` above gives it a persistent profile, so the
   refresh token in `localStorage` survives reboots and the app keeps
   renewing its own access token. You only re-log-in if that profile
   directory is deleted.

3. Optionally lower the poll interval in the app's **Settings** card on that
   machine (it's stored per-profile, so it won't affect your phone).

4. To start it automatically, run the command from a systemd user service,
   a `@reboot` cron entry, or your desktop's autostart.

Notes:

- The redirect URI is the same deployed URL you already registered with
  Spotify — nothing to add in the dashboard.
- If your phone also has the app open at the same time, both poll and both
  write the same bookmark. It's harmless (identical, idempotent writes) —
  just double the API calls, well within rate limits. In practice you'd
  leave the always-on client to do the capturing and only open the phone app
  to hit **Resume**.
- The only thing a real backend (e.g. a Firebase scheduled Cloud Function
  holding your refresh token) would add over this is not needing a physical
  device that stays powered on. The polling and latency are identical.
