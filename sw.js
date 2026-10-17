// =============================================================================
// SERVICE WORKER PWA - EMPRESARIOTEC S.A.
// MODO OFFLINE TOTAL - ANTI-DINOSAURIO GARANTIZADO
// Permite que la web abra y se refresque SIN INTERNET en cualquier momento
// y sirva la aplicacion, camara y reportes Excel desde la memoria local.
// =============================================================================

const CACHE_NAME = 'empresariotec-pwa-v53';

const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/sonidos.js',
  '/static/js/sweetalert2.all.min.js',
  '/static/js/webauthn_biometria.js',
  '/static/js/exceljs.min.js',
  '/static/manifest.json'
];

// Datos semilla de contingencia para modo offline absoluto en primera apertura
const SEED_API_DATA = {
  '/api/trabajadores': {
    exito: true,
    offline: true,
    trabajadores: [
      {
        id: 1,
        dni: "001643199",
        nombres: "Kleverd Gabriel",
        apellidos: "Apaza Quispe",
        cargo: "Administrador de Seguridad IoT",
        departamento: "Tecnología y Operaciones",
        estado: "ACTIVO",
        fecha_registro: "2026-10-17 12:00:00",
        foto_perfil: null,
        huella_registrada: 0,
        rostro_registrado: 0,
        fotos_entrenadas: 0
      }
    ]
  },
  '/api/dashboard/stats': {
    exito: true,
    offline: true,
    stats: {
      total_trabajadores: 1,
      accesos_permitidos: 0,
      accesos_denegados: 0,
      alertas_criticas: 0,
      rostros_activos: 0,
      huellas_activas: 0
    }
  },
  '/api/logs/accesos': {
    exito: true,
    offline: true,
    logs: []
  },
  '/api/logs/incidentes': {
    exito: true,
    offline: true,
    logs: []
  }
};

// 1. INSTALACIÓN: Pre-cachear todos los activos estáticos críticos de forma resiliente
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-cacheando recursos y semilla para operacion Offline total...');
      const fetchPromises = CRITICAL_ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) {
            await cache.put(url, res.clone());
            if (url.endsWith('.js') || url.endsWith('.css')) {
              await cache.put(url + '?v=20261017_cctv_history_v52', res);
            }
          }
        } catch (err) {
          console.warn('[SW] No se pudo pre-cachear:', url, err);
        }
      });

      // Pre-cargar respuestas JSON semilla para /api/* en cache
      for (const [endpoint, data] of Object.entries(SEED_API_DATA)) {
        const jsonResp = new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
        await cache.put(endpoint, jsonResp);
      }

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

        // Si está online, intentar red con timeout rápido (1.8 segundos)
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1800);
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
          if (navigator.onLine) {
            fetch(req).then((net) => {
              if (net && net.status === 200) {
                caches.open(CACHE_NAME).then((c) => c.put(req, net));
              }
            }).catch(() => {});
          }
          return cached;
        }

        return fetch(req).then((net) => {
          if (net && net.status === 200) {
            const clone = net.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return net;
        }).catch(async () => {
          const fallback = await caches.match(url.pathname, { ignoreSearch: true });
          if (fallback) return fallback;
          return new Response('', { status: 404, statusText: 'Offline Resource Not Found' });
        });
      })
    );
    return;
  }

  // C) PETICIONES API (/api/*)
  // Estrategia: Network con timeout de 1.5s -> Si no responde o está offline, Cache-First en 0ms
  if (url.pathname.startsWith('/api/')) {
    // PROTECCIÓN CRÍTICA: Los reportes binarios (Excel/PDF/CSV) NUNCA deben recibir una respuesta JSON 200 de contingencia,
    // ya que corrompería el archivo .xlsx o .csv en el cliente. Si falla la red o está offline, devolver 503 para que el cliente active su generador local.
    if (url.pathname.startsWith('/api/reportes/') || url.pathname === '/api/logs/exportar_csv') {
      event.respondWith(
        fetch(req).catch(() => {
          return new Response(JSON.stringify({
            exito: false,
            offline: true,
            mensaje: 'Reporte binario offline no disponible en servidor. Generar con motor local del cliente.'
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        })
      );
      return;
    }

    if (req.method === 'GET') {
      event.respondWith(
        (async () => {
          // 1. Si el cliente no tiene internet, responder de inmediato con la caché en 0ms
          if (!navigator.onLine) {
            const cached = await caches.match(req, { ignoreSearch: true })
                        || await caches.match(url.pathname, { ignoreSearch: true });
            if (cached) return cached;

            if (SEED_API_DATA[url.pathname]) {
              return new Response(JSON.stringify(SEED_API_DATA[url.pathname]), {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
              });
            }
          }

          // 2. Si dice estar online, intentar fetch con timeout estricto de 1.5 segundos
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 1500);
            const netResp = await fetch(req, { signal: controller.signal });
            clearTimeout(timer);

            if (netResp && netResp.status === 200) {
              const clone = netResp.clone();
              caches.open(CACHE_NAME).then((c) => {
                c.put(req, clone.clone());
                c.put(url.pathname, clone);
              });
              return netResp;
            }
          } catch (e) {
            // Timeout o error de red
          }

          // 3. Fallback a caché
          const cached = await caches.match(req, { ignoreSearch: true })
                      || await caches.match(url.pathname, { ignoreSearch: true });
          if (cached) {
            return cached;
          }

          // 4. Fallback a datos semilla específicos del endpoint
          if (SEED_API_DATA[url.pathname]) {
            return new Response(JSON.stringify(SEED_API_DATA[url.pathname]), {
              status: 200,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
          }

          // 5. Respuesta JSON offline de emergencia garantizada
          return new Response(JSON.stringify({
            exito: true,
            offline: true,
            trabajadores: SEED_API_DATA['/api/trabajadores'].trabajadores,
            logs: SEED_API_DATA['/api/logs/accesos'].logs,
            incidentes: SEED_API_DATA['/api/logs/incidentes'].logs,
            stats: SEED_API_DATA['/api/dashboard/stats'].stats
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        })()
      );
      return;
    }

    // POST / PUT / DELETE sin conexión
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(JSON.stringify({
          exito: false,
          offline: true,
          mensaje: 'Servidor fuera de línea. Operación encolada o simulada en almacenamiento local.'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      })
    );
    return;
  }
});
