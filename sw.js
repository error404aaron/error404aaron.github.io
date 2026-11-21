// AETHER offline shell service worker (placeholders replaced by Vite aetherPwa plugin).
const BUILD_ID = "1dcaff9-f1d77eda9f";
const PRECACHE = [
  "/",
  "/assets/AdvancedGraphView-2LFMsgai.js",
  "/assets/CollectivePanel-BnCLsviD.js",
  "/assets/DesktopShell-By87U_K_.js",
  "/assets/MindspaceView-Daai0zqn.js",
  "/assets/PanelViews-BlQzySmP.js",
  "/assets/QuickSwitcher-9daawNM1.js",
  "/assets/RecoveryDialog-V7Boy_Fa.js",
  "/assets/SearchPanelView-xUtwzS7z.js",
  "/assets/SpatialCards-D0fUYJ2J.js",
  "/assets/WorkspaceOverviewView-2rODxkqe.js",
  "/assets/index-CQHss3lG.css",
  "/assets/index-Cni5vIpl.js",
  "/assets/index-CwCBZe2X.js",
  "/assets/recoveryRestore-DSVrj235.js",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.png",
  "/icons/icon-512.svg",
  "/index.html",
  "/manifest.webmanifest"
];
const PRECACHE_SET = new Set(PRECACHE);
const PRECACHE_ASSETS = PRECACHE.filter((p) => p.startsWith("/assets/"));
const CACHE_PREFIX = "aether-shell-";
const CACHE_VERSION = CACHE_PREFIX + BUILD_ID;
const BUILD_META = `name="aether-build" content="${BUILD_ID}"`;
const NETWORK_ONLY = new Set(["/sw.js", "/build.json"]);
const NAVIGATION_TIMEOUT_MS = 4000;

function extractAssetRefs(html) {
  if (typeof html !== "string") return [];
  return [...new Set(html.match(/\/assets\/[^"'\s>]+/g) || [])];
}

function verifyShellCoherence(cache, html) {
  if (typeof html !== "string" || !html.includes(BUILD_META) || !html.includes("</html>")) {
    return Promise.resolve(false);
  }
  const refs = extractAssetRefs(html);
  if (
    refs.length === 0 ||
    !refs.some((r) => r.endsWith(".js")) ||
    !refs.every((r) => PRECACHE_SET.has(r))
  ) {
    return Promise.resolve(false);
  }
  const required = [...new Set([...refs, ...PRECACHE_ASSETS])];
  return Promise.all(required.map((p) => cache.match(p, { ignoreVary: true }))).then((hits) =>
    hits.every((h) => Boolean(h && h.status === 200))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        cache
          .addAll(PRECACHE.map((p) => new Request(p, { cache: "reload" })))
          .then(() => Promise.all(PRECACHE.map((p) => cache.match(p, { ignoreVary: true }))))
          .then((matches) => {
            if (matches.some((h) => !h || h.status !== 200)) {
              throw new Error("aether-sw: incomplete precache validation");
            }
            const shells = ["/index.html", "/"].filter((p) => PRECACHE_SET.has(p));
            return Promise.all(
              shells.map((p) =>
                cache
                  .match(p, { ignoreVary: true })
                  .then((h) => (h ? h.clone().text() : ""))
                  .then((html) => verifyShellCoherence(cache, html))
              )
            );
          })
          .then((okList) => {
            if (okList.length === 0 || okList.some((ok) => !ok)) {
              throw new Error("aether-sw: incoherent shell build identity during install");
            }
          })
      )
      .catch((error) =>
        caches.delete(CACHE_VERSION).then(() => {
          throw error;
        })
      )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
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
    .then((c) =>
      c.match("/index.html", { ignoreVary: true }).then((h) => h || c.match("/", { ignoreVary: true }))
    );
}

function networkWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("navigation timeout")), NAVIGATION_TIMEOUT_MS);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NETWORK_ONLY.has(url.pathname)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      networkWithTimeout(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const inspectCopy = res.clone();
            const storeCopy = res.clone();
            event.waitUntil(
              caches
                .has(CACHE_VERSION)
                .then((exists) => {
                  if (!exists) return;
                  return inspectCopy.text().then((html) =>
                    caches.open(CACHE_VERSION).then((c) =>
                      verifyShellCoherence(c, html).then((ok) => {
                        if (ok) return c.put("/index.html", storeCopy);
                      })
                    )
                  );
                })
                .catch(() => {})
            );
            return res;
          }
          return cachedShell().then((cached) => cached || res);
        })
        .catch(() => cachedShell().then((cached) => cached || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: CACHE_VERSION, ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (
          res &&
          res.status === 200 &&
          res.type === "basic" &&
          !url.search &&
          PRECACHE_SET.has(url.pathname)
        ) {
          const copy = res.clone();
          event.waitUntil(
            caches
              .has(CACHE_VERSION)
              .then((exists) => {
                if (exists) return caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
              })
              .catch(() => {})
          );
        }
        return res;
      });
    })
  );
});
