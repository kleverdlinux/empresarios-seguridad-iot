"""
=============================================================================
SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
SENATI - PIAD-526: GESTOR DE BASE DE DATOS LOCAL Y OFFLINE (SQLite)
=============================================================================
Modulo de persistencia 100% autonoma. Opera sin conexion a internet
y mantiene integridad transaccional ACID conforme a estandares ISO 27001.
"""

import sqlite3
import os
import json
from datetime import datetime, timezone, timedelta

# Zona horaria oficial de Perú: UTC-5 permanente (sin horario de verano)
TZ_PERU_FALLBACK = timezone(timedelta(hours=-5))
try:
    from zoneinfo import ZoneInfo
    TZ_PERU = ZoneInfo('America/Lima')
except Exception:
    TZ_PERU = TZ_PERU_FALLBACK

def ahora_peru_dt():
    """Obtiene el objeto datetime actual con hora oficial de Perú (UTC-5 garantizado)."""
    tz = TZ_PERU if TZ_PERU is not None else TZ_PERU_FALLBACK
    return datetime.now(tz)

def ahora_peru_iso():
    """Genera la fecha y hora oficial sincronizada con la hora de Perú (America/Lima UTC-5)."""
    return ahora_peru_dt().strftime('%Y-%m-%d %H:%M:%S')

DB_PATH = os.path.join(os.path.dirname(__file__), 'seguridad_empresariotec.db')

class DatabaseManager:
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.inicializar_tablas()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        # Activar Write-Ahead Logging para concurrencia rapida y cero bloqueos
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return conn

    def inicializar_tablas(self):
        """Crea las tablas del sistema e inserta configuraciones iniciales si no existen."""
        with self.get_connection() as conn:
            cursor = conn.cursor()

            # 1. Tabla de Usuarios / Trabajadores
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dni TEXT UNIQUE NOT NULL,
                nombres TEXT NOT NULL,
                apellidos TEXT NOT NULL,
                cargo TEXT NOT NULL,
                departamento TEXT NOT NULL,
                estado TEXT NOT NULL DEFAULT 'ACTIVO',
                fecha_registro TEXT NOT NULL,
                foto_perfil TEXT,
                huella_registrada INTEGER NOT NULL DEFAULT 0,
                huella_credential_id TEXT,
                huella_public_key TEXT,
                as608_finger_id INTEGER DEFAULT -1,
                rostro_registrado INTEGER NOT NULL DEFAULT 0,
                fotos_entrenadas INTEGER NOT NULL DEFAULT 0
            );
            """)

            # 2. Tabla de Fotos Faciales para entrenamiento LBPH
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS fotos_faciales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER NOT NULL,
                ruta_imagen TEXT NOT NULL,
                fecha_captura TEXT NOT NULL,
                FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
            );
            """)

            # 3. Tabla de Configuracion de Terminales y Parametros
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS configuracion_terminales (
                clave TEXT PRIMARY KEY NOT NULL,
                valor TEXT NOT NULL,
                descripcion TEXT,
                actualizado_en TEXT NOT NULL
            );
            """)

            # 4. Tabla de Auditoria de Accesos
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS logs_acceso (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER,
                nombre_usuario TEXT NOT NULL,
                dni TEXT,
                metodo TEXT NOT NULL,       -- 'FACIAL', 'HUELLA', 'CCTV_OVERRIDE', 'ADMIN'
                terminal TEXT NOT NULL,     -- 'TERMINAL_FACIAL', 'TERMINAL_HUELLA', 'TERMINAL_CCTV', 'PANEL_ADMIN'
                estado TEXT NOT NULL,       -- 'PERMITIDO', 'DENEGADO'
                detalle TEXT,
                timestamp TEXT NOT NULL
            );
            """)

            # 5. Tabla de Incidentes de Seguridad y Telemetria IoT
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS logs_incidentes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo_sensor TEXT NOT NULL,  -- 'SW420_IMPACTO', 'PIR_PRESENCIA', 'BIOMETRIA_FALLIDA', 'PUERTA_FORZADA'
                nivel_alerta TEXT NOT NULL, -- 'INFO', 'ADVERTENCIA', 'CRITICO'
                descripcion TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
            """)

            # 6. Sembrar configuraciones por defecto si no existen
            ahora = datetime.now().isoformat()
            configs_defecto = [
                ('admin_user', 'admin', 'Usuario Administrador Maestro', ahora),
                ('admin_pwd', 'admin123', 'Contraseña Panel Maestro Admin', ahora),
                ('terminal_facial_pwd', 'FACIAL2026', 'Contraseña Terminal de Reconocimiento Facial', ahora),
                ('terminal_huella_pwd', 'HUELLA2026', 'Contraseña Terminal Biometrico Dactilar', ahora),
                ('terminal_cctv_pwd', 'CCTV2026', 'Contraseña Centro de Monitoreo CCTV', ahora),
                ('tiempo_apertura_puerta', '5', 'Tiempo de activacion de solenoide/cerradura (segundos)', ahora),
                ('umbral_confianza_facial', '70', 'Umbral de distancia LBPH (menor es mayor precision)', ahora),
                ('empresa_nombre', 'EMPRESARIOTEC S.A.', 'Razon social de la organizacion', ahora)
            ]

            for clave, valor, desc, fecha in configs_defecto:
                cursor.execute("""
                INSERT OR IGNORE INTO configuracion_terminales (clave, valor, descripcion, actualizado_en)
                VALUES (?, ?, ?, ?);
                """, (clave, valor, desc, fecha))

            # 7. Sembrar usuario inicial (Admin/Tecnico Gabriel Apaza) si la tabla esta vacia
            cursor.execute("SELECT COUNT(*) AS total FROM usuarios;")
            if cursor.fetchone()['total'] == 0:
                cursor.execute("""
                INSERT INTO usuarios (dni, nombres, apellidos, cargo, departamento, estado, fecha_registro, huella_registrada, rostro_registrado, fotos_entrenadas)
                VALUES (?, ?, ?, ?, ?, 'ACTIVO', ?, 0, 0, 0);
                """, ('001643199', 'Kleverd Gabriel', 'Apaza Quispe', 'Administrador de Seguridad IoT', 'Tecnología y Operaciones', ahora))

            conn.commit()

    # =========================================================================
    # METODOS DE AUTENTICACION Y CONFIGURACION
    # =========================================================================

    def verificar_admin(self, usuario, password):
        """Verifica credenciales del panel de administracion."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT valor FROM configuracion_terminales WHERE clave = 'admin_user';")
            user_row = cursor.fetchone()
            cursor.execute("SELECT valor FROM configuracion_terminales WHERE clave = 'admin_pwd';")
            pwd_row = cursor.fetchone()

            if user_row and pwd_row:
                return user_row['valor'] == usuario and pwd_row['valor'] == password
            return False

    def verificar_password_terminal(self, tipo_terminal, password):
        """
        Verifica la contraseña de acceso a un terminal especifico.
        tipo_terminal: 'facial', 'huella', 'cctv'
        """
        clave_map = {
            'facial': 'terminal_facial_pwd',
            'huella': 'terminal_huella_pwd',
            'cctv': 'terminal_cctv_pwd'
        }
        clave_db = clave_map.get(tipo_terminal.lower())
        if not clave_db:
            return False

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT valor FROM configuracion_terminales WHERE clave = ?;", (clave_db,))
            row = cursor.fetchone()
            if row:
                return row['valor'] == password
            return False

    def obtener_configuraciones(self):
        """Retorna todas las configuraciones del sistema en formato diccionario."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT clave, valor, descripcion, actualizado_en FROM configuracion_terminales;")
            filas = cursor.fetchall()
            return {f['clave']: {'valor': f['valor'], 'descripcion': f['descripcion'], 'actualizado_en': f['actualizado_en']} for f in filas}

    def actualizar_configuracion(self, clave, nuevo_valor):
        """Actualiza el valor de una configuracion (por ejemplo contraseñas de terminales)."""
        ahora = datetime.now().isoformat()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE configuracion_terminales
            SET valor = ?, actualizado_en = ?
            WHERE clave = ?;
            """, (nuevo_valor, ahora, clave))
            conn.commit()
            return cursor.rowcount > 0

    # =========================================================================
    # METODOS DE GESTION DE TRABAJADORES
    # =========================================================================

    def crear_trabajador(self, dni, nombres, apellidos, cargo, departamento, foto_perfil=None):
        """Registra un nuevo trabajador en el sistema."""
        ahora = datetime.now().isoformat()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO usuarios (dni, nombres, apellidos, cargo, departamento, estado, fecha_registro, foto_perfil, huella_registrada, rostro_registrado, fotos_entrenadas)
            VALUES (?, ?, ?, ?, ?, 'ACTIVO', ?, ?, 0, 0, 0);
            """, (dni, nombres, apellidos, cargo, departamento, ahora, foto_perfil))
            conn.commit()
            return cursor.lastrowid

    def obtener_trabajadores(self):
        """Obtiene la lista de todos los trabajadores registrados."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT id, dni, nombres, apellidos, cargo, departamento, estado, 
                   fecha_registro, foto_perfil, huella_registrada, rostro_registrado, fotos_entrenadas
            FROM usuarios
            ORDER BY id DESC;
            """)
            return [dict(f) for f in cursor.fetchall()]

    def obtener_trabajador_por_id(self, usuario_id):
        """Obtiene el registro completo de un trabajador por su ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM usuarios WHERE id = ?;", (usuario_id,))
            fila = cursor.fetchone()
            return dict(fila) if fila else None

    def obtener_trabajador_por_dni(self, dni):
        """Obtiene el registro de un trabajador por su numero de DNI."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM usuarios WHERE dni = ?;", (dni,))
            fila = cursor.fetchone()
            return dict(fila) if fila else None

    def actualizar_trabajador(self, usuario_id, datos):
        """Actualiza campos especificos de un trabajador."""
        campos_permitidos = ['dni', 'nombres', 'apellidos', 'cargo', 'departamento', 'estado', 'foto_perfil']
        actualizaciones = []
        valores = []

        for k in campos_permitidos:
            if k in datos:
                actualizaciones.append(f"{k} = ?")
                valores.append(datos[k])

        if not actualizaciones:
            return False

        valores.append(usuario_id)
        consulta = f"UPDATE usuarios SET {', '.join(actualizaciones)} WHERE id = ?;"

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(consulta, tuple(valores))
            conn.commit()
            return cursor.rowcount > 0

    def eliminar_trabajador(self, usuario_id):
        """Elimina a un trabajador y sus datos asociados."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM usuarios WHERE id = ?;", (usuario_id,))
            conn.commit()
            return cursor.rowcount > 0

    # =========================================================================
    # METODOS DE BIOMETRIA (FACIAL Y DACTILAR)
    # =========================================================================

    def guardar_foto_facial(self, usuario_id, ruta_imagen):
        """Registra una foto facial guardada para el dataset de entrenamiento."""
        ahora = datetime.now().isoformat()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO fotos_faciales (usuario_id, ruta_imagen, fecha_captura)
            VALUES (?, ?, ?);
            """, (usuario_id, ruta_imagen, ahora))

            # Incrementar conteo de fotos entrenadas
            cursor.execute("""
            UPDATE usuarios
            SET fotos_entrenadas = fotos_entrenadas + 1, rostro_registrado = 1
            WHERE id = ?;
            """, (usuario_id,))
            conn.commit()
            return cursor.lastrowid

    def obtener_fotos_usuario(self, usuario_id):
        """Retorna todas las rutas de fotos faciales de un usuario."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT ruta_imagen FROM fotos_faciales WHERE usuario_id = ?;", (usuario_id,))
            return [f['ruta_imagen'] for f in cursor.fetchall()]

    def limpiar_fotos_faciales_usuario(self, usuario_id):
        """Elimina todos los registros de fotos faciales de un usuario y reinicia contadores para evitar residuos."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM fotos_faciales WHERE usuario_id = ?;", (usuario_id,))
            cursor.execute("""
            UPDATE usuarios
            SET fotos_entrenadas = 0, rostro_registrado = 0, foto_perfil = NULL
            WHERE id = ?;
            """, (usuario_id,))
            conn.commit()
            return True

    def registrar_huella_webauthn(self, usuario_id, credential_id, public_key):
        """Registra la credencial dactilar de hardware (WebAuthn / Biometria Movil)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE usuarios
            SET huella_registrada = 1,
                huella_credential_id = ?,
                huella_public_key = ?
            WHERE id = ?;
            """, (credential_id, public_key, usuario_id))
            conn.commit()
            return cursor.rowcount > 0

    def buscar_usuario_por_credential_id(self, credential_id):
        """Busca el trabajador propietario de la credencial dactilar."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM usuarios WHERE huella_credential_id = ?;", (credential_id,))
            fila = cursor.fetchone()
            return dict(fila) if fila else None

    def desvincular_huella(self, usuario_id):
        """Desvincula y purga la credencial dactilar de un trabajador en SQLite."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE usuarios
            SET huella_registrada = 0,
                huella_credential_id = NULL,
                huella_public_key = NULL
            WHERE id = ?;
            """, (usuario_id,))
            conn.commit()
            return cursor.rowcount > 0

    # =========================================================================
    # AUDITORIA, ACCESOS E INCIDENTES
    # =========================================================================

    def registrar_acceso(self, usuario_id, nombre_usuario, dni, metodo, terminal, estado, detalle="", timestamp=None):
        """Registra un evento de acceso en el log auditable con hora oficial de Perú."""
        ahora = timestamp or ahora_peru_iso()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO logs_acceso (usuario_id, nombre_usuario, dni, metodo, terminal, estado, detalle, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """, (usuario_id, nombre_usuario, dni, metodo, terminal, estado, detalle, ahora))
            conn.commit()
            return cursor.lastrowid

    def obtener_logs_acceso(self, limite=2000, filtro=None, desde=None, hasta=None, terminal=None, estado=None, texto=None):
        """Obtiene eventos de acceso con filtros multi-criterio flexibles (fechas, lugar/terminal, estado, texto)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            condiciones = []
            params = []

            # 1. Filtro rápido de estado / método / terminal
            if filtro and filtro.upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                condiciones.append("(estado = ? OR metodo = ? OR terminal = ?)")
                params.extend([filtro, filtro, filtro])

            # 2. Rango de Fechas
            if desde and str(desde).strip():
                condiciones.append("timestamp >= ?")
                params.append(f"{str(desde).strip()} 00:00:00")

            if hasta and str(hasta).strip():
                condiciones.append("timestamp <= ?")
                params.append(f"{str(hasta).strip()} 23:59:59")

            # 3. Terminal / Lugar
            if terminal and str(terminal).strip().upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                t_val = str(terminal).strip()
                condiciones.append("(terminal = ? OR terminal LIKE ?)")
                params.extend([t_val, f"%{t_val}%"])

            # 4. Estado de Acceso
            if estado and str(estado).strip().upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                condiciones.append("estado = ?")
                params.append(str(estado).strip().upper())

            # 5. Búsqueda de Texto (DNI, Nombre, Detalle)
            if texto and str(texto).strip():
                q = f"%{str(texto).strip()}%"
                condiciones.append("(nombre_usuario LIKE ? OR dni LIKE ? OR detalle LIKE ? OR terminal LIKE ?)")
                params.extend([q, q, q, q])

            query = "SELECT * FROM logs_acceso"
            if condiciones:
                query += " WHERE " + " AND ".join(condiciones)
            query += " ORDER BY id DESC LIMIT ?;"
            params.append(limite)

            cursor.execute(query, tuple(params))
            return [dict(f) for f in cursor.fetchall()]

    def obtener_logs_acceso_por_usuario(self, usuario_id, limite=100):
        """Obtiene el historial de marcaciones de un trabajador específico."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT * FROM logs_acceso 
            WHERE usuario_id = ? 
            ORDER BY id DESC LIMIT ?;
            """, (usuario_id, limite))
            return [dict(f) for f in cursor.fetchall()]

    def registrar_incidente(self, tipo_sensor, nivel_alerta, descripcion, timestamp=None):
        """Registra una anomalia o alerta en la tabla de incidentes con hora oficial de Perú."""
        ahora = timestamp or ahora_peru_iso()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO logs_incidentes (tipo_sensor, nivel_alerta, descripcion, timestamp)
            VALUES (?, ?, ?, ?);
            """, (tipo_sensor, nivel_alerta, descripcion, ahora))
            conn.commit()
            return cursor.lastrowid

    def obtener_logs_incidentes(self, limite=1000, desde=None, hasta=None, sensor=None, nivel=None, texto=None):
        """Obtiene el historial de incidentes de seguridad con filtros flexibles (fechas, sensor, nivel, texto)."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            condiciones = []
            params = []

            if desde and str(desde).strip():
                condiciones.append("timestamp >= ?")
                params.append(f"{str(desde).strip()} 00:00:00")

            if hasta and str(hasta).strip():
                condiciones.append("timestamp <= ?")
                params.append(f"{str(hasta).strip()} 23:59:59")

            if sensor and str(sensor).strip().upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                s_val = str(sensor).strip()
                condiciones.append("(tipo_sensor = ? OR tipo_sensor LIKE ?)")
                params.extend([s_val, f"%{s_val}%"])

            if nivel and str(nivel).strip().upper() not in ('', 'TODOS', 'TODAS', 'ALL'):
                condiciones.append("nivel_alerta = ?")
                params.append(str(nivel).strip().upper())

            if texto and str(texto).strip():
                q = f"%{str(texto).strip()}%"
                condiciones.append("(descripcion LIKE ? OR tipo_sensor LIKE ?)")
                params.extend([q, q])

            query = "SELECT * FROM logs_incidentes"
            if condiciones:
                query += " WHERE " + " AND ".join(condiciones)
            query += " ORDER BY id DESC LIMIT ?;"
            params.append(limite)

            cursor.execute(query, tuple(params))
            return [dict(f) for f in cursor.fetchall()]

    def limpiar_logs_incidentes(self):
        """Vacía exclusivamente la tabla logs_incidentes a cero y reinicia su secuencia."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM logs_incidentes;")
            cursor.execute("DELETE FROM sqlite_sequence WHERE name='logs_incidentes';")
            conn.commit()
            return True

    def resetear_base_de_datos_a_cero(self, purgar_usuarios_secundarios=True):
        """
        Purga y restablece la base de datos a CERO total:
        - Vacía logs_acceso (0 registros)
        - Vacía logs_incidentes (0 registros)
        - Vacía fotos_faciales (0 registros)
        - Reinicia las secuencias AUTOINCREMENT
        - Preserva configuración de terminales y la cuenta administrativa del sistema.
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM logs_acceso;")
            cursor.execute("DELETE FROM logs_incidentes;")
            cursor.execute("DELETE FROM fotos_faciales;")
            cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('logs_acceso', 'logs_incidentes', 'fotos_faciales');")

            if purgar_usuarios_secundarios:
                # Mantener solo el usuario admin primario si existe, limpiando datos de prueba secundarios
                cursor.execute("DELETE FROM usuarios WHERE dni != '001643199';")
                cursor.execute("""
                UPDATE usuarios 
                SET rostro_registrado = 0, fotos_entrenadas = 0, huella_registrada = 0,
                    huella_credential_id = NULL, huella_public_key = NULL
                WHERE dni = '001643199';
                """)
            conn.commit()
            return True

    def obtener_estadisticas_dashboard(self):
        """Retorna las metricas operativas en tiempo real para el panel de administracion."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS total FROM usuarios WHERE estado = 'ACTIVO';")
            total_trabajadores = cursor.fetchone()['total']

            cursor.execute("SELECT COUNT(*) AS total FROM logs_acceso WHERE estado = 'PERMITIDO';")
            accesos_permitidos = cursor.fetchone()['total']

            cursor.execute("SELECT COUNT(*) AS total FROM logs_acceso WHERE estado = 'DENEGADO';")
            accesos_denegados = cursor.fetchone()['total']

            cursor.execute("SELECT COUNT(*) AS total FROM logs_incidentes WHERE nivel_alerta = 'CRITICO';")
            alertas_criticas = cursor.fetchone()['total']

            cursor.execute("SELECT COUNT(*) AS total FROM usuarios WHERE rostro_registrado = 1;")
            rostros_activos = cursor.fetchone()['total']

            cursor.execute("SELECT COUNT(*) AS total FROM usuarios WHERE huella_registrada = 1;")
            huellas_activas = cursor.fetchone()['total']

            return {
                'total_trabajadores': total_trabajadores,
                'accesos_permitidos': accesos_permitidos,
                'accesos_denegados': accesos_denegados,
                'alertas_criticas': alertas_criticas,
                'rostros_activos': rostros_activos,
                'huellas_activas': huellas_activas
            }
