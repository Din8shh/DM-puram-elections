// Minimal service worker so phones can install the app.
// It does not cache anything, so everyone always gets the newest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:sans-serif;background:#F6F4EE;color:#1C2321;padding:32px;text-align:center">' +
    '<h2>ఇంటర్నెట్ లేదు</h2><p>No internet. Connect and try again.</p>' +
    '<button onclick="location.reload()" style="font-size:18px;padding:12px 24px;border-radius:12px;border:0;background:#1F5C45;color:#fff">Retry</button></body>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
