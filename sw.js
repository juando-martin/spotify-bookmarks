// Minimal service worker for the app shell.
//
// Strategy: network-first for same-origin GETs, falling back to the cache
// only when offline. This app is useless without the network anyway (it
// talks to Spotify + Firebase), so there's no reason to ever serve a stale
// shell while online — that just meant "reload twice after every deploy".
// The cache exists purely so the PWA still opens (offline shell) with no
// connection. Spotify API / Firebase / gstatic requests are never touched.
const CACHE_NAME = "playlist-resume-shell-v8";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/config.js",
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
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
    fetch(event.request)
      .then((response) => {
        // Refresh the cached copy on every successful fetch.
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)) // offline — fall back to cache
  );
});
