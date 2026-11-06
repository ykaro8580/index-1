// registra o service worker (deixa o site instalável e abrindo offline)
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
    });
}
