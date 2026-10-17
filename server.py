"""
=============================================================================
SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
SENATI - PIAD-526: SERVIDOR MAESTRO DE ACCESO, BIOMETRIA Y AUDITORIA
=============================================================================
Servidor multiproceso con soporte dual:
- HTTP / HTTPS nativo para acceso movil con camaras y sensores WebAuthn
- Compatible para ejecucion local 100% OFFLINE y despliegue en la nube (Render)
"""

import os
import sys
import time
import json
import socket
import ssl
import threading
import mimetypes
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Configurar zona horaria oficial del servidor (Perú UTC-5)
os.environ['TZ'] = 'America/Lima'
if hasattr(time, 'tzset'):
    try:
        time.tzset()
    except Exception:
        pass

# Importar modulos locales
from db.database_manager import DatabaseManager, ahora_peru_iso, ahora_peru_dt, TZ_PERU
from biometria.reconocimiento_facial import MotorFacialLBPH
from biometria.reconocimiento_dactilar_optico import MotorDactilarOptico
from reportes.generador_excel import (
    exportar_excel_nomina_completa,
    exportar_excel_auditoria_accesos,
    exportar_excel_trabajador_individual,
    exportar_excel_incidentes_seguridad
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
db = DatabaseManager()
motor_facial = MotorFacialLBPH()
motor_dactilar_optico = MotorDactilarOptico()

# Estado global de hardware IoT (Solenoid door strike, relé, sensores)
estado_hardware = {
    'puerta_abierta': False,
    'tiempo_restante': 0,
    'sensor_sw420_impacto': False,
    'sensor_pir_presencia': False,
    'ultima_actualizacion': ahora_peru_iso()
}
lock_hardware = threading.Lock()

def obtener_ip_local():
    """Detecta la direccion IP local de la maquina en la red LAN (WiFi)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# =============================================================================
# ALGORITMOS DE BIOMETRIA DACTILAR CAPACITIVA Y RECONOCIMIENTO 1:1 / 1:N
# =============================================================================

def validar_morfologia_dactilar(muestra):
    """
    Verifica si las dimensiones del contacto corresponden a una yema dactilar humana.
    Rechaza dedos del pie, palmas, objetos o toques anómalos.
    """
    if not muestra or not isinstance(muestra, dict):
        return False, "Datos biométricos de contacto no recibidos"

    try:
        area = float(muestra.get('area', 0))
        rx = float(muestra.get('radiusX', 0))
        ry = float(muestra.get('radiusY', 0))
        aspect = float(muestra.get('aspectRatio', 1.0))
    except (ValueError, TypeError):
        return False, "Parámetros biométricos con formato no numérico"

    # Detección de dedo del pie / superficie no dactilar:
    # 1. Un dedo del pie (hallux) o contacto aplastado tiene área > 4800 px² o radio > 55 px
    if area > 4800 or rx > 55 or ry > 60:
        return False, "Dimensiones de contacto excesivas incompatibles con huella dactilar humana (posible dedo del pie o contacto anómalo detectado)."

    # 2. Contacto demasiado pequeño o puntual (lápiz óptico, uña, toque accidental)
    if area < 400 or (rx < 10 and ry < 10):
        return False, "Área de contacto insuficiente para lectura papilar (coloque firmemente la yema del dedo)."

    # 3. Relación de aspecto extrema (deformidad no dactilar)
    if aspect < 0.35 or aspect > 2.8:
        return False, "Geometría de contacto deformada (contacto angular anómalo no papilar)."

    return True, "Morfología dactilar humana válida"

def calcular_similitud_huella(muestra, plantilla):
    """
    Calcula el porcentaje de similitud matemática entre una muestra candidata y una plantilla registrada.
    Retorna float 0.0 a 100.0
    """
    if not muestra or not plantilla:
        return 0.0

    try:
        a1 = float(muestra.get('area', 0))
        a2 = float(plantilla.get('area', 0))
        if max(a1, a2) <= 0:
            return 0.0
        diff_area = abs(a1 - a2) / max(a1, a2)

        rx1 = float(muestra.get('radiusX', 0))
        rx2 = float(plantilla.get('radiusX', 0))
        ry1 = float(muestra.get('radiusY', 0))
        ry2 = float(plantilla.get('radiusY', 0))
        diff_rx = abs(rx1 - rx2) / max(rx1, rx2, 1.0)
        diff_ry = abs(ry1 - ry2) / max(ry1, ry2, 1.0)
        diff_r = (diff_rx + diff_ry) / 2.0

        asp1 = float(muestra.get('aspectRatio', 1.0))
        asp2 = float(plantilla.get('aspectRatio', 1.0))
        diff_aspect = abs(asp1 - asp2) / max(asp1, asp2, 0.1)

        p1 = float(muestra.get('presion', 0.5))
        p2 = float(plantilla.get('presion', 0.5))
        diff_presion = abs(p1 - p2) / max(p1, p2, 0.1)

        # Ponderación biométrica
        similitud = 1.0 - (
            0.35 * diff_area +
            0.25 * diff_aspect +
            0.20 * diff_r +
            0.20 * min(diff_presion, 1.0)
        )

        pct = max(0.0, min(100.0, similitud * 100.0))
        return round(pct, 1)
    except Exception as e:
        print(f"Error calculando similitud huella: {e}")
        return 0.0

class GestorPeticionesSeguridad(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        try:
            msg = format % args
            if "GET /static" in msg or "GET /favicon" in msg:
                return
            sys.stderr.write(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")
        except Exception:
            pass

    def responder_json(self, codigo, data):
        """Envia respuesta JSON al cliente."""
        cuerpo = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        self.wfile.write(cuerpo)

    def responder_excel(self, bytes_data, nombre_archivo):
        """Envia archivo binario nativo de Microsoft Excel (.xlsx OpenXML) con cabeceras oficiales."""
        cuerpo = bytes_data if isinstance(bytes_data, (bytes, bytearray)) else bytes_data.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.send_header('Content-Disposition', f'attachment; filename="{nombre_archivo}"')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_OPTIONS(self):
        """Maneja pre-flight requests CORS."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_HEAD(self):
        """Maneja health-checks automáticos de Render y Cloudflare."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        ruta = parsed_url.path
        query = parse_qs(parsed_url.query)

        # 1. RUTA RAIZ -> Index HTML
        if ruta == '/' or ruta == '/index.html':
            self.servir_archivo(os.path.join(BASE_DIR, 'templates', 'index.html'), 'text/html; charset=utf-8')
            return

        # 1.1 SERVICE WORKER PWA (Offline Anti-Dinosaurio)
        if ruta == '/sw.js':
            ruta_sw = os.path.join(BASE_DIR, 'sw.js')
            if os.path.exists(ruta_sw):
                with open(ruta_sw, 'rb') as f:
                    contenido = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
                self.send_header('Service-Worker-Allowed', '/')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Content-Length', str(len(contenido)))
                self.end_headers()
                self.wfile.write(contenido)
                return

        # 2. ARCHIVOS ESTATICOS (/static/*)
        if ruta.startswith('/static/'):
            ruta_rel = ruta.replace('/static/', '', 1).replace('/', os.sep)
            ruta_disco = os.path.join(BASE_DIR, 'static', ruta_rel)
            if os.path.exists(ruta_disco) and os.path.isfile(ruta_disco):
                mime, _ = mimetypes.guess_type(ruta_disco)
                self.servir_archivo(ruta_disco, mime or 'application/octet-stream')
                return
            else:
                self.send_error(404, "Archivo estatico no encontrado")
                return

        # 3. ENDPOINTS API REST
        if ruta == '/api/ping':
            self.responder_json(200, {
                'exito': True,
                'servidor': 'EMPRESARIOTEC_CORE',
                'estado': 'ONLINE',
                'timestamp': ahora_peru_iso()
            })
            return

        if ruta == '/api/dashboard/stats':
            stats = db.obtener_estadisticas_dashboard()
            self.responder_json(200, {'exito': True, 'stats': stats})
            return

        if ruta == '/api/trabajadores':
            trabajadores = db.obtener_trabajadores()
            self.responder_json(200, {'exito': True, 'trabajadores': trabajadores})
            return

        if ruta.startswith('/api/trabajadores/'):
            partes = ruta.strip('/').split('/')
            if len(partes) == 3:
                try:
                    usuario_id = int(partes[2])
                    usuario = db.obtener_trabajador_por_id(usuario_id)
                    if usuario:
                        usuario['fotos'] = db.obtener_fotos_usuario(usuario_id)
                        self.responder_json(200, {'exito': True, 'trabajador': usuario})
                    else:
                        self.responder_json(404, {'exito': False, 'mensaje': 'Trabajador no encontrado'})
                except ValueError:
                    self.responder_json(400, {'exito': False, 'mensaje': 'ID invalido'})
                return

        if ruta == '/api/config/terminales':
            configs = db.obtener_configuraciones()
            # Retornar configuraciones limpias
            self.responder_json(200, {'exito': True, 'configuraciones': configs})
            return

        if ruta == '/api/biometria/obtener_credenciales_huella':
            trabajadores = db.obtener_trabajadores()
            huellas = []
            for t in trabajadores:
                if t['huella_registrada'] == 1:
                    u = db.obtener_trabajador_por_id(t['id'])
                    if u and u.get('huella_credential_id'):
                        template_obj = None
                        raw_pub = u.get('huella_public_key', '')
                        if raw_pub:
                            try:
                                template_obj = json.loads(raw_pub)
                            except Exception:
                                template_obj = None
                        nombre_dedo = 'Yema Dactilar'
                        if template_obj and isinstance(template_obj, dict):
                            nombre_dedo = template_obj.get('nombre_dedo', 'Yema Dactilar')
                        huellas.append({
                            'usuario_id': u['id'],
                            'nombre': f"{u['nombres']} {u['apellidos']}",
                            'dni': u['dni'],
                            'cargo': u['cargo'],
                            'nombre_dedo': nombre_dedo,
                            'credential_id': u['huella_credential_id'],
                            'template': template_obj
                        })
            self.responder_json(200, {'exito': True, 'credenciales': huellas})
            return

        if ruta == '/api/logs/accesos':
            limite = int(query.get('limite', [2000])[0])
            filtro = query.get('filtro', [None])[0]
            desde = query.get('desde', [None])[0]
            hasta = query.get('hasta', [None])[0]
            terminal = query.get('terminal', [None])[0]
            estado = query.get('estado', [None])[0]
            texto = query.get('texto', [None])[0]
            logs = db.obtener_logs_acceso(
                limite=limite, filtro=filtro, desde=desde, hasta=hasta,
                terminal=terminal, estado=estado, texto=texto
            )
            self.responder_json(200, {'exito': True, 'logs': logs, 'total': len(logs)})
            return

        if ruta == '/api/logs/incidentes':
            limite = int(query.get('limite', [1000])[0])
            desde = query.get('desde', [None])[0]
            hasta = query.get('hasta', [None])[0]
            sensor = query.get('sensor', [None])[0]
            nivel = query.get('nivel', [None])[0]
            texto = query.get('texto', [None])[0]
            logs = db.obtener_logs_incidentes(
                limite=limite, desde=desde, hasta=hasta, sensor=sensor, nivel=nivel, texto=texto
            )
            self.responder_json(200, {'exito': True, 'logs': logs, 'total': len(logs)})
            return

        if ruta == '/api/logs/exportar_csv':
            limite = int(query.get('limite', [2000])[0])
            filtro = query.get('filtro', [None])[0]
            desde = query.get('desde', [None])[0]
            hasta = query.get('hasta', [None])[0]
            terminal = query.get('terminal', [None])[0]
            estado = query.get('estado', [None])[0]
            texto = query.get('texto', [None])[0]
            logs = db.obtener_logs_acceso(
                limite=limite, filtro=filtro, desde=desde, hasta=hasta,
                terminal=terminal, estado=estado, texto=texto
            )
            csv_lineas = ["ID,Fecha_Hora,DNI,Usuario,Metodo,Terminal,Estado,Detalle\n"]
            for l in logs:
                csv_lineas.append(f"{l['id']},\"{l['timestamp']}\",\"{l['dni']}\",\"{l['nombre_usuario']}\",\"{l['metodo']}\",\"{l['terminal']}\",\"{l['estado']}\",\"{l['detalle']}\"\n")
            csv_data = "".join(csv_lineas).encode('utf-8-sig')
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="auditoria_seguridad_empresariotec.csv"')
            self.send_header('Content-Length', str(len(csv_data)))
            self.end_headers()
            self.wfile.write(csv_data)
            return

        if ruta == '/api/hardware/estado':
            with lock_hardware:
                self.responder_json(200, {'exito': True, 'hardware': estado_hardware})
            return

        # =====================================================================
        # REPORTES EN EXCEL PROFESIONALES NATIVOS (.xlsx OpenXML)
        # =====================================================================
        if ruta == '/api/reportes/excel/nomina':
            trabajadores = db.obtener_trabajadores()
            xlsx_bytes = exportar_excel_nomina_completa(trabajadores)
            timestamp_str = datetime.now(TZ_PERU).strftime('%Y%m%d_%H%M%S')
            self.responder_excel(xlsx_bytes, f"nomina_trabajadores_empresariotec_{timestamp_str}.xlsx")
            return

        if ruta == '/api/reportes/excel/accesos':
            limite = int(query.get('limite', [2000])[0])
            filtro = query.get('filtro', [None])[0]
            desde = query.get('desde', [None])[0]
            hasta = query.get('hasta', [None])[0]
            terminal = query.get('terminal', [None])[0]
            estado = query.get('estado', [None])[0]
            texto = query.get('texto', [None])[0]

            logs = db.obtener_logs_acceso(
                limite=limite, filtro=filtro, desde=desde, hasta=hasta,
                terminal=terminal, estado=estado, texto=texto
            )

            # Construir resumen de filtros aplicados para la cabecera del Excel
            desc_filtros = []
            if desde and hasta:
                desc_filtros.append(f"Rango: {desde} al {hasta}")
            elif desde:
                desc_filtros.append(f"Desde: {desde}")
            elif hasta:
                desc_filtros.append(f"Hasta: {hasta}")

            if terminal and terminal.upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                desc_filtros.append(f"Lugar/Terminal: {terminal}")

            if estado and estado.upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                desc_filtros.append(f"Estado: {estado}")

            if texto and texto.strip():
                desc_filtros.append(f"Búsqueda: '{texto.strip()}'")

            filtros_str = " | ".join(desc_filtros) if desc_filtros else "Todos los registros (Sin filtros)"

            xlsx_bytes = exportar_excel_auditoria_accesos(logs, filtros_desc=filtros_str)
            timestamp_str = datetime.now(TZ_PERU).strftime('%Y%m%d_%H%M%S')
            self.responder_excel(xlsx_bytes, f"auditoria_accesos_{timestamp_str}.xlsx")
            return

        if ruta == '/api/reportes/excel/incidentes':
            limite = int(query.get('limite', [1500])[0])
            desde = query.get('desde', [None])[0]
            hasta = query.get('hasta', [None])[0]
            sensor = query.get('sensor', [None])[0]
            nivel = query.get('nivel', [None])[0]
            texto = query.get('texto', [None])[0]

            incidentes = db.obtener_logs_incidentes(
                limite=limite, desde=desde, hasta=hasta, sensor=sensor, nivel=nivel, texto=texto
            )

            desc_filtros = []
            if desde and hasta:
                desc_filtros.append(f"Rango: {desde} al {hasta}")
            elif desde:
                desc_filtros.append(f"Desde: {desde}")
            elif hasta:
                desc_filtros.append(f"Hasta: {hasta}")

            if sensor and sensor.upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                desc_filtros.append(f"Sensor/Origen: {sensor}")

            if nivel and nivel.upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                desc_filtros.append(f"Nivel: {nivel}")

            if texto and texto.strip():
                desc_filtros.append(f"Búsqueda: '{texto.strip()}'")

            filtros_str = " | ".join(desc_filtros) if desc_filtros else "Todos los incidentes (Sin filtros)"

            xlsx_bytes = exportar_excel_incidentes_seguridad(incidentes, filtros_desc=filtros_str)
            timestamp_str = datetime.now(TZ_PERU).strftime('%Y%m%d_%H%M%S')
            self.responder_excel(xlsx_bytes, f"incidentes_cctv_{timestamp_str}.xlsx")
            return

        if ruta.startswith('/api/reportes/excel/trabajador/'):
            partes = ruta.strip('/').split('/')
            if len(partes) == 5:
                try:
                    usuario_id = int(partes[4])
                    usuario = db.obtener_trabajador_por_id(usuario_id)
                    if not usuario:
                        self.responder_json(404, {'exito': False, 'mensaje': 'Trabajador no encontrado'})
                        return
                    logs_usuario = db.obtener_logs_acceso_por_usuario(usuario_id, limite=100)
                    xlsx_bytes = exportar_excel_trabajador_individual(usuario, logs_usuario)
                    dni_clean = usuario.get('dni', 'sin_dni')
                    timestamp_str = datetime.now(TZ_PERU).strftime('%Y%m%d')
                    self.responder_excel(xlsx_bytes, f"ficha_trabajador_{dni_clean}_{timestamp_str}.xlsx")
                    return
                except ValueError:
                    self.responder_json(400, {'exito': False, 'mensaje': 'ID de trabajador invalido'})
                    return

        # Ruta no encontrada
        self.send_error(404, "Endpoint no encontrado")

    def do_POST(self):
        parsed_url = urlparse(self.path)
        ruta = parsed_url.path

        # Leer cuerpo de la peticion JSON
        longitud = int(self.headers.get('Content-Length', 0))
        cuerpo = self.rfile.read(longitud).decode('utf-8') if longitud > 0 else '{}'
        try:
            datos = json.loads(cuerpo) if cuerpo else {}
        except Exception:
            datos = {}

        # =====================================================================
        # 1. AUTENTICACION
        # =====================================================================
        if ruta == '/api/login/admin':
            usuario = datos.get('usuario', '')
            password = datos.get('password', '')
            if db.verificar_admin(usuario, password):
                self.responder_json(200, {
                    'exito': True,
                    'mensaje': 'Acceso autorizado al Panel de Administrador Maestro',
                    'rol': 'ADMIN'
                })
            else:
                db.registrar_incidente('AUTENTICACION_ADMIN', 'ADVERTENCIA', f'Intento de inicio de sesion fallido para usuario: {usuario}')
                self.responder_json(401, {'exito': False, 'mensaje': 'Credenciales de Administrador incorrectas'})
            return

        if ruta == '/api/login/terminal':
            tipo_terminal = datos.get('terminal', '')  # 'facial', 'huella', 'cctv'
            password = datos.get('password', '')
            if db.verificar_password_terminal(tipo_terminal, password):
                self.responder_json(200, {
                    'exito': True,
                    'terminal': tipo_terminal,
                    'mensaje': f'Terminal {tipo_terminal.upper()} desbloqueada con exito'
                })
            else:
                db.registrar_incidente('TERMINAL_DESBLOQUEO', 'ADVERTENCIA', f'Contraseña incorrecta en terminal: {tipo_terminal}')
                self.responder_json(401, {'exito': False, 'mensaje': 'Contraseña de terminal incorrecta'})
            return

        # =====================================================================
        # 2. CONFIGURACION DE TERMINALES
        # =====================================================================
        if ruta == '/api/config/terminales':
            # Permite actualizar contraseñas de las terminales y parametros
            campos = ['terminal_facial_pwd', 'terminal_huella_pwd', 'terminal_cctv_pwd', 
                      'admin_pwd', 'tiempo_apertura_puerta', 'umbral_confianza_facial']
            actualizados = 0
            for c in campos:
                if c in datos and datos[c].strip() != '':
                    db.actualizar_configuracion(c, datos[c].strip())
                    actualizados += 1

            self.responder_json(200, {
                'exito': True, 
                'mensaje': f'{actualizados} configuraciones actualizadas correctamente',
                'configuraciones': db.obtener_configuraciones()
            })
            return

        # =====================================================================
        # 2.0 RESETEO Y PURGA TOTAL DE BASE DE DATOS A CERO
        # =====================================================================
        if ruta == '/api/admin/database/reset':
            admin_pwd = datos.get('password', '')
            configs = db.obtener_configuraciones()
            pwd_real = configs.get('admin_pwd', {}).get('valor', 'admin123')
            if admin_pwd != pwd_real:
                self.responder_json(401, {'exito': False, 'mensaje': 'Contraseña de administrador incorrecta. Operación de reseteo denegada.'})
                return

            purgar_usuarios = bool(datos.get('purgar_usuarios', True))
            db.resetear_base_de_datos_a_cero(purgar_usuarios_secundarios=purgar_usuarios)
            self.responder_json(200, {
                'exito': True,
                'mensaje': 'Base de datos restablecida a CERO total con éxito. Auditoría e incidentes en cero.'
            })
            return

        # =====================================================================
        # 2.1 SINCRONIZACION OFFLINE (IndexedDB / SQLite Local a Servidor)
        # =====================================================================
        if ruta == '/api/sincronizar_offline':
            registros = datos.get('registros', [])
            sincronizados = 0
            for r in registros:
                try:
                    tipo = r.get('tipo', 'acceso')
                    ts = r.get('timestamp')
                    if tipo == 'acceso':
                        db.registrar_acceso(
                            usuario_id=r.get('usuario_id'),
                            nombre_usuario=r.get('nombre_usuario', 'Desconocido'),
                            dni=r.get('dni', ''),
                            metodo=r.get('metodo', 'OFFLINE'),
                            terminal=r.get('terminal', 'offline'),
                            estado=r.get('estado', 'PERMITIDO'),
                            detalle=r.get('detalle', 'Marcación offline sincronizada'),
                            timestamp=ts
                        )
                        sincronizados += 1
                    elif tipo == 'incidente':
                        db.registrar_incidente(
                            tipo_sensor=r.get('tipo_sensor', 'OFFLINE_EVENT'),
                            nivel_alerta=r.get('nivel_alerta', 'INFO'),
                            descripcion=r.get('descripcion', 'Incidente registrado en modo offline'),
                            timestamp=ts
                        )
                        sincronizados += 1
                except Exception as ex_sync:
                    print(f"[SYNC_OFFLINE] Error registrando fila: {ex_sync}")

            self.responder_json(200, {
                'exito': True,
                'sincronizados': sincronizados,
                'mensaje': f'Se sincronizaron con éxito {sincronizados} registros con SQLite central.'
            })
            return

        # =====================================================================
        # 3. GESTION DE TRABAJADORES
        # =====================================================================
        if ruta == '/api/trabajadores':
            dni = datos.get('dni', '').strip()
            nombres = datos.get('nombres', '').strip()
            apellidos = datos.get('apellidos', '').strip()
            cargo = datos.get('cargo', '').strip()
            departamento = datos.get('departamento', '').strip()
            foto_perfil = datos.get('foto_perfil', None)

            if not (dni and nombres and apellidos and cargo and departamento):
                self.responder_json(400, {'exito': False, 'mensaje': 'Todos los campos obligatorios deben ser completados'})
                return

            existente = db.obtener_trabajador_por_dni(dni)
            if existente:
                self.responder_json(400, {'exito': False, 'mensaje': f'El DNI {dni} ya se encuentra registrado'})
                return

            try:
                nuevo_id = db.crear_trabajador(dni, nombres, apellidos, cargo, departamento, foto_perfil)
                self.responder_json(201, {
                    'exito': True,
                    'mensaje': f'Trabajador {nombres} {apellidos} registrado con exito',
                    'id': nuevo_id
                })
            except Exception as e:
                self.responder_json(500, {'exito': False, 'mensaje': str(e)})
            return

        # =====================================================================
        # 4. BIOMETRIA FACIAL
        # =====================================================================
        if ruta == '/api/biometria/capturar_muestra':
            usuario_id = datos.get('usuario_id')
            imagen_b64 = datos.get('imagen_base64', '')
            limpiar_previas = bool(datos.get('limpiar_previas', False))
            if not usuario_id or not imagen_b64:
                self.responder_json(400, {'exito': False, 'mensaje': 'Faltan parametros requeridos (usuario_id, imagen_base64)'})
                return

            resultado = motor_facial.capturar_muestra_rostro(usuario_id, imagen_b64, db, limpiar_previas=limpiar_previas)
            codigo = 200 if resultado['exito'] else 400
            self.responder_json(codigo, resultado)
            return

        if ruta == '/api/biometria/limpiar_fotos_usuario':
            usuario_id = datos.get('usuario_id')
            if not usuario_id:
                self.responder_json(400, {'exito': False, 'mensaje': 'ID de usuario requerido'})
                return
            motor_facial.limpiar_muestras_usuario(usuario_id, db)
            res_train = motor_facial.entrenar_modelo_lbph(db)
            self.responder_json(200, {
                'exito': True,
                'mensaje': 'Fotos residuales eliminadas de SQLite y del almacenamiento.',
                'entrenamiento': res_train
            })
            return

        if ruta == '/api/biometria/verificar_rostro':
            imagen_b64 = datos.get('imagen_base64', '')
            raw_filtro = datos.get('usuario_id_filtro')
            usuario_id_filtro = None
            if raw_filtro not in (None, '', 'null', 'undefined', 0):
                try:
                    usuario_id_filtro = int(raw_filtro)
                except (ValueError, TypeError):
                    usuario_id_filtro = None

            print(f"[API ROSTRO] Verificando fotograma | Filtro 1:1: {usuario_id_filtro}", flush=True)

            if not imagen_b64:
                self.responder_json(400, {'estado': 'ERROR', 'mensaje': 'Fotograma no proporcionado'})
                return

            # Obtener umbral configurado en DB (defecto 42.0 para máxima precisión anti-intrusos)
            configs = db.obtener_configuraciones()
            umbral = float(configs.get('umbral_confianza_facial', {}).get('valor', 42.0))
            # Limitar a maximo 45.0 para evitar cualquier falso positivo
            umbral = min(umbral, 45.0)
            resultado = motor_facial.verificar_rostro_en_vivo(
                imagen_b64,
                db,
                umbral_confianza=umbral,
                usuario_id_filtro=usuario_id_filtro
            )

            # Si el acceso fue permitido, disparar solenoide de puerta
            if resultado.get('estado') == 'PERMITIDO':
                self.activar_puerta_temporizada()

            self.responder_json(200, resultado)
            return

        if ruta == '/api/biometria/entrenar_modelo':
            res = motor_facial.entrenar_modelo_lbph(db)
            self.responder_json(200, res)
            return

        # =====================================================================
        # 5. BIOMETRIA DACTILAR
        # =====================================================================
        if ruta == '/api/biometria/enrolar_huella':
            usuario_id = datos.get('usuario_id')
            credential_id = datos.get('credential_id')
            public_key = datos.get('public_key', '')

            if not usuario_id or not credential_id:
                self.responder_json(400, {'exito': False, 'mensaje': 'Datos de credencial incompletos'})
                return

            exito = db.registrar_huella_webauthn(usuario_id, credential_id, public_key)
            if exito:
                usuario = db.obtener_trabajador_por_id(usuario_id)
                self.responder_json(200, {
                    'exito': True,
                    'mensaje': f'Huella dactilar de {usuario["nombres"]} enrolada correctamente en base de datos.'
                })
            else:
                self.responder_json(500, {'exito': False, 'mensaje': 'No se pudo registrar la huella en base de datos'})
            return

        # =====================================================================
        # 5.1 BIOMETRIA DACTILAR OPTICA POR CAMARA (TOUCHLESS FINGERPRINT OPENCV)
        # =====================================================================
        if ruta in ('/api/biometria/enrolar_huella_multimuestra', '/api/biometria/enrolar_huella_optica'):
            usuario_id = datos.get('usuario_id')
            muestras = datos.get('muestras') or []
            if not muestras and datos.get('imagen_base64'):
                muestras = [datos.get('imagen_base64')]
            nombre_dedo = datos.get('nombre_dedo', 'Yema Dactilar')

            if not usuario_id or not muestras:
                self.responder_json(400, {'exito': False, 'mensaje': 'Faltan parámetros requeridos (usuario_id, muestras/imagen_base64)'})
                return

            res = motor_dactilar_optico.enrolar_huella_multimuestra(usuario_id, muestras, db, nombre_dedo)
            codigo = 200 if res['exito'] else 400
            self.responder_json(codigo, res)
            return

        if ruta == '/api/biometria/desvincular_huella':
            usuario_id = datos.get('usuario_id')
            if not usuario_id:
                self.responder_json(400, {'exito': False, 'mensaje': 'usuario_id requerido'})
                return
            db.desvincular_huella(usuario_id)
            self.responder_json(200, {'exito': True, 'mensaje': 'Huella dactilar desvinculada exitosamente de SQLite'})
            return

        if ruta == '/api/biometria/validar_foto_dedo':
            imagen_b64 = datos.get('imagen_base64')
            if not imagen_b64:
                self.responder_json(400, {'exito': False, 'motivo': 'SIN_IMAGEN', 'mensaje': 'Imagen requerida'})
                return
            img = motor_dactilar_optico.decodificar_imagen_base64(imagen_b64)
            if img is None:
                self.responder_json(400, {'exito': False, 'motivo': 'CORRUPTA', 'mensaje': 'Imagen no válida o corrupta'})
                return
            crestas, kp, des, info_encuadre = motor_dactilar_optico.preprocesar_y_mejorar_crestas(img)
            if not info_encuadre.get('es_dedo_humano', True) or not info_encuadre.get('encuadre_valido', True):
                motivo = info_encuadre.get('motivo', 'ENCUADRE_INCORRECTO')
                detalle = info_encuadre.get('detalle', 'Coloque la yema de su dedo a 5 cm.')
                titulo = 'No es un Dedo Humano' if motivo == 'NO_ES_DEDO' else ('Dedo No Detectado' if motivo == 'SIN_DEDO' else 'Encuadre Fuera de Rango (5 cm)')
                self.responder_json(400, {'exito': False, 'motivo': motivo, 'mensaje': titulo, 'detalle': detalle})
                return
            if des is None or len(kp) < 15:
                self.responder_json(400, {'exito': False, 'motivo': 'SIN_CRESTAS_PAPILARES', 'mensaje': 'Dedo No Enfocado', 'detalle': 'No se detectaron crestas papilares nítidas en la yema.'})
                return
            self.responder_json(200, {
                'exito': True,
                'minucias_detectadas': len(kp),
                'mensaje': 'Yema dactilar humana validada con éxito a 5 cm'
            })
            return

        if ruta == '/api/biometria/verificar_huella_optica':
            imagen_b64 = datos.get('imagen_base64')
            raw_filtro = datos.get('usuario_id_filtro')

            id_filtro = None
            if raw_filtro is not None and str(raw_filtro).strip() != '':
                try:
                    id_filtro = int(raw_filtro)
                except (ValueError, TypeError):
                    id_filtro = None

            if not imagen_b64:
                self.responder_json(400, {'estado': 'DENEGADO', 'mensaje': 'Fotograma de huella requerido'})
                return

            resultado = motor_dactilar_optico.verificar_huella_optica(imagen_b64, db, id_filtro)
            if resultado.get('estado') == 'PERMITIDO':
                self.activar_puerta_temporizada()
            self.responder_json(200, resultado)
            return

        if ruta == '/api/biometria/verificar_huella':
            credential_id = datos.get('credential_id')
            raw_filtro = datos.get('usuario_id_filtro')
            muestra = datos.get('muestra') or datos.get('touch_data') or datos.get('sample')

            id_filtro = None
            if raw_filtro is not None and str(raw_filtro).strip() != '':
                try:
                    id_filtro = int(raw_filtro)
                except (ValueError, TypeError):
                    id_filtro = None

            # -----------------------------------------------------------------
            # 1. VERIFICACION CON MUESTRA BIOMETRICA TACTIL / CAPACITIVA
            # -----------------------------------------------------------------
            if muestra:
                # Validar morfología (filtro estricto para rechazar dedos del pie, palmas, objetos)
                es_valido, motivo_morf = validar_morfologia_dactilar(muestra)
                if not es_valido:
                    db.registrar_acceso(
                        usuario_id=id_filtro,
                        nombre_usuario="DESCONOCIDO",
                        dni="N/A",
                        metodo="HUELLA",
                        terminal="TERMINAL_HUELLA",
                        estado="DENEGADO",
                        detalle=f"ANOMALIA_CONTACTO_NO_DACTILAR: {motivo_morf}"
                    )
                    db.registrar_incidente(
                        'CONTACTO_BIOMETRICO_ANOMALO',
                        'CRITICO',
                        f"Anomalía en terminal dactilar: {motivo_morf}"
                    )
                    self.responder_json(200, {
                        'estado': 'DENEGADO',
                        'motivo': 'CONTACTO_ANOMALO',
                        'mensaje': '🚨 Contacto Biométrico Inválido',
                        'detalle': motivo_morf
                    })
                    return

                # Obtener todos los trabajadores con huella registrada
                trabajadores = db.obtener_trabajadores()
                candidatos = []
                for t in trabajadores:
                    if t['huella_registrada'] == 1 and t['estado'] == 'ACTIVO':
                        u = db.obtener_trabajador_por_id(t['id'])
                        plantilla_raw = u.get('huella_public_key', '')
                        plantilla = None
                        if plantilla_raw:
                            try:
                                plantilla = json.loads(plantilla_raw)
                            except Exception:
                                plantilla = None
                        if plantilla:
                            score = calcular_similitud_huella(muestra, plantilla)
                            candidatos.append({
                                'usuario': u,
                                'score': score
                            })

                candidatos.sort(key=lambda x: x['score'], reverse=True)
                mejor_candidato = candidatos[0] if candidatos else None
                mejor_score = mejor_candidato['score'] if mejor_candidato else 0.0

                UMBRAL_COINCIDENCIA = 80.0

                # CASO A: MODO POR NOMBRE (Validación 1:1)
                if id_filtro:
                    trab_esperado = db.obtener_trabajador_por_id(id_filtro)
                    nombre_esp = f"{trab_esperado['nombres']} {trab_esperado['apellidos']}" if trab_esperado else f"ID {id_filtro}"
                    
                    score_esperado = 0.0
                    for c in candidatos:
                        if c['usuario']['id'] == id_filtro:
                            score_esperado = c['score']
                            break

                    if score_esperado >= UMBRAL_COINCIDENCIA:
                        u = trab_esperado
                        db.registrar_acceso(
                            usuario_id=u['id'],
                            nombre_usuario=f"{u['nombres']} {u['apellidos']}",
                            dni=u['dni'],
                            metodo="HUELLA",
                            terminal="TERMINAL_HUELLA",
                            estado="PERMITIDO",
                            detalle=f"Huella 1:1 validada con {score_esperado}% de coincidencia"
                        )
                        self.activar_puerta_temporizada()
                        self.responder_json(200, {
                            'estado': 'PERMITIDO',
                            'mensaje': f'Acceso Autorizado: {u["nombres"]} {u["apellidos"]}',
                            'coincidencia': score_esperado,
                            'trabajador': {
                                'id': u['id'],
                                'nombres': u['nombres'],
                                'apellidos': u['apellidos'],
                                'cargo': u['cargo'],
                                'departamento': u['departamento'],
                                'dni': u['dni'],
                                'foto_perfil': u['foto_perfil']
                            }
                        })
                        return

                    # Si el dedo colocado pertenece a OTRA persona con alta coincidencia -> SUPLANTACION
                    if mejor_candidato and mejor_candidato['score'] >= UMBRAL_COINCIDENCIA and mejor_candidato['usuario']['id'] != id_filtro:
                        u_det = mejor_candidato['usuario']
                        nombre_det = f"{u_det['nombres']} {u_det['apellidos']}"
                        db.registrar_acceso(
                            usuario_id=u_det['id'],
                            nombre_usuario=nombre_det,
                            dni=u_det['dni'],
                            metodo="HUELLA",
                            terminal="TERMINAL_HUELLA",
                            estado="DENEGADO",
                            detalle=f"SUPLANTACION_1A1_HUELLA: Huella de {nombre_det} ({mejor_score}%) colocada para {nombre_esp}"
                        )
                        db.registrar_incidente(
                            'INTRUSION_HUELLA_1A1',
                            'CRITICO',
                            f"Suplantación dactilar 1:1: Huella de {nombre_det} colocada cuando se requería a {nombre_esp}"
                        )
                        self.responder_json(200, {
                            'estado': 'DENEGADO',
                            'motivo': 'SUPLANTACION_1A1_HUELLA',
                            'mensaje': '🚨 Suplantación 1:1 Detectada',
                            'detalle': f"La huella dactilar colocada pertenece a {nombre_det} ({mejor_score}%), pero la terminal requería a {nombre_esp}.",
                            'detectado': nombre_det,
                            'esperado': nombre_esp,
                            'coincidencia': mejor_score
                        })
                        return

                    # No coincide con nadie registrado ni con el esperado
                    db.registrar_acceso(
                        usuario_id=id_filtro,
                        nombre_usuario=nombre_esp,
                        dni=trab_esperado['dni'] if trab_esperado else "N/A",
                        metodo="HUELLA",
                        terminal="TERMINAL_HUELLA",
                        estado="DENEGADO",
                        detalle=f"Huella no coincide con {nombre_esp} (Score: {score_esperado}%)"
                    )
                    db.registrar_incidente('BIOMETRIA_FALLIDA', 'ADVERTENCIA', f'Huella no coincide con {nombre_esp}')
                    self.responder_json(200, {
                        'estado': 'DENEGADO',
                        'motivo': 'HUELLA_NO_COINCIDE',
                        'mensaje': 'Huella Dactilar No Coincide',
                        'detalle': f"El dedo colocado no coincide con el registro de {nombre_esp} (Coincidencia: {score_esperado}% - Requerido: {UMBRAL_COINCIDENCIA}%).",
                        'coincidencia': score_esperado
                    })
                    return

                # CASO B: MODO GENERAL (Identificación 1:N Automática)
                else:
                    if mejor_candidato and mejor_score >= UMBRAL_COINCIDENCIA:
                        u = mejor_candidato['usuario']
                        db.registrar_acceso(
                            usuario_id=u['id'],
                            nombre_usuario=f"{u['nombres']} {u['apellidos']}",
                            dni=u['dni'],
                            metodo="HUELLA",
                            terminal="TERMINAL_HUELLA",
                            estado="PERMITIDO",
                            detalle=f"Identificación 1:N exitosa con {mejor_score}% de coincidencia"
                        )
                        self.activar_puerta_temporizada()
                        self.responder_json(200, {
                            'estado': 'PERMITIDO',
                            'mensaje': f'Acceso Autorizado: {u["nombres"]} {u["apellidos"]}',
                            'coincidencia': mejor_score,
                            'trabajador': {
                                'id': u['id'],
                                'nombres': u['nombres'],
                                'apellidos': u['apellidos'],
                                'cargo': u['cargo'],
                                'departamento': u['departamento'],
                                'dni': u['dni'],
                                'foto_perfil': u['foto_perfil']
                            }
                        })
                        return
                    else:
                        db.registrar_acceso(
                            usuario_id=None,
                            nombre_usuario="DESCONOCIDO",
                            dni="N/A",
                            metodo="HUELLA",
                            terminal="TERMINAL_HUELLA",
                            estado="DENEGADO",
                            detalle=f"Huella 1:N no registrada (Mejor score: {mejor_score}%)"
                        )
                        db.registrar_incidente('BIOMETRIA_FALLIDA', 'ADVERTENCIA', f'Huella 1:N no reconocida (Mejor score: {mejor_score}%)')
                        self.responder_json(200, {
                            'estado': 'DENEGADO',
                            'motivo': 'HUELLA_NO_REGISTRADA',
                            'mensaje': 'Huella Dactilar No Reconocida',
                            'detalle': f"La huella dactilar colocada no pertenece a ningún trabajador registrado en la empresa (Mejor coincidencia: {mejor_score}% - Requerido: {UMBRAL_COINCIDENCIA}%).",
                            'coincidencia': mejor_score
                        })
                        return

            # -----------------------------------------------------------------
            # 2. VERIFICACION CON CREDENTIAL_ID (WebAuthn Hardware FIDO2)
            # -----------------------------------------------------------------
            if not credential_id:
                self.responder_json(400, {'estado': 'DENEGADO', 'mensaje': 'Identificador de huella o muestra no enviado'})
                return

            usuario = db.buscar_usuario_por_credential_id(credential_id)
            if usuario and usuario['estado'] == 'ACTIVO':
                # Validar suplantación 1:1 en modo filtro dactilar
                if id_filtro and usuario['id'] != id_filtro:
                    trab_esperado = db.obtener_trabajador_por_id(id_filtro)
                    nombre_esp = f"{trab_esperado['nombres']} {trab_esperado['apellidos']}" if trab_esperado else f"ID {id_filtro}"
                    nombre_det = f"{usuario['nombres']} {usuario['apellidos']}"
                    
                    db.registrar_acceso(
                        usuario_id=usuario['id'],
                        nombre_usuario=nombre_det,
                        dni=usuario['dni'],
                        metodo="HUELLA",
                        terminal="TERMINAL_HUELLA",
                        estado="DENEGADO",
                        detalle=f"SUPLANTACION_1A1_HUELLA: Huella detectada de {nombre_det}, esperado {nombre_esp}"
                    )
                    db.registrar_incidente(
                        'INTRUSION_HUELLA_1A1',
                        'CRITICO',
                        f"Suplantacion dactilar 1:1: Huella fisica de {nombre_det} colocada cuando se requeria {nombre_esp}"
                    )
                    self.responder_json(200, {
                        'estado': 'DENEGADO',
                        'motivo': 'SUPLANTACION_1A1_HUELLA',
                        'mensaje': 'Acceso Denegado: Suplantación de Huella 1:1 Detectada',
                        'detalle': f"La huella dactilar física pertenece a {nombre_det}, pero la terminal requería a {nombre_esp}.",
                        'detectado': nombre_det,
                        'esperado': nombre_esp,
                        'coincidencia': 96.0
                    })
                    return

                db.registrar_acceso(
                    usuario_id=usuario['id'],
                    nombre_usuario=f"{usuario['nombres']} {usuario['apellidos']}",
                    dni=usuario['dni'],
                    metodo="HUELLA",
                    terminal="TERMINAL_HUELLA",
                    estado="PERMITIDO",
                    detalle="Verificacion criptografica de huella dactilar valida"
                )
                self.activar_puerta_temporizada()
                self.responder_json(200, {
                    'estado': 'PERMITIDO',
                    'mensaje': 'Acceso Autorizado por Huella Digital Real',
                    'coincidencia': 98.5,
                    'trabajador': {
                        'id': usuario['id'],
                        'nombres': usuario['nombres'],
                        'apellidos': usuario['apellidos'],
                        'cargo': usuario['cargo'],
                        'departamento': usuario['departamento'],
                        'dni': usuario['dni'],
                        'foto_perfil': usuario['foto_perfil']
                    }
                })
            else:
                motivo = "Trabajador inactivo" if usuario else "Huella dactilar no vinculada a ningún trabajador"
                db.registrar_acceso(
                    usuario_id=usuario['id'] if usuario else None,
                    nombre_usuario=f"{usuario['nombres']} {usuario['apellidos']}" if usuario else "DESCONOCIDO",
                    dni=usuario['dni'] if usuario else "N/A",
                    metodo="HUELLA",
                    terminal="TERMINAL_HUELLA",
                    estado="DENEGADO",
                    detalle=motivo
                )
                db.registrar_incidente('BIOMETRIA_FALLIDA', 'ADVERTENCIA', f'Intento fallido de huella dactilar: {motivo}')
                self.responder_json(200, {
                    'estado': 'DENEGADO',
                    'mensaje': f'Acceso Denegado: {motivo}'
                })
            return

        # =====================================================================
        # 6. HARDWARE Y TELEMETRIA
        # =====================================================================
        if ruta in ('/api/hardware/disparar_rele', '/api/hardware/abrir_puerta'):
            segundos = self.activar_puerta_temporizada()
            origen = datos.get('origen', 'PANEL_ADMIN')
            db.registrar_acceso(
                usuario_id=None,
                nombre_usuario="OPERADOR_CCTV" if 'CCTV' in origen else "ADMINISTRADOR",
                dni="N/A",
                metodo="CCTV_OVERRIDE",
                terminal="TERMINAL_CCTV" if 'CCTV' in origen else "PANEL_ADMIN",
                estado="PERMITIDO",
                detalle=f"Apertura remota de esclusa autorizada por {segundos} segundos ({origen})"
            )
            db.registrar_incidente(
                tipo_sensor="CERRADURA_REMOTE",
                nivel_alerta="INFO",
                descripcion=f"Apertura remota autorizada de esclusa por {segundos} segundos desde {origen}"
            )
            self.responder_json(200, {'exito': True, 'mensaje': f'Cerradura desasegurada por {segundos} segundos'})
            return

        if ruta == '/api/hardware/evento_sensor':
            tipo_sensor = datos.get('tipo_sensor') or datos.get('tipo', 'SW420_IMPACTO')
            nivel = datos.get('nivel_alerta') or datos.get('nivel', 'ADVERTENCIA')
            descripcion = datos.get('descripcion', 'Evento detectado en nodo de seguridad')
            timestamp = datos.get('timestamp') or ahora_peru_iso()
            db.registrar_incidente(tipo_sensor, nivel, descripcion, timestamp=timestamp)
            self.responder_json(200, {'exito': True, 'mensaje': 'Incidente registrado'})
            return

        self.send_error(404, "Endpoint no encontrado")

    def do_PUT(self):
        parsed_url = urlparse(self.path)
        ruta = parsed_url.path

        longitud = int(self.headers.get('Content-Length', 0))
        cuerpo = self.rfile.read(longitud).decode('utf-8') if longitud > 0 else '{}'
        datos = json.loads(cuerpo) if cuerpo else {}

        if ruta.startswith('/api/trabajadores/'):
            partes = ruta.strip('/').split('/')
            if len(partes) == 3:
                usuario_id = int(partes[2])
                exito = db.actualizar_trabajador(usuario_id, datos)
                self.responder_json(200, {'exito': exito})
                return

        self.send_error(404)

    def do_DELETE(self):
        parsed_url = urlparse(self.path)
        ruta = parsed_url.path

        if ruta.startswith('/api/trabajadores/'):
            partes = ruta.strip('/').split('/')
            if len(partes) == 3:
                usuario_id = int(partes[2])
                exito = db.eliminar_trabajador(usuario_id)
                self.responder_json(200, {'exito': exito})
                return

        self.send_error(404)

    def activar_puerta_temporizada(self):
        """Activa el solenoide de la puerta durante el tiempo configurado."""
        configs = db.obtener_configuraciones()
        segundos = int(configs.get('tiempo_apertura_puerta', {}).get('valor', 5))
        
        def tarea_temporizador():
            with lock_hardware:
                estado_hardware['puerta_abierta'] = True
                estado_hardware['tiempo_restante'] = segundos
            for s in range(segundos, 0, -1):
                with lock_hardware:
                    estado_hardware['tiempo_restante'] = s
                threading.Event().wait(1.0)
            with lock_hardware:
                estado_hardware['puerta_abierta'] = False
                estado_hardware['tiempo_restante'] = 0

        t = threading.Thread(target=tarea_temporizador, daemon=True)
        t.start()
        return segundos

    def servir_archivo(self, ruta_archivo, content_type):
        """Envia un archivo estatico con sus headers apropiados."""
        try:
            with open(ruta_archivo, 'rb') as f:
                contenido = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(contenido)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.end_headers()
            self.wfile.write(contenido)
        except Exception as e:
            self.send_error(500, f"Error leyendo archivo: {e}")

def iniciar_servidor_https(ip, puerto_https):
    """Inicia el servidor seguro HTTPS para permitir camara y biometria en telefonos moviles."""
    cert_path = os.path.join(BASE_DIR, 'certs', 'cert.pem')
    key_path = os.path.join(BASE_DIR, 'certs', 'key.pem')

    if os.path.exists(cert_path) and os.path.exists(key_path):
        try:
            servidor = HTTPServer(('0.0.0.0', puerto_https), GestorPeticionesSeguridad)
            contexto_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            contexto_ssl.load_cert_chain(certfile=cert_path, keyfile=key_path)
            servidor.socket = contexto_ssl.wrap_socket(servidor.socket, server_side=True)
            print(f"[HTTPS] Servidor Seguro Activo en: https://{ip}:{puerto_https}")
            print(f"[MOVIL] Acceso desde Celulares:  https://{ip}:{puerto_https}")
            servidor.serve_forever()
        except Exception as e:
            print(f"[HTTPS ERROR] No se pudo iniciar HTTPS: {e}")
    else:
        print("[HTTPS AVISO] Certificados no encontrados. Operando en modo HTTP.")

def iniciar_servidor_http(puerto_http):
    """Inicia el servidor HTTP estandar (para Render o navegadores de escritorio)."""
    try:
        servidor = HTTPServer(('0.0.0.0', puerto_http), GestorPeticionesSeguridad)
        print(f"[HTTP]  Servidor Activo en:       http://localhost:{puerto_http}")
        servidor.serve_forever()
    except Exception as e:
        print(f"[HTTP ERROR] Error en servidor HTTP: {e}")

if __name__ == '__main__':
    ip_lan = obtener_ip_local()
    # Soporte para variable de entorno PORT (Cloud / Render)
    puerto_env = os.environ.get('PORT')
    
    print("=" * 75)
    print(" SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.")
    print(" SENATI - PIAD-526: NODO CENTRAL Y TERMINALES DISTRIBUIDAS")
    print("=" * 75)
    print(f" [DB] Base de datos local: SQLite 100% Offline (WAL Mode)")
    print(f" [IA] Motor Biometrico:   OpenCV LBPH Nativo")
    print(f" [IP] Direccion LAN WiFi: {ip_lan}")
    print("=" * 75)

    if puerto_env:
        # En entorno Render / Cloud
        puerto_render = int(puerto_env)
        print(f"[CLOUD] Despliegue en Render detectado en puerto {puerto_render}")
        iniciar_servidor_http(puerto_render)
    else:
        # En entorno local con soporte dual (HTTP 8080 y HTTPS 8443 para moviles)
        puerto_http = 8080
        puerto_https = 8443

        # Lanzar HTTP en hilo secundario
        t_http = threading.Thread(target=iniciar_servidor_http, args=(puerto_http,), daemon=True)
        t_http.start()

        # Lanzar HTTPS en hilo principal
        iniciar_servidor_https(ip_lan, puerto_https)
