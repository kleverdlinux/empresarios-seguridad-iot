// =============================================================================
// SERVICE WORKER PWA - EMPRESARIOTEC S.A.
// MODO OFFLINE TOTAL - ANTI-DINOSAURIO GARANTIZADO
// Permite que la web abra y se refresque SIN INTERNET en cualquier momento
// y sirva la aplicacion, camara y reportes Excel desde la memoria local.
// =============================================================================

const CACHE_NAME = 'empresariotec-pwa-v42';

const CRITICAL_ASSETS = [
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

// 1. INSTALACIÓN: Pre-cachear todos los activos estáticos críticos de forma resiliente
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-cacheando recursos para operacion Offline total...');
      const fetchPromises = CRITICAL_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) {
            await cache.put(url, res.clone());
            if (url.endsWith('.js') || url.endsWith('.css')) {
              await cache.put(url + '?v=20261017_excel_perfect_cols_v42', res);
            }
          }
        } catch (err) {
          console.warn('[SW] No se pudo pre-cachear:', url, err);
        }
      });
      await Promise.all(fetchPromises);
    })
  );
});

// 2. ACTIVACIÓN: Purgar cachés viejas y tomar control inmediato
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

// 3. INTERCEPTOR FETCH: Cero pantalla de dinosaurio
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo peticiones GET HTTP/HTTPS
  if (req.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // A) NAVEGACIÓN Y REFRESCADO DE PÁGINA (F5 o recarga sin internet)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      (async () => {
        // Si el navegador ya sabe que está offline, devolver index.html de inmediato en 0ms
        if (!navigator.onLine) {
          const cached = await caches.match('/index.html', { ignoreSearch: true })
                      || await caches.match('/', { ignoreSearch: true });
          if (cached) return cached;
        }

        // Si está online, intentar red con timeout rápido (2.5 segundos)
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          const netResp = await fetch(req, { signal: controller.signal });
          clearTimeout(timer);

          if (netResp && netResp.status === 200) {
            const clone = netResp.clone();
            caches.open(CACHE_NAME).then((c) => {
              c.put('/index.html', clone.clone());
              c.put('/', clone);
            });
            return netResp;
          }
        } catch (e) {
          console.warn('[SW] Sin conexión de red al navegar, sirviendo index.html offline...');
        }

        // Fallback offline garantizado: servir index.html
        const cached = await caches.match('/index.html', { ignoreSearch: true })
                    || await caches.match('/', { ignoreSearch: true });
        if (cached) return cached;

        // Búsqueda de emergencia en la caché
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        for (const k of keys) {
          if (k.url.includes('index.html') || k.url.endsWith('/')) {
            const match = await cache.match(k);
            if (match) return match;
          }
        }

        return new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><title>EMPRESARIOTEC</title></head><body><h1>Modo Offline Activo</h1></body></html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // B) RECURSOS ESTÁTICOS (JS, CSS, JSON, Audios, Fuentes, Imágenes)
  // Estrategia: Cache First con ignoreSearch: true (resuelve cualquier ?v=...)
  if (
    url.pathname.startsWith('/static/') ||
    url.pathname === '/sw.js' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.mp3') ||
    url.pathname.endsWith('.wav')
  ) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        if (cached) {
          // Si estamos online, actualizar en segundo plano sin bloquear
          if (navigator.onLine) {
            fetch(req).then((net) => {
              if (net && net.status === 200) {
                caches.open(CACHE_NAME).then((c) => c.put(req, net));
              }
            }).catch(() => {});
          }
          return cached;
        }

        // Si no estaba en caché, buscar en red
        return fetch(req).then((net) => {
          if (net && net.status === 200) {
            const clone = net.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return net;
        }).catch(async () => {
          // Búsqueda por pathname base
          const fallback = await caches.match(url.pathname, { ignoreSearch: true });
          if (fallback) return fallback;
          return new Response('', { status: 404, statusText: 'Offline Resource Not Found' });
        });
      })
    );
    return;
  }

  // C) PETICIONES API (/api/*)
  // Network First con fallback controlado a JSON offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(JSON.stringify({
          exito: false,
          offline: true,
          mensaje: 'Servidor fuera de línea temporalmente. Operando en modo local.'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      })
    );
    return;
  }
});
