// =============================================================================
// SERVICE WORKER PWA - EMPRESARIOTEC S.A.
// Permite que la web abra SIN INTERNET (evita la pantalla del dinosaurio)
// y sirva la aplicacion, camara y reportes Excel desde la memoria local.
// =============================================================================

const CACHE_NAME = 'empresariotec-pwa-v40';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/sonidos.js',
  '/static/js/sweetalert2.all.min.js',
  '/static/js/webauthn_biometria.js',
  '/static/js/xlsx.full.min.js',
  '/static/manifest.json'
];

// 1. INSTALACION: Pre-cachear todos los activos estaticos criticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-cacheando recursos para operacion Offline total...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// 2. ACTIVACION: Limpiar caches antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Eliminando cache obsoleta:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. INTERCEPTOR DE PETICIONES: Responde aun con internet caido (Anti-Dinosaurio)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignorar peticiones que no sean GET o esquemas extraños
  if (req.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // A) Si es una navegacion HTML (la barra de direcciones del navegador)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => {
        // Si no hay internet, servir index.html desde la cache
        return caches.match('/index.html').then((cached) => {
          return cached || caches.match('/');
        });
      })
    );
    return;
  }

  // B) Si es un recurso estatico (CSS, JS, iconos) -> Cache First con fallback a red
  if (url.pathname.startsWith('/static/') || url.pathname === '/sw.js') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkResp) => {
          if (networkResp.status === 200) {
            const respClone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
          }
          return networkResp;
        }).catch(() => cached);
      })
    );
    return;
  }

  // C) Para APIs (/api/*) -> Network First con fallback silencioso
  event.respondWith(
    fetch(req).catch(() => {
      // Si la red falla, intentar ver si hay respuesta cacheada previa
      return caches.match(req);
    })
  );
});
