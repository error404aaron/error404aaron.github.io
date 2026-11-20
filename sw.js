// AETHER offline shell service worker.
//
// This file is a template: the Vite `aetherPwa` plugin (apps/web/vite.config.ts) replaces the
// two placeholders below and emits the result as `dist/sw.js`. Every production build therefore
// gets its own cache name and a complete list of the files it needs to start offline.
//
// The worker only caches application files. Workspace data lives in IndexedDB, which this
// worker never opens, so installing or replacing a worker cannot alter saved records.
const BUILD_ID = "ad9faaf-4eec068d1a";
const PRECACHE = [
  "/",
  "/assets/AdvancedGraphView-CDqhlDyP.js",
  "/assets/CollectivePanel-C2lH8CJQ.js",
  "/assets/DesktopShell-D0FFa7uG.js",
  "/assets/MindspaceView-Dqfq6UJw.js",
  "/assets/PanelViews-BA_0tlfb.js",
  "/assets/QuickSwitcher-Ca4XfDiJ.js",
  "/assets/RecoveryDialog-BLFbeaox.js",
  "/assets/SearchPanelView-CNW47owM.js",
  "/assets/SpatialCards-BZDxW-Dk.js",
  "/assets/WorkspaceOverviewView-D7rKVJt4.js",
  "/assets/index-BXVkX-Qp.js",
  "/assets/index-CVieVYg6.js",
  "/assets/index-n4wxqG8A.css",
  "/assets/recoveryRestore-BweT_D2S.js",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.png",
  "/icons/icon-512.svg",
  "/index.html",
  "/manifest.webmanifest"
];
const CACHE_PREFIX = "aether-shell-";
const CACHE_VERSION = CACHE_PREFIX + BUILD_ID;
// Files that describe the build itself are always fetched fresh and never cached.
const NETWORK_ONLY = new Set(["/sw.js", "/build.json"]);
// On a slow or captive network, fall back to the cached shell instead of hanging the launch.
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        // `reload` bypasses the HTTP cache so a new build never precaches stale bytes.
        cache
          .addAll(PRECACHE.map((path) => new Request(path, { cache: "reload" })))
          .then(() => Promise.all(PRECACHE.map((path) => cache.match(path, { ignoreVary: true }))))
          .then((matches) => {
            if (matches.some((hit) => !hit)) {
              throw new Error("aether-sw: incomplete precache validation");
            }
          })
      )
      .catch((error) => {
        // Remove incomplete cache on failed install while keeping prior caches intact.
        return caches.delete(CACHE_VERSION).then(() => {
          throw error;
        });
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  } else if (event.data.type === "GET_BUILD_ID" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ buildId: BUILD_ID, cache: CACHE_VERSION });
  } else if (event.data.type === "GET_CLIENT_COUNT" && event.ports && event.ports[0]) {
    self.clients
      .matchAll({ type: "window", includeUncontrolled: false })
      .then((list) => event.ports[0].postMessage({ count: list.length }))
      .catch(() => event.ports[0].postMessage({ count: 2 }));
  }
});

function cachedShell() {
  return caches
    .open(CACHE_VERSION)
    .then((cache) =>
      cache
        .match("/index.html", { ignoreVary: true })
        .then((hit) => hit || cache.match("/", { ignoreVary: true }))
    );
}

function networkWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("navigation timeout")), NAVIGATION_TIMEOUT_MS);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.has(url.pathname)) return;

  if (req.mode === "navigate") {
    // Network first so an online launch sees the newest index.html, which references only
    // assets this build precached. Offline, slow or failing responses use the cached shell.
    event.respondWith(
      networkWithTimeout(req)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put("/index.html", copy));
            return response;
          }
          return cachedShell().then((cached) => cached || response);
        })
        .catch(() => cachedShell().then((cached) => cached || Response.error()))
    );
    return;
  }

  // Hashed assets never change content under the same URL, so cache first is safe.
  // `ignoreVary` is required: servers send `Vary: Origin`, and the page's module and stylesheet
  // requests carry an Origin header that the precache requests made during install do not.
  event.respondWith(
    caches.match(req, { cacheName: CACHE_VERSION, ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return response;
      });
    })
  );
});
