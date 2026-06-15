// Service Worker for PWA — v60 강제 캐시 폐기 + 클라이언트 reload
const CACHE_NAME = 'dashboard-v89';

// 설치: 즉시 활성화 (캐시 prefetch 없음 — fetch 시 채워짐)
self.addEventListener('install', event => {
  self.skipWaiting();
});

// 활성화: 모든 옛 캐시 삭제 + 클라이언트 점유 + reload 메시지 발송
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

// fetch: 항상 네트워크, 실패 시 없음 (캐시 미사용)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
