// Service worker: lets the finder open even when the gym Wi-Fi drops.
//
// How it works: every page, style sheet, script and map the phone loads is also saved
// on the phone. Online, the phone always asks the internet first (so updates show up
// right away). If the internet does not answer within a few seconds, the saved copy is used.
//
// Scholar lists are NOT handled here - the pages save the last list themselves.

const CACHE = "science-fair-finder-v2";
const SHELL = [
  "/",
  "/judge",
  "/admin",
  "/css/app.css",
  "/js/common.js",
  "/js/judge.js",
  "/js/admin.js",
  "/img/gsp-logo-small.png",
  "/layouts/index.json",
];
const WAIT_MS = 4000;

async function saveCopy(cache, url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) await cache.put(url, response.clone());
    return response;
  } catch {
    return null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL.map((url) => saveCopy(cache, url)));
      // Also save the map of every fair in the drop-down.
      try {
        const index = await cache.match("/layouts/index.json");
        const fairs = index ? await index.json() : [];
        await Promise.all(fairs.map((fair) => saveCopy(cache, `/layouts/${fair.id}.json`)));
      } catch {
        // no maps saved; they will be saved the first time each one is opened
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// "/judge.html" and "/judge" are the same page; "/index.html" is "/".
function keyFor(url) {
  let path = url.pathname.replace(/\.html$/, "");
  if (path === "/index") path = "/";
  return path;
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  try {
    const slow = new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS));
    const response = await Promise.race([fromNetwork, slow]);
    if (response) return response;
    // The internet is slow: use the saved copy if we have one, otherwise keep waiting.
    return (await cache.match(key)) || fromNetwork;
  } catch (error) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live data always goes straight to the server
  event.respondWith(networkFirst(request, keyFor(url)));
});
