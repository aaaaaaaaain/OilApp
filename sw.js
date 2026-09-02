// Service Worker：讓 App 離線也能開，加油站沒訊號時條碼照樣掃得到。
// 改版時把 CACHE 換成新版號，舊快取會在 activate 時清掉。
const CACHE = 'oilapp-1.11.0';

// 版號要跟 index.html 裡的 ?v= 一致，否則會快取到對不上的檔案
const ASSETS = [
    './',
    './index.html',
    './style.css?v=25',
    './script.js?v=25',
    './manifest.json',
    './fuel.png',
    './vendor/xlsx.full.min.js?v=25',
    './vendor/chart.min.js?v=25',
    './vendor/jsbarcode.all.min.js?v=25'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // 逐個放，某一個抓失敗不會讓整個安裝失敗
        await Promise.all(
            ASSETS.map(url => cache.add(url).catch(() => {}))
        );
        self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    // 開啟頁面時優先走網路，才不會因為快取住 index.html 而一直看到舊版；
    // 沒網路再退回快取。
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(req);
                const cache = await caches.open(CACHE);
                cache.put('./index.html', fresh.clone());
                return fresh;
            } catch (e) {
                return (await caches.match('./index.html')) || Response.error();
            }
        })());
        return;
    }

    // 其他資源：帶 ?v= 版號等於不會變動，快取優先最快
    event.respondWith((async () => {
        const hit = await caches.match(req);
        if (hit) return hit;

        try {
            const res = await fetch(req);
            if (res && (res.ok || res.type === 'opaque')) {
                const cache = await caches.open(CACHE);
                cache.put(req, res.clone());
            }
            return res;
        } catch (e) {
            return Response.error();
        }
    })());
});
