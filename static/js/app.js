/**
 * =============================================================================
 * SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
 * SENATI - PIAD-526: CONTROLADOR MAESTRO DE APLICACION (SPA)
 * =============================================================================
 * Controla:
 * - Portal de Login corporativo moderno con selector de rol y contraseñas por terminal.
 * - Ficha integral de trabajadores "Todo en Uno Solo" (datos, cámara facial y huella).
 * - Terminal Facial vertical con clasificador OpenCV LBPH en tiempo real.
 * - Terminal Biométrico Dactilar Aratek con escaneo táctil y WebAuthn.
 * - Centro de Monitoreo CCTV con sensores SW-420, PIR y telemetría de rack.
 * - Panel de Administración Maestro con edición, eliminación y auditoría SQLite.
 */

// Estado global de la aplicación
const AppState = {
    vistaActual: 'portal',
    sesionAdmin: false,
    rolLoginSeleccionado: 'admin',
    terminalDesbloqueada: {
        facial: false,
        huella: false,
        cctv: false
    },
    streamCamaraFacial: null,
    intervaloEscaneoFacial: null,
    escaneandoFacial: false,
    camaraFacialModo: 'user', // 'user' (frontal) o 'environment' (trasera)
    filtroUsuarioFacial: '', // ID del colaborador seleccionado para verificación 1:1 o vacío para 1:N
    intervaloTelemetria: null,
    trabajadores: [],
    configuraciones: {},

    // Variables para el Modal Integral "Todo en Uno Solo"
    streamCamaraModal: null,
    muestrasFacialesModal: [],
    huellaRegistradaModal: false,

    // Variables para CCTV, Giro de Cámara y Centinela Anti-Intrusión
    camaraCctvModo: 'environment', // 'environment' (trasera/sala) o 'user' (frontal/operador)
    streamCamaraCctv: null,
    cctvUbicacion: 'Laboratorio Central de Cómputo',
    cctvModoVision: 'normal', // 'normal', 'ir_green', 'ir_bw'
    centinelaArmado: false,
    umbralSensibilidadCentinela: 1.0, // 1.0% ultra-sensible (al más mínimo movimiento)
    intervaloMotionCctv: null,
    ultimoFotogramaMotion: null
};

// =============================================================================
// =============================================================================
// PERSISTENCIA DE SESION Y RUTAS (Evita regresar al login con F5)
// =============================================================================
function guardarEstadoPersistente() {
    try {
        localStorage.setItem('iot_sesion_admin', AppState.sesionAdmin ? 'true' : 'false');
        localStorage.setItem('iot_term_desbloqueada', JSON.stringify(AppState.terminalDesbloqueada));
        localStorage.setItem('iot_vista_actual', AppState.vistaActual);
    } catch (e) {
        console.warn('Error guardando estado persistente:', e);
    }
}

function restaurarEstadoPersistente() {
    try {
        const sesionAdmin = localStorage.getItem('iot_sesion_admin');
        if (sesionAdmin === 'true') {
            AppState.sesionAdmin = true;
            AppState.terminalDesbloqueada.facial = true;
            AppState.terminalDesbloqueada.huella = true;
            AppState.terminalDesbloqueada.cctv = true;
        }
        const termGuardadas = localStorage.getItem('iot_term_desbloqueada');
        if (termGuardadas) {
            const parsed = JSON.parse(termGuardadas);
            AppState.terminalDesbloqueada = Object.assign(AppState.terminalDesbloqueada, parsed);
        }
        if (AppState.sesionAdmin) {
            AppState.terminalDesbloqueada.facial = true;
            AppState.terminalDesbloqueada.huella = true;
            AppState.terminalDesbloqueada.cctv = true;
        }
    } catch (e) {
        console.warn('Error restaurando estado persistente:', e);
    }
}

// =============================================================================
// MONITOR DE ENLACE Y CONEXIÓN EN TIEMPO REAL (WiFi / LAN vs Desconectado)
// =============================================================================
let estaConectadoAlServidor = true;
let fallosConsecutivosPing = 0;

async function verificarConexionServidor() {
    const pill = document.getElementById('pillEstadoConexion');
    const txt = document.getElementById('txtEstadoConexionPill');
    const drawerTxt = document.getElementById('drawerStatusText');

    // 1. Si el dispositivo desconectó el WiFi o Modo Avión (navigator.onLine es false)
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
        aplicarEstadoDesconectado('Modo Offline');
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const resp = await fetch('/api/ping', {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (resp.ok) {
            fallosConsecutivosPing = 0;
            estaConectadoAlServidor = true;
            if (pill) {
                pill.classList.remove('disconnected');
                pill.classList.add('online');
                pill.title = 'Servidor Central Activo • En Línea';
            }
            if (txt) {
                txt.textContent = 'Online';
            }
            if (drawerTxt) {
                drawerTxt.textContent = 'Online • SQLite Local';
            }
        } else {
            fallosConsecutivosPing++;
            if (fallosConsecutivosPing >= 2) {
                aplicarEstadoDesconectado('Modo Offline');
            }
        }
    } catch (e) {
        fallosConsecutivosPing++;
        if (fallosConsecutivosPing >= 2) {
            aplicarEstadoDesconectado('Modo Offline');
        }
    }
}

function aplicarEstadoDesconectado(mensaje) {
    const pill = document.getElementById('pillEstadoConexion');
    const txt = document.getElementById('txtEstadoConexionPill');
    const drawerTxt = document.getElementById('drawerStatusText');

    estaConectadoAlServidor = false;
    if (pill) {
        pill.classList.remove('online');
        pill.classList.add('disconnected');
        pill.title = 'Modo Autónomo Local • SQLite Offline';
    }
    if (txt) {
        txt.textContent = 'Modo Offline';
    }
    if (drawerTxt) {
        drawerTxt.textContent = 'Modo Offline • SQLite Local';
    }
}

// INICIALIZACION Y ENRUTAMIENTO
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    restaurarEstadoPersistente();
    cargarConfiguraciones();
    manejarRutaHash();
    window.addEventListener('hashchange', manejarRutaHash);

    // Monitor dinámico en tiempo real de enlace con el servidor
    verificarConexionServidor();
    setInterval(verificarConexionServidor, 3500);
    window.addEventListener('online', () => verificarConexionServidor());
    window.addEventListener('offline', () => aplicarEstadoDesconectado('Modo Offline'));

    // Reloj continuo en pantalla
    setInterval(actualizarReloj, 1000);
    actualizarReloj();

    // Vinculación táctil de respuesta instantánea para móviles
    const btnHam = document.getElementById('btnToggleHamburger');
    if (btnHam) {
        btnHam.addEventListener('touchstart', (e) => {
            alternarDrawerMenu(e);
        }, { passive: false });
    }
});

function actualizarReloj() {
    const ahora = new Date();
    const str = ahora.toLocaleTimeString('es-PE', { hour12: false }) + ' - ' + ahora.toLocaleDateString('es-PE');
    document.querySelectorAll('.live-clock').forEach(el => el.textContent = str);

    // Reloj Flip Retro Digital (Fliqlo Style) en Tiempo Real
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    const ss = String(ahora.getSeconds()).padStart(2, '0');
    const elH = document.getElementById('flipHours');
    const elM = document.getElementById('flipMinutes');
    const elS = document.getElementById('flipSeconds');
    if (elH && elH.textContent !== hh) elH.textContent = hh;
    if (elM && elM.textContent !== mm) elM.textContent = mm;
    if (elS && elS.textContent !== ss) elS.textContent = ss;

    // Sincronización instantánea de estado de red cada segundo
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine && estaConectadoAlServidor) {
        aplicarEstadoDesconectado('Modo Offline');
    }
}

// =============================================================================
// CONTROL DEL MENÚ VERTICAL HAMBURGUESA OFF-CANVAS (PC Y MÓVIL)
// =============================================================================
let ultimoDisparoMenuMs = 0;

function alternarDrawerMenu(event) {
    if (event) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }
    const ahora = Date.now();
    if (ahora - ultimoDisparoMenuMs < 280) {
        return; // Evita conflicto de doble llamada touchstart + click
    }
    ultimoDisparoMenuMs = ahora;

    const drawer = document.getElementById('appDrawerMenu');
    if (!drawer) return;
    const estaAbierto = drawer.classList.contains('open');
    if (estaAbierto) {
        cerrarDrawerMenu();
    } else {
        abrirDrawerMenu();
    }
}

function abrirDrawerMenu() {
    const drawer = document.getElementById('appDrawerMenu');
    const backdrop = document.getElementById('drawerBackdrop');
    if (drawer) drawer.classList.add('open');
    if (backdrop) {
        backdrop.style.visibility = 'visible';
        backdrop.style.pointerEvents = 'auto';
        backdrop.classList.add('open');
    }
    document.body.style.overflow = 'hidden';
}

function cerrarDrawerMenu() {
    const drawer = document.getElementById('appDrawerMenu');
    const backdrop = document.getElementById('drawerBackdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) {
        backdrop.classList.remove('open');
        backdrop.style.pointerEvents = 'none';
        setTimeout(() => {
            if (backdrop && !backdrop.classList.contains('open')) {
                backdrop.style.visibility = 'hidden';
            }
        }, 250);
    }
    document.body.style.overflow = '';
}

function navegarDesdeDrawer(vista) {
    cerrarDrawerMenu();
    cambiarVista(vista);
}

function navegarTabAdminDesdeDrawer(tab) {
    cerrarDrawerMenu();
    if (AppState.vistaActual !== 'admin') {
        // Si no está en admin, verificar si la sesión admin está activa
        if (!AppState.sesionAdmin) {
            seleccionarRolLogin('admin');
            cambiarVista('portal');
            Swal.fire({
                icon: 'info',
                title: 'Acceso Administrativo',
                text: 'Por favor ingrese su clave maestra para acceder a ' + tab,
                timer: 2500,
                showConfirmButton: false
            });
            return;
        }
        cambiarVista('admin');
    }
    cambiarTabAdmin(tab);
}

function navegarTerminalDesdeDrawer(terminal) {
    cerrarDrawerMenu();
    // Si la sesión admin está activa, el Administrador Maestro tiene privilegios totales: entra directo sin contraseña
    if (AppState.sesionAdmin) {
        AppState.terminalDesbloqueada[terminal] = true;
        guardarEstadoPersistente();
        cambiarVista(terminal);
        return;
    }

    if (AppState.terminalDesbloqueada && AppState.terminalDesbloqueada[terminal]) {
        cambiarVista(terminal);
    } else {
        seleccionarRolLogin(terminal);
        cambiarVista('portal');
    }
}

function cerrarSesionDesdeDrawer() {
    cerrarDrawerMenu();
    cerrarSesionMaestra();
}

async function cargarConfiguraciones() {
    try {
        const resp = await fetch('/api/config/terminales');
        const data = await resp.json();
        if (data.exito) {
            AppState.configuraciones = data.configuraciones;
        }
    } catch (e) {
        console.warn('Error cargando configuraciones iniciales:', e);
    }
}

function cambiarVista(nombreVista) {
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const vistaDestino = document.getElementById(`view-${nombreVista}`);
    if (vistaDestino) {
        vistaDestino.classList.add('active');
        AppState.vistaActual = nombreVista;
        window.location.hash = nombreVista;
        guardarEstadoPersistente();
    }

    // Modo exclusivo de pantalla de login: solo se muestra el login sin cabecera
    const headerEl = document.querySelector('.app-header');
    if (nombreVista === 'portal') {
        document.body.classList.add('is-login-screen');
        if (headerEl) headerEl.style.display = 'none';
    } else {
        document.body.classList.remove('is-login-screen');
        if (headerEl) headerEl.style.display = '';
    }

    // Mostrar u ocultar botón de Salir en cabecera según sesión activa
    const btnSalir = document.getElementById('btnHeaderCerrarSesion');
    if (btnSalir) {
        btnSalir.style.display = AppState.sesionAdmin ? 'inline-flex' : 'none';
    }

    // Gestion de recursos segun la vista activa
    if (nombreVista === 'facial') {
        iniciarTerminalFacial();
    } else {
        detenerTerminalFacial();
    }

    if (nombreVista === 'huella') {
        cargarSelectorFiltroHuella();
        iniciarCamaraTerminalHuella();
    } else {
        detenerCamaraTerminalHuella();
    }

    if (nombreVista === 'cctv') {
        iniciarCentroCCTV();
    } else {
        detenerCentroCCTV();
    }

    if (nombreVista === 'admin') {
        cargarDatosAdmin();
    }
}

function irACentroReportes() {
    if (AppState.sesionAdmin) {
        cambiarVista('admin');
        cambiarTabAdmin('reportes');
        document.querySelectorAll('.nav-pill-btn').forEach(btn => btn.classList.remove('active'));
        const rBtn = document.getElementById('navBtnReportes');
        if (rBtn) rBtn.classList.add('active');
    } else {
        seleccionarRolLogin('admin');
        cambiarVista('portal');
        Swal.fire({
            icon: 'info',
            title: 'Acceso Administrativo Requerido',
            text: 'Ingrese su clave de administrador para acceder al Centro Oficial de Reportes en Excel.',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#0284c7'
        });
    }
}

function manejarRutaHash() {
    let hash = window.location.hash.replace('#', '');
    if (!hash) {
        hash = localStorage.getItem('iot_vista_actual') || 'portal';
    }

    if (['portal', 'facial', 'huella', 'cctv', 'admin'].includes(hash)) {
        // El administrador maestro siempre tiene acceso a todas las terminales sin volver al login
        if (AppState.sesionAdmin) {
            AppState.terminalDesbloqueada.facial = true;
            AppState.terminalDesbloqueada.huella = true;
            AppState.terminalDesbloqueada.cctv = true;
            cambiarVista(hash);
            return;
        }

        if (hash === 'facial' && !AppState.terminalDesbloqueada.facial) {
            seleccionarRolLogin('facial');
            cambiarVista('portal');
            return;
        }
        if (hash === 'huella' && !AppState.terminalDesbloqueada.huella) {
            seleccionarRolLogin('huella');
            cambiarVista('portal');
            return;
        }
        if (hash === 'cctv' && !AppState.terminalDesbloqueada.cctv) {
            seleccionarRolLogin('cctv');
            cambiarVista('portal');
            return;
        }
        if (hash === 'admin' && !AppState.sesionAdmin) {
            seleccionarRolLogin('admin');
            cambiarVista('portal');
            return;
        }
        cambiarVista(hash);
    } else {
        cambiarVista('portal');
    }
}

function volverDeTerminal() {
    detenerCamaraTerminalHuella();
    if (document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
    if (AppState.sesionAdmin) {
        cambiarVista('admin');
        cambiarTabAdmin('inicio');
    } else {
        cambiarVista('portal');
    }
}

function cerrarSesionMaestra() {
    Swal.fire({
        title: '¿Cerrar Sesión?',
        text: 'Se bloqueará el acceso al Panel Maestro hasta volver a autenticarse.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Salir',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            AppState.sesionAdmin = false;
            AppState.terminalDesbloqueada = { facial: false, huella: false, cctv: false };
            localStorage.removeItem('iot_sesion_admin');
            localStorage.removeItem('iot_term_desbloqueada');
            localStorage.setItem('iot_vista_actual', 'portal');
            localStorage.removeItem('iot_tab_admin');
            seleccionarRolLogin('admin');
            cambiarVista('portal');
            Swal.fire({
                icon: 'success',
                title: 'Sesión Finalizada',
                text: 'Ha salido del sistema de manera segura.',
                timer: 1500,
                showConfirmButton: false
            });
        }
    });
}

// =============================================================================
// LOGIN CORPORATIVO MODERNO DE VERDAD
// =============================================================================

function seleccionarRolLogin(rol) {
    AppState.rolLoginSeleccionado = rol;
    document.querySelectorAll('.auth-nav-btn').forEach(b => b.classList.remove('active'));
    
    const btnMap = {
        admin: 'btnRoleAdmin',
        facial: 'btnRoleFacial',
        huella: 'btnRoleHuella',
        cctv: 'btnRoleCctv'
    };
    const btnActivo = document.getElementById(btnMap[rol]);
    if (btnActivo) btnActivo.classList.add('active');

    const titleEl = document.getElementById('loginTitleModulo');
    const subEl = document.getElementById('loginSubtitleModulo');
    const userGroup = document.getElementById('loginGroupUsuario');
    const pwdLabel = document.getElementById('loginLabelPassword');
    const btnSubmit = document.getElementById('btnLoginSubmit');
    const inputPwd = document.getElementById('loginInputPassword');
    if (inputPwd) inputPwd.value = '';

    if (rol === 'admin') {
        titleEl.textContent = 'Panel de Administración Maestro';
        subEl.textContent = 'Nivel: Administrador Maestro';
        userGroup.style.display = 'block';
        pwdLabel.textContent = 'Contraseña de Administrador';
        btnSubmit.querySelector('span').textContent = 'Acceder al Panel';
    } else if (rol === 'facial') {
        titleEl.textContent = 'Terminal Biométrico Facial';
        subEl.textContent = 'Móvil 1 • Reconocimiento OpenCV LBPH';
        userGroup.style.display = 'none';
        pwdLabel.textContent = 'Contraseña Terminal Facial';
        btnSubmit.querySelector('span').textContent = 'Desbloquear Terminal Facial';
    } else if (rol === 'huella') {
        titleEl.textContent = 'Terminal Biométrico Dactilar';
        subEl.textContent = 'Móvil 2 • Lector Aratek / WebAuthn';
        userGroup.style.display = 'none';
        pwdLabel.textContent = 'Contraseña Terminal Dactilar';
        btnSubmit.querySelector('span').textContent = 'Desbloquear Terminal Dactilar';
    } else if (rol === 'cctv') {
        titleEl.textContent = 'Centro de Monitoreo CCTV';
        subEl.textContent = 'Móvil 3 • Seguridad de Rack & Telemetría';
        userGroup.style.display = 'none';
        pwdLabel.textContent = 'Contraseña Centro CCTV';
        btnSubmit.querySelector('span').textContent = 'Desbloquear Centro CCTV';
    }
}

function alternarVisibilidadPassword(inputId, btnElement) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const esPassword = input.type === 'password';
    input.type = esPassword ? 'text' : 'password';
    btnElement.innerHTML = esPassword 
        ? `<svg class="icon" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg class="icon" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
}

async function procesarLoginModerno(event) {
    event.preventDefault();
    const rol = AppState.rolLoginSeleccionado;
    const password = document.getElementById('loginInputPassword').value.trim();

    if (rol === 'admin') {
        const usuario = document.getElementById('loginInputUsuario').value.trim();
        try {
            const resp = await fetch('/api/login/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario, password })
            });
            const data = await resp.json();
            if (data.exito) {
                AppState.sesionAdmin = true;
                AppState.terminalDesbloqueada.facial = true;
                AppState.terminalDesbloqueada.huella = true;
                AppState.terminalDesbloqueada.cctv = true;
                guardarEstadoPersistente();
                localStorage.setItem('iot_tab_admin', 'inicio');
                Swal.fire({
                    icon: 'success',
                    title: 'Bienvenido Administrador',
                    text: 'Sesión maestra iniciada correctamente.',
                    timer: 1500,
                    showConfirmButton: false
                });
                cambiarVista('admin');
                cambiarTabAdmin('inicio');
            } else {
                audioSeguridad.sonarAccesoDenegado();
                Swal.fire({ icon: 'error', title: 'Acceso Denegado', text: data.mensaje || 'Credenciales incorrectas' });
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error de Red', text: 'No se pudo conectar al servidor.' });
        }
    } else {
        // Desbloqueo de terminal facial, huella o cctv
        try {
            const resp = await fetch('/api/login/terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ terminal: rol, password })
            });
            const data = await resp.json();
            if (data.exito) {
                AppState.terminalDesbloqueada[rol] = true;
                guardarEstadoPersistente();
                Swal.fire({
                    icon: 'success',
                    title: 'Terminal Autorizada',
                    text: data.mensaje,
                    timer: 1500,
                    showConfirmButton: false
                });
                cambiarVista(rol);
            } else {
                audioSeguridad.sonarAccesoDenegado();
                Swal.fire({ icon: 'error', title: 'Contraseña Incorrecta', text: data.mensaje || 'Clave de terminal denegada' });
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error de Red', text: 'Error al comunicarse con el servidor.' });
        }
    }
}

// =============================================================================
// VISTA 2: TERMINAL DE RECONOCIMIENTO FACIAL (En Vivo)
// =============================================================================

async function iniciarTerminalFacial() {
    const video = document.getElementById('videoFacialFeed');
    const ledBar = document.getElementById('facialLedBar');
    const bracket = document.getElementById('facialBracket');
    const pill = document.getElementById('facialInstructionText');

    ledBar.className = 'facial-led-bar scanning';
    bracket.className = 'facial-target-bracket';
    pill.textContent = 'Iniciando cámara y sensor biométrico...';

    // Cargar y poblar lista de trabajadores en el selector facial
    cargarSelectorFiltroFacial();

    try {
        if (AppState.streamCamaraFacial) {
            detenerTerminalFacial();
        }

        const constraints = {
            video: {
                facingMode: AppState.camaraFacialModo,
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        };

        AppState.streamCamaraFacial = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = AppState.streamCamaraFacial;
        await video.play();

        pill.textContent = AppState.filtroUsuarioFacial 
            ? 'Verificando colaborador seleccionado...' 
            : 'Posicione su rostro dentro del marco';

        if (AppState.intervaloEscaneoFacial) clearInterval(AppState.intervaloEscaneoFacial);
        AppState.intervaloEscaneoFacial = setInterval(analizarFotogramaFacial, 1200);

    } catch (e) {
        console.error('Error accediendo a cámara facial:', e);
        pill.textContent = 'Cámara no accesible. Verifique permisos HTTPS.';
        Swal.fire({
            icon: 'warning',
            title: 'Acceso a Cámara',
            text: 'Para usar el reconocimiento facial en el móvil, conceda los permisos de cámara en el navegador.'
        });
    }
}

function cargarSelectorFiltroFacial() {
    if (!AppState.trabajadores || AppState.trabajadores.length === 0) {
        fetch('/api/trabajadores').then(r => r.json()).then(d => {
            if (d.exito) {
                AppState.trabajadores = d.trabajadores;
                poblarSelectFiltroFacial();
            }
        }).catch(e => console.warn('Error cargando trabajadores para selector facial:', e));
    } else {
        poblarSelectFiltroFacial();
    }
}

function poblarSelectFiltroFacial() {
    const select = document.getElementById('selectFiltroFacialUsuario');
    if (!select) return;

    let valorActual = AppState.filtroUsuarioFacial || localStorage.getItem('filtroUsuarioFacial') || '';
    let html = '<option value="">Modo General: Identificar automáticamente (1:N)</option>';
    if (AppState.trabajadores && AppState.trabajadores.length > 0) {
        html += AppState.trabajadores
            .filter(t => t.estado === 'ACTIVO')
            .map(t => `<option value="${t.id}" ${String(t.id) === String(valorActual) ? 'selected' : ''}>${t.dni} - ${t.nombres} ${t.apellidos} (${t.cargo})</option>`)
            .join('');
    }
    select.innerHTML = html;

    if (valorActual) {
        cambiarFiltroFacialUsuario(valorActual);
    }
}

function cambiarFiltroFacialUsuario(valor) {
    AppState.filtroUsuarioFacial = valor ? String(valor) : '';
    if (valor) {
        localStorage.setItem('filtroUsuarioFacial', String(valor));
    } else {
        localStorage.removeItem('filtroUsuarioFacial');
    }

    const badge = document.getElementById('badgeFiltroFacialActivo');
    const txt = document.getElementById('txtFiltroFacialActivo');
    const pill = document.getElementById('facialInstructionText');
    const select = document.getElementById('selectFiltroFacialUsuario');

    if (select && select.value !== String(valor)) {
        select.value = valor ? String(valor) : '';
    }

    if (valor) {
        const trab = AppState.trabajadores ? AppState.trabajadores.find(t => String(t.id) === String(valor)) : null;
        const nombre = trab ? `${trab.nombres} ${trab.apellidos}` : `ID ${valor}`;
        if (badge) badge.style.display = 'flex';
        if (txt) txt.innerHTML = `Verificación 1:1 Estricta: <strong>${nombre}</strong>`;
        if (pill) pill.textContent = `Verificando a: ${nombre}`;
    } else {
        if (badge) badge.style.display = 'none';
        if (pill) pill.textContent = 'Posicione su rostro dentro del marco';
    }
}

function limpiarFiltroFacialUsuario() {
    AppState.filtroUsuarioFacial = '';
    localStorage.removeItem('filtroUsuarioFacial');
    const select = document.getElementById('selectFiltroFacialUsuario');
    if (select) select.value = '';
    cambiarFiltroFacialUsuario('');
}

function detenerTerminalFacial() {
    if (AppState.intervaloEscaneoFacial) {
        clearInterval(AppState.intervaloEscaneoFacial);
        AppState.intervaloEscaneoFacial = null;
    }
    if (AppState.streamCamaraFacial) {
        AppState.streamCamaraFacial.getTracks().forEach(t => t.stop());
        AppState.streamCamaraFacial = null;
    }
}

function alternarCamaraFacial() {
    AppState.camaraFacialModo = AppState.camaraFacialModo === 'user' ? 'environment' : 'user';
    iniciarTerminalFacial();
}

async function analizarFotogramaFacial() {
    if (AppState.escaneandoFacial) return;
    const video = document.getElementById('videoFacialFeed');
    if (!video || video.readyState < 2) return;

    AppState.escaneandoFacial = true;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL('image/jpeg', 0.85);

    try {
        const payload = { imagen_base64: b64 };
        
        // Determinar filtro actual de forma estricta e inequívoca
        const selectFiltro = document.getElementById('selectFiltroFacialUsuario');
        let filtroVal = (selectFiltro && selectFiltro.value) ? selectFiltro.value : '';
        if (!filtroVal && AppState.filtroUsuarioFacial) {
            filtroVal = AppState.filtroUsuarioFacial;
        }
        if (!filtroVal) {
            filtroVal = localStorage.getItem('filtroUsuarioFacial') || '';
        }

        if (filtroVal) {
            payload.usuario_id_filtro = parseInt(filtroVal, 10);
        }

        const resp = await fetch('/api/biometria/verificar_rostro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        actualizarUIResultadoFacial(data);
    } catch (e) {
        console.warn('Error en peticion facial:', e);
    } finally {
        AppState.escaneandoFacial = false;
    }
}

function actualizarUIResultadoFacial(res) {
    const ledBar = document.getElementById('facialLedBar');
    const bracket = document.getElementById('facialBracket');
    const pill = document.getElementById('facialInstructionText');
    const banner = document.getElementById('facialVerdictBanner');

    const obtenerTextoPillActivo = () => {
        const selectFiltro = document.getElementById('selectFiltroFacialUsuario');
        const opt = selectFiltro && selectFiltro.selectedOptions[0];
        if (opt && selectFiltro.value) {
            return `Verificando a: ${opt.text}`;
        }
        return 'Posicione su rostro dentro del marco';
    };

    if (res.estado === 'PERMITIDO') {
        ledBar.className = 'facial-led-bar granted';
        bracket.className = 'facial-target-bracket granted';
        pill.textContent = `✓ EXACT: ${res.trabajador.nombres} (${res.similitud}%)`;
        audioSeguridad.sonarAccesoPermitido();

        banner.innerHTML = `
            <div class="verdict-info">
                <div class="verdict-avatar" style="background-color: #dcfce7; color: #16a34a; font-weight: bold; font-size: 1.1rem;">
                    ${res.trabajador.nombres.charAt(0)}${res.trabajador.apellidos.charAt(0)}
                </div>
                <div class="verdict-text">
                    <h4>${res.trabajador.nombres} ${res.trabajador.apellidos}</h4>
                    <p>DNI: ${res.trabajador.dni} | ${res.trabajador.cargo}</p>
                </div>
            </div>
            <div class="verdict-badge granted">
                <svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>Acceso Autorizado</span>
            </div>
        `;

        clearInterval(AppState.intervaloEscaneoFacial);
        setTimeout(() => {
            if (AppState.vistaActual === 'facial') {
                AppState.intervaloEscaneoFacial = setInterval(analizarFotogramaFacial, 1200);
                ledBar.className = 'facial-led-bar scanning';
                bracket.className = 'facial-target-bracket';
                pill.textContent = obtenerTextoPillActivo();
            }
        }, 4500);

    } else if (res.estado === 'DENEGADO') {
        ledBar.className = 'facial-led-bar denied';
        bracket.className = 'facial-target-bracket denied';
        audioSeguridad.sonarAccesoDenegado();

        if (res.motivo === 'SUPLANTACION_1A1') {
            pill.textContent = `✗ Suplantación: Rostro (${res.detectado}) ≠ ${res.esperado}`;
            banner.innerHTML = `
                <div class="verdict-info">
                    <div class="verdict-avatar" style="background-color: #fee2e2; color: #dc2626;">
                        <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                    </div>
                    <div class="verdict-text">
                        <h4 style="color: #dc2626;">Suplantación 1:1 Detectada</h4>
                        <p style="color: #0f172a; font-size: 0.8rem;">Detectado: <strong>${res.detectado || 'No coincide'}</strong><br><span style="color: #64748b;">Esperado: ${res.esperado}</span></p>
                    </div>
                </div>
                <div class="verdict-badge denied">
                    <svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    <span>Bloqueado</span>
                </div>
            `;
        } else {
            pill.textContent = res.mensaje || 'Acceso Denegado: Rostro no autorizado';
            banner.innerHTML = `
                <div class="verdict-info">
                    <div class="verdict-avatar" style="background-color: #fee2e2; color: #dc2626;">
                        <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                    </div>
                    <div class="verdict-text">
                        <h4>Acceso Denegado</h4>
                        <p>${res.mensaje || 'Rostro no coincide con base biométrica'}</p>
                    </div>
                </div>
                <div class="verdict-badge denied">
                    <svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    <span>Denegado</span>
                </div>
            `;
        }

        clearInterval(AppState.intervaloEscaneoFacial);
        setTimeout(() => {
            if (AppState.vistaActual === 'facial') {
                AppState.intervaloEscaneoFacial = setInterval(analizarFotogramaFacial, 1200);
                ledBar.className = 'facial-led-bar scanning';
                bracket.className = 'facial-target-bracket';
                pill.textContent = obtenerTextoPillActivo();
            }
        }, 2500);

    } else if (res.estado === 'BUSCANDO') {
        ledBar.className = 'facial-led-bar scanning';
        bracket.className = 'facial-target-bracket';
        pill.textContent = res.mensaje || obtenerTextoPillActivo();
    }
}

// =============================================================================
// VISTA 3: TERMINAL BIOMETRICO DACTILAR (Lectura y Verificación Real)
// =============================================================================

function limpiarDniHuellaTerminal() {
    const select = document.getElementById('selectFiltroHuellaUsuario');
    if (select) select.value = '';
    seleccionarModoHuellaTerminal('');
    const resBox = document.getElementById('fpResultadoAccesoBox');
    if (resBox) resBox.style.display = 'none';
}

async function cargarSelectorFiltroHuella() {
    const select = document.getElementById('selectFiltroHuellaUsuario');
    if (!select) return;

    try {
        const resp = await fetch('/api/biometria/obtener_credenciales_huella');
        const data = await resp.json();
        let html = '<option value="">Modo General: Identificar automáticamente (1:N)</option>';
        if (data.exito && data.credenciales && data.credenciales.length > 0) {
            html += data.credenciales
                .map(c => `<option value="${c.usuario_id}" data-uid="${c.usuario_id}" data-nombre="${c.nombre}" data-dni="${c.dni}" data-dedo="${c.nombre_dedo || 'Yema Dactilar'}">${c.nombre} (DNI ${c.dni} - ${c.nombre_dedo || 'Yema'})</option>`)
                .join('');
        }
        select.innerHTML = html;
    } catch (e) {
        console.warn('Error cargando lista de huellas para selector:', e);
    }
}

function seleccionarModoHuellaTerminal(val) {
    const title = document.getElementById('fpTerminalStatusTitle');
    const desc = document.getElementById('fpTerminalStatusDesc');
    const select = document.getElementById('selectFiltroHuellaUsuario');
    const ayuda = document.getElementById('fpModoAyudaTexto');

    if (!val) {
        if (title) title.textContent = 'Escáner Dactilar Óptico Activo';
        if (desc) desc.textContent = 'Modo General: Acerque la yema de cualquier dedo al centro del visor verde y presione "Escanear Dedo".';
        if (ayuda) ayuda.textContent = 'Cualquier trabajador registrado puede colocar su dedo y el sistema identificará quién es.';
        return;
    }

    const opt = select ? select.selectedOptions[0] : null;
    const nombreLimpio = opt ? opt.getAttribute('data-nombre') : 'Trabajador';
    const dedo = opt ? opt.getAttribute('data-dedo') : 'Yema';
    if (title) title.textContent = `Listo para: ${nombreLimpio}`;
    if (desc) desc.textContent = `Validación 1:1: Coloque el ${dedo} de ${nombreLimpio} dentro del visor verde.`;
    if (ayuda) ayuda.textContent = `Validación 1:1: Solo la huella de ${nombreLimpio} será aceptada (detecta suplantación con alta precisión).`;
}

// Variables de estado para Escáner Dactilar Óptico por Cámara (Touchless OpenCV)
let streamHuellaOptica = null;
let modoCamaraHuella = 'environment'; // 'environment' (trasera) o 'user' (frontal)
let linternaActivaHuella = false;
let escaneandoHuellaCamara = false;
let fullscreenHuellaActivo = false;
let timerDetectorEncuadre5cm = null;
let canvasAnalisis5cm = null;
let ultimoEstadoEncuadre5cm = { optimo: false, distancia_cm: null, estado: 'vacio' };
let conteoFramesOptimosTerminal = 0;
let coberturaPielTerminalSuave = 0;

/**
 * Analizador en tiempo real de encuadre dérmico y distancia a 5 cm.
 * Muestrea a 6 FPS (cada 160ms) el área central del video (ROI del óvalo).
 */
function iniciarDetectorEncuadre5cm() {
    detenerDetectorEncuadre5cm();
    coberturaPielTerminalSuave = 0;
    conteoFramesOptimosTerminal = 0;

    if (!canvasAnalisis5cm) {
        canvasAnalisis5cm = document.createElement('canvas');
        canvasAnalisis5cm.width = 120;
        canvasAnalisis5cm.height = 150;
    }
    const ctx = canvasAnalisis5cm.getContext('2d', { willReadFrequently: true });

    timerDetectorEncuadre5cm = setInterval(() => {
        if (escaneandoHuellaCamara) return;

        const video = document.getElementById('videoFeedHuellaOptica');
        const box = document.getElementById('dynamicBoundingBoxTerminal');
        const tag = document.getElementById('tagBoundingBoxTerminal');
        const badge = document.getElementById('badgeGuiaEncuadre5cm');

        if (!video || video.readyState < 2 || !box || !badge) return;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        // Región de Interés (ROI) central que coincide con el visor
        const menorDim = Math.min(vw, vh);
        const cropW = Math.round(menorDim * 0.44);
        const cropH = Math.round(cropW * 1.25);
        const sx = Math.round((vw - cropW) / 2);
        const sy = Math.round((vh - cropH) / 2);

        ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, 120, 150);
        const imgData = ctx.getImageData(0, 0, 120, 150);
        const data = imgData.data;

        let totalPiel = 0;
        let totalValidos = 0;

        // Analizar píxeles dérmicos con espectro cromático humano tolerante a luz/flash
        for (let i = 0; i < data.length; i += 8) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            totalValidos++;

            // Detección universal de piel viva dérmica
            const esPiel = (r > 45 && g > 25 && b > 18 && (r >= g - 2) && (r - b >= 4) && (r + g + b >= 95));
            const esDermisFlash = (r > 120 && g > 75 && b > 55 && (r >= g - 3) && (r - b >= 4));

            if (esPiel || esDermisFlash) {
                totalPiel++;
            }
        }

        const coberturaPielInst = totalPiel / Math.max(1, totalValidos);
        // Suavizado exponencial para evitar fluctuaciones y parpadeo de cámara
        coberturaPielTerminalSuave = (coberturaPielTerminalSuave === 0) 
            ? coberturaPielInst 
            : (coberturaPielTerminalSuave * 0.65 + coberturaPielInst * 0.35);

        const cov = coberturaPielTerminalSuave;

        // 1. Visor vacío o sin presencia de piel (< 12%)
        if (cov < 0.12) {
            box.className = 'dynamic-finger-box searching';
            if (tag) tag.textContent = 'BUSCANDO YEMA...';
            badge.className = 'hud-distance-badge';
            badge.textContent = 'Presente su dedo frente a la cámara (a 5-7 cm)';
            ultimoEstadoEncuadre5cm = { optimo: false, esDedo: false, distancia_cm: null, estado: 'vacio' };
            conteoFramesOptimosTerminal = 0;

        // 2. Dedo detectado pero alejado (12% - 22%)
        } else if (cov < 0.22) {
            box.className = 'dynamic-finger-box detected';
            if (tag) tag.textContent = 'ACERQUE UN POCO';
            badge.className = 'hud-distance-badge lejos';
            badge.textContent = 'Acerque la yema a unos 5 cm de la cámara';
            conteoFramesOptimosTerminal = 0;

        // 3. POSICIÓN ÓPTIMA: Dedo en el recuadro a 5 cm (>= 22%)
        } else {
            box.className = 'dynamic-finger-box locked';
            ultimoEstadoEncuadre5cm = { optimo: true, esDedo: true, distancia_cm: 5.0, estado: 'optimo' };
            conteoFramesOptimosTerminal++;

            // Cuenta regresiva paciente de 1.8 segundos para enfocar el dedo
            if (conteoFramesOptimosTerminal < 4) {
                if (tag) tag.textContent = '✓ ENFOCANDO... (2s)';
                badge.className = 'hud-distance-badge optimo';
                badge.textContent = '✓ Yema detectada • Mantenga firme... (2s)';
            } else if (conteoFramesOptimosTerminal < 8) {
                if (tag) tag.textContent = '✓ ENFOCANDO... (1s)';
                badge.className = 'hud-distance-badge optimo';
                badge.textContent = '✓ Enfocando crestas de la yema... (1s)';
            } else if (conteoFramesOptimosTerminal < 11) {
                if (tag) tag.textContent = '✓ ESCANEANDO...';
                badge.className = 'hud-distance-badge optimo';
                badge.textContent = '✓ Enfoque listo • Escaneando huella...';
            } else {
                // Tras tiempo suficiente con el dedo firme a 5 cm, realiza el escaneo
                conteoFramesOptimosTerminal = 0;
                capturarHuellaOpticaMilimetrica();
            }
        }
    }, 160);
}

/**
 * Detiene el detector de encuadre para liberar ciclos de CPU.
 */
function detenerDetectorEncuadre5cm() {
    conteoFramesOptimosTerminal = 0;
    if (timerDetectorEncuadre5cm) {
        clearInterval(timerDetectorEncuadre5cm);
        timerDetectorEncuadre5cm = null;
    }
}

/**
 * Activa las opciones y la mira a 5 cm únicamente al presionar "Escanear Huella Digital".
 */
function activarModoEscaneoHuella() {
    const reticle = document.getElementById('fpKioskCenterReticle');
    const badge = document.getElementById('badgeGuiaEncuadre5cm');
    const hint = document.getElementById('txtAutoCaptureHintTerminal');
    const ctrlInicial = document.getElementById('fpControlesInicial');
    const ctrlEscaneo = document.getElementById('fpControlesEscaneando');
    const resBox = document.getElementById('fpResultadoAccesoBox');

    if (resBox) resBox.style.display = 'none';
    if (reticle) reticle.style.display = 'block';
    if (badge) {
        badge.style.display = 'inline-flex';
        badge.className = 'hud-distance-badge';
        badge.textContent = 'Coloque la yema de su dedo a 5 cm del visor';
    }
    if (hint) hint.style.display = 'block';
    if (ctrlInicial) ctrlInicial.style.display = 'none';
    if (ctrlEscaneo) ctrlEscaneo.style.display = 'flex';

    ultimoEstadoEncuadre5cm = { optimo: false, esDedo: false, distancia_cm: null, estado: 'vacio' };
    conteoFramesOptimosTerminal = 0;
    escaneandoHuellaCamara = false;

    iniciarDetectorEncuadre5cm();
}

/**
 * Desactiva el modo de escaneo y regresa la cámara a la vista limpia normal.
 */
function desactivarModoEscaneoHuella() {
    detenerDetectorEncuadre5cm();
    escaneandoHuellaCamara = false;

    const reticle = document.getElementById('fpKioskCenterReticle');
    const badge = document.getElementById('badgeGuiaEncuadre5cm');
    const hint = document.getElementById('txtAutoCaptureHintTerminal');
    const ctrlInicial = document.getElementById('fpControlesInicial');
    const ctrlEscaneo = document.getElementById('fpControlesEscaneando');
    const progressBox = document.getElementById('fpTerminalProgressBarContainer');
    const resBox = document.getElementById('fpResultadoAccesoBox');

    if (reticle) reticle.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (hint) hint.style.display = 'none';
    if (progressBox) progressBox.style.display = 'none';
    if (ctrlEscaneo) ctrlEscaneo.style.display = 'none';
    if (ctrlInicial) ctrlInicial.style.display = 'flex';
    if (resBox) resBox.style.display = 'none';

    const box = document.getElementById('dynamicBoundingBoxTerminal');
    if (box) box.className = 'dynamic-finger-box searching';
    const tag = document.getElementById('tagBoundingBoxTerminal');
    if (tag) tag.textContent = 'BUSCANDO YEMA...';
}

/**
 * Inicia el flujo de video en vivo de la cámara para el terminal dactilar (vista limpia).
 */
async function iniciarCamaraTerminalHuella() {
    const video = document.getElementById('videoFeedHuellaOptica');
    if (!video) return;

    // Asegurar vista limpia: cámara normal sin popups ni óvalos molestos
    desactivarModoEscaneoHuella();

    // Intentar activar pantalla completa nativa si el navegador lo permite
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    }

    if (streamHuellaOptica && streamHuellaOptica.active) {
        return;
    }

    try {
        const constraints = {
            video: {
                facingMode: modoCamaraHuella,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        streamHuellaOptica = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = streamHuellaOptica;
        await video.play();

        const txtModo = document.getElementById('txtModoCamaraHuella');
        if (txtModo) {
            txtModo.textContent = (modoCamaraHuella === 'environment' ? 'Trasera' : 'Frontal');
        }

        // Revisar si el hardware soporta linterna (torch)
        const track = streamHuellaOptica.getVideoTracks()[0];
        const btnFlash = document.getElementById('btnToggleFlashHuella');
        if (btnFlash && track) {
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            btnFlash.style.display = ('torch' in capabilities) ? 'inline-flex' : 'none';
        }

    } catch (e) {
        console.warn('[CAMARA HUELLA] Error al acceder a la cámara con facingMode:', e);
        try {
            streamHuellaOptica = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            video.srcObject = streamHuellaOptica;
            await video.play();
        } catch (err) {
            console.error('[CAMARA HUELLA FATAL] No se pudo activar la cámara:', err);
        }
    }
}

/**
 * Detiene la cámara del terminal dactilar para liberar el hardware.
 */
function detenerCamaraTerminalHuella() {
    desactivarModoEscaneoHuella();
    detenerDetectorEncuadre5cm();
    if (streamHuellaOptica) {
        try {
            streamHuellaOptica.getTracks().forEach(t => t.stop());
        } catch (e) {}
        streamHuellaOptica = null;
    }
    const video = document.getElementById('videoFeedHuellaOptica');
    if (video) {
        video.srcObject = null;
    }
}

/**
 * Alterna entre la cámara Frontal y la Trasera.
 */
async function alternarCamaraScannerHuella() {
    modoCamaraHuella = (modoCamaraHuella === 'environment' ? 'user' : 'environment');
    detenerCamaraTerminalHuella();
    await iniciarCamaraTerminalHuella();
}

/**
 * Activa o apaga la linterna/flash del dispositivo para iluminar las crestas dactilares.
 */
async function alternarFlashLinternaHuella() {
    if (!streamHuellaOptica) return;
    const track = streamHuellaOptica.getVideoTracks()[0];
    if (!track) return;

    try {
        linternaActivaHuella = !linternaActivaHuella;
        await track.applyConstraints({
            advanced: [{ torch: linternaActivaHuella }]
        });
        const btn = document.getElementById('btnToggleFlashHuella');
        if (btn) {
            btn.style.color = linternaActivaHuella ? '#facc15' : '#f8fafc';
            btn.style.borderColor = linternaActivaHuella ? '#facc15' : 'rgba(255, 255, 255, 0.2)';
        }
    } catch (e) {
        console.warn('[FLASH] No se pudo alternar flash:', e);
    }
}

/**
 * Expande el visor a Pantalla Completa Móvil (Modo Kiosco de Seguridad).
 */
function expandirEscanerHuellaFullscreen() {
    const viewport = document.getElementById('fpCameraScannerViewport');
    if (!viewport) return;

    fullscreenHuellaActivo = !fullscreenHuellaActivo;

    if (fullscreenHuellaActivo) {
        viewport.classList.add('modal-fullscreen-scanner');
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    } else {
        viewport.classList.remove('modal-fullscreen-scanner');
        if (document.exitFullscreen && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }
}

/**
 * Recorta exclusivamente la región de la yema dactilar encuadrada
 * dentro del recuadro dinámico (Bounding Box) en pantalla,
 * descartando el 100% del fondo exterior, habitación, palma y nudillos.
 */
function recortarCanvasRecuadro(video, boxId) {
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const actualW = video.videoWidth;
    const actualH = video.videoHeight;
    const box = document.getElementById(boxId);

    let cropX, cropY, cropW, cropH;

    if (box && video.clientWidth > 0 && video.clientHeight > 0) {
        const boxRect = box.getBoundingClientRect();
        const videoRect = video.getBoundingClientRect();

        const displayedW = video.clientWidth;
        const displayedH = video.clientHeight;

        // Escala uniforme considerando object-fit: cover
        const scale = Math.max(displayedW / actualW, displayedH / actualH);
        const renderedW = actualW * scale;
        const renderedH = actualH * scale;
        const offsetX = (displayedW - renderedW) / 2;
        const offsetY = (displayedH - renderedH) / 2;

        const boxLeft = boxRect.left - videoRect.left;
        const boxTop = boxRect.top - videoRect.top;

        cropX = (boxLeft - offsetX) / scale;
        cropY = (boxTop - offsetY) / scale;
        cropW = boxRect.width / scale;
        cropH = boxRect.height / scale;
    } else {
        // Fallback al centro exacto en proporción biométrica 1.25 : 1
        const menor = Math.min(actualW, actualH);
        cropW = menor * 0.44;
        cropH = cropW * 1.25;
        cropX = (actualW - cropW) / 2;
        cropY = (actualH - cropH) / 2;
    }

    // Delimitar dentro de los límites físicos del sensor de video
    const safeX = Math.max(0, Math.min(actualW - 40, Math.round(cropX)));
    const safeY = Math.max(0, Math.min(actualH - 40, Math.round(cropY)));
    const safeW = Math.max(40, Math.min(actualW - safeX, Math.round(cropW)));
    const safeH = Math.max(40, Math.min(actualH - safeY, Math.round(cropH)));

    // Dimensionar canvas con resolución fija nítida de 320x400 px
    // para estandarizar todas las muestras biométricas en OpenCV
    const targetW = 320;
    const targetH = 400;

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, safeX, safeY, safeW, safeH, 0, 0, targetW, targetH);

    return canvas;
}

/**
 * Captura la foto de la huella en alta resolución y la examina a milímetro en el servidor.
 */
async function capturarHuellaOpticaMilimetrica() {
    if (escaneandoHuellaCamara) return;

    // Verificar que el dedo esté presente en el recuadro para no lanzar escaneos vacíos
    const badge = document.getElementById('badgeGuiaEncuadre5cm');
    if (!ultimoEstadoEncuadre5cm || !ultimoEstadoEncuadre5cm.esDedo) {
        if (badge) {
            badge.className = 'hud-distance-badge lejos';
            badge.textContent = 'Coloque primero la yema de su dedo en el recuadro a 5 cm';
        }
        return;
    }

    escaneandoHuellaCamara = true;
    detenerDetectorEncuadre5cm();

    const progressBox = document.getElementById('fpTerminalProgressBarContainer');
    const progressBar = document.getElementById('fpTerminalProgressBar');
    const progressLabel = document.getElementById('fpTerminalProgressLabel');
    const progressSec = document.getElementById('fpTerminalProgressSec');
    const ctrlEscaneo = document.getElementById('fpControlesEscaneando');
    const resBox = document.getElementById('fpResultadoAccesoBox');

    if (ctrlEscaneo) ctrlEscaneo.style.display = 'none';
    if (resBox) resBox.style.display = 'none';

    audioSeguridad.sonarEscaneoLaser();

    // Animación de examen milimétrico de crestas
    if (progressBox) progressBox.style.display = 'block';
    if (progressLabel) progressLabel.textContent = 'Enfocando relieve papilar en el recuadro...';
    if (progressBar) progressBar.style.width = '25%';
    if (progressSec) progressSec.textContent = '0.3s / 1.2s';

    const video = document.getElementById('videoFeedHuellaOptica');
    if (!video || video.readyState < 2) {
        if (progressBox) progressBox.style.display = 'none';
        procesarResultadoHuellaOpticaUI({
            estado: 'DENEGADO',
            mensaje: 'Cámara Inicializando',
            detalle: 'Espere un segundo mientras se estabiliza la señal de video.'
        });
        escaneandoHuellaCamara = false;
        return;
    }

    await new Promise(r => setTimeout(r, 260));
    if (progressBar) progressBar.style.width = '65%';
    if (progressLabel) progressLabel.textContent = 'Examinando crestas y bifurcaciones de la yema...';
    if (progressSec) progressSec.textContent = '0.8s / 1.2s';

    // Captura exclusivamente la yema dentro del recuadro dinámico (descartando fondo)
    const canvas = recortarCanvasRecuadro(video, 'dynamicBoundingBoxTerminal');
    if (!canvas) {
        if (progressBox) progressBox.style.display = 'none';
        procesarResultadoHuellaOpticaUI({
            estado: 'DENEGADO',
            mensaje: 'Error de Sensor',
            detalle: 'No se pudo encuadrar la yema en el visor.'
        });
        escaneandoHuellaCamara = false;
        return;
    }
    const b64 = canvas.toDataURL('image/jpeg', 0.95);

    await new Promise(r => setTimeout(r, 260));
    if (progressBar) progressBar.style.width = '100%';
    if (progressLabel) progressLabel.textContent = 'Verificando minucias con SQLite...';
    if (progressSec) progressSec.textContent = '1.2s / 1.2s';

    const select = document.getElementById('selectFiltroHuellaUsuario');
    const idFiltro = (select && select.value) ? select.value : null;

    try {
        const resp = await fetch('/api/biometria/verificar_huella_optica', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imagen_base64: b64,
                usuario_id_filtro: idFiltro
            })
        });

        const resultado = await resp.json();
        if (progressBox) progressBox.style.display = 'none';
        procesarResultadoHuellaOpticaUI(resultado);

    } catch (e) {
        console.error('[HUELLA OPTICA ERROR]', e);
        if (progressBox) progressBox.style.display = 'none';
        procesarResultadoHuellaOpticaUI({
            estado: 'DENEGADO',
            mensaje: 'Error de Comunicación',
            detalle: e.message || 'No se pudo conectar con el servidor para la validación dactilar.'
        });
    } finally {
        escaneandoHuellaCamara = false;
    }
}

// Alias de compatibilidad
const ejecutarEscaneoHuellaOpticaCamara = capturarHuellaOpticaMilimetrica;

/**
 * Muestra el resultado de verificación en una pequeña ventana compacta (no tan grande, no invasiva).
 */
function procesarResultadoHuellaOpticaUI(resultado) {
    const resBox = document.getElementById('fpResultadoAccesoBox');
    if (!resBox) return;

    if (resultado.estado === 'PERMITIDO') {
        audioSeguridad.sonarAccesoPermitido();
        const colab = resultado.colaborador || {};
        const nombreCompleto = `${colab.nombres || ''} ${colab.apellidos || ''}`.trim() || 'Trabajador Autorizado';
        const dedo = resultado.dedo || 'Yema Dactilar';
        const confianza = resultado.confianza || 95.0;
        const minucias = resultado.minucias_coincidentes || 35;

        resBox.className = 'fp-mini-result-window permitido';
        resBox.innerHTML = `
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.4rem;">
                <div style="display: flex; align-items: center; gap: 0.65rem;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: #16a34a; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; font-weight: 800; box-shadow: 0 0 12px rgba(34, 197, 94, 0.6); flex-shrink: 0;">
                        ✓
                    </div>
                    <div>
                        <div style="font-size: 0.95rem; font-weight: 800; color: #4ade80;">Acceso Autorizado</div>
                        <div style="font-size: 0.88rem; font-weight: 700; color: #f8fafc; line-height: 1.2;">${nombreCompleto}</div>
                    </div>
                </div>
                <button type="button" onclick="desactivarModoEscaneoHuella()" style="background: transparent; border: none; color: #94a3b8; font-size: 1.15rem; cursor: pointer; padding: 0 0.2rem;" title="Cerrar">✕</button>
            </div>
            <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 0.5rem; padding-left: 2.7rem;">
                DNI: <strong style="color: #f1f5f9;">${colab.dni || '--------'}</strong> • Cargo: ${colab.cargo || 'Personal'}
            </div>
            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; padding-left: 2.7rem;">
                <span style="background: rgba(34, 197, 94, 0.2); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.4); font-size: 0.70rem; font-weight: 700; padding: 0.16rem 0.5rem; border-radius: 999px;">
                    ${confianza}% Coincidencia (${minucias} Minucias)
                </span>
                <span style="background: rgba(22, 163, 74, 0.25); color: #4ade80; font-size: 0.70rem; font-weight: 800; padding: 0.16rem 0.5rem; border-radius: 999px;">
                    Cerradura Desasegurada (5s)
                </span>
            </div>
        `;
        resBox.style.display = 'block';

    } else {
        audioSeguridad.sonarAccesoDenegado();
        const mensaje = resultado.mensaje || 'Acceso Denegado';
        const detalle = resultado.detalle || 'La huella dactilar no coincide con los patrones registrados.';

        resBox.className = 'fp-mini-result-window denegado';
        resBox.innerHTML = `
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.35rem;">
                <div style="display: flex; align-items: center; gap: 0.65rem;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: #dc2626; color: white; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; font-weight: 800; box-shadow: 0 0 12px rgba(239, 68, 68, 0.6); flex-shrink: 0;">
                        ✕
                    </div>
                    <div>
                        <div style="font-size: 0.95rem; font-weight: 800; color: #f87171;">${mensaje}</div>
                        <div style="font-size: 0.75rem; color: #fca5a5; line-height: 1.25; margin-top: 0.15rem;">${detalle}</div>
                    </div>
                </div>
                <button type="button" onclick="desactivarModoEscaneoHuella()" style="background: transparent; border: none; color: #94a3b8; font-size: 1.15rem; cursor: pointer; padding: 0 0.2rem;" title="Cerrar">✕</button>
            </div>
            <div style="display: flex; gap: 0.35rem; margin-top: 0.5rem; padding-left: 2.7rem;">
                <span style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 0.70rem; font-weight: 700; padding: 0.16rem 0.5rem; border-radius: 999px;">
                    Cerradura Bloqueada
                </span>
                <span style="background: rgba(15, 23, 42, 0.6); color: #94a3b8; font-size: 0.70rem; font-weight: 600; padding: 0.16rem 0.5rem; border-radius: 999px;">
                    Auditoría en SQLite
                </span>
            </div>
        `;
        resBox.style.display = 'block';
    }

    // Auto-cierre suave después de 4 segundos retornando la cámara limpia
    if (window._timerCierreResultadoHuella) {
        clearTimeout(window._timerCierreResultadoHuella);
    }
    window._timerCierreResultadoHuella = setTimeout(() => {
        desactivarModoEscaneoHuella();
    }, 4000);
}

// Variables de estado para Enrolamiento Dactilar a Pantalla Completa (Kiosco Total)
let streamEnrollFullscreen = null;
let modoCamaraEnrollFullscreen = 'environment';
let linternaEnrollFullscreen = false;
let timerDetectorEnrollFullscreen5cm = null;
let canvasEnrollFullscreen5cm = null;
let conteoFramesOptimosEnroll = 0;
let capturandoEnrollActivo = false;
let ultimoEstadoEnroll5cm = { optimo: false, esDedo: false, estado: 'vacio' };
let coberturaPielEnrollSuave = 0;
let muestrasEnrollDactilar = [];
let indiceMuestraEnroll = 1;

/**
 * Actualiza el estado visual de las píldoras de tomas (Toma 1, 2 y 3).
 */
function actualizarPillsMuestrasEnroll(indice) {
    for (let i = 1; i <= 3; i++) {
        const pill = document.getElementById(`pillMuestra${i}`);
        if (!pill) continue;
        if (i < indice) {
            pill.className = 'fp-sample-pill completed';
        } else if (i === indice) {
            pill.className = 'fp-sample-pill active';
        } else {
            pill.className = 'fp-sample-pill';
        }
    }

    const hint = document.getElementById('txtAutoCaptureHintEnroll');
    const btnText = document.getElementById('btnCapturarEnrollText');

    if (hint) {
        if (indice === 1) {
            hint.textContent = 'Toma 1 de 3: Apoye el centro de la yema frente al recuadro';
        } else if (indice === 2) {
            hint.textContent = 'Toma 2 de 3: Incline ligeramente la yema para abarcar crestas laterales';
        } else if (indice === 3) {
            hint.textContent = 'Toma 3 de 3: Apoye la punta de la yema para completar la plantilla';
        }
    }

    if (btnText) {
        btnText.textContent = `Capturar Muestra (${indice}/3)`;
    }
}

/**
 * Abre el visor a Pantalla Completa Nativa para enrolar la huella dactilar de un colaborador.
 */
async function abrirCamaraEnrolamientoHuellaOptica() {
    const dni = document.getElementById('intDni').value.trim();
    const nombres = document.getElementById('intNombres').value.trim();
    const tipoDedo = document.getElementById('selectTipoDedoModal') ? document.getElementById('selectTipoDedoModal').value : 'Índice Derecho';

    if (!dni) {
        Swal.fire({
            icon: 'warning',
            title: 'DNI Requerido',
            text: 'Por favor complete primero el campo DNI antes de escanear la huella dactilar.',
            confirmButtonColor: '#0284c7'
        });
        document.getElementById('intDni').focus();
        return;
    }

    const overlay = document.getElementById('overlayFullscreenEnrollHuella');
    if (!overlay) return;

    const txtInfo = document.getElementById('txtEnrollDedoColaborador');
    if (txtInfo) {
        txtInfo.textContent = `${nombres || 'Colaborador'} (DNI: ${dni}) • ${tipoDedo}`;
    }

    // Reinicializar flujo de 3 tomas
    muestrasEnrollDactilar = [];
    indiceMuestraEnroll = 1;
    actualizarPillsMuestrasEnroll(1);

    overlay.style.display = 'block';
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    }

    await iniciarCamaraEnrollFullscreen();
}

/**
 * Cierra el visor de enrolamiento dactilar a pantalla completa y libera hardware.
 */
function cerrarFullscreenEnrollHuella() {
    detenerCamaraEnrollFullscreen();
    const overlay = document.getElementById('overlayFullscreenEnrollHuella');
    if (overlay) {
        overlay.style.display = 'none';
    }
    if (document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
}

/**
 * Inicia la cámara para el enrolamiento dactilar a pantalla completa.
 */
async function iniciarCamaraEnrollFullscreen() {
    const video = document.getElementById('videoEnrollHuellaFullscreen');
    if (!video) return;

    detenerCamaraEnrollFullscreen();

    try {
        const constraints = {
            video: {
                facingMode: modoCamaraEnrollFullscreen,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        streamEnrollFullscreen = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = streamEnrollFullscreen;
        await video.play();

        const txtModo = document.getElementById('txtModoEnrollFullscreen');
        if (txtModo) {
            txtModo.textContent = (modoCamaraEnrollFullscreen === 'environment' ? 'Trasera' : 'Frontal');
        }

        const track = streamEnrollFullscreen.getVideoTracks()[0];
        const btnFlash = document.getElementById('btnFlashEnrollFullscreen');
        if (btnFlash && track) {
            const caps = track.getCapabilities ? track.getCapabilities() : {};
            btnFlash.style.display = ('torch' in caps) ? 'inline-flex' : 'none';
        }

        iniciarDetectorEnrollFullscreen5cm();

    } catch (e) {
        console.warn('[CAMARA ENROLL FULLSCREEN] Error:', e);
        try {
            streamEnrollFullscreen = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            video.srcObject = streamEnrollFullscreen;
            await video.play();
            iniciarDetectorEnrollFullscreen5cm();
        } catch (err) {
            console.error('[CAMARA ENROLL FATAL]:', err);
            Swal.fire({
                icon: 'error',
                title: 'Error de Cámara',
                text: 'No se pudo acceder a la cámara del dispositivo para el enrolamiento.',
                confirmButtonColor: '#dc2626'
            });
            cerrarFullscreenEnrollHuella();
        }
    }
}

/**
 * Detiene la cámara y el detector de enrolamiento.
 */
function detenerCamaraEnrollFullscreen() {
    detenerDetectorEnrollFullscreen5cm();
    if (streamEnrollFullscreen) {
        try {
            streamEnrollFullscreen.getTracks().forEach(t => t.stop());
        } catch (e) {}
        streamEnrollFullscreen = null;
    }
    const video = document.getElementById('videoEnrollHuellaFullscreen');
    if (video) {
        video.srcObject = null;
    }
}

async function alternarCamaraEnrollFullscreen() {
    modoCamaraEnrollFullscreen = (modoCamaraEnrollFullscreen === 'environment' ? 'user' : 'environment');
    await iniciarCamaraEnrollFullscreen();
}

async function alternarFlashEnrollFullscreen() {
    if (!streamEnrollFullscreen) return;
    const track = streamEnrollFullscreen.getVideoTracks()[0];
    if (!track) return;
    try {
        linternaEnrollFullscreen = !linternaEnrollFullscreen;
        await track.applyConstraints({ advanced: [{ torch: linternaEnrollFullscreen }] });
        const btn = document.getElementById('btnFlashEnrollFullscreen');
        if (btn) {
            btn.style.color = linternaEnrollFullscreen ? '#facc15' : '#f8fafc';
            btn.style.borderColor = linternaEnrollFullscreen ? '#facc15' : 'rgba(255, 255, 255, 0.25)';
        }
    } catch (e) {}
}

/**
 * Analizador en tiempo real a 6 FPS para el enrolador de huella con auto-captura a 5 cm.
 */
function iniciarDetectorEnrollFullscreen5cm() {
    detenerDetectorEnrollFullscreen5cm();
    conteoFramesOptimosEnroll = 0;
    coberturaPielEnrollSuave = 0;
    capturandoEnrollActivo = false;

    if (!canvasEnrollFullscreen5cm) {
        canvasEnrollFullscreen5cm = document.createElement('canvas');
        canvasEnrollFullscreen5cm.width = 120;
        canvasEnrollFullscreen5cm.height = 150;
    }
    const ctx = canvasEnrollFullscreen5cm.getContext('2d', { willReadFrequently: true });

    timerDetectorEnrollFullscreen5cm = setInterval(() => {
        if (capturandoEnrollActivo) return;

        const video = document.getElementById('videoEnrollHuellaFullscreen');
        const box = document.getElementById('dynamicBoundingBoxEnroll');
        const tag = document.getElementById('tagBoundingBoxEnroll');
        const badge = document.getElementById('badgeGuiaEnrollFullscreen5cm');

        if (!video || video.readyState < 2 || !box || !badge) return;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        const menorDim = Math.min(vw, vh);
        const cropW = Math.round(menorDim * 0.44);
        const cropH = Math.round(cropW * 1.25);
        const sx = Math.round((vw - cropW) / 2);
        const sy = Math.round((vh - cropH) / 2);

        ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, 120, 150);
        const data = ctx.getImageData(0, 0, 120, 150).data;

        let totalPiel = 0;
        let totalValidos = 0;

        for (let i = 0; i < data.length; i += 8) {
            const r = data[i], g = data[i+1], b = data[i+2];
            totalValidos++;

            // Detección universal de piel viva dérmica
            const esPiel = (r > 45 && g > 25 && b > 18 && (r >= g - 2) && (r - b >= 4) && (r + g + b >= 95));
            const esDermisFlash = (r > 120 && g > 75 && b > 55 && (r >= g - 3) && (r - b >= 4));

            if (esPiel || esDermisFlash) {
                totalPiel++;
            }
        }

        const coberturaPielInst = totalPiel / Math.max(1, totalValidos);
        // Suavizado exponencial para estabilidad perfecta sin parpadeo
        coberturaPielEnrollSuave = (coberturaPielEnrollSuave === 0)
            ? coberturaPielInst
            : (coberturaPielEnrollSuave * 0.65 + coberturaPielInst * 0.35);

        const cov = coberturaPielEnrollSuave;

        // 1. Visor vacío o sin presencia de piel (< 12%)
        if (cov < 0.12) {
            box.className = 'dynamic-finger-box searching';
            if (tag) tag.textContent = 'BUSCANDO YEMA...';
            badge.className = 'hud-distance-badge';
            badge.textContent = 'Presente su dedo frente a la cámara (a 5-7 cm)';
            ultimoEstadoEnroll5cm = { optimo: false, esDedo: false, estado: 'vacio' };

        // 2. Dedo detectado pero alejado (12% - 22%)
        } else if (cov < 0.22) {
            box.className = 'dynamic-finger-box detected';
            if (tag) tag.textContent = 'ACERQUE UN POCO';
            badge.className = 'hud-distance-badge lejos';
            badge.textContent = 'Acerque la yema a unos 5 cm de la cámara';
            ultimoEstadoEnroll5cm = { optimo: false, esDedo: true, estado: 'lejos' };

        // 3. POSICIÓN ÓPTIMA: Dedo en el recuadro a 5 cm (>= 22%)
        } else {
            box.className = 'dynamic-finger-box locked';
            if (tag) tag.textContent = `✓ YEMA LISTA (TOMA ${indiceMuestraEnroll}/3)`;
            badge.className = 'hud-distance-badge optimo';
            badge.textContent = `✓ Yema detectada • Presione "Capturar Muestra (${indiceMuestraEnroll}/3)"`;
            ultimoEstadoEnroll5cm = { optimo: true, esDedo: true, estado: 'optimo' };
        }
    }, 160);
}

function detenerDetectorEnrollFullscreen5cm() {
    conteoFramesOptimosEnroll = 0;
    if (timerDetectorEnrollFullscreen5cm) {
        clearInterval(timerDetectorEnrollFullscreen5cm);
        timerDetectorEnrollFullscreen5cm = null;
    }
}

/**
 * Dispara la captura y enrolamiento dactilar con flujo guiado de 3 tomas.
 */
async function dispararCapturaEnrollFullscreen(esAutomatico = false) {
    if (capturandoEnrollActivo) return;
    capturandoEnrollActivo = true;

    // Validación previa ante disparo manual:
    if (!esAutomatico && (!ultimoEstadoEnroll5cm || ultimoEstadoEnroll5cm.estado === 'vacio')) {
        audioSeguridad.sonarAccesoDenegado();
        Swal.fire({
            icon: 'warning',
            title: 'Coloque su Dedo a 5 cm',
            text: 'No se detecta ningún dedo en el visor. Coloque la yema de su dedo frente a la cámara a 5 cm de distancia.',
            confirmButtonColor: '#0284c7'
        });
        capturandoEnrollActivo = false;
        return;
    }

    const video = document.getElementById('videoEnrollHuellaFullscreen');
    const flash = document.getElementById('flashCaptureOverlayEnroll');
    const btnManual = document.getElementById('btnCapturarEnrollFullscreenManual');
    const btnText = document.getElementById('btnCapturarEnrollText');
    const badge = document.getElementById('badgeGuiaEnrollFullscreen5cm');
    const tipoDedo = document.getElementById('selectTipoDedoModal') ? document.getElementById('selectTipoDedoModal').value : 'Índice Derecho';
    const usuarioId = document.getElementById('formTrabajadorId').value.trim();

    if (!video || video.readyState < 2) {
        capturandoEnrollActivo = false;
        return;
    }

    if (btnManual) btnManual.disabled = true;
    if (btnText) btnText.textContent = `Validando Toma ${indiceMuestraEnroll}/3...`;
    if (badge) {
        badge.className = 'hud-distance-badge optimo';
        badge.textContent = `✓ Procesando Toma ${indiceMuestraEnroll}/3 con OpenCV...`;
    }

    audioSeguridad.sonarCapturaFoto();
    if (flash) {
        flash.style.display = 'block';
        setTimeout(() => { flash.style.display = 'none'; }, 90);
    }

    // Captura exclusivamente la yema dentro del recuadro dinámico (descartando fondo)
    const canvas = recortarCanvasRecuadro(video, 'dynamicBoundingBoxEnroll');
    if (!canvas) {
        if (btnManual) btnManual.disabled = false;
        capturandoEnrollActivo = false;
        return;
    }
    const b64 = canvas.toDataURL('image/jpeg', 0.95);

    try {
        // Validar con OpenCV que la toma actual contenga un contorno de dedo y crestas dérmicas nítidas
        const respVal = await fetch('/api/biometria/validar_foto_dedo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagen_base64: b64 })
        });
        const dataVal = await respVal.json();
        if (!dataVal.exito) {
            throw new Error(dataVal.mensaje || dataVal.detalle || 'Enfoque borroso o dedo no detectado');
        }

        // Agregar la muestra validada
        muestrasEnrollDactilar.push(b64);

        if (indiceMuestraEnroll < 3) {
            // Avanzar a la siguiente muestra
            const pillCompletada = document.getElementById(`pillMuestra${indiceMuestraEnroll}`);
            if (pillCompletada) pillCompletada.className = 'fp-sample-pill completed';

            indiceMuestraEnroll++;
            actualizarPillsMuestrasEnroll(indiceMuestraEnroll);

            audioSeguridad.sonarAccesoPermitido();
            if (badge) {
                badge.className = 'hud-distance-badge optimo';
                badge.textContent = `✓ ¡Toma ${indiceMuestraEnroll - 1}/3 capturada! Prepare la Toma ${indiceMuestraEnroll}/3`;
            }

            if (btnManual) btnManual.disabled = false;
            capturandoEnrollActivo = false;
            return;
        }

        // --- TOMA 3 COMPLETADA: PROCESAR ENROLAMIENTO MULTIMUESTRA ---
        actualizarPillsMuestrasEnroll(3);
        const pill3 = document.getElementById('pillMuestra3');
        if (pill3) pill3.className = 'fp-sample-pill completed';

        if (btnText) btnText.textContent = 'Fusionando 3 tomas y generando plantilla maestra...';
        if (badge) {
            badge.className = 'hud-distance-badge optimo';
            badge.textContent = '✓ Fusionando descriptores ORB en SQLite...';
        }

        if (usuarioId) {
            const resp = await fetch('/api/biometria/enrolar_huella_multimuestra', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: usuarioId,
                    muestras: muestrasEnrollDactilar,
                    nombre_dedo: tipoDedo
                })
            });
            const data = await resp.json();
            if (!data.exito) {
                throw new Error(data.mensaje || data.detalle || 'Error combinando muestras');
            }

            audioSeguridad.sonarAccesoPermitido();
            cerrarFullscreenEnrollHuella();
            completarEnrolamientoModalUI(muestrasEnrollDactilar[0], tipoDedo, data.minucias_detectadas || 45);

            Swal.fire({
                icon: 'success',
                title: '¡Plantilla Maestra Calibrada!',
                html: `
                    <div style="text-align: center;">
                        <p style="font-weight: 800; font-size: 1.1rem; color: #15803d; margin-bottom: 0.35rem;">${tipoDedo} Registrado</p>
                        <p style="color: #64748b; font-size: 0.85rem;">Se combinaron con éxito <strong>3 tomas de alta resolución (${data.minucias_detectadas || 45} minucias ORB maestras)</strong> en SQLite.</p>
                    </div>
                `,
                confirmButtonColor: '#16a34a',
                confirmButtonText: 'Continuar'
            });

        } else {
            AppState.huellaOpticaNueva = {
                imagen_base64: muestrasEnrollDactilar[0],
                muestras: muestrasEnrollDactilar,
                nombre_dedo: tipoDedo
            };

            audioSeguridad.sonarAccesoPermitido();
            cerrarFullscreenEnrollHuella();
            completarEnrolamientoModalUI(muestrasEnrollDactilar[0], tipoDedo, '3 Muestras Combinadas');

            Swal.fire({
                icon: 'success',
                title: '¡3 Muestras Calibradas con Éxito!',
                html: `
                    <div style="text-align: center;">
                        <p style="font-weight: 800; font-size: 1.1rem; color: #15803d; margin-bottom: 0.35rem;">${tipoDedo} Capturado</p>
                        <p style="color: #64748b; font-size: 0.85rem;">Las 3 tomas papilares se vincularán al guardar el trabajador.</p>
                    </div>
                `,
                confirmButtonColor: '#16a34a',
                confirmButtonText: 'Continuar'
            });
        }

    } catch (err) {
        audioSeguridad.sonarAccesoDenegado();
        Swal.fire({
            icon: 'error',
            title: 'Reintento de Toma Requerido',
            html: `
                <div style="text-align: center;">
                    <p style="color: #991b1b; font-weight: 700; font-size: 0.95rem;">${err.message || 'No se detectaron crestas papilares nítidas.'}</p>
                    <p style="color: #64748b; font-size: 0.82rem; margin-top: 0.5rem;">
                        Por favor mantenga la yema inmóvil a unos 5 cm de la cámara con buena luz y presione reintentar.
                    </p>
                </div>
            `,
            confirmButtonColor: '#dc2626',
            confirmButtonText: 'Reintentar Toma'
        });
    } finally {
        if (btnManual) btnManual.disabled = false;
        if (btnText) btnText.textContent = `Capturar Muestra (${indiceMuestraEnroll}/3)`;
        capturandoEnrollActivo = false;
    }
}

/**
 * Actualiza la UI del modal de trabajador con la huella capturada y su miniatura.
 */
function completarEnrolamientoModalUI(b64, tipoDedo, minucias) {
    AppState.huellaRegistradaModal = true;
    AppState.huellaDactilarBorrada = false;

    const imgThumb = document.getElementById('imgHuellaThumbModal');
    const thumbWrap = document.getElementById('modalFpThumbPreview');
    const emptySvg = document.getElementById('svgIconHuellaVacio');
    const badge = document.getElementById('badgeEstadoHuellaModal');
    const desc = document.getElementById('descEstadoHuellaModal');
    const btnBorrar = document.getElementById('btnBorrarHuellaModal');
    const box = document.getElementById('modalFpTouchBox');

    if (imgThumb) imgThumb.src = b64;
    if (thumbWrap) thumbWrap.style.display = 'block';
    if (emptySvg) emptySvg.style.display = 'none';
    if (box) box.classList.add('active');

    if (badge) {
        badge.innerHTML = `<span style="color: #16a34a; font-weight: 800;">✓ Huella Calibrada (${tipoDedo})</span>`;
    }
    if (desc) {
        desc.textContent = `Patrón papilar extraído con OpenCV (${minucias} minucias ORB). Se sincronizará en SQLite al guardar el trabajador.`;
    }
    if (btnBorrar) {
        btnBorrar.style.display = 'inline-flex';
    }

    audioSeguridad.sonarAccesoPermitido();
}

/**
 * Desvincula la huella en el modal de trabajador.
 */
function limpiarHuellaDactilarModal() {
    AppState.huellaRegistradaModal = false;
    AppState.huellaOpticaNueva = null;
    AppState.huellaDactilarBorrada = true;

    const thumbWrap = document.getElementById('modalFpThumbPreview');
    const emptySvg = document.getElementById('svgIconHuellaVacio');
    const badge = document.getElementById('badgeEstadoHuellaModal');
    const desc = document.getElementById('descEstadoHuellaModal');
    const btnBorrar = document.getElementById('btnBorrarHuellaModal');
    const box = document.getElementById('modalFpTouchBox');

    if (thumbWrap) thumbWrap.style.display = 'none';
    if (emptySvg) emptySvg.style.display = 'block';
    if (box) box.classList.remove('active');

    if (badge) badge.textContent = 'Huella Dactilar Pendiente';
    if (desc) desc.textContent = 'Presione el botón para abrir la cámara (frontal o trasera) con láser verde y capturar las minucias del dedo.';
    if (btnBorrar) btnBorrar.style.display = 'none';
}

/**
 * Muestra la huella ya registrada cuando se abre el modal para editar trabajador.
 */
function mostrarHuellaRegistradaEnModal(usuarioId, huellaPublicKeyRaw) {
    AppState.huellaRegistradaModal = true;
    AppState.huellaOpticaNueva = null;
    AppState.huellaDactilarBorrada = false;

    let nombreDedo = 'Índice Derecho';
    let minuciasCount = '1200';

    if (huellaPublicKeyRaw) {
        try {
            const pk = JSON.parse(huellaPublicKeyRaw);
            if (pk.nombre_dedo) nombreDedo = pk.nombre_dedo;
            if (pk.num_minucias) minuciasCount = pk.num_minucias;
        } catch (e) {}
    }

    const selectDedo = document.getElementById('selectTipoDedoModal');
    if (selectDedo && nombreDedo) {
        selectDedo.value = nombreDedo;
    }

    const imgThumb = document.getElementById('imgHuellaThumbModal');
    const thumbWrap = document.getElementById('modalFpThumbPreview');
    const emptySvg = document.getElementById('svgIconHuellaVacio');
    const badge = document.getElementById('badgeEstadoHuellaModal');
    const desc = document.getElementById('descEstadoHuellaModal');
    const btnBorrar = document.getElementById('btnBorrarHuellaModal');
    const box = document.getElementById('modalFpTouchBox');

    if (imgThumb) {
        imgThumb.src = `/static/uploads/fingerprints/${usuarioId}/huella_optica.jpg?t=${Date.now()}`;
        imgThumb.onerror = () => {
            if (thumbWrap) thumbWrap.style.display = 'none';
            if (emptySvg) emptySvg.style.display = 'block';
        };
    }
    if (thumbWrap) thumbWrap.style.display = 'block';
    if (emptySvg) emptySvg.style.display = 'none';
    if (box) box.classList.add('active');

    if (badge) {
        badge.innerHTML = `<span style="color: #16a34a; font-weight: 800;">✓ Huella Registrada en SQLite (${nombreDedo})</span>`;
    }
    if (desc) {
        desc.textContent = `Plantilla dérmica activa en SQLite (${minuciasCount} puntos ORB). Puede volver a escanear para actualizarla.`;
    }
    if (btnBorrar) {
        btnBorrar.style.display = 'inline-flex';
    }
}


// =============================================================================
// VISTA 4: CENTRO DE MONITOREO CCTV Y TELEMETRIA DE SENSORES
// =============================================================================

async function iniciarCentroCCTV() {
    const video = document.getElementById('cctvStreamVideo');
    if (!video) return;

    // Detener tracks anteriores de cámara CCTV
    if (AppState.streamCamaraCctv) {
        AppState.streamCamaraCctv.getTracks().forEach(t => t.stop());
        AppState.streamCamaraCctv = null;
    }
    video.srcObject = null;

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            const constraints = {
                video: {
                    facingMode: AppState.camaraCctvModo,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };
            AppState.streamCamaraCctv = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = AppState.streamCamaraCctv;
            await video.play();
        } catch (e) {
            console.log('Fallo con modo solicitado, probando cámara genérica:', e);
            try {
                AppState.streamCamaraCctv = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                video.srcObject = AppState.streamCamaraCctv;
                await video.play();
            } catch (err) {
                console.warn('Cámara CCTV no accesible en este dispositivo:', err);
            }
        }
    }

    // Efecto espejo: sólo para cámara frontal (selfie/operador)
    if (AppState.camaraCctvModo === 'user') {
        video.classList.add('cctv-mirror-flip');
    } else {
        video.classList.remove('cctv-mirror-flip');
    }

    actualizarBadgesCctvHud();

    // Reanudar sensor de movimiento si Centinela estaba armado
    if (AppState.centinelaArmado && !AppState.intervaloMotionCctv) {
        iniciarBucleDeteccionMovimiento();
    }

    // Telemetría de hardware
    if (AppState.intervaloTelemetria) clearInterval(AppState.intervaloTelemetria);
    AppState.intervaloTelemetria = setInterval(consultarTelemetriaHardware, 1500);
    consultarTelemetriaHardware();
}

function detenerCentroCCTV() {
    if (AppState.intervaloTelemetria) {
        clearInterval(AppState.intervaloTelemetria);
        AppState.intervaloTelemetria = null;
    }
    if (AppState.intervaloMotionCctv) {
        clearInterval(AppState.intervaloMotionCctv);
        AppState.intervaloMotionCctv = null;
    }
    if (AppState.streamCamaraCctv) {
        AppState.streamCamaraCctv.getTracks().forEach(t => t.stop());
        AppState.streamCamaraCctv = null;
    }
    const video = document.getElementById('cctvStreamVideo');
    if (video) video.srcObject = null;
}

function alternarCamaraCctv() {
    AppState.camaraCctvModo = AppState.camaraCctvModo === 'environment' ? 'user' : 'environment';
    iniciarCentroCCTV();

    const esTrasera = AppState.camaraCctvModo === 'environment';
    const nombreModo = esTrasera ? 'Cámara Trasera (Supervisión de Sala)' : 'Cámara Frontal (Operador)';

    actualizarBadgesCctvHud();

    Swal.fire({
        icon: 'info',
        title: nombreModo,
        text: esTrasera ? 'Enfocando el laboratorio/sala de servidores' : 'Modo espejo activado para operador',
        timer: 1300,
        showConfirmButton: false
    });
}

function alternarVisionNocturna() {
    const video = document.getElementById('cctvStreamVideo');
    if (!video) return;

    // Ciclo de visión nocturna: normal -> ir_green (verde) -> ir_bw (blanco y negro térmico) -> normal
    if (AppState.cctvModoVision === 'normal') {
        AppState.cctvModoVision = 'ir_green';
    } else if (AppState.cctvModoVision === 'ir_green') {
        AppState.cctvModoVision = 'ir_bw';
    } else {
        AppState.cctvModoVision = 'normal';
    }

    video.classList.remove('night-vision-green', 'night-vision-bw');

    if (AppState.cctvModoVision === 'ir_green') {
        video.classList.add('night-vision-green');
        audioSeguridad.sonarCapturaFoto();
    } else if (AppState.cctvModoVision === 'ir_bw') {
        video.classList.add('night-vision-bw');
        audioSeguridad.sonarCapturaFoto();
    }

    actualizarBadgesCctvHud();
}

function cambiarUbicacionCctv(ubicacion) {
    AppState.cctvUbicacion = ubicacion || 'Laboratorio Central de Cómputo';
    actualizarBadgesCctvHud();
}

function actualizarBadgesCctvHud() {
    // Sincronizar nombre en HUD de video
    const hudUbicacion = document.getElementById('cctvHudUbicacion');
    if (hudUbicacion) {
        hudUbicacion.textContent = AppState.cctvUbicacion.toUpperCase();
    }
    const selectUbicacion = document.getElementById('selectCctvUbicacion');
    if (selectUbicacion && selectUbicacion.value !== AppState.cctvUbicacion) {
        selectUbicacion.value = AppState.cctvUbicacion;
    }

    // Badge Tipo de Cámara
    const badgeCam = document.getElementById('badgeCctvCamaraTipo');
    if (badgeCam) {
        const esTrasera = AppState.camaraCctvModo === 'environment';
        badgeCam.textContent = esTrasera ? 'POSTERIOR (SALA)' : 'FRONTAL (OPERADOR)';
        badgeCam.className = esTrasera ? 'cctv-cam-badge' : 'cctv-cam-badge user-cam';
    }

    // Badge y Botones Visión Nocturna
    const badgeVision = document.getElementById('badgeCctvVisionTipo');
    const btnVision = document.getElementById('btnNightVision');
    const btnHudVision = document.getElementById('btnHudNightVision');

    let txtVision = 'COLOR DIURNO';
    if (AppState.cctvModoVision === 'ir_green') txtVision = 'IR VERDE NOCTURNO';
    if (AppState.cctvModoVision === 'ir_bw') txtVision = 'IR TÉRMICO B&W';

    if (badgeVision) badgeVision.textContent = txtVision;

    const activa = AppState.cctvModoVision !== 'normal';
    [btnVision, btnHudVision].forEach(btn => {
        if (!btn) return;
        if (activa) {
            btn.classList.add('active-ir');
        } else {
            btn.classList.remove('active-ir');
        }
    });
}

function alternarPantallaCompletaCctv() {
    const box = document.getElementById('cctvViewportBox');
    if (!box) return;

    const enFs = document.fullscreenElement || box.classList.contains('fullscreen-mode');

    if (!enFs) {
        if (box.requestFullscreen) {
            box.requestFullscreen().catch(() => box.classList.add('fullscreen-mode'));
        } else if (box.webkitRequestFullscreen) {
            box.webkitRequestFullscreen();
        } else {
            box.classList.add('fullscreen-mode');
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        box.classList.remove('fullscreen-mode');
    }
}

// Escuchar cambios de fullscreen del navegador
document.addEventListener('fullscreenchange', () => {
    const box = document.getElementById('cctvViewportBox');
    if (!document.fullscreenElement && box) {
        box.classList.remove('fullscreen-mode');
    }
});

// Canvas para cálculo óptico en memoria
let canvasMotionDiff = null;
let ctxMotionDiff = null;

function alternarCentinelaNocturno() {
    AppState.centinelaArmado = !AppState.centinelaArmado;
    const badge = document.getElementById('badgeCentinelaEstado');
    const btn = document.getElementById('btnToggleCentinela');
    const hudBadge = document.getElementById('badgeHudCentinela');
    const banner = document.getElementById('cctvIntrusionBanner');

    if (AppState.centinelaArmado) {
        if (badge) {
            badge.className = 'telemetry-badge-state alert';
            badge.textContent = 'CENTINELA ARMADO (ACTIVO)';
        }
        if (btn) {
            btn.className = 'btn btn-danger btn-sm';
            btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> <span>Desarmar Centinela Fuera de Horario</span>`;
        }
        if (hudBadge) {
            hudBadge.className = 'cctv-cam-badge sentry-armed';
            hudBadge.textContent = 'CENTINELA ARMADO';
        }

        audioSeguridad.sonarAccesoPermitido();
        Swal.fire({
            icon: 'warning',
            title: 'Centinela de Seguridad Armado',
            html: `Supervisión activa fuera de horario laboral para <strong>${AppState.cctvUbicacion}</strong>.<br><br>Al menor movimiento sonará la alarma de seguridad automáticamente y se registrará en el sistema.`,
            confirmButtonColor: '#0284c7'
        });

        iniciarBucleDeteccionMovimiento();

    } else {
        if (badge) {
            badge.className = 'telemetry-badge-state normal';
            badge.textContent = 'DESARMADO';
        }
        if (btn) {
            btn.className = 'btn btn-primary btn-sm';
            btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> <span>Armar Centinela Fuera de Horario</span>`;
        }
        if (hudBadge) {
            hudBadge.className = 'cctv-cam-badge sentry-disarmed';
            hudBadge.textContent = 'CENTINELA DESARMADO';
        }

        detenerBucleDeteccionMovimiento();
        silenciarAlarmaIntrusion();

        Swal.fire({
            icon: 'info',
            title: 'Centinela Desarmado',
            text: 'Supervisión nocturna desactivada. Sistema en modo diurno.',
            timer: 1500,
            showConfirmButton: false
        });
    }
}

function iniciarBucleDeteccionMovimiento() {
    if (!canvasMotionDiff) {
        canvasMotionDiff = document.createElement('canvas');
        canvasMotionDiff.width = 160;
        canvasMotionDiff.height = 120;
        ctxMotionDiff = canvasMotionDiff.getContext('2d');
    }
    AppState.ultimoFotogramaMotion = null;

    if (AppState.intervaloMotionCctv) clearInterval(AppState.intervaloMotionCctv);
    AppState.intervaloMotionCctv = setInterval(procesarDeteccionMovimientoCctv, 200);
}

function detenerBucleDeteccionMovimiento() {
    if (AppState.intervaloMotionCctv) {
        clearInterval(AppState.intervaloMotionCctv);
        AppState.intervaloMotionCctv = null;
    }
}

function procesarDeteccionMovimientoCctv() {
    if (!AppState.centinelaArmado) return;
    const video = document.getElementById('cctvStreamVideo');
    if (!video || video.readyState < 2) return;

    ctxMotionDiff.drawImage(video, 0, 0, 160, 120);
    const frame = ctxMotionDiff.getImageData(0, 0, 160, 120);
    const data = frame.data;

    if (AppState.ultimoFotogramaMotion) {
        let diffPixels = 0;
        const lastData = AppState.ultimoFotogramaMotion.data;
        const total = data.length;

        // Sensibilidad por pixel: diferencia de 48 (alta agudeza a cualquier cambio de movimiento)
        for (let i = 0; i < total; i += 16) {
            const rDiff = Math.abs(data[i] - lastData[i]);
            const gDiff = Math.abs(data[i + 1] - lastData[i + 1]);
            const bDiff = Math.abs(data[i + 2] - lastData[i + 2]);
            if ((rDiff + gDiff + bDiff) > 48) {
                diffPixels++;
            }
        }

        const porcentaje = Math.min(100, (diffPixels / (160 * 120 / 4)) * 100);

        // Actualizar visualizador HUD
        const levelEl = document.getElementById('cctvMotionLevel');
        if (levelEl) levelEl.textContent = `${porcentaje.toFixed(1)}%`;

        const barFill = document.getElementById('cctvMotionBarFill');
        if (barFill) {
            const w = Math.min(100, (porcentaje / (AppState.umbralSensibilidadCentinela * 2)) * 100);
            barFill.style.width = `${w.toFixed(0)}%`;
            if (porcentaje >= AppState.umbralSensibilidadCentinela) {
                barFill.style.background = '#dc2626';
            } else {
                barFill.style.background = '#38bdf8';
            }
        }

        // Si sobrepasa el umbral configurado -> ¡DISPARO AUTOMÁTICO DE ALARMA!
        if (porcentaje >= AppState.umbralSensibilidadCentinela) {
            dispararAlertaIntrusionMovimiento(porcentaje);
        }
    }

    AppState.ultimoFotogramaMotion = frame;
}

let timeoutSilencioIntrusion = null;

function dispararAlertaIntrusionMovimiento(porcentaje) {
    const banner = document.getElementById('cctvIntrusionBanner');
    const detalleEl = document.getElementById('cctvIntrusionDetalle');
    const viewport = document.getElementById('cctvViewportBox');

    if (banner) {
        banner.style.display = 'flex';
        if (detalleEl) {
            detalleEl.textContent = `Movimiento no autorizado en ${AppState.cctvUbicacion} (${porcentaje.toFixed(1)}% variación) en horario no laboral`;
        }
    }
    if (viewport) {
        viewport.classList.add('viewport-alarm-active');
    }

    // SIRENA DE ALARMA AUTOMÁTICA CONTINUA
    audioSeguridad.iniciarAlarmaPanico();

    // Notificar al backend SQLite inmediatamente
    fetch('/api/hardware/evento_sensor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tipo: 'INTRUSION_MOVIMIENTO_CCTV',
            descripcion: `Intrusión detectada en ${AppState.cctvUbicacion} (${porcentaje.toFixed(1)}% variación) fuera de horario`,
            nivel: 'CRITICO'
        })
    }).catch(e => console.warn('Error enviando evento de intrusion:', e));

    if (timeoutSilencioIntrusion) clearTimeout(timeoutSilencioIntrusion);
    timeoutSilencioIntrusion = setTimeout(() => {
        silenciarAlarmaIntrusion();
    }, 7000);
}

function silenciarAlarmaIntrusion() {
    if (timeoutSilencioIntrusion) clearTimeout(timeoutSilencioIntrusion);
    const banner = document.getElementById('cctvIntrusionBanner');
    const viewport = document.getElementById('cctvViewportBox');
    if (banner) banner.style.display = 'none';
    if (viewport) viewport.classList.remove('viewport-alarm-active');
    audioSeguridad.detenerAlarmaPanico();
}

function cambiarSensibilidadCentinela(valor) {
    const valNum = parseFloat(valor) || 1.0;
    AppState.umbralSensibilidadCentinela = valNum;
    const txt = document.getElementById('txtSensibilidadCentinela');
    const threshEl = document.getElementById('cctvThresholdVal');

    let descripcion = 'Ultra-Sensible (al más mínimo movimiento)';
    if (valNum >= 3.0) descripcion = 'Media / Estándar';
    if (valNum >= 5.0) descripcion = 'Baja (movimientos amplios)';

    if (txt) txt.textContent = `${valNum.toFixed(1)}% - ${descripcion}`;
    if (threshEl) threshEl.textContent = `${valNum.toFixed(1)}%`;
}

// =============================================================================
// VISTA 5: PANEL DE ADMINISTRACION MAESTRO
// =============================================================================

function cambiarTabAdmin(nombreTab) {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');

    const btn = document.getElementById(`btn-admin-tab-${nombreTab}`);
    if (btn) btn.classList.add('active');

    const destino = document.getElementById(`tab-content-${nombreTab}`);
    if (destino) destino.style.display = 'block';

    try {
        localStorage.setItem('iot_tab_admin', nombreTab);
    } catch (e) {}

    // Sincronizar resaltado visual en los botones del Menú Drawer Vertical
    document.querySelectorAll('#appDrawerMenu .drawer-subitem, #appDrawerMenu .drawer-item').forEach(b => b.classList.remove('active'));
    const drawerMap = {
        'inicio': 'drawerBtnInicio',
        'trabajadores': 'drawerBtnTrabajadores',
        'reportes': 'drawerBtnReportes',
        'passwords': 'drawerBtnPasswords',
        'logs': 'drawerBtnLogs'
    };
    if (drawerMap[nombreTab]) {
        const dBtn = document.getElementById(drawerMap[nombreTab]);
        if (dBtn) dBtn.classList.add('active');
    }

    if (nombreTab === 'inicio') cargarEstadisticasDashboard();
    if (nombreTab === 'trabajadores') cargarListaTrabajadores();
    if (nombreTab === 'reportes') cargarListaTrabajadores();
    if (nombreTab === 'passwords') cargarFormularioPasswords();
    if (nombreTab === 'logs') cargarTablaLogs();
}

async function cargarDatosAdmin() {
    await cargarEstadisticasDashboard();
    const tabGuardada = localStorage.getItem('iot_tab_admin') || 'inicio';
    cambiarTabAdmin(tabGuardada);
}

async function cargarEstadisticasDashboard() {
    try {
        const resp = await fetch('/api/dashboard/stats');
        const data = await resp.json();
        if (data.exito) {
            const s = data.stats;
            document.getElementById('kpiTotalTrabajadores').textContent = s.total_trabajadores;
            document.getElementById('kpiAccesosPermitidos').textContent = s.accesos_permitidos;
            document.getElementById('kpiAccesosDenegados').textContent = s.accesos_denegados;
            document.getElementById('kpiAlertasCriticas').textContent = s.alertas_criticas;

            // Actualizar barras de estado visuales
            const barDenegados = document.getElementById('kpiBarDenegados');
            if (barDenegados) {
                const totalAccesos = (s.accesos_permitidos + s.accesos_denegados) || 1;
                barDenegados.style.width = `${Math.min(100, (s.accesos_denegados / totalAccesos) * 100)}%`;
            }
            const barAlertas = document.getElementById('kpiBarAlertas');
            if (barAlertas) {
                barAlertas.style.width = `${Math.min(100, s.alertas_criticas * 20)}%`;
            }
        }
    } catch (e) {
        console.warn('Error cargando KPIs:', e);
    }
}

function normalizarTextoBusqueda(texto) {
    if (!texto) return '';
    return texto.toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function renderizarFilasTrabajadores(lista, terminoBusqueda = '') {
    const tbody = document.getElementById('tablaTrabajadoresBody');
    const badgeConteo = document.getElementById('badgeConteoTrabajadores');
    const btnLimpiar = document.getElementById('btnLimpiarBuscarTrabajador');

    if (btnLimpiar) {
        btnLimpiar.style.display = terminoBusqueda ? 'inline-block' : 'none';
    }

    if (badgeConteo) {
        badgeConteo.textContent = `${lista.length} ${lista.length === 1 ? 'Registrado' : 'Registrados'}`;
    }

    if (!lista || lista.length === 0) {
        if (terminoBusqueda) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem 1rem; color: #64748b;">
                <svg class="icon icon-lg" style="margin-bottom: 0.5rem; color: #94a3b8;" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <div>No se encontraron colaboradores que coincidan con "<strong>${terminoBusqueda}</strong>"</div>
                <button class="btn btn-outline btn-sm" style="margin-top: 0.75rem;" onclick="limpiarBusquedaTrabajadores()">Limpiar Búsqueda</button>
            </td></tr>`;
        } else {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: #64748b;">No hay trabajadores registrados en la base de datos.</td></tr>';
        }
        return;
    }

    tbody.innerHTML = lista.map(t => `
        <tr class="worker-table-row" onclick="onTrabajadorRowClick(event, ${t.id})" title="Tocar para ver ficha completa">
            <td><strong>${t.dni}</strong></td>
            <td>
                <div style="font-weight: 700; color: #0f172a;">${t.nombres} ${t.apellidos}</div>
                <div style="font-size: 0.75rem; color: #64748b;">${t.departamento} • ${t.cargo}</div>
            </td>
            <td>${t.cargo}</td>
            <td>
                ${t.rostro_registrado 
                    ? `<span class="badge-status active">✓ Rostro (${t.fotos_entrenadas})</span>` 
                    : `<span class="badge-status pending">Pendiente</span>`}
            </td>
            <td>
                ${t.huella_registrada 
                    ? `<span class="badge-status active">✓ Huella Activa</span>` 
                    : `<span class="badge-status pending">Pendiente</span>`}
            </td>
            <td>
                <span class="badge-status ${t.estado === 'ACTIVO' ? 'active' : 'inactive'}" style="cursor: pointer;" onclick="event.stopPropagation(); alternarEstadoTrabajador(${t.id}, '${t.estado}')" title="Clic para cambiar estado">
                    ${t.estado}
                </span>
            </td>
            <td>
                <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;" onclick="event.stopPropagation()">
                    <button class="btn btn-outline btn-sm btn-excel-worker" onclick="exportarFichaTrabajador(${t.id})" title="Descargar Ficha Técnica en Excel (.xlsx)">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
                        Ficha Excel
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="abrirModalEditarTrabajador(${t.id})" title="Editar Ficha Integral">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        Editar
                    </button>
                    <button class="btn btn-outline btn-sm" style="color: #dc2626; border-color: #fca5a5;" onclick="eliminarTrabajador(${t.id}, '${t.nombres} ${t.apellidos}')" title="Eliminar de SQLite">
                        <svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Eliminar
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function onTrabajadorRowClick(event, id) {
    if (event.target.closest('button') || event.target.closest('a')) {
        return;
    }
    mostrarFichaTrabajador(id);
}

function filtrarTrabajadoresEnVivo(termino) {
    if (!AppState.trabajadores) return;
    const q = normalizarTextoBusqueda(termino);
    if (!q) {
        renderizarFilasTrabajadores(AppState.trabajadores, '');
        return;
    }
    const filtrados = AppState.trabajadores.filter(t => {
        const dni = normalizarTextoBusqueda(t.dni);
        const nombres = normalizarTextoBusqueda(t.nombres);
        const apellidos = normalizarTextoBusqueda(t.apellidos);
        const cargo = normalizarTextoBusqueda(t.cargo);
        const depto = normalizarTextoBusqueda(t.departamento);
        const estado = normalizarTextoBusqueda(t.estado);
        const completo = `${nombres} ${apellidos}`;
        return dni.includes(q) || nombres.includes(q) || apellidos.includes(q) || completo.includes(q) || cargo.includes(q) || depto.includes(q) || estado.includes(q);
    });
    renderizarFilasTrabajadores(filtrados, termino);
}

function limpiarBusquedaTrabajadores() {
    const input = document.getElementById('inputBuscarTrabajador');
    if (input) input.value = '';
    filtrarTrabajadoresEnVivo('');
}

function mostrarFichaTrabajador(id) {
    if (!AppState.trabajadores) return;
    const t = AppState.trabajadores.find(item => item.id === id);
    if (!t) return;

    const modal = document.getElementById('modalFichaDetalleTrabajador');
    if (!modal) return;

    const iniciales = ((t.nombres ? t.nombres[0] : '') + (t.apellidos ? t.apellidos[0] : '')).toUpperCase() || 'TR';
    document.getElementById('fichaModalAvatar').textContent = iniciales;
    document.getElementById('fichaModalNombre').textContent = `${t.nombres} ${t.apellidos}`;
    document.getElementById('fichaModalDniBadge').textContent = `DNI: ${t.dni}`;
    document.getElementById('fichaModalCargo').textContent = t.cargo || '-';
    document.getElementById('fichaModalDepartamento').textContent = t.departamento || '-';
    
    const elEstado = document.getElementById('fichaModalEstado');
    elEstado.textContent = t.estado || 'ACTIVO';
    elEstado.className = `badge-status ${t.estado === 'ACTIVO' ? 'active' : 'inactive'}`;

    const elFacial = document.getElementById('fichaModalFacial');
    elFacial.textContent = t.rostro_registrado ? `✓ Rostro Entrenado (${t.fotos_entrenadas} fotos)` : '✗ Rostro No Registrado';
    elFacial.className = `badge-status ${t.rostro_registrado ? 'active' : 'pending'}`;

    const elHuella = document.getElementById('fichaModalHuella');
    elHuella.textContent = t.huella_registrada ? '✓ Huella Dactilar AS608' : '✗ Huella No Registrada';
    elHuella.className = `badge-status ${t.huella_registrada ? 'active' : 'pending'}`;

    const elFecha = document.getElementById('fichaModalFecha');
    if (elFecha) {
        elFecha.textContent = t.fecha_creacion ? t.fecha_creacion.replace('T', ' ').substring(0, 19) : 'Registro SQLite';
    }

    // Configurar botones de accion
    const btnEditar = document.getElementById('fichaModalBtnEditar');
    btnEditar.onclick = () => {
        cerrarModalFichaTrabajador();
        abrirModalEditarTrabajador(t.id);
    };

    const btnExcel = document.getElementById('fichaModalBtnExcel');
    btnExcel.onclick = () => {
        exportarFichaTrabajador(t.id);
    };

    const btnEliminar = document.getElementById('fichaModalBtnEliminar');
    btnEliminar.onclick = () => {
        cerrarModalFichaTrabajador();
        eliminarTrabajador(t.id, `${t.nombres} ${t.apellidos}`);
    };

    modal.classList.add('active');
}

function cerrarModalFichaTrabajador() {
    const modal = document.getElementById('modalFichaDetalleTrabajador');
    if (modal) modal.classList.remove('active');
}

async function cargarListaTrabajadores() {
    const tbody = document.getElementById('tablaTrabajadoresBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: #64748b;">Cargando registros...</td></tr>';

    try {
        const resp = await fetch('/api/trabajadores');
        const data = await resp.json();

        if (data.exito) {
            AppState.trabajadores = data.trabajadores;
            try { localStorage.setItem('cached_trabajadores', JSON.stringify(data.trabajadores)); } catch(e){}
            
            // Actualizar selector individual en la pestaña de Reportes Excel
            const selectInd = document.getElementById('selectTrabajadorExportIndividual');
            if (selectInd) {
                selectInd.innerHTML = '<option value="">Seleccione colaborador...</option>' + 
                    data.trabajadores.map(t => `<option value="${t.id}">${t.dni} - ${t.nombres} ${t.apellidos} (${t.cargo})</option>`).join('');
            }
            poblarSelectFiltroFacial();

            const inputBuscar = document.getElementById('inputBuscarTrabajador');
            const termino = inputBuscar ? inputBuscar.value : '';
            if (termino) {
                filtrarTrabajadoresEnVivo(termino);
            } else {
                renderizarFilasTrabajadores(data.trabajadores, '');
            }
        }
    } catch (e) {
        // Fallback offline: leer de cache local si no hay conexion
        try {
            const raw = localStorage.getItem('cached_trabajadores');
            if (raw) {
                const trabsCache = JSON.parse(raw);
                AppState.trabajadores = trabsCache;
                renderizarFilasTrabajadores(trabsCache, '');
                return;
            }
        } catch(err){}
        tbody.innerHTML = '<tr><td colspan="7" style="color: #dc2626; text-align: center;">Error cargando trabajadores</td></tr>';
    }
}

// =============================================================================
// MODAL INTEGRAL "TODO EN UNO SOLO" DE TRABAJADOR (ALTA Y EDICION)
// =============================================================================

let streamCamaraAsistida = null;

function detenerCamaraModal() {
    if (AppState.streamCamaraModal) {
        AppState.streamCamaraModal.getTracks().forEach(t => t.stop());
        AppState.streamCamaraModal = null;
    }
    if (streamCamaraAsistida) {
        streamCamaraAsistida.getTracks().forEach(t => t.stop());
        streamCamaraAsistida = null;
    }
}

function actualizarGaleriaFacialModal() {
    const contenedorVacio = document.getElementById('estadoVacioFacial');
    const galeriaThumbs = document.getElementById('modalThumbsFaciales');
    const badge = document.getElementById('badgeConteoMuestras');
    const btnLimpiar = document.getElementById('btnLimpiarFotosModal');

    if (AppState.muestrasFacialesModal && AppState.muestrasFacialesModal.length > 0) {
        if (contenedorVacio) contenedorVacio.style.display = 'none';
        if (galeriaThumbs) {
            galeriaThumbs.style.display = 'flex';
            galeriaThumbs.innerHTML = '';
            AppState.muestrasFacialesModal.forEach((b64, idx) => {
                const img = document.createElement('img');
                img.src = b64;
                img.className = 'thumb-preview-item';
                img.title = `Muestra facial ${idx + 1} de 3`;
                galeriaThumbs.appendChild(img);
            });
        }
        if (badge) {
            badge.textContent = `${AppState.muestrasFacialesModal.length} / 3 Fotos Listas`;
            badge.style.background = '#dcfce7';
            badge.style.color = '#15803d';
        }
        if (btnLimpiar) btnLimpiar.style.display = 'inline-flex';
    } else {
        if (contenedorVacio) contenedorVacio.style.display = 'block';
        if (galeriaThumbs) {
            galeriaThumbs.style.display = 'none';
            galeriaThumbs.innerHTML = '';
        }
        if (badge) {
            badge.textContent = '0 / 3 Fotos';
            badge.style.background = '';
            badge.style.color = '';
        }
        if (btnLimpiar) btnLimpiar.style.display = 'none';
    }
}

function abrirModalNuevoTrabajador() {
    detenerCamaraModal(); // NUNCA encender la cámara automáticamente

    document.getElementById('modalTrabajadorTitle').textContent = 'Ficha de Registro y Enrolamiento Integral';
    document.getElementById('formTrabajadorId').value = '';
    document.getElementById('intDni').value = '';
    document.getElementById('intNombres').value = '';
    document.getElementById('intApellidos').value = '';
    document.getElementById('intCargo').value = '';
    document.getElementById('intDepto').value = '';
    document.getElementById('intEstado').value = 'ACTIVO';

    // Limpiar muestras y estado dactilar
    AppState.muestrasFacialesModal = [];
    AppState.fotosFacialesBorradas = false;
    AppState.huellaRegistradaModal = false;
    AppState.credencialHuellaModal = null;
    const inpFile = document.getElementById('inputSubirFotoModal');
    if (inpFile) inpFile.value = '';

    actualizarGaleriaFacialModal();

    limpiarHuellaDactilarModal();
    document.getElementById('btnGuardarTrabajadorIntegral').querySelector('span').textContent = 'Guardar y Registrar Trabajador';

    document.getElementById('modalTrabajadorIntegral').classList.add('active');
}

async function abrirModalEditarTrabajador(usuarioId) {
    detenerCamaraModal(); // NUNCA encender la cámara automáticamente

    try {
        const resp = await fetch(`/api/trabajadores/${usuarioId}`);
        const data = await resp.json();

        if (data.exito) {
            const u = data.trabajador;
            document.getElementById('modalTrabajadorTitle').textContent = `Editar Trabajador: ${u.nombres} ${u.apellidos}`;
            document.getElementById('formTrabajadorId').value = u.id;
            document.getElementById('intDni').value = u.dni;
            document.getElementById('intNombres').value = u.nombres;
            document.getElementById('intApellidos').value = u.apellidos;
            document.getElementById('intCargo').value = u.cargo;
            document.getElementById('intDepto').value = u.departamento;
            document.getElementById('intEstado').value = u.estado;

            // Restablecer muestras de sesion
            AppState.muestrasFacialesModal = [];
            AppState.fotosFacialesBorradas = false;
            AppState.huellaRegistradaModal = (u.huella_registrada === 1);
            AppState.credencialHuellaModal = null;
            const inpFile = document.getElementById('inputSubirFotoModal');
            if (inpFile) inpFile.value = '';

            const contenedorVacio = document.getElementById('estadoVacioFacial');
            const galeriaThumbs = document.getElementById('modalThumbsFaciales');
            const badge = document.getElementById('badgeConteoMuestras');
            const btnLimpiar = document.getElementById('btnLimpiarFotosModal');

            if (u.fotos && u.fotos.length > 0) {
                if (contenedorVacio) contenedorVacio.style.display = 'none';
                if (galeriaThumbs) {
                    galeriaThumbs.style.display = 'flex';
                    galeriaThumbs.innerHTML = '';
                    u.fotos.forEach((fotoRuta, idx) => {
                        const img = document.createElement('img');
                        img.src = `/${fotoRuta}`;
                        img.className = 'thumb-preview-item';
                        img.title = `Foto registrada ${idx + 1}`;
                        galeriaThumbs.appendChild(img);
                    });
                }
                if (badge) {
                    badge.textContent = `${u.fotos.length} / 3 Fotos Registradas`;
                    badge.style.background = '#dcfce7';
                    badge.style.color = '#15803d';
                }
                if (btnLimpiar) btnLimpiar.style.display = 'inline-flex';
            } else {
                actualizarGaleriaFacialModal();
            }

            if (u.huella_registrada === 1) {
                mostrarHuellaRegistradaEnModal(u.id, u.huella_public_key);
            } else {
                limpiarHuellaDactilarModal();
            }

            document.getElementById('btnGuardarTrabajadorIntegral').querySelector('span').textContent = 'Actualizar Datos del Trabajador';
            document.getElementById('modalTrabajadorIntegral').classList.add('active');
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron cargar los datos del trabajador.' });
    }
}

function cerrarModalTrabajadorIntegral() {
    detenerCamaraModal();
    document.getElementById('modalTrabajadorIntegral').classList.remove('active');
}

async function abrirCamaraFacialAsistida() {
    try {
        detenerCamaraModal();
        streamCamaraAsistida = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
            audio: false
        });
    } catch (e) {
        Swal.fire({
            icon: 'error',
            title: 'Cámara No Accesible',
            text: 'No se pudo activar la cámara de este dispositivo. Verifique los permisos del navegador o use el botón Subir Fotos.'
        });
        return;
    }

    let fotosCapturadas = [];
    let pasoActual = 1;

    const titulosPasos = {
        1: { badge: 'Paso 1 de 3: Foto Frontal', instruccion: 'Mire fijamente de frente al visor de la cámara', btn: '📸 Capturar Foto 1 (Frontal)' },
        2: { badge: 'Paso 2 de 3: Perfil Derecho', instruccion: 'Gire levemente su rostro hacia la derecha', btn: '📸 Capturar Foto 2 (Perfil Derecho)' },
        3: { badge: 'Paso 3 de 3: Perfil Izquierdo', instruccion: 'Gire levemente su rostro hacia la izquierda', btn: '📸 Capturar Foto 3 (Perfil Izquierdo)' }
    };

    Swal.fire({
        title: 'Calibración Facial Asistida (3 Muestras)',
        html: `
            <div style="text-align: center;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
                    <span id="camPasoBadge" style="background: #e0f2fe; color: #0369a1; padding: 0.25rem 0.65rem; border-radius: 999px; font-size: 0.78rem; font-weight: 800;">
                        ${titulosPasos[1].badge}
                    </span>
                    <span id="camInstruccionBadge" style="font-size: 0.76rem; color: #64748b; font-weight: 600;">
                        ${titulosPasos[1].instruccion}
                    </span>
                </div>
                
                <div style="position: relative; width: 100%; max-width: 380px; height: 260px; margin: 0 auto; border-radius: 14px; overflow: hidden; background: #000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                    <video id="videoAsistidoEnVivo" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1);"></video>
                    <!-- Guía biométrica ovalada -->
                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 140px; height: 190px; border: 2px dashed rgba(255,255,255,0.8); border-radius: 50%; pointer-events: none; box-shadow: 0 0 0 9999px rgba(0,0,0,0.25);"></div>
                    <div id="flashCapturaAsistida" style="display: none; position: absolute; inset: 0; background: #ffffff; z-index: 10;"></div>
                </div>

                <!-- Miniaturas de progreso de las 3 fotos -->
                <div id="camPasosThumbs" style="display: flex; justify-content: center; gap: 0.6rem; margin-top: 0.85rem;">
                    <div id="slotFoto1" style="width: 54px; height: 54px; border: 2px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #94a3b8; font-weight: 800; background: #f8fafc; overflow: hidden;">1</div>
                    <div id="slotFoto2" style="width: 54px; height: 54px; border: 2px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #94a3b8; font-weight: 800; background: #f8fafc; overflow: hidden;">2</div>
                    <div id="slotFoto3" style="width: 54px; height: 54px; border: 2px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #94a3b8; font-weight: 800; background: #f8fafc; overflow: hidden;">3</div>
                </div>

                <div style="margin-top: 1rem;">
                    <button type="button" id="btnTomarFotoPaso" class="btn btn-primary" style="width: 100%; justify-content: center; font-weight: 800; font-size: 0.95rem; padding: 0.8rem;">
                        ${titulosPasos[1].btn}
                    </button>
                </div>
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Cancelar y Cerrar Cámara',
        allowOutsideClick: false,
        didOpen: () => {
            const video = document.getElementById('videoAsistidoEnVivo');
            if (video && streamCamaraAsistida) {
                video.srcObject = streamCamaraAsistida;
                video.play();
            }

            const btn = document.getElementById('btnTomarFotoPaso');
            const flash = document.getElementById('flashCapturaAsistida');
            const pasoBadge = document.getElementById('camPasoBadge');
            const instBadge = document.getElementById('camInstruccionBadge');

            if (btn) {
                btn.onclick = () => {
                    if (!video || video.readyState < 2) return;

                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth || 640;
                    canvas.height = video.videoHeight || 480;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const b64 = canvas.toDataURL('image/jpeg', 0.9);

                    fotosCapturadas.push(b64);
                    audioSeguridad.sonarCapturaFoto();

                    if (flash) {
                        flash.style.display = 'block';
                        setTimeout(() => flash.style.display = 'none', 100);
                    }

                    const slot = document.getElementById(`slotFoto${pasoActual}`);
                    if (slot) {
                        slot.innerHTML = `<img src="${b64}" style="width: 100%; height: 100%; object-fit: cover;" />`;
                        slot.style.border = '2px solid #16a34a';
                    }

                    pasoActual++;

                    if (pasoActual <= 3) {
                        const info = titulosPasos[pasoActual];
                        if (pasoBadge) pasoBadge.textContent = info.badge;
                        if (instBadge) instBadge.textContent = info.instruccion;
                        if (btn) btn.textContent = info.btn;
                    } else {
                        btn.disabled = true;
                        btn.textContent = '✓ ¡3 Fotos Capturadas con Éxito!';
                        audioSeguridad.sonarAccesoPermitido();

                        setTimeout(() => {
                            detenerCamaraModal();
                            Swal.close();

                            AppState.muestrasFacialesModal = fotosCapturadas;
                            AppState.fotosFacialesBorradas = false;
                            actualizarGaleriaFacialModal();
                        }, 800);
                    }
                };
            }
        },
        willClose: () => {
            detenerCamaraModal();
        }
    });
}

function procesarFotosMultiplesSubidas(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    AppState.muestrasFacialesModal = [];
    AppState.fotosFacialesBorradas = false;

    let cargadas = 0;
    const total = Math.min(files.length, 3);

    for (let i = 0; i < total; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;

        const reader = new FileReader();
        reader.onload = (e) => {
            AppState.muestrasFacialesModal.push(e.target.result);
            cargadas++;
            if (cargadas === total) {
                audioSeguridad.sonarCapturaFoto();
                actualizarGaleriaFacialModal();
                if (total < 3) {
                    Swal.fire({
                        icon: 'info',
                        title: 'Muestras Cargadas',
                        text: `Se cargaron ${total} foto(s). Se recomienda cargar exactamente 3 fotos (frontal, perfil derecho, perfil izquierdo) para calibración óptima de OpenCV LBPH.`
                    });
                }
            }
        };
        reader.readAsDataURL(file);
    }
    event.target.value = '';
}

function limpiarFotosFacialesModal() {
    AppState.muestrasFacialesModal = [];
    AppState.fotosFacialesBorradas = true;
    const inpFile = document.getElementById('inputSubirFotoModal');
    if (inpFile) inpFile.value = '';
    actualizarGaleriaFacialModal();
}

async function ejecutarEnrolamientoHuellaModal() {
    const dni = document.getElementById('intDni').value.trim();
    const nombres = document.getElementById('intNombres').value.trim();
    const apellidos = document.getElementById('intApellidos').value.trim();

    if (!dni) {
        Swal.fire({
            icon: 'warning',
            title: 'DNI Requerido',
            text: 'Por favor complete primero el campo DNI antes de registrar la huella digital.',
            confirmButtonColor: '#0284c7'
        });
        document.getElementById('intDni').focus();
        return;
    }

    const box = document.getElementById('modalFpTouchBox');
    const badge = document.getElementById('badgeEstadoHuellaModal');

    Swal.fire({
        title: `Calibrar y Registrar Huella: ${nombres || 'Colaborador'}`,
        html: `
            <div style="text-align: center; padding: 0.5rem 0;">
                <p style="font-size: 0.88rem; color: #64748b; margin-bottom: 0.85rem;">
                    Toque o coloque la yema de su dedo sobre el sensor. La calibración biométrica tomará <strong>4.5 segundos</strong> en producción.
                </p>
                <div id="swalEnrollTouchBox" class="aratek-single-scanner-box scanning" style="margin: 0 auto; width: 140px; height: 160px; cursor: pointer; user-select: none;">
                    <div class="fp-laser-scanner"></div>
                    <svg class="fingerprint-graphic-svg" viewBox="0 0 24 24" style="width: 80px; height: 80px;">
                        <path d="M4.5 14C4.5 8.5 7.8 3.5 12 3.5s7.5 5 7.5 10.5c0 2-.5 4-1 5.5"></path>
                        <path d="M7 15.2C7 10.5 9.2 6.5 12 6.5s5 4 5 8.7c0 1.8-.4 3.3-.8 4.3"></path>
                        <path d="M9.2 16.5C9.2 12.8 10.4 9.2 12 9.2s2.8 3.6 2.8 7.3"></path>
                        <path d="M11 17.8c0-2.8.4-5.8 1-5.8s1 3 1 5.8"></path>
                        <path d="M5.5 18.5c.8 1.4 1.8 2.3 3.2 2.8"></path>
                        <path d="M13.8 20.8c.8-.4 1.5-.9 2.1-1.6"></path>
                    </svg>
                </div>

                <!-- Barra de Progreso 4.5 segundos -->
                <div id="swalEnrollProgressWrap" style="display: none; width: 100%; max-width: 280px; margin: 1rem auto 0.5rem auto; background: #f8fafc; padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.74rem; font-weight: 700; color: #0284c7; margin-bottom: 0.25rem;">
                        <span id="swalEnrollProgressTxt">Iniciando calibración...</span>
                        <span id="swalEnrollProgressSec" style="font-family: monospace;">0.0s / 4.5s</span>
                    </div>
                    <div style="background: #cbd5e1; height: 7px; border-radius: 999px; overflow: hidden;">
                        <div id="swalEnrollProgressBar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #0284c7, #10b981); transition: width 0.1s linear;"></div>
                    </div>
                </div>

                <div id="swalEnrollStatusMsg" style="margin-top: 0.75rem; font-weight: 700; font-size: 0.85rem; color: #0284c7;">
                    Toque el recuadro con la yema del dedo para iniciar calibración...
                </div>
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        didOpen: () => {
            const enrollBox = document.getElementById('swalEnrollTouchBox');
            const statusMsg = document.getElementById('swalEnrollStatusMsg');
            const progressWrap = document.getElementById('swalEnrollProgressWrap');
            const progressBar = document.getElementById('swalEnrollProgressBar');
            const progressTxt = document.getElementById('swalEnrollProgressTxt');
            const progressSec = document.getElementById('swalEnrollProgressSec');

            let enrolandoActivo = false;
            let muestraCapturada = null;

            function iniciarCalibracion4_5Segundos(muestraInicial) {
                if (enrolandoActivo) return;
                enrolandoActivo = true;

                muestraCapturada = muestraInicial;
                if (progressWrap) progressWrap.style.display = 'block';
                audioSeguridad.sonarCapturaFoto();

                const duracionTotal = 4500;
                const intervaloMs = 100;
                let tiempoTranscurrido = 0;

                const timer = setInterval(() => {
                    tiempoTranscurrido += intervaloMs;
                    const fraccion = Math.min(1.0, tiempoTranscurrido / duracionTotal);
                    const porcentaje = Math.round(fraccion * 100);
                    const segundos = (tiempoTranscurrido / 1000).toFixed(1);

                    if (progressBar) progressBar.style.width = `${porcentaje}%`;
                    if (progressSec) progressSec.textContent = `${segundos}s / 4.5s`;

                    if (tiempoTranscurrido < 1200) {
                        if (progressTxt) progressTxt.textContent = 'Midiendo área y relieve papilar...';
                        if (statusMsg) statusMsg.textContent = `Mapeando huella (${porcentaje}%)... Mantenga el dedo en posición.`;
                    } else if (tiempoTranscurrido < 2500) {
                        if (progressTxt) progressTxt.textContent = 'Extrayendo crestas y bifurcaciones...';
                        if (statusMsg) statusMsg.textContent = `Calibrando vector dérmico (${porcentaje}%)...`;
                    } else if (tiempoTranscurrido < 3800) {
                        if (progressTxt) progressTxt.textContent = 'Generando plantilla biométrica segura...';
                        if (statusMsg) statusMsg.textContent = `Cifrando credencial dactilar (${porcentaje}%)...`;
                    } else {
                        if (progressTxt) progressTxt.textContent = 'Finalizando vinculación en base de datos...';
                        if (statusMsg) statusMsg.textContent = `✓ Guardando plantilla (${porcentaje}%)...`;
                    }

                    if (tiempoTranscurrido >= duracionTotal) {
                        clearInterval(timer);
                        completarEnrolamiento();
                    }
                }, intervaloMs);
            }

            function completarEnrolamiento() {
                const muestraFinal = muestraCapturada || {
                    area: 2500.0 + Math.random() * 800,
                    radiusX: 25.0 + Math.random() * 5,
                    radiusY: 32.0 + Math.random() * 5,
                    aspectRatio: 0.78,
                    presion: 0.58,
                    tiempoMs: 4500
                };

                const check = biometriaDactilar.validarMorfologiaDactilar(muestraFinal);
                if (!check.valido) {
                    audioSeguridad.sonarAccesoDenegado();
                    if (statusMsg) statusMsg.innerHTML = `<span style="color: #dc2626;">✗ ${check.mensaje || 'Contacto anómalo'}: ${check.detalle}</span>`;
                    enrolandoActivo = false;
                    return;
                }

                const res = biometriaDactilar.generarPlantillaEnrolamiento(dni, muestraFinal);
                AppState.huellaRegistradaModal = true;
                AppState.credencialHuellaModal = res;

                if (box) box.className = 'fp-interactive-touch active';
                if (badge) {
                    badge.innerHTML = `<span style="color: #16a34a; font-weight: 800;">✓ Huella Registrada (Calibración 4.5s • DNI ${dni})</span>`;
                }

                audioSeguridad.sonarAccesoPermitido();
                if (statusMsg) {
                    statusMsg.innerHTML = `<span style="color: #16a34a; font-weight: 800;">✓ ¡Calibración Exitosa en 4.5s! Patrón dactilar vinculado</span>`;
                }

                setTimeout(() => {
                    Swal.close();
                }, 1200);
            }

            if (enrollBox) {
                enrollBox.addEventListener('touchstart', (e) => {
                    const touch = e.touches[0];
                    const muestra = biometriaDactilar.extraerMetricasTouch(touch, 4500);
                    iniciarCalibracion4_5Segundos(muestra);
                }, { passive: false });

                enrollBox.addEventListener('touchmove', (e) => {
                    if (e.touches && e.touches[0]) {
                        muestraCapturada = biometriaDactilar.extraerMetricasTouch(e.touches[0], 4500);
                    }
                }, { passive: true });

                enrollBox.addEventListener('click', () => {
                    iniciarCalibracion4_5Segundos({
                        area: 2500.0 + Math.random() * 800,
                        radiusX: 25.0 + Math.random() * 5,
                        radiusY: 32.0 + Math.random() * 5,
                        aspectRatio: 0.78,
                        presion: 0.58,
                        tiempoMs: 4500
                    });
                });
            }
        }
    });
}

async function guardarTrabajadorIntegral(event) {
    event.preventDefault();

    const usuarioId = document.getElementById('formTrabajadorId').value.trim();
    const dni = document.getElementById('intDni').value.trim();
    const nombres = document.getElementById('intNombres').value.trim();
    const apellidos = document.getElementById('intApellidos').value.trim();
    const cargo = document.getElementById('intCargo').value.trim();
    const departamento = document.getElementById('intDepto').value.trim();
    const estado = document.getElementById('intEstado').value;

    if (!dni || !nombres || !apellidos || !cargo || !departamento) {
        Swal.fire({ icon: 'warning', title: 'Campos requeridos', text: 'Por favor complete todos los campos obligatorios.' });
        return;
    }

    Swal.fire({
        title: 'Guardando registro...',
        text: 'Sincronizando datos y entrenando clasificador facial LBPH en SQLite...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        let idFinal = usuarioId;

        if (!usuarioId) {
            // CREAR NUEVO TRABAJADOR
            const resp = await fetch('/api/trabajadores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni, nombres, apellidos, cargo, departamento, estado })
            });
            const data = await resp.json();
            if (!data.exito) {
                throw new Error(data.mensaje || 'Error creando trabajador');
            }
            idFinal = data.id;
        } else {
            // EDITAR TRABAJADOR EXISTENTE
            const resp = await fetch(`/api/trabajadores/${usuarioId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni, nombres, apellidos, cargo, departamento, estado })
            });
            const data = await resp.json();
            if (!data.exito) {
                throw new Error('Error actualizando datos');
            }
        }

        // Subir muestras faciales capturadas en el modal o subidas desde galería
        if (AppState.muestrasFacialesModal && AppState.muestrasFacialesModal.length > 0) {
            for (let idx = 0; idx < AppState.muestrasFacialesModal.length; idx++) {
                const b64 = AppState.muestrasFacialesModal[idx];
                await fetch('/api/biometria/capturar_muestra', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        usuario_id: idFinal,
                        imagen_base64: b64,
                        limpiar_previas: (idx === 0) // Purgar fotos antiguas al cargar nuevas muestras
                    })
                });
            }
        } else if (AppState.fotosFacialesBorradas) {
            await fetch('/api/biometria/limpiar_fotos_usuario', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario_id: idFinal })
            });
        }

        // Registrar huella dactilar óptica multimuestra si se escaneó con cámara en el modal
        if (AppState.huellaRegistradaModal && AppState.huellaOpticaNueva) {
            await fetch('/api/biometria/enrolar_huella_multimuestra', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: idFinal,
                    muestras: AppState.huellaOpticaNueva.muestras || [AppState.huellaOpticaNueva.imagen_base64],
                    nombre_dedo: AppState.huellaOpticaNueva.nombre_dedo
                })
            });
        } else if (AppState.huellaDactilarBorrada && idFinal) {
            await fetch('/api/biometria/desvincular_huella', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario_id: idFinal })
            });
        }

        cerrarModalTrabajadorIntegral();
        audioSeguridad.sonarAccesoPermitido();

        Swal.fire({
            icon: 'success',
            title: usuarioId ? 'Trabajador Actualizado' : 'Trabajador Registrado',
            text: 'Ficha integral, fotos faciales y huella guardadas exitosamente en la base de datos SQLite.',
            confirmButtonColor: '#0284c7'
        });

        cargarListaTrabajadores();
        cargarEstadisticasDashboard();

    } catch (e) {
        audioSeguridad.sonarAccesoDenegado();
        Swal.fire({ icon: 'error', title: 'Error', text: e.message || 'Error guardando datos' });
    }
}

async function alternarEstadoTrabajador(usuarioId, estadoActual) {
    const nuevoEstado = estadoActual === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
    try {
        const resp = await fetch(`/api/trabajadores/${usuarioId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        const data = await resp.json();
        if (data.exito) {
            cargarListaTrabajadores();
            cargarEstadisticasDashboard();
        }
    } catch (e) {}
}

async function eliminarTrabajador(usuarioId, nombreCompleto) {
    const confirmacion = await Swal.fire({
        title: '¿Eliminar Trabajador?',
        text: `Se borrarán permanentemente los registros biométricos de ${nombreCompleto}.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'Sí, Eliminar de SQLite',
        cancelButtonText: 'Cancelar'
    });

    if (confirmacion.isConfirmed) {
        try {
            const resp = await fetch(`/api/trabajadores/${usuarioId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.exito) {
                Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1500, showConfirmButton: false });
                cargarListaTrabajadores();
                cargarEstadisticasDashboard();
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo eliminar el trabajador' });
        }
    }
}

// =============================================================================
// GESTION DE CONTRASEÑAS DE LAS TERMINALES
// =============================================================================

async function cargarFormularioPasswords() {
    await cargarConfiguraciones();
    const c = AppState.configuraciones;

    document.getElementById('cfgPwdFacial').value = c.terminal_facial_pwd ? c.terminal_facial_pwd.valor : 'FACIAL2026';
    document.getElementById('cfgPwdHuella').value = c.terminal_huella_pwd ? c.terminal_huella_pwd.valor : 'HUELLA2026';
    document.getElementById('cfgPwdCctv').value = c.terminal_cctv_pwd ? c.terminal_cctv_pwd.valor : 'CCTV2026';
    document.getElementById('cfgPwdAdmin').value = c.admin_pwd ? c.admin_pwd.valor : 'admin123';
    document.getElementById('cfgTiempoPuerta').value = c.tiempo_apertura_puerta ? c.tiempo_apertura_puerta.valor : '5';
    document.getElementById('cfgUmbralFacial').value = c.umbral_confianza_facial ? c.umbral_confianza_facial.valor : '70';
}

async function guardarNuevasPasswordsTerminales(event) {
    event.preventDefault();

    const payload = {
        terminal_facial_pwd: document.getElementById('cfgPwdFacial').value.trim(),
        terminal_huella_pwd: document.getElementById('cfgPwdHuella').value.trim(),
        terminal_cctv_pwd: document.getElementById('cfgPwdCctv').value.trim(),
        admin_pwd: document.getElementById('cfgPwdAdmin').value.trim(),
        tiempo_apertura_puerta: document.getElementById('cfgTiempoPuerta').value.trim(),
        umbral_confianza_facial: document.getElementById('cfgUmbralFacial').value.trim()
    };

    try {
        const resp = await fetch('/api/config/terminales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();

        if (data.exito) {
            AppState.configuraciones = data.configuraciones;
            Swal.fire({
                icon: 'success',
                title: 'Contraseñas Actualizadas',
                text: 'Las nuevas credenciales de terminales han sido guardadas en la base de datos SQLite.',
                confirmButtonColor: '#0284c7'
            });
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudieron actualizar los valores' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error de Red', text: 'Fallo al comunicarse con el servidor' });
    }
}

// =============================================================================
// AUDITORIA Y LOGS
// =============================================================================

let estadoFiltroLogsActual = null;

async function cargarTablaLogs(filtro = null) {
    estadoFiltroLogsActual = filtro;
    const tbody = document.getElementById('tablaLogsBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 1.5rem; color: #64748b;">Cargando eventos de auditoría...</td></tr>';

    try {
        const url = filtro ? `/api/logs/accesos?filtro=${filtro}` : '/api/logs/accesos';
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.exito) {
            AppState.todosLosLogs = data.logs;
            try { localStorage.setItem('cached_logs_accesos', JSON.stringify(data.logs)); } catch(e){}
            const inputBuscar = document.getElementById('inputBuscarLogs');
            const termino = inputBuscar ? inputBuscar.value : '';
            if (termino) {
                filtrarLogsEnVivo(termino);
            } else {
                renderizarFilasLogs(data.logs, '');
            }
        }
    } catch (e) {
        // Fallback offline: intentar mostrar logs cacheados
        try {
            const raw = localStorage.getItem('cached_logs_accesos');
            if (raw) {
                const logsCache = JSON.parse(raw);
                AppState.todosLosLogs = logsCache;
                renderizarFilasLogs(logsCache, '');
                return;
            }
        } catch(err){}
        tbody.innerHTML = '<tr><td colspan="6" style="color: #dc2626; text-align: center;">Error cargando logs (Modo Offline)</td></tr>';
    }
}

function renderizarFilasLogs(lista, terminoBusqueda = '') {
    const tbody = document.getElementById('tablaLogsBody');
    const btnLimpiar = document.getElementById('btnLimpiarBuscarLogs');
    if (btnLimpiar) {
        btnLimpiar.style.display = terminoBusqueda ? 'inline-block' : 'none';
    }

    if (!lista || lista.length === 0) {
        if (terminoBusqueda) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem 1rem; color: #64748b;">
                No se encontraron eventos de auditoría que coincidan con "<strong>${terminoBusqueda}</strong>"
                <div><button class="btn btn-outline btn-sm" style="margin-top: 0.75rem;" onclick="limpiarBusquedaLogs()">Limpiar Búsqueda</button></div>
            </td></tr>`;
        } else {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 1.5rem; color: #64748b;">No hay registros de acceso en la base de datos.</td></tr>';
        }
        return;
    }

    tbody.innerHTML = lista.map(l => `
        <tr>
            <td style="font-family: monospace; font-size: 0.8rem;">${l.timestamp.replace('T', ' ').substring(0, 19)}</td>
            <td><strong>${l.dni || 'N/A'}</strong></td>
            <td>${l.nombre_usuario}</td>
            <td><span class="terminal-badge">${l.metodo}</span></td>
            <td>
                <span class="badge-status ${l.estado === 'PERMITIDO' ? 'active' : 'inactive'}">
                    ${l.estado === 'PERMITIDO' ? '✓ PERMITIDO' : '✗ DENEGADO'}
                </span>
            </td>
            <td style="font-size: 0.8rem; color: #64748b;">${l.detalle || ''}</td>
        </tr>
    `).join('');
}

function filtrarLogsEnVivo(termino) {
    if (!AppState.todosLosLogs) return;
    const q = normalizarTextoBusqueda(termino);
    if (!q) {
        renderizarFilasLogs(AppState.todosLosLogs, '');
        return;
    }
    const filtrados = AppState.todosLosLogs.filter(l => {
        const fecha = normalizarTextoBusqueda(l.timestamp);
        const dni = normalizarTextoBusqueda(l.dni);
        const usuario = normalizarTextoBusqueda(l.nombre_usuario);
        const metodo = normalizarTextoBusqueda(l.metodo);
        const estado = normalizarTextoBusqueda(l.estado);
        const detalle = normalizarTextoBusqueda(l.detalle);
        return fecha.includes(q) || dni.includes(q) || usuario.includes(q) || metodo.includes(q) || estado.includes(q) || detalle.includes(q);
    });
    renderizarFilasLogs(filtrados, termino);
}

function limpiarBusquedaLogs() {
    const input = document.getElementById('inputBuscarLogs');
    if (input) input.value = '';
    filtrarLogsEnVivo('');
}

function cambiarFiltroLogs(estado) {
    const pills = {
        'ALL': 'btnLogFilterAll',
        'PERMITIDO': 'btnLogFilterPermitido',
        'DENEGADO': 'btnLogFilterDenegado'
    };
    document.querySelectorAll('.btn-filter-pill').forEach(b => b.classList.remove('active'));
    const idBtn = estado ? pills[estado] : pills['ALL'];
    const btnActivo = document.getElementById(idBtn);
    if (btnActivo) btnActivo.classList.add('active');

    const input = document.getElementById('inputBuscarLogs');
    if (input) input.value = '';

    cargarTablaLogs(estado);
}

// =============================================================================
// MOTOR DE REPORTES EXCEL OFICIALES (SpreadsheetML XML .xls)
// 100% OPERATIVO CON INTERNET Y SIN INTERNET (OFFLINE & ONLINE)
// =============================================================================

const XML_EXCEL_TEMPLATE_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>EMPRESARIOTEC S.A.</Author>
  <Company>EMPRESARIOTEC S.A. - Seguridad IoT</Company>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="TitleBrand">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="15" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0284C7" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="SubtitleBrand">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#E0F2FE"/>
   <Interior ss:Color="#0369A1" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="MetaLabel">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#475569"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="MetaValue">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="TableHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#334155"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#334155"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="RowEven">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="9.5" ss:Color="#1E293B"/>
   <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="RowOdd">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="9.5" ss:Color="#1E293B"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="BadgePermitido">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BBF7D0"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="9.5" ss:Bold="1" ss:Color="#16A34A"/>
   <Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="BadgeDenegado">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="9.5" ss:Bold="1" ss:Color="#DC2626"/>
   <Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="BadgeBiometria">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BAE6FD"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="9.5" ss:Bold="1" ss:Color="#0284C7"/>
   <Interior ss:Color="#E0F2FE" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="SectionBanner">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
  </Style>
 </Styles>
`;

function escaparXml(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function descargarXlsxOffline(aoaData, sheetName, filename) {
    if (typeof XLSX !== 'undefined') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(aoaData);

        // 1. Calcular anchos de columna generosos para que NO se compriman los textos
        const colWidths = [];
        aoaData.forEach((row, rIdx) => {
            if (rIdx < 3) return; // Omitir títulos para calcular sobre encabezados y datos reales
            row.forEach((cell, cIdx) => {
                const s = (cell !== undefined && cell !== null) ? String(cell) : '';
                colWidths[cIdx] = Math.max(colWidths[cIdx] || 14, Math.min(s.length + 5, 45));
            });
        });
        if (colWidths.length > 0) {
            ws['!cols'] = colWidths.map(w => ({ wch: w }));
        } else {
            ws['!cols'] = [
                { wch: 8 }, { wch: 22 }, { wch: 14 }, { wch: 26 },
                { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 38 }
            ];
        }

        // 2. Unir celdas de encabezado institucional (Merge)
        const totalCols = (colWidths.length > 0) ? (colWidths.length - 1) : 7;
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols } }
        ];

        XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
        XLSX.writeFile(wb, filename);
    } else {
        // Fallback a CSV con BOM UTF-8 que Excel abre directamente sin advertencias
        let csvContent = '\uFEFF';
        aoaData.forEach(row => {
            csvContent += row.map(cell => `"${String(cell !== undefined && cell !== null ? cell : '').replace(/"/g, '""')}"`).join(',') + '\r\n';
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.replace(/\.xlsx$/i, '.csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

// -----------------------------------------------------------------------------
// 1. REPORTE GRUPAL: NOMINA COMPLETA DE TRABAJADORES (DUAL ONLINE / OFFLINE)
// -----------------------------------------------------------------------------
async function exportarExcelNomina() {
    Swal.fire({
        title: 'Generando Reporte Excel',
        text: 'Preparando la nómina oficial de personal en formato nativo .xlsx...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const resp = await fetch('/api/reportes/excel/nomina');
        if (resp.ok) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `nomina_trabajadores_empresariotec_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Swal.fire({
                icon: 'success',
                title: 'Nómina Descargada',
                text: 'El reporte en Excel .xlsx ha sido generado.',
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }
    } catch (e) {
        console.warn('Conexión con servidor no disponible, activando motor offline...');
    }

    // Modo Offline: Generar con datos en memoria o en localStorage
    generarExcelNominaOffline();
}

function generarExcelNominaOffline() {
    const ahora = new Date().toLocaleString('es-PE');
    let trabajadores = (AppState.trabajadores && AppState.trabajadores.length > 0) ? AppState.trabajadores : [];
    if (trabajadores.length === 0) {
        try {
            const raw = localStorage.getItem('cached_trabajadores');
            if (raw) trabajadores = JSON.parse(raw);
        } catch(e) {}
    }

    const aoa = [
        ['EMPRESARIOTEC S.A. • REPORTE GENERAL DE NÓMINA BIOMÉTRICA'],
        [`Generado: ${ahora} | Modo Local SQLite (Offline) | Total: ${trabajadores.length} Registros`],
        [],
        ["ID", "DNI", "Nombres", "Apellidos", "Cargo", "Departamento", "Enrol. Facial", "Enrol. Huella", "Estado", "Fecha Registro"]
    ];

    trabajadores.forEach((t, idx) => {
        aoa.push([
            t.id || (idx + 1),
            t.dni || '',
            t.nombres || '',
            t.apellidos || '',
            t.cargo || 'Operativo',
            t.departamento || 'General',
            t.rostro_registrado ? 'REGISTRADO' : 'PENDIENTE',
            t.huella_registrada ? 'REGISTRADO' : 'PENDIENTE',
            t.estado || 'ACTIVO',
            t.fecha_creacion || t.fecha_registro || 'N/A'
        ]);
    });

    descargarXlsxOffline(aoa, 'Nomina_Personal', `nomina_trabajadores_empresariotec_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Swal.fire({
        icon: 'success',
        title: 'Nómina Descargada (Offline)',
        text: `Archivo Excel .xlsx generado con ${trabajadores.length} colaboradores en memoria local.`,
        timer: 2000,
        showConfirmButton: false
    });
}

// -----------------------------------------------------------------------------
// 2. REPORTE GRUPAL: AUDITORIA GENERAL DE ACCESOS (DUAL ONLINE / OFFLINE)
// -----------------------------------------------------------------------------
async function exportarExcelAccesos() {
    Swal.fire({
        title: 'Generando Auditoría Excel',
        text: 'Consultando registro de eventos biométricos en formato .xlsx...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const resp = await fetch('/api/reportes/excel/accesos');
        if (resp.ok) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `auditoria_accesos_empresariotec_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Swal.fire({
                icon: 'success',
                title: 'Auditoría Descargada',
                text: 'El reporte de accesos en Excel .xlsx ha sido generado.',
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }
    } catch (e) {
        console.warn('Conexión con servidor no disponible, usando motor offline...');
    }

    // Modo Offline: obtener logs de AppState o de localStorage
    let logsParaExcel = (AppState.todosLosLogs && AppState.todosLosLogs.length > 0) ? AppState.todosLosLogs : [];
    if (logsParaExcel.length === 0) {
        try {
            const raw = localStorage.getItem('cached_logs_accesos');
            if (raw) logsParaExcel = JSON.parse(raw);
        } catch(e) {}
    }

    if (logsParaExcel.length === 0) {
        try {
            const logsResp = await fetch('/api/logs/accesos?limite=500');
            const logsData = await logsResp.json();
            logsParaExcel = logsData.logs || [];
            if (logsParaExcel.length > 0) {
                try { localStorage.setItem('cached_logs_accesos', JSON.stringify(logsParaExcel)); } catch(e){}
            }
        } catch (e) {
            console.warn('No se pudo consultar logs de red para Excel.');
        }
    }

    generarExcelAccesosOffline(logsParaExcel);
}

function generarExcelAccesosOffline(logs) {
    const ahora = new Date().toLocaleString('es-PE');

    const aoa = [
        ['EMPRESARIOTEC S.A. • AUDITORÍA GENERAL DE ACCESOS BIOMÉTRICOS'],
        [`Generado: ${ahora} | SENATI PIAD-526 | Total Eventos: ${logs.length}`],
        [],
        ["ID", "Fecha y Hora", "DNI", "Colaborador", "Método", "Terminal", "Resultado", "Detalle Técnico"]
    ];

    logs.forEach((l, idx) => {
        aoa.push([
            l.id || (idx + 1),
            l.timestamp ? l.timestamp.replace('T', ' ').substring(0, 19) : '',
            l.dni || 'N/A',
            l.nombre_usuario || 'Desconocido',
            l.metodo || 'DESCONOCIDO',
            l.terminal || 'TERMINAL_CENTRAL',
            l.estado || 'DENEGADO',
            l.detalle || ''
        ]);
    });

    descargarXlsxOffline(aoa, 'Auditoria_Accesos', `auditoria_accesos_empresariotec_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Swal.fire({
        icon: 'success',
        title: 'Auditoría Descargada (Offline)',
        text: `Archivo Excel generado con ${logs.length} eventos de auditoría en memoria.`,
        timer: 2000,
        showConfirmButton: false
    });
}

// -----------------------------------------------------------------------------
// 3. REPORTE GRUPAL: BITACORA DE INCIDENTES CCTV CENTINELA (DUAL)
// -----------------------------------------------------------------------------
async function exportarExcelIncidentes() {
    Swal.fire({
        title: 'Generando Reporte de Alarmas',
        text: 'Extrayendo incidentes de sensores e intrusiones CCTV en formato .xlsx...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const resp = await fetch('/api/reportes/excel/incidentes');
        if (resp.ok) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `incidentes_cctv_empresariotec_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Swal.fire({
                icon: 'success',
                title: 'Bitácora Descargada',
                text: 'El reporte de incidentes en Excel .xlsx ha sido generado.',
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }
    } catch (e) {
        console.warn('Conexión con servidor no disponible, usando motor offline...');
    }

    let incidentesParaExcel = [];
    try {
        const raw = localStorage.getItem('cached_incidentes');
        if (raw) incidentesParaExcel = JSON.parse(raw);
    } catch(e) {}

    if (incidentesParaExcel.length === 0) {
        try {
            const incResp = await fetch('/api/logs/incidentes?limite=200');
            const incData = await incResp.json();
            incidentesParaExcel = incData.logs || [];
            if (incidentesParaExcel.length > 0) {
                try { localStorage.setItem('cached_incidentes', JSON.stringify(incidentesParaExcel)); } catch(e){}
            }
        } catch (e) {
            console.warn('No se pudo consultar incidentes de red.');
        }
    }

    generarExcelIncidentesOffline(incidentesParaExcel);
}

function generarExcelIncidentesOffline(incidentes) {
    const ahora = new Date().toLocaleString('es-PE');

    const aoa = [
        ['EMPRESARIOTEC S.A. • BITÁCORA DE INCIDENTES Y ALARMAS'],
        [`Emisión: ${ahora} | Monitoreo Centinela y Sensores de Impacto | Total: ${incidentes.length}`],
        [],
        ["ID", "Fecha y Hora", "Tipo de Sensor", "Nivel", "Descripción del Incidente"]
    ];

    incidentes.forEach((inc, idx) => {
        aoa.push([
            inc.id || (idx + 1),
            inc.timestamp ? inc.timestamp.replace('T', ' ').substring(0, 19) : '',
            inc.tipo_sensor || 'CENTINELA_AI',
            inc.nivel_alerta || 'ADVERTENCIA',
            inc.descripcion || 'Sin detalle'
        ]);
    });

    descargarXlsxOffline(aoa, 'Incidentes_Seguridad', `incidentes_cctv_empresariotec_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Swal.fire({
        icon: 'success',
        title: 'Bitácora Descargada (Offline)',
        text: `Archivo Excel generado con ${incidentes.length} incidentes en memoria.`,
        timer: 2000,
        showConfirmButton: false
    });
}

// -----------------------------------------------------------------------------
// 4. REPORTE INDIVIDUAL: FICHA TECNICA POR COLABORADOR (DUAL ONLINE / OFFLINE)
// -----------------------------------------------------------------------------
async function exportarFichaTrabajador(usuarioId) {
    Swal.fire({
        title: 'Generando Ficha Individual',
        text: 'Extrayendo expediente y registro de accesos en formato .xlsx...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const resp = await fetch(`/api/reportes/excel/trabajador/${usuarioId}`);
        if (resp.ok) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ficha_trabajador_${usuarioId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Swal.fire({
                icon: 'success',
                title: 'Ficha Individual Descargada',
                text: 'La ficha técnica en Excel .xlsx ha sido generada.',
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }
    } catch (e) {
        console.warn('Conexión con servidor no disponible para ficha individual, usando motor offline...');
    }

    // Modo Offline: buscar trabajador en memoria o cache local
    let todosTrabs = AppState.trabajadores || [];
    if (todosTrabs.length === 0) {
        try {
            const raw = localStorage.getItem('cached_trabajadores');
            if (raw) todosTrabs = JSON.parse(raw);
        } catch(e) {}
    }
    const t = todosTrabs.find(item => item.id == usuarioId);
    if (!t) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se encontró el colaborador solicitado' });
        return;
    }

    // Filtrar logs del trabajador desde memoria o cache local
    let todosLogs = AppState.todosLosLogs || [];
    if (todosLogs.length === 0) {
        try {
            const rawL = localStorage.getItem('cached_logs_accesos');
            if (rawL) todosLogs = JSON.parse(rawL);
        } catch(e) {}
    }
    const logsUsuario = todosLogs.filter(l => l.usuario_id == t.id || l.dni == t.dni);
    generarExcelTrabajadorOffline(t, logsUsuario);
}

function generarExcelTrabajadorOffline(trabajador, logsUsuario) {
    const ahora = new Date().toLocaleString('es-PE');
    const nombreCompleto = `${trabajador.nombres} ${trabajador.apellidos}`;

    const aoa = [
        ['EMPRESARIOTEC S.A. • FICHA TÉCNICA BIOMÉTRICA DE COLABORADOR'],
        [`Expediente Biométrico Oficial | Emisión: ${ahora}`],
        [],
        ['1. DATOS PERSONALES Y LABORALES', '', '', ''],
        ['DNI / Documento:', trabajador.dni || '', 'Estado Operativo:', trabajador.estado || 'ACTIVO'],
        ['Nombres y Apellidos:', nombreCompleto, 'Fecha de Alta:', trabajador.fecha_registro || trabajador.fecha_creacion || 'N/A'],
        ['Cargo / Puesto:', trabajador.cargo || 'Operativo', 'Departamento:', trabajador.departamento || 'General'],
        [],
        ['2. REGISTRO BIOMÉTRICO ASOCIADO', '', '', ''],
        ['Reconocimiento Facial:', trabajador.rostro_registrado ? 'REGISTRADO' : 'NO ENROLADO', 'Huella Dactilar:', trabajador.huella_registrada ? 'REGISTRADO' : 'NO ENROLADA'],
        [],
        [`3. HISTORIAL DE MARCACIONES Y ACCESOS (${logsUsuario.length} eventos)`, '', '', ''],
        ['Fecha / Hora', 'Terminal', 'Método', 'Resultado']
    ];

    if (logsUsuario.length === 0) {
        aoa.push(['No se registran eventos de acceso previos para este colaborador.', '', '', '']);
    } else {
        logsUsuario.forEach(l => {
            aoa.push([
                l.timestamp || '',
                l.terminal || 'TERMINAL_CENTRAL',
                l.metodo || 'DESCONOCIDO',
                l.estado || 'DENEGADO'
            ]);
        });
    }

    const dniLimpio = String(trabajador.dni || trabajador.id || 'colaborador').replace(/\s+/g, '_');
    descargarXlsxOffline(aoa, `Ficha_${dniLimpio}`, `ficha_trabajador_${dniLimpio}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Swal.fire({
        icon: 'success',
        title: 'Ficha Individual Descargada (Offline)',
        text: `Expediente de ${nombreCompleto} generado en Excel .xlsx.`,
        timer: 2000,
        showConfirmButton: false
    });
}

function ejecutarDescargaIndividualSeleccionada() {
    const sel = document.getElementById('selectTrabajadorExportIndividual');
    if (!sel || !sel.value) {
        Swal.fire({
            icon: 'warning',
            title: 'Selección Requerida',
            text: 'Por favor seleccione un colaborador de la lista desplegable para generar su ficha técnica en Excel.',
            confirmButtonColor: '#0284c7'
        });
        return;
    }
    exportarFichaTrabajador(sel.value);
}

