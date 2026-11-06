/* Service worker do Index.
   - Arquivos do próprio site: rede primeiro (você publica e já vê a mudança), cache só quando está sem internet.
   - Fontes do Google e lamejs: guardados na primeira visita online, depois funcionam offline.
   - Tudo o mais passa direto, sem passar por aqui: chamadas ao Apps Script (POST), fotos do Drive, capas do TMDB/Apple.
   Nunca guardamos resposta do servidor de dados, então o feed nunca fica velho. */
const VERSAO = "index-v1";
const ESTATICOS = [
    "./", "index.html", "login.html", "feed.html", "reviews.html",
    "style.css", "config.js", "pwa.js", "manifest.json",
    "assets/icone.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png", "assets/apple-touch-icon.png"
];
const CDNS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(VERSAO)
            .then((c) => Promise.all(ESTATICOS.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys()
            .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

// a chave ignora o ?u=... para o feed de qualquer perfil achar a mesma página guardada
const chave = (url) => url.origin + url.pathname;

async function doSite(req, url) {
    const cache = await caches.open(VERSAO);
    try {
        const r = await fetch(req, { cache: "no-cache" });
        if (r.status === 200) cache.put(chave(url), r.clone()).catch(() => {});
        return r;
    } catch (err) {
        const guardado = await cache.match(chave(url));
        if (guardado) return guardado;
        if (req.mode === "navigate") {
            const entrada = await cache.match(new URL("login.html", self.registration.scope).href);
            if (entrada) return entrada;
        }
        throw err;
    }
}

async function doCdn(req) {
    const cache = await caches.open(VERSAO);
    const guardado = await cache.match(req);
    const buscar = fetch(req).then((r) => {
        if (r.ok || r.type === "opaque") cache.put(req, r.clone()).catch(() => {});
        return r;
    });
    if (guardado) { buscar.catch(() => {}); return guardado; }
    return buscar;
}

self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return; // POSTs para o Apps Script ficam de fora
    const url = new URL(req.url);
    if (url.origin === self.location.origin) e.respondWith(doSite(req, url));
    else if (CDNS.includes(url.hostname)) e.respondWith(doCdn(req));
});
