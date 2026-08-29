// Minimal service worker: caches the static app shell so the PWA installs
// cleanly and opens instantly. It deliberately does NOT cache Spotify API,
// Firebase, or CDN requests — those always need the network to be useful.
//
// Bump CACHE_NAME whenever you change any shell file and redeploy, so
// installed devices pick up the update instead of serving a stale cache.
const CACHE_NAME = "playlist-resume-shell-v2";

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
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
