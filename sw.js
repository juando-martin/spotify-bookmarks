// Minimal service worker for the app shell.
//
// Strategy: network-first for same-origin GETs, cache only as an offline
// fallback. The app is useless without the network anyway (Spotify +
// Firebase), so it should never serve a stale shell while online.
//
// The catch that caused every "still on the old version" report: GitHub
// Pages sends `Cache-Control: max-age=600` with no revalidation, so a plain
// fetch() — even from a "network-first" worker — is served from the browser
// HTTP cache for 10 minutes. So every shell fetch here forces revalidation
// (`cache: no-cache` → conditional request, cheap 304s) and install does a
// hard `reload`. Spotify API / Firebase / gstatic requests are never touched.
//
// Keep the version number here in step with APP_VERSION in js/version.js.
const CACHE_NAME = "playlist-resume-shell-v24";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/config.js",
  "./js/version.js",
  "./js/format.js",
  "./js/pkce.js",
  "./js/auth.js",
  "./js/spotifyApi.js",
  "./js/firebaseBookmarks.js",
  "./js/main.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_FILES.map((file) =>
          fetch(file, { cache: "reload" }).then((res) => {
            if (res.ok) return cache.put(file, res);
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only manage same-origin GET requests (the app shell). Everything else
  // (Spotify API, Firebase, gstatic CDN) goes straight to the network.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    // no-cache: hit the server and revalidate rather than trusting max-age.
    fetch(url.pathname + url.search, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)) // offline — fall back to cache
  );
});
