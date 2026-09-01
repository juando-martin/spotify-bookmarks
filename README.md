# My Spot

Bookmark exactly where you are in a Spotify playlist or album — track +
position — and jump back in later with the queue continuing normally.
Installable on Android as a home-screen PWA (repo name: `spotify-bookmarks`).

Static site (plain ES modules, no build step), hosted on GitHub Pages, with
Firestore for bookmark storage and Spotify's Web API + PKCE OAuth for
playback. Running your own copy needs your own Spotify app credentials, a
Firebase project, and a hosted URL — the four setup steps below, once, then
it's a normal `git push` to deploy. Your credentials go in `config.json`
(loaded at runtime, not baked into the bundle), so rotating a Client ID or
moving Firebase projects later is a one-file edit — no version bump.

## Features

- **Bookmark & resume** the exact track + position inside a playlist or
  album. Resume drops you back there with the queue continuing normally.
  Playing from an artist page or a bare track instead? The button becomes
  **"Bookmark this album"** and saves the current track's album at that spot.
- **Auto-bookmark on switch** — leaving a playlist/album saves where you
  were, automatically (toggle in Settings).
- **Now playing card** — album art, track / album / playlist name, and
  **⏮ / ⏯ / ⏭** transport controls for the active device.
- **Bookmark list** — cover-art thumbnail, saved position ("resumes at
  2:34"), last-used relative time, ordered most-recently-used first, with a
  filter box (matches name / track / artist).
- **Editorial playlists** — Spotify's Web API 404s their name and cover for
  a Development-Mode app; the app falls back to the public
  `open.spotify.com/oembed` endpoint, so Today's Top Hits, RapCaviar and the
  like still show their real name and artwork.
- **Playlist tiles** — a playlist with genuinely no artwork (a private
  personalized mix, a bare playlist) gets a tile drawn from its name. Six
  styles in Settings, plus "Song art" and "Blank"; optionally replace every
  playlist's cover with it. Any bookmark (playlist or album) can also
  override this individually — Spotify's own image, the Settings style
  forced on, one specific style pinned, or an uploaded image — via ✎.
- **List tools** (off by default — see the `listtools` flag below): a
  **Find a playlist or album** search box, and **Pick a track** on any
  bookmark to play a different song from its playlist/album.
- **✎ on any bookmark** opens a panel to rename it and to pick its tile
  image (see *Playlist tiles* above). Renaming is needed for Spotify's
  editorial "Mix" playlists, whose real name the Web API won't hand back;
  your name then shows on the Now playing card too.
- **Resume device handling** — one idle device just plays; several show a
  picker; none shows an "Open in Spotify" deep link.
- **Undo** on Remove (5-second grace period).
- **"Resume last played"** PWA shortcut (long-press the home-screen icon).
- **Settings** — auto-bookmark toggle and poll interval (3–60 s), per
  device.
- **Backup & restore** — export all bookmarks to JSON (copied to the
  clipboard) and paste an export back in to restore them.
- **Update banner** — flags a newer deployed build and reloads past a stuck
  cache in one tap; the running version also shows in the footer.

Deeper detail on each, plus the constraints, is in
[Notes / known constraints](#notes--known-constraints).

## Setup

Do these once. If you're picking this up mid-way, start at step 1 (or step 3
if credentials are already in `config.json` and only hosting is left).

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
5. Save. Open the app's **Settings** and copy the **Client ID** — you'll
   paste it into `config.json` as `spotify.clientId` in step 4.
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
   (`</>`) to register a web app (no Firebase Hosting needed), and keep the
   resulting config object's values handy for the `firebase` block of
   `config.json` in step 4.
6. **Restrict the browser API key.** The Firebase web `apiKey` is public by
   design (access is controlled by `firestore.rules` + anonymous auth, not
   by hiding the key — GitHub's secret scanner flags it anyway, mark that a
   false positive), but scope it to your domain so a copied key is useless
   elsewhere. In the Google Cloud console for the same project
   (**APIs & Services → Credentials → "Browser key (auto created by
   Firebase)"**):
   - **Application restrictions → Websites** — add
     `<your-username>.github.io/*` and `localhost/*` (referrer
     restrictions apply to Firebase Auth, so your dev origin must be
     listed or `signInAnonymously` fails locally).
   - **API restrictions → Restrict key** — *Identity Toolkit API*, *Token
     Service API*, *Cloud Firestore API*, *Firebase Installations API*.
     Firestore data access goes through the rules + auth token, not the
     key, so this doesn't affect it.

   Changes take a few minutes; then confirm login + a bookmark save still
   work on the deployed site and locally.

### 3. GitHub Pages hosting

GitHub Pages on the **free** plan only works with **public** repos (private
repo Pages needs GitHub Pro/Team/Enterprise). That's fine here — `config.json`
only ever holds a Spotify Client ID and a Firebase web config, both meant to
be public, not secrets (the Firebase key is domain-restricted in step 2.6) —
so keep the repo public unless you're on a paid plan. (`config.json` is
committed on purpose: Pages serves the repo directly with no build step, so
an untracked file would never deploy.)

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

1. Copy `config.example.json` to `config.json` and fill in `spotify.clientId`
   (from step 1) and every `firebase.*` value (from step 2). It's plain JSON,
   no comments. The app validates it on load and shows a **"Setup needed"**
   screen listing anything missing or malformed.
2. Commit and push again (`config.json` is tracked — see step 3).
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
- **List tools** — the **Find a playlist or album** search card and the
  per-bookmark **Pick a track** button — are **hidden by default**. Both hit
  Spotify endpoints (`/search`, `/playlists/{id}/tracks`) that chew through
  a Development-Mode app's small rate-limit budget in bursts, which is the
  quickest way to get the app 429'd. The code is all still there; only the
  UI that reaches it is gated on a flag, `LIST_TOOLS_ENABLED` in
  `js/main.js`, resolved at startup from:
  - `?listtools=1` in the URL — turns it on and persists the choice (the
    param is then stripped from the address bar). `?listtools=0` turns it
    back off. Handy on a phone with no dev console.
  - `localStorage` key `myspot:listTools` (`"1"` / `"0"`) — what the URL
    param writes; set it directly from a desktop console if you prefer.
  - default: **off**.

  With the flag on: **Find a playlist or album** is a foldable card between
  Now playing and Settings — typing searches the catalogue
  (`/search?type=playlist,album`, debounced 300 ms), tapping a result plays
  it from the start on the active device (`context_uri` with
  `offset: { position: 0 }`, same needs-a-device caveat as Resume; it
  doesn't create a bookmark — "Bookmark this spot" does once it's playing).
  **Pick a track** expands a bookmark's playlist/album inline so you can
  start a different song from it.
- A bookmark's **cover art is a link** (green ↗ badge) to
  `open.spotify.com/<kind>/<id>` — on a phone that opens the Spotify app on
  that playlist/album; on desktop it opens the web player in a new tab.
  This one is always available (it's a plain link, no API call) and is the
  get-out for editorial playlists "Pick a track" can't list.
- The Now playing card has **⏮ / ⏯ / ⏭** transport buttons and a **seek
  bar** (shown only when something's on a device). They control whatever
  device is active — same "needs an active device" caveat as Resume.
  Play/pause flips optimistically; the seek bar advances once a second
  between polls and resyncs on each poll; dragging it seeks the device.
- **Remove** deletes after a 5-second grace period with an **Undo** in the
  toast; the delete only actually hits Firestore once that window passes.
- **Backup & restore** lives at the bottom of the bookmarks card. *Export &
  copy* puts `{ app, version, exportedAt, bookmarks[] }` on the clipboard
  (and in a textarea as a fallback). *Import* accepts that, or a bare array;
  each entry is sanitized to the whitelisted fields before writing, and a
  bookmark for a playlist/album you already have is overwritten. Your only
  copy of the data is otherwise the one Firestore collection.
- Bookmarks are always **playlist** or **album** contexts. When you're
  playing from an **artist** page, from Liked Songs, or a bare track with no
  context at all, there's no resumable list to save a spot in — so the
  button becomes **"Bookmark this album"** and saves an ordinary album
  bookmark for the *current track's* album, at that track and position.
  Resume then plays that album from there. (A **podcast** episode has no
  album, so the button stays disabled — Spotify already remembers episode
  position natively.) Auto-bookmark-on-switch is unchanged: it still only
  fires for playlist/album contexts.
- Bookmarks are keyed one-per-context: re-bookmarking the same playlist or
  album overwrites its previous bookmark in place. A playlist and an album
  are always separate bookmarks even in the unlikely event their IDs match
  (the stored key is prefixed with the type).
- The bookmark list is ordered most-recently-used first, where "used" means
  either saved (manual or auto) or resumed. Bookmarks created before this
  ordering existed fall back to their save time.
- A bookmark's thumbnail is the **playlist or album cover**. For an album
  that's free (it's the playing track's art, already in the payload); for a
  playlist it's one extra `GET /playlists/{id}`, made **only when a bookmark
  is first saved** (or re-saved while it still lacks a real name or cover) —
  never on the poll loop, and skipped entirely once the name and cover are
  stored. When Spotify confirms a playlist has no cover it can read (an
  editorial mix, or a playlist with no art of its own), the bookmark stores
  `imageUrl: null` and the list draws a **generated tile** instead — what
  that looks like is the *Playlist tile* setting below. Each bookmark also
  stores `trackImageUrl` (the saved track's own art, always) to feed the
  "Song art" tile. The Now playing card still shows the current *track's*
  art, not the cover. Bookmarks saved before a change keep whatever they
  stored until re-saved.
- The poll loop is deliberately just `GET /me/player`. A playlist's name
  isn't in that payload, so the Now playing card takes the name from the
  matching bookmark (`customName` / `contextName`); for a playlist you're
  playing but haven't bookmarked it does **one** name lookup per context per
  session (`GET /playlists/{id}`, then oEmbed — see the editorial-playlist
  note below), off the poll tick, and shows "In a playlist" until that
  lands. This keeps steady-state traffic to one request per interval — an
  earlier build looked the name up *every* tick and that call is what kept
  getting 429'd.
- Reading a **private or collaborative** playlist's name needs the
  `playlist-read-private` / `playlist-read-collaborative` scopes (in
  `js/config.js`). If you added these to an existing install, **log out and
  back in** once to re-consent, or playlist names stay blank ("In a
  playlist").
- Spotify-owned **editorial / algorithmic** playlists (Today's Top Hits,
  RapCaviar, mood/genre mixes, …) can't be read via the Web API for
  Development-Mode apps (it 404s). When that happens the app falls back to
  **`open.spotify.com/oembed`** — the same public endpoint blog embeds use.
  It's unauthenticated, CORS-open, and on a separate rate limit from
  `api.spotify.com`, and it returns the playlist's real **name and cover**,
  so most editorial playlists now resolve normally with no action from you.
  The fallback lives in `getContextMeta()` (`js/spotifyApi.js`); the cover
  URL it hands back is an `i.scdn.co` link, stored in `imageUrl` exactly
  like a Web-API cover. What oEmbed *can't* see is a playlist that isn't
  public on `open.spotify.com` — a truly private playlist, or a personalized
  mix like **Discover Weekly / Daily Mix**. Those still show "Unknown
  playlist" + a generated tile; rename with ✎ to give them a name (it
  sticks — the playlist ID is stable even as the contents rotate).
- Every bookmark has a **✎** control opening a panel with a name field and
  the tile picker (see *Playlist tiles* above). The custom name is stored
  per bookmark (`customName`), shown instead of Spotify's (clear the field
  to fall back), and survives re-saves and auto-bookmarks. While that
  context is playing, the Now playing card shows the custom name too. This
  is the fix for the editorial-playlist case above: the playlist ID is
  stable (Discover Weekly keeps the same URI forever, only its contents
  rotate), so a name you set once sticks.
- Next to ✎ is a **↻ refresh** control — re-asks Spotify for the playlist's
  real name and cover and, for an old bookmark, backfills the saved track's
  art via `GET /tracks/{id}`. It bypasses the session cache, the failure
  cooldown, *and* a prior "unreadable" mark — a full retry of the Web API
  **and** the oEmbed fallback (not the global rate-limit pause). Merges just
  the changed fields; doesn't touch the saved spot or the ordering. Use it
  to unstick an "Unknown playlist" or a blank Song-art tile without
  replaying the playlist.
- If the Spotify **refresh token** is finally rejected (revoked, or long
  unused), the app clears its tokens, drops to the login screen, and shows
  "Your Spotify session expired — log in again". A reload wouldn't help;
  this is the clean path.
- If Spotify rate-limits a request (HTTP 429), the API wrapper stops making
  requests entirely until it's safe again. It honours the `Retry-After`
  header **in full** (Spotify sends anything from seconds to an hour for a
  badly-limited app), with a 30s floor and no upper cap, and each further
  429 before the window clears **doubles** the wait (60s → 120s → … → ~64
  min). Every `apiFetch` short-circuits *and* `pollOnce` no-ops during that
  window, so the app goes completely silent and Spotify's limiter can reset
  rather than being pinned open by a request every few seconds. The
  deadline is persisted to `localStorage` (`myspot:rl`, re-read every check
  so a 429 in one tab pauses the others, capped at 1h when recovered from
  storage) so a reload or service-worker update still waits it out. A toast
  tells you (at most once a minute). It recovers on its own. The whole
  state machine is `createRateLimiter()` in `js/rateLimit.js` and the wait
  math is `rateLimitWaitSeconds()` in `js/format.js` — both unit-tested.
- A playlist whose name/cover can't be read is backed off so it isn't
  re-requested on the next save: a 404 where the oEmbed fallback also can't
  see it (a private / personalized playlist) for the rest of the session; a
  429 for 15 minutes; a transient oEmbed failure or any other error for 10
  minutes.
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
  - **Playlist tile** — the account-wide *style*: six generated tiles
    (**Flat, Gradient, Aurora, Equalizer, Risograph, Hairline** — drawn from
    the playlist's id for the colour/shape and its name for a 1–2 letter
    monogram, so the same playlist always looks the same on every device),
    or **Song art** (the saved track's album art) or **Blank** (an empty
    tile). The radio below it no longer decides live rendering — it only
    picks which tile source a **newly-created** bookmark starts with:
    Spotify's own image, falling back to this style if there is none
    (default), or this style forced on from the start. Any bookmark, once
    created (playlist or album), can override its own tile independently via
    **✎**: Spotify's image, the *current* Settings style forced on (tracks
    future changes to it), one specific style pinned regardless of Settings,
    or an uploaded image — see `IDEAS.md` #12 for the full model. (Studied
    in the "Playlist Tile Studio" design page for the generated styles
    themselves.)
  All four are stored per-device in `localStorage`; `POLL_INTERVAL_MS` in
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
  allowlisted account can't write junk or oversized documents. Because the
  rules whitelist the exact bookmark fields, **a client change that adds a
  field needs `firestore.rules` re-pasted and Published first** — otherwise
  every save fails with `Missing or insufficient permissions`. Re-publish
  whenever you pull a change to that file.
- Firestore runs with a **persistent local cache** (IndexedDB). Bookmark
  writes queue and retry through connectivity blips, and the list loads from
  cache first, then revalidates. Falls back to memory-only where IndexedDB
  isn't available.
- A playlist that returns 404 from the Web API *and* has no public
  `open.spotify.com/oembed` data is negative-cached for the session, so a
  bookmark save doesn't re-request one that's known to be unreadable. The ↻
  button clears that mark for a one-off retry.
- **Runtime config.** The Spotify Client ID and the Firebase web config load
  from `./config.json` at startup (`js/runtimeConfig.js`), not from the JS
  bundle — so if a Client ID is ever revoked, or you move to a new Firebase
  project, you edit one JSON file and `git push`, with no `npm run bump`.
  `config.json` is validated on load; anything missing or malformed (a
  leftover `config.example.json` placeholder, a typo'd key) shows a **"Setup
  needed"** screen listing the exact problems instead of a login button that
  can't work. It's committed to the repo (Pages has no build step) and
  listed in `sw.js`'s `SHELL_FILES`, so the service worker never caches a
  shell that's newer than the config it needs — online, the network-first
  worker still revalidates it every load. The `scopes` list and the poll
  interval default stay in `js/config.js`: changing scopes forces every user
  to re-consent, so it's deliberately a code change.
- **The Firebase `apiKey` in `config.json` is not a secret.** It's a public
  project identifier that ships in every Firebase web app; access is
  controlled by `firestore.rules` + the anonymous-auth gate, and the key is
  restricted to the deploy domain + `localhost` in the Google Cloud console
  (step 2.6). GitHub's secret scanner still flags the `AIza…` prefix — a
  known false positive for Firebase web keys; dismiss the alert as such.
  Same for the Spotify Client ID (a PKCE app has no client secret).

## File layout

```
index.html              Single-page UI
style.css                Styling
manifest.json            PWA manifest (Android "Add to Home Screen")
sw.js                     Service worker — network-first shell cache (offline fallback only)
firestore.rules           Firestore security rules to paste into the Firebase console
config.json               YOUR Spotify Client ID + Firebase web config (fill in per steps above)
config.example.json       Template for config.json — copy and fill in
js/config.js              Static config: OAuth scopes, redirect URI, poll-interval default
js/runtimeConfig.js       Loads + validates config.json at startup (unit-tested)
js/pkce.js                PKCE code_verifier/code_challenge helpers
js/auth.js                Spotify OAuth login/redirect/token refresh (shared single-flight)
js/spotifyApi.js          Spotify Web API wrapper (playback, resume, transport, devices, meta + open.spotify.com/oembed fallback)
js/rateLimit.js           The 429 back-off state machine (persisted deadline, escalation, cross-tab) — unit-tested
js/format.js              Pure helpers: formatting, playback-state normalization, oEmbed parse, tile monogram + hash, 429 wait math (unit-tested)
js/tiles.js               Generated placeholder cover tiles — canvas → data URL, six styles
js/firebaseBookmarks.js   Firestore bookmark storage (one doc per playlist/album per user)
js/version.js             APP_VERSION string — bump with sw.js CACHE_NAME each deploy
js/main.js                Wires it all together: UI, polling loop, auto-bookmark
test/format.test.js       Unit tests for js/format.js
test/rateLimit.test.js    Unit tests for the 429 back-off (injected clock + fake storage)
test/rules.test.js        Asserts the client's bookmark fields all pass firestore.rules
test/runtimeConfig.test.js  config.json validation + load (mocked fetch), and the shipped config files
icons/                    App icons for the PWA manifest
```

## Development

No build step — it's plain ES modules served as files. To run the unit tests
(`js/format.js` helpers, `normalizePlaybackState`, the bookmark sort key, the
429 wait math + the `js/rateLimit.js` back-off state machine, the tile
monogram, the oEmbed response parser, a check that the client's bookmark
fields all pass `firestore.rules`, and the `config.json` loader + validator):

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

---

Copyright (c) 2026 Juan D. Martin.
