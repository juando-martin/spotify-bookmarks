# Playlist Resume

Bookmark exactly where you are in a Spotify playlist or album — track +
position — and jump back in later with the queue continuing normally.
Installable on Android as a home-screen PWA.

The code is scaffolded and functionally complete. It won't run yet because
it needs your own Spotify app credentials, your own Firebase project, and a
hosted URL. Do the four setup steps below once, then it's a normal git push
to deploy from then on.

**Status as of this scaffold:** nothing has been pushed to GitHub yet and
`js/config.js` still has placeholder values. If you're picking this up in a
new Claude Code session, this file has everything needed to continue —
just start with step 1 below (or step 3 if credentials are already filled
in and only hosting/git is left).

## 1. Spotify Developer Dashboard

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

## 2. Firebase project

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

## 3. GitHub Pages hosting

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

## 4. Fill in config and test

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

### Notes / known constraints

- Spotify's `Start/Resume Playback` endpoint requires an **active device**
  (something with Spotify open). If nothing is open anywhere, Resume will
  show an error asking you to open Spotify first — that's a Spotify API
  limitation, not a bug here.
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
- Auto-bookmark-on-switch works by polling playback state on an interval, so
  the saved position can be up to one interval behind the actual switch
  moment. The **Settings** card in the app has:
  - a checkbox to turn auto-bookmark-on-switch off (manual **Bookmark this
    spot** still works); and
  - a dropdown to change how often the app polls Spotify (3–60 s). Lower is
    tighter precision at the cost of more API calls.
  Both are stored per-device in `localStorage`. `POLL_INTERVAL_MS` in
  `js/config.js` is only the default before you touch the dropdown.
- The Firestore security model is intentionally simple for a personal /
  small-allowlist app — see the comment block at the top of
  `js/firebaseBookmarks.js` before sharing this more widely.

## File layout

```
index.html              Single-page UI
style.css                Styling
manifest.json            PWA manifest (Android "Add to Home Screen")
sw.js                     Service worker — caches the app shell for install/offline shell
firestore.rules           Firestore security rules to paste into the Firebase console
js/config.js              YOUR Spotify + Firebase config (fill in per steps above)
js/pkce.js                PKCE code_verifier/code_challenge helpers
js/auth.js                Spotify OAuth login/redirect/token refresh
js/spotifyApi.js          Spotify Web API wrapper (playback state, resume, playlist/album name)
js/firebaseBookmarks.js   Firestore bookmark storage (one doc per playlist/album per user)
js/main.js                Wires it all together: UI, polling loop, auto-bookmark
icons/                    App icons for the PWA manifest
```
