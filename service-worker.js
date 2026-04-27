// Service Worker for PWA
// 캐시 정책: 네트워크 우선 + HTTP 캐시 우회(no-store), 오프라인 폴백 전용 캐시.
// SW가 옛 HTML을 잡아서 새 JS가 안 들어오는 사고 방지용.
const CACHE_NAME = 'dashboard-v5';
const urlsToCache = [
  '/index.html',
  '/pages/agency-purchase.html',
  '/pages/supplier-ranking.html',
  '/pages/customer-analysis.html',
  '/pages/trend-analysis.html',
  '/pages/monthly-sales.html',
  '/pages/inventory-management.html',
  '/assets/css/common.css',
  '/assets/js/common.js',
  '/assets/js/public-data-api.js',
  '/assets/js/sheets-api.js',
  '/assets/js/agency-purchase.js',
  '/assets/js/supplier-ranking.js',
  '/assets/js/customer-analysis.js',
  '/assets/js/trend-analysis.js',
  '/assets/js/monthly-sales.js',
  '/assets/js/inventory-management.js'
];

// 설치: 즉시 활성화하도록 waiting 단계 건너뛰기
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.log('Cache install error:', err))
  );
});

// 활성화: 구버전 캐시 모두 삭제 + 즉시 모든 클라이언트 점유
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// 요청 가로채기: 항상 서버에서 fresh fetch (브라우저 HTTP 캐시도 우회), 네트워크 실패 시에만 캐시 폴백
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .catch(() => caches.match(event.request))
  );
});
