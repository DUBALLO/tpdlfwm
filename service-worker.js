// Service Worker for PWA
const CACHE_NAME = 'dashboard-v1';
const urlsToCache = [
  '/index.html',
  '/pages/agency-purchase.html',
  '/pages/supplier-ranking.html',
  '/pages/customer-analysis.html',
  '/pages/trend-analysis.html',
  '/pages/monthly-sales.html',
  '/assets/css/common.css',
  '/assets/js/common.js',
  '/assets/js/sheets-api.js',
  '/assets/js/agency-purchase.js',
  '/assets/js/supplier-ranking.js',
  '/assets/js/customer-analysis.js',
  '/assets/js/trend-analysis.js',
  '/assets/js/monthly-sales.js'
];

// 설치 시 캐싱
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.log('Cache install error:', err))
  );
});

// 요청 가로채기 (네트워크 우선, 캐시 폴백)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

// 구버전 캐시 삭제
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
