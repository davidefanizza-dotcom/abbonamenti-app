const CACHE = "abbonamenti-v12";
const FILE = ["./", "./index.html", "./style.css", "./app.js", "./config.js", "./manifest.json", "./icona-192.png", "./icona-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname === "api.github.com") return;
  // Font: prima la cache.
  if (url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com")) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copia = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return res;
    })));
    return;
  }
  // App: prima la rete (così gli aggiornamenti arrivano), poi la cache.
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
      const copia = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Abbonamenti", {
    body: d.body || "",
    icon: "icona-192.png",
    badge: "icona-192.png",
    tag: d.tag,
    data: { url: "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
    for (const c of lista) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
