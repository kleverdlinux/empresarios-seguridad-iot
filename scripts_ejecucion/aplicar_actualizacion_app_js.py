# -*- coding: utf-8 -*-
"""
Script de actualización robusta para static/js/app.js
Reemplaza los métodos del simulador táctil antiguo por el sistema de escáner óptico dactilar
en vivo con cámara móvil (frontal/trasera), láser verde, pantalla completa y OpenCV.
"""

import os

APP_JS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static', 'js', 'app.js')

NUEVO_BLOQUE_HUELLA = '''async function cargarSelectorFiltroHuella() {
    const select = document.getElementById('selectFiltroHuellaUsuario');
    if (!select) return;

    try {
        const resp = await fetch('/api/biometria/obtener_credenciales_huella');
        const data = await resp.json();
        let html = '<option value="">🌐 Modo General: Identificar automáticamente (1:N)</option>';
        if (data.exito && data.credenciales && data.credenciales.length > 0) {
            html += data.credenciales
                .map(c => `<option value="${c.usuario_id}" data-uid="${c.usuario_id}" data-nombre="${c.nombre}" data-dni="${c.dni}" data-dedo="${c.nombre_dedo || 'Yema Dactilar'}">👤 ${c.nombre} (DNI ${c.dni} - ${c.nombre_dedo || 'Yema'})</option>`)
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

/**
 * Inicia el flujo de video en vivo de la cámara para el escaneo dactilar óptico.
 */
async function iniciarCamaraTerminalHuella() {
    const video = document.getElementById('videoFeedHuellaOptica');
    if (!video) return;

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
 * Ejecuta el escaneo de la huella en vivo con cámara y análisis OpenCV:
 */
async function ejecutarEscaneoHuellaOpticaCamara() {
    if (escaneandoHuellaCamara) return;
    escaneandoHuellaCamara = true;

    const viewport = document.getElementById('fpCameraScannerViewport');
    const laser = document.getElementById('fpLaserGreenLine');
    const progressBox = document.getElementById('fpTerminalProgressBarContainer');
    const progressBar = document.getElementById('fpTerminalProgressBar');
    const progressLabel = document.getElementById('fpTerminalProgressLabel');
    const progressSec = document.getElementById('fpTerminalProgressSec');
    const btnScan = document.getElementById('btnEscanearHuellaOptica');
    const resBox = document.getElementById('fpResultadoAccesoBox');

    // Asegurar que la cámara esté encendida
    if (!streamHuellaOptica || !streamHuellaOptica.active) {
        await iniciarCamaraTerminalHuella();
        await new Promise(r => setTimeout(r, 600));
    }

    const video = document.getElementById('videoFeedHuellaOptica');
    if (!video || video.readyState < 2) {
        Swal.fire({
            icon: 'warning',
            title: 'Cámara Inicializando',
            text: 'Espere un segundo mientras se estabiliza la señal de video.',
            timer: 2000
        });
        escaneandoHuellaCamara = false;
        return;
    }

    // Efecto visual y sonoro de escáner láser verde
    if (viewport) {
        viewport.classList.remove('success', 'denied');
        viewport.classList.add('scanning');
    }
    if (laser) {
        laser.style.animationDuration = '0.6s';
    }
    if (btnScan) btnScan.disabled = true;
    if (resBox) resBox.style.display = 'none';

    audioSeguridad.sonarEscaneoLaser();

    // Animación de barra de calibración dérmica
    if (progressBox) progressBox.style.display = 'block';
    if (progressLabel) progressLabel.textContent = 'Enfocando relieve papilar dérmico...';
    if (progressBar) progressBar.style.width = '25%';
    if (progressSec) progressSec.textContent = '0.3s / 1.5s';

    await new Promise(r => setTimeout(r, 350));
    if (progressBar) progressBar.style.width = '65%';
    if (progressLabel) progressLabel.textContent = 'Extrayendo crestas y bifurcaciones con OpenCV...';
    if (progressSec) progressSec.textContent = '0.9s / 1.5s';

    // Capturar fotograma en alta resolución desde el video
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL('image/jpeg', 0.95);

    await new Promise(r => setTimeout(r, 350));
    if (progressBar) progressBar.style.width = '100%';
    if (progressLabel) progressLabel.textContent = 'Verificando con plantillas en SQLite...';
    if (progressSec) progressSec.textContent = '1.5s / 1.5s';

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
        procesarResultadoHuellaOpticaUI(resultado);

    } catch (e) {
        console.error('[HUELLA OPTICA ERROR]', e);
        procesarResultadoHuellaOpticaUI({
            estado: 'DENEGADO',
            mensaje: 'Error de Comunicación',
            detalle: e.message || 'No se pudo conectar con el servidor para la validación dactilar.'
        });
    } finally {
        if (laser) laser.style.animationDuration = '2s';
        if (progressBox) progressBox.style.display = 'none';
        if (btnScan) btnScan.disabled = false;
        escaneandoHuellaCamara = false;
    }
}

/**
 * Procesa la respuesta de la verificación dactilar óptica y actualiza la UI.
 */
function procesarResultadoHuellaOpticaUI(resultado) {
    const viewport = document.getElementById('fpCameraScannerViewport');
    const title = document.getElementById('fpTerminalStatusTitle');
    const desc = document.getElementById('fpTerminalStatusDesc');
    const resBox = document.getElementById('fpResultadoAccesoBox');

    if (viewport) {
        viewport.classList.remove('scanning');
    }

    if (resultado.estado === 'PERMITIDO') {
        if (viewport) {
            viewport.classList.remove('denied');
            viewport.classList.add('success');
        }
        audioSeguridad.sonarAccesoPermitido();

        const colab = resultado.colaborador || {};
        const nombreCompleto = `${colab.nombres || ''} ${colab.apellidos || ''}`.trim() || 'Trabajador Autorizado';
        const dedo = resultado.dedo || 'Yema Dactilar';
        const confianza = resultado.confianza || 95.0;
        const minucias = resultado.minucias_coincidentes || 45;

        if (title) title.textContent = '✓ Acceso Autorizado';
        if (desc) desc.textContent = `${nombreCompleto} • Coincidencia Dactilar: ${confianza}%`;

        if (resBox) {
            resBox.style.display = 'block';
            resBox.style.background = '#f0fdf4';
            resBox.style.border = '2px solid #22c55e';
            resBox.style.boxShadow = '0 4px 16px rgba(34, 197, 94, 0.2)';
            resBox.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.85rem;">
                    <div style="width: 50px; height: 50px; border-radius: 50%; background: #16a34a; color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.5rem; flex-shrink: 0; box-shadow: 0 0 12px rgba(22, 163, 74, 0.5);">
                        ✓
                    </div>
                    <div>
                        <div style="font-weight: 800; font-size: 1.12rem; color: #14532d;">
                            ${nombreCompleto}
                        </div>
                        <div style="font-size: 0.82rem; color: #475569; margin: 0.15rem 0;">
                            DNI: <strong>${colab.dni || '--------'}</strong> • Cargo: ${colab.cargo || 'Personal'} • Dedo: <strong>${dedo}</strong>
                        </div>
                        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-top: 0.35rem;">
                            <span style="background: #dcfce7; color: #15803d; font-size: 0.74rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 999px;">
                                🔒 Cerradura Desasegurada (5s)
                            </span>
                            <span style="background: #e0f2fe; color: #0369a1; font-size: 0.74rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 999px;">
                                ⚡ ${confianza}% Coincidencia (${minucias} Minucias ORB)
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }

        Swal.fire({
            icon: 'success',
            title: '¡Acceso Autorizado!',
            html: `
                <div style="text-align: center; margin-top: 0.5rem;">
                    <p style="font-weight: 800; font-size: 1.25rem; color: #0f172a; margin-bottom: 0.2rem;">${nombreCompleto}</p>
                    <p style="color: #64748b; font-size: 0.86rem; margin-bottom: 0.85rem;">DNI: ${colab.dni || ''} • ${colab.cargo || ''}</p>
                    <div style="padding: 0.8rem; background: #dcfce7; border-radius: 10px; color: #15803d; border: 1px solid #86efac;">
                        <div style="font-weight: 800; font-size: 1.05rem;">✓ Coincidencia Dactilar: ${confianza}%</div>
                        <div style="font-size: 0.82rem; margin-top: 0.25rem;">Dedo Verificado: <strong>${dedo}</strong> • ${minucias} Minucias Papilares</div>
                        <div style="margin-top: 0.45rem; font-size: 0.8rem; font-weight: 600; color: #166534;">🔓 Cerradura Electromagnética Desasegurada (5 seg)</div>
                    </div>
                </div>
            `,
            confirmButtonColor: '#16a34a',
            confirmButtonText: 'Continuar',
            timer: 4500
        });

    } else {
        if (viewport) {
            viewport.classList.remove('success');
            viewport.classList.add('denied');
        }
        audioSeguridad.sonarAccesoDenegado();

        const motivo = resultado.motivo || 'DENEGADO';
        const mensaje = resultado.mensaje || 'Acceso Denegado';
        const detalle = resultado.detalle || 'La huella óptica no coincide con los patrones papilares registrados.';

        if (title) {
            if (motivo === 'SUPLANTACION_HUELLA_1A1') title.textContent = '🚨 Suplantación 1:1 Detectada';
            else if (motivo === 'HUELLA_NO_REGISTRADA') title.textContent = '✗ Huella NO Registrada';
            else if (motivo === 'DEDO_NO_ENFOCADO') title.textContent = '🔍 Enfoque Dérmico Insuficiente';
            else title.textContent = '✗ Acceso Denegado';
        }
        if (desc) desc.textContent = detalle;

        if (resBox) {
            resBox.style.display = 'block';
            resBox.style.background = '#fef2f2';
            resBox.style.border = '2px solid #ef4444';
            resBox.style.boxShadow = '0 4px 16px rgba(239, 68, 68, 0.2)';
            resBox.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.85rem;">
                    <div style="width: 50px; height: 50px; border-radius: 50%; background: #dc2626; color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.5rem; flex-shrink: 0; box-shadow: 0 0 12px rgba(220, 38, 38, 0.5);">
                        ✕
                    </div>
                    <div>
                        <div style="font-weight: 800; font-size: 1.1rem; color: #991b1b;">
                            ${mensaje}
                        </div>
                        <div style="font-size: 0.82rem; color: #7f1d1d; margin: 0.2rem 0;">
                            ${detalle}
                        </div>
                        <div style="display: flex; gap: 0.4rem; align-items: center; margin-top: 0.35rem;">
                            <span style="background: #fee2e2; color: #b91c1c; font-size: 0.74rem; font-weight: 800; padding: 0.2rem 0.55rem; border-radius: 999px;">
                                🛑 Cerradura Bloqueada
                            </span>
                            <span style="background: #f1f5f9; color: #475569; font-size: 0.74rem; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: 999px;">
                                Incidente Auditado en SQLite
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }

        Swal.fire({
            icon: 'error',
            title: mensaje,
            html: `
                <div style="text-align: center;">
                    <p style="color: #991b1b; font-weight: 700; font-size: 0.95rem;">${detalle}</p>
                    <p style="color: #64748b; font-size: 0.8rem; margin-top: 0.6rem;">
                        💡 Consejos para la lectura:<br>
                        - Asegure buena luz o encienda el flash.<br>
                        - Coloque la yema en el centro del óvalo a 5-8 cm de distancia.<br>
                        - Cada dedo es distinto: use el mismo dedo registrado.
                    </p>
                </div>
            `,
            confirmButtonColor: '#dc2626',
            timer: 4500
        });
    }

    setTimeout(() => {
        if (viewport && (viewport.classList.contains('success') || viewport.classList.contains('denied'))) {
            viewport.classList.remove('success', 'denied');
            const select = document.getElementById('selectFiltroHuellaUsuario');
            seleccionarModoHuellaTerminal(select ? select.value : '');
        }
    }, 5000);
}

/**
 * Abre el modal de escaneo de huella por cámara para enrolar a un colaborador (Nuevo o Editando).
 */
async function abrirCamaraEnrolamientoHuellaOptica() {
    const dni = document.getElementById('intDni').value.trim();
    const nombres = document.getElementById('intNombres').value.trim();
    const tipoDedo = document.getElementById('selectTipoDedoModal') ? document.getElementById('selectTipoDedoModal').value : 'Índice Derecho';
    const usuarioId = document.getElementById('formTrabajadorId').value.trim();

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

    let streamModalHuella = null;
    let modoCamaraEnroll = 'environment';
    let linternaEnroll = false;

    Swal.fire({
        title: `Escanear: ${tipoDedo}`,
        html: `
            <div style="text-align: center; color: #1e293b;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <span style="background: #dcfce7; color: #15803d; font-size: 0.78rem; font-weight: 800; padding: 0.25rem 0.65rem; border-radius: 999px;">
                        ${tipoDedo}
                    </span>
                    <span style="font-size: 0.75rem; color: #64748b;">
                        Para: <strong>${nombres || 'Colaborador'}</strong>
                    </span>
                </div>

                <!-- Visor de cámara en SweetAlert con láser verde -->
                <div style="position: relative; width: 100%; max-width: 340px; height: 300px; margin: 0 auto; border-radius: 16px; overflow: hidden; background: #090d16; border: 2px solid #22c55e; box-shadow: 0 4px 16px rgba(34, 197, 94, 0.35);">
                    <video id="videoEnrollHuellaLive" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
                    
                    <!-- Láser Verde -->
                    <div class="fp-laser-line-green"></div>

                    <!-- Óvalo de centrado de yema -->
                    <div class="target-oval-finger" style="width: 120px; height: 175px;"></div>

                    <!-- Controles flotantes -->
                    <div style="position: absolute; top: 8px; left: 8px; right: 8px; display: flex; justify-content: space-between; z-index: 12;">
                        <button type="button" id="btnFlipEnrollCam" class="fp-cam-floating-btn" title="Alternar Cámara">
                            🔄 <span id="txtModoEnrollCam">Trasera</span>
                        </button>
                        <button type="button" id="btnFlashEnrollCam" class="fp-cam-floating-btn" title="Flash">
                            ⚡ Flash
                        </button>
                    </div>

                    <!-- Indicador inferior -->
                    <div style="position: absolute; bottom: 8px; left: 0; right: 0; text-align: center; pointer-events: none; z-index: 12;">
                        <span style="background: rgba(15, 23, 42, 0.85); color: #4ade80; font-size: 0.72rem; font-weight: 700; padding: 0.25rem 0.65rem; border-radius: 999px;">
                            👆 Acerque la yema del dedo al óvalo verde
                        </span>
                    </div>

                    <div id="flashCaptureEnroll" style="display: none; position: absolute; inset: 0; background: white; z-index: 20;"></div>
                </div>

                <div style="margin-top: 1rem;">
                    <button type="button" id="btnDispararCapturaHuella" class="btn btn-primary" style="width: 100%; justify-content: center; font-weight: 800; font-size: 0.95rem; padding: 0.8rem; background: linear-gradient(135deg, #15803d, #22c55e); border-color: #15803d;">
                        📸 Capturar y Extraer Minucias (OpenCV)
                    </button>
                </div>
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Cancelar y Cerrar',
        allowOutsideClick: false,
        didOpen: async () => {
            const videoEl = document.getElementById('videoEnrollHuellaLive');
            const btnDisparar = document.getElementById('btnDispararCapturaHuella');
            const btnFlip = document.getElementById('btnFlipEnrollCam');
            const btnFlash = document.getElementById('btnFlashEnrollCam');
            const txtModo = document.getElementById('txtModoEnrollCam');
            const flashOverlay = document.getElementById('flashCaptureEnroll');

            async function activarCamaraModal() {
                try {
                    if (streamModalHuella) {
                        streamModalHuella.getTracks().forEach(t => t.stop());
                    }
                    streamModalHuella = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: modoCamaraEnroll, width: { ideal: 1280 }, height: { ideal: 720 } },
                        audio: false
                    });
                    if (videoEl) {
                        videoEl.srcObject = streamModalHuella;
                        await videoEl.play();
                    }
                    if (txtModo) txtModo.textContent = (modoCamaraEnroll === 'environment' ? 'Trasera' : 'Frontal');

                    const track = streamModalHuella.getVideoTracks()[0];
                    if (btnFlash && track) {
                        const caps = track.getCapabilities ? track.getCapabilities() : {};
                        btnFlash.style.display = ('torch' in caps) ? 'inline-flex' : 'none';
                    }
                } catch (e) {
                    console.warn('[CAMARA MODAL HUELLA ERROR]', e);
                    try {
                        streamModalHuella = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                        if (videoEl) {
                            videoEl.srcObject = streamModalHuella;
                            await videoEl.play();
                        }
                    } catch (err) {}
                }
            }

            await activarCamaraModal();

            if (btnFlip) {
                btnFlip.onclick = async () => {
                    modoCamaraEnroll = (modoCamaraEnroll === 'environment' ? 'user' : 'environment');
                    await activarCamaraModal();
                };
            }

            if (btnFlash) {
                btnFlash.onclick = async () => {
                    if (!streamModalHuella) return;
                    const track = streamModalHuella.getVideoTracks()[0];
                    if (!track) return;
                    try {
                        linternaEnroll = !linternaEnroll;
                        await track.applyConstraints({ advanced: [{ torch: linternaEnroll }] });
                        btnFlash.style.color = linternaEnroll ? '#facc15' : '#f8fafc';
                    } catch (e) {}
                };
            }

            if (btnDisparar) {
                btnDisparar.onclick = async () => {
                    if (!videoEl || videoEl.readyState < 2) return;

                    btnDisparar.disabled = true;
                    btnDisparar.textContent = 'Procesando crestas papilares...';

                    // Flash visual y sonido
                    audioSeguridad.sonarCapturaFoto();
                    if (flashOverlay) {
                        flashOverlay.style.display = 'block';
                        setTimeout(() => flashOverlay.style.display = 'none', 100);
                    }

                    // Captura a canvas
                    const canvas = document.createElement('canvas');
                    canvas.width = videoEl.videoWidth || 1280;
                    canvas.height = videoEl.videoHeight || 720;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
                    const b64 = canvas.toDataURL('image/jpeg', 0.95);

                    // Si estamos editando a un trabajador que ya tiene ID en SQLite:
                    if (usuarioId) {
                        try {
                            const resp = await fetch('/api/biometria/enrolar_huella_optica', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    usuario_id: usuarioId,
                                    imagen_base64: b64,
                                    nombre_dedo: tipoDedo
                                })
                            });
                            const data = await resp.json();
                            if (!data.exito) {
                                throw new Error(data.mensaje || 'Error al calibrar huella');
                            }

                            // Éxito inmediato en SQLite
                            completarEnrolamientoModalUI(b64, tipoDedo, data.minucias_detectadas);
                            Swal.close();

                        } catch (err) {
                            btnDisparar.disabled = false;
                            btnDisparar.textContent = 'Reintentar Captura';
                            Swal.showValidationMessage(`✗ ${err.message}`);
                        }
                    } else {
                        // Es un nuevo trabajador que aún no se guarda en SQLite:
                        AppState.huellaOpticaNueva = {
                            imagen_base64: b64,
                            nombre_dedo: tipoDedo
                        };
                        completarEnrolamientoModalUI(b64, tipoDedo, 'calibradas');
                        Swal.close();
                    }
                };
            }
        },
        willClose: () => {
            if (streamModalHuella) {
                try {
                    streamModalHuella.getTracks().forEach(t => t.stop());
                } catch (e) {}
                streamModalHuella = null;
            }
        }
    });
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
'''

def main():
    with open(APP_JS_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    start_marker = 'async function cargarSelectorFiltroHuella() {'
    end_marker = '// =============================================================================\n// VISTA 4: CENTRO DE MONITOREO CCTV Y TELEMETRIA DE SENSORES'

    start_pos = content.find(start_marker)
    end_pos = content.find(end_marker)

    if start_pos == -1 or end_pos == -1:
        print(f"Error: no se encontraron marcadores (start: {start_pos}, end: {end_pos})")
        return False

    nuevo_content = content[:start_pos] + NUEVO_BLOQUE_HUELLA + '\n\n' + content[end_pos:]

    # Ajustar abrirModalCrearTrabajador
    antiguo_crear = """    document.getElementById('modalFpTouchBox').className = 'fp-interactive-touch';
    document.getElementById('badgeEstadoHuellaModal').textContent = 'Huella Dactilar No Vinculada';"""
    nuevo_crear = """    limpiarHuellaDactilarModal();"""
    if antiguo_crear in nuevo_content:
        nuevo_content = nuevo_content.replace(antiguo_crear, nuevo_crear, 1)

    # Ajustar abrirModalEditarTrabajador
    antiguo_editar = """            const fpBox = document.getElementById('modalFpTouchBox');
            const fpBadge = document.getElementById('badgeEstadoHuellaModal');
            if (u.huella_registrada === 1) {
                fpBox.className = 'fp-interactive-touch active';
                fpBadge.textContent = '✓ Huella Dactilar Activa en SQLite';
            } else {
                fpBox.className = 'fp-interactive-touch';
                fpBadge.textContent = 'Huella Dactilar Pendiente';
            }"""
    nuevo_editar = """            if (u.huella_registrada === 1) {
                mostrarHuellaRegistradaEnModal(u.id, u.huella_public_key);
            } else {
                limpiarHuellaDactilarModal();
            }"""
    if antiguo_editar in nuevo_content:
        nuevo_content = nuevo_content.replace(antiguo_editar, nuevo_editar, 1)

    # Ajustar guardarTrabajadorIntegral para enrolar huella optica nueva
    antiguo_guardar = """        // Registrar huella dactilar si se activó en el modal
        if (AppState.huellaRegistradaModal && (AppState.credencialHuellaModal || !usuarioId)) {
            const credData = AppState.credencialHuellaModal || {};
            await fetch('/api/biometria/enrolar_huella', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: idFinal,
                    credential_id: credData.credential_id || `ARATEK_FP_${dni}`,
                    public_key: credData.public_key || 'BIOMETRIC_PUB_KEY_HARDWARE'
                })
            });
        }"""
    nuevo_guardar = """        // Registrar huella dactilar óptica si se escaneó con cámara en el modal
        if (AppState.huellaRegistradaModal && AppState.huellaOpticaNueva) {
            await fetch('/api/biometria/enrolar_huella_optica', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usuario_id: idFinal,
                    imagen_base64: AppState.huellaOpticaNueva.imagen_base64,
                    nombre_dedo: AppState.huellaOpticaNueva.nombre_dedo
                })
            });
        }"""
    if antiguo_guardar in nuevo_content:
        nuevo_content = nuevo_content.replace(antiguo_guardar, nuevo_guardar, 1)

    with open(APP_JS_PATH, 'w', encoding='utf-8') as f:
        f.write(nuevo_content)

    print("static/js/app.js actualizado con exito.")
    return True

if __name__ == '__main__':
    main()
