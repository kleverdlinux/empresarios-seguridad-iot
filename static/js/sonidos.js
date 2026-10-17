/**
 * =============================================================================
 * SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
 * MOTOR DE AUDIO SINTETIZADO (Web Audio API) - 100% OFFLINE
 * =============================================================================
 * Genera tonos acusticos de confirmacion y alarma directamente en el hardware de audio
 * del movil/computadora sin requerir archivos mp3 ni conexion a internet.
 */

class MotorSonidoSeguridad {
    constructor() {
        this.ctx = null;
        this.sirenaActiva = false;
        this.intervaloSirena = null;
    }

    obtenerContexto() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        return this.ctx;
    }

    /**
     * Tono armonico afirmativo: Doble campana de frecuencia ascendente (880Hz -> 1320Hz)
     * Indica: Acceso Concedido / Apertura de Cerradura / Verificacion Exitosa
     */
    sonarAccesoPermitido() {
        try {
            const ctx = this.obtenerContexto();
            const ahora = ctx.currentTime;

            // Tono 1 (880 Hz - Nota La5)
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(880, ahora);
            gain1.gain.setValueAtTime(0, ahora);
            gain1.gain.linearRampToValueAtTime(0.3, ahora + 0.03);
            gain1.gain.exponentialRampToValueAtTime(0.001, ahora + 0.25);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(ahora);
            osc1.stop(ahora + 0.25);

            // Tono 2 (1320 Hz - Nota Mi6)
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1320, ahora + 0.12);
            gain2.gain.setValueAtTime(0, ahora + 0.12);
            gain2.gain.linearRampToValueAtTime(0.35, ahora + 0.15);
            gain2.gain.exponentialRampToValueAtTime(0.001, ahora + 0.45);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(ahora + 0.12);
            osc2.stop(ahora + 0.45);
        } catch (e) {
            console.warn('Audio contextual bloqueado por politicas del navegador hasta primer toque:', e);
        }
    }

    /**
     * Tono de advertencia de acceso denegado: Doble pulso grave disonante (220Hz / 180Hz)
     * Indica: Acceso Denegado / Rostro no reconocido / Huella incorrecta
     */
    sonarAccesoDenegado() {
        try {
            const ctx = this.obtenerContexto();
            const ahora = ctx.currentTime;

            // Pulso 1
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(220, ahora);
            gain1.gain.setValueAtTime(0.3, ahora);
            gain1.gain.exponentialRampToValueAtTime(0.001, ahora + 0.18);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(ahora);
            osc1.stop(ahora + 0.18);

            // Pulso 2
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sawtooth';
            osc2.frequency.setValueAtTime(180, ahora + 0.22);
            gain2.gain.setValueAtTime(0.35, ahora + 0.22);
            gain2.gain.exponentialRampToValueAtTime(0.001, ahora + 0.42);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(ahora + 0.22);
            osc2.stop(ahora + 0.42);
        } catch (e) {
            console.warn('Audio contextual bloqueado:', e);
        }
    }

    /**
     * Tono de confirmacion de captura / foto registrada
     */
    sonarCapturaFoto() {
        try {
            const ctx = this.obtenerContexto();
            const ahora = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1200, ahora);
            gain.gain.setValueAtTime(0.2, ahora);
            gain.gain.exponentialRampToValueAtTime(0.001, ahora + 0.1);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ahora);
            osc.stop(ahora + 0.1);
        } catch (e) {}
    }

    /**
     * Tono de barrido láser óptico biométrico (Laser Scan)
     */
    sonarEscaneoLaser() {
        try {
            const ctx = this.obtenerContexto();
            const ahora = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, ahora);
            osc.frequency.exponentialRampToValueAtTime(1550, ahora + 0.35);
            gain.gain.setValueAtTime(0.22, ahora);
            gain.gain.exponentialRampToValueAtTime(0.01, ahora + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ahora);
            osc.stop(ahora + 0.35);
        } catch (e) {}
    }

    /**
     * Sirena de alarma de seguridad (para incidentes de vibracion severa o boton de panico)
     */
    iniciarAlarmaPanico() {
        if (this.sirenaActiva) return;
        this.sirenaActiva = true;

        const ctx = this.obtenerContexto();
        let subiendo = true;

        this.intervaloSirena = setInterval(() => {
            if (!this.sirenaActiva) return;
            const t = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(subiendo ? 600 : 1000, t);
            osc.frequency.linearRampToValueAtTime(subiendo ? 1000 : 600, t + 0.4);
            gain.gain.setValueAtTime(0.25, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.4);
            subiendo = !subiendo;
        }, 450);
    }

    detenerAlarmaPanico() {
        this.sirenaActiva = false;
        if (this.intervaloSirena) {
            clearInterval(this.intervaloSirena);
            this.intervaloSirena = null;
        }
    }
}

// Instancia global
window.audioSeguridad = new MotorSonidoSeguridad();
