// =============================================================================
// SERVICE WORKER PWA - EMPRESARIOTEC S.A.
// MODO OFFLINE TOTAL - ANTI-DINOSAURIO GARANTIZADO
// Permite que la web abra y se refresque SIN INTERNET en cualquier momento
// y sirva la aplicacion, camara y reportes Excel desde la memoria local.
// =============================================================================

const CACHE_NAME = 'empresariotec-pwa-v50';

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
        fecha_registro: "2026-10-13T12:56:40",
        foto_perfil: null,
        huella_registrada: 1,
        rostro_registrado: 1,
        fotos_entrenadas: 3
      },
      {
        id: 2,
        dni: "92742345",
        nombres: "Carlos",
        apellidos: "Rodríguez Peña",
        cargo: "Administrador de equipos",
        departamento: "Operaciones",
        estado: "ACTIVO",
        fecha_registro: "2026-10-13T17:28:37",
        foto_perfil: null,
        huella_registrada: 1,
        rostro_registrado: 1,
        fotos_entrenadas: 3
      }
    ]
  },
  '/api/dashboard/stats': {
    exito: true,
    offline: true,
    stats: {
      total_trabajadores: 2,
      accesos_permitidos: 270,
      accesos_denegados: 456,
      alertas_criticas: 489,
      rostros_activos: 2,
      huellas_activas: 2
    }
  },
  '/api/logs/accesos': {
    exito: true,
    offline: true,
    logs: [
      {
        id: 726,
        usuario_id: 2,
        nombre_usuario: "Carlos Rodríguez Peña",
        dni: "92742345",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "PERMITIDO",
        detalle: "Huella óptica 1:N (Índice Derecho) identificada con 90.8% (15 minucias ORB)",
        timestamp: "2026-10-14T21:59:14.002632"
      },
      {
        id: 725,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 7.1%)",
        timestamp: "2026-10-14T21:59:06.627056"
      },
      {
        id: 724,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 8.0%)",
        timestamp: "2026-10-14T21:58:59.257683"
      },
      {
        id: 723,
        usuario_id: 1,
        nombre_usuario: "Kleverd Gabriel Apaza Quispe",
        dni: "001643199",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "PERMITIDO",
        detalle: "Huella óptica 1:N (Índice Derecho) identificada con 99.6% (51 minucias ORB)",
        timestamp: "2026-10-14T21:58:51.821503"
      },
      {
        id: 722,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 23.9%)",
        timestamp: "2026-10-14T21:58:09.455967"
      },
      {
        id: 721,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 14.4%)",
        timestamp: "2026-10-14T21:58:01.993596"
      },
      {
        id: 720,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 5.8%)",
        timestamp: "2026-10-14T21:56:33.946726"
      },
      {
        id: 719,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 10.7%)",
        timestamp: "2026-10-14T21:56:26.598418"
      },
      {
        id: 718,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 16.0%)",
        timestamp: "2026-10-14T21:56:19.251803"
      },
      {
        id: 717,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 9.2%)",
        timestamp: "2026-10-14T21:56:10.415214"
      },
      {
        id: 716,
        usuario_id: 2,
        nombre_usuario: "Carlos Rodríguez Peña",
        dni: "92742345",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "PERMITIDO",
        detalle: "Huella óptica 1:N (Índice Derecho) identificada con 99.6% (56 minucias ORB)",
        timestamp: "2026-10-14T21:56:03.705161"
      },
      {
        id: 715,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 17.6%)",
        timestamp: "2026-10-14T21:55:56.514058"
      },
      {
        id: 714,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 10.7%)",
        timestamp: "2026-10-14T21:55:49.085702"
      },
      {
        id: 713,
        usuario_id: null,
        nombre_usuario: "Desconocido",
        dni: "--------",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "Huella óptica desconocida / no registrada (Mejor match: 5.9%)",
        timestamp: "2026-10-14T21:55:40.702206"
      },
      {
        id: 712,
        usuario_id: 1,
        nombre_usuario: "Kleverd Gabriel Apaza Quispe",
        dni: "001643199",
        metodo: "HUELLA",
        terminal: "TERMINAL_HUELLA",
        estado: "DENEGADO",
        detalle: "SUPLANTACION_1A1_HUELLA: Huella no corresponde a Kleverd Gabriel (10.6%)",
        timestamp: "2026-10-14T21:55:33.467658"
      }
    ]
  },
  '/api/logs/incidentes': {
    exito: true,
    offline: true,
    logs: [
      {
        id: 101,
        tipo_sensor: "CAMARA_CCTV_IA",
        nivel_alerta: "CRITICO",
        descripcion: "Alerta intrusión: Movimiento detectado en zona restringida CCTV (Modo Seguridad)",
        timestamp: "2026-10-17T12:30:15"
      },
      {
        id: 100,
        tipo_sensor: "PANICO_MANUAL",
        nivel_alerta: "ALERTA",
        descripcion: "Sirena y alarma perimetral activadas manualmente desde consola CCTV",
        timestamp: "2026-10-17T11:15:00"
      },
      {
        id: 99,
        tipo_sensor: "RELE_REMOTO",
        nivel_alerta: "INFO",
        descripcion: "Apertura forzada de esclusa de acceso autorizada remotamente desde CCTV",
        timestamp: "2026-10-17T10:05:22"
      }
    ]
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
              await cache.put(url + '?v=20261017_cctv_alerts_v50', res);
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
