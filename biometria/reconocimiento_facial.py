"""
=============================================================================
SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
SENATI - PIAD-526: MOTOR DE RECONOCIMIENTO FACIAL LBPH (OpenCV)
=============================================================================
Implementacion biometrica real basada en Local Binary Patterns Histograms (LBPH).
Cero simulacion: procesa matrices de imagen en tiempo real, normaliza iluminacion,
detecta regiones de interes (ROI) y clasifica rostros autorizados.
"""

import cv2
import numpy as np
import base64
import os
import time
from datetime import datetime

DIRECTORIO_ACTUAL = os.path.dirname(os.path.abspath(__file__))
HAAR_PATH = os.path.join(DIRECTORIO_ACTUAL, 'haar', 'haarcascade_frontalface_default.xml')
MODELO_PATH = os.path.join(DIRECTORIO_ACTUAL, 'modelos', 'modelo_lbph_empresariotec.xml')
UPLOADS_DIR = os.path.abspath(os.path.join(DIRECTORIO_ACTUAL, '..', 'static', 'uploads', 'faces'))

class MotorFacialLBPH:
    def __init__(self, haar_path=HAAR_PATH, modelo_path=MODELO_PATH):
        self.haar_path = haar_path
        self.modelo_path = modelo_path
        self.detector_rostros = cv2.CascadeClassifier(self.haar_path)
        
        # Instanciar reconocedor LBPH nativo de OpenCV
        self.reconocedor = cv2.face.LBPHFaceRecognizer_create(
            radius=1,
            neighbors=8,
            grid_x=8,
            grid_y=8,
            threshold=110.0
        )
        self.modelo_entrenado = False
        self.cargar_modelo_existente()

    def cargar_modelo_existente(self):
        """Intenta cargar el archivo de entrenamiento XML si ya existe en disco."""
        if os.path.exists(self.modelo_path) and os.path.getsize(self.modelo_path) > 100:
            try:
                self.reconocedor.read(self.modelo_path)
                self.modelo_entrenado = True
                print(f"[BIOMETRIA] Modelo LBPH cargado exitosamente desde: {self.modelo_path}")
            except Exception as e:
                print(f"[BIOMETRIA] Error al cargar modelo existente: {e}")
                self.modelo_entrenado = False
        else:
            self.modelo_entrenado = False

    def decodificar_base64_a_cv2(self, imagen_base64):
        """Convierte una cadena base64 transmitida por el frontend en una imagen OpenCV (BGR)."""
        try:
            if ',' in imagen_base64:
                imagen_base64 = imagen_base64.split(',', 1)[1]
            img_bytes = base64.b64decode(imagen_base64)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            return img_bgr
        except Exception as e:
            print(f"[ERROR] Fallo decodificando imagen base64: {e}")
            return None

    def normalizar_rostro(self, rostro_gris):
        """
        Aplica CLAHE (Contrast Limited Adaptive Histogram Equalization)
        y redimensionado estandar (200x200) para maxima precision biometrica ante sombras.
        """
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        rostro_clahe = clahe.apply(rostro_gris)
        rostro_normalizado = cv2.resize(rostro_clahe, (200, 200), interpolation=cv2.INTER_CUBIC)
        return rostro_normalizado

    def detectar_y_extraer_rostros(self, img_bgr):
        """
        Localiza rostros en el frame usando Haar Cascade.
        Retorna lista de tuplas: (rostro_normalizado, (x, y, w, h))
        """
        if img_bgr is None:
            return []
        
        gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        rostros_detectados = self.detector_rostros.detectMultiScale(
            gris,
            scaleFactor=1.15,
            minNeighbors=5,
            minSize=(80, 80)
        )

        resultados = []
        for (x, y, w, h) in rostros_detectados:
            roi_gris = gris[y:y+h, x:x+w]
            roi_proc = self.normalizar_rostro(roi_gris)
            resultados.append((roi_proc, (int(x), int(y), int(w), int(h))))
        
        return resultados

    def limpiar_muestras_usuario(self, usuario_id, db_manager):
        """
        Elimina todas las fotos físicas en static/uploads/faces/usuario_{id}/
        y limpia los registros en la base de datos SQLite para evitar residuos anteriores.
        """
        dir_usuario = os.path.join(UPLOADS_DIR, f"usuario_{usuario_id}")
        if os.path.exists(dir_usuario):
            try:
                for f in os.listdir(dir_usuario):
                    fp = os.path.join(dir_usuario, f)
                    if os.path.isfile(fp):
                        os.remove(fp)
            except Exception as e:
                print(f"[BIOMETRIA] Error limpiando directorio {dir_usuario}: {e}")
        db_manager.limpiar_fotos_faciales_usuario(usuario_id)

    def capturar_muestra_rostro(self, usuario_id, imagen_base64, db_manager, limpiar_previas=False):
        """
        Extrae el rostro del frame capturado por la camara del movil/webcam,
        lo guarda en la carpeta de datasets y lo asocia en la base de datos SQLite.
        Si limpiar_previas es True, purga las fotos antiguas antes de guardar la nueva.
        """
        if limpiar_previas:
            self.limpiar_muestras_usuario(usuario_id, db_manager)

        img_bgr = self.decodificar_base64_a_cv2(imagen_base64)
        if img_bgr is None:
            return {'exito': False, 'mensaje': 'Formato de imagen invalido'}

        rostros = self.detectar_y_extraer_rostros(img_bgr)
        if len(rostros) == 0:
            return {'exito': False, 'mensaje': 'No se detecto ningun rostro claro en la imagen. Centra tu rostro en la camara.'}

        # Tomar el rostro de mayor tamaño detectado
        rostro_roi, (x, y, w, h) = max(rostros, key=lambda item: item[1][2] * item[1][3])

        dir_usuario = os.path.join(UPLOADS_DIR, f"usuario_{usuario_id}")
        os.makedirs(dir_usuario, exist_ok=True)

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        nombre_archivo = f"face_{usuario_id}_{timestamp_str}.jpg"
        ruta_guardado = os.path.join(dir_usuario, nombre_archivo)

        # Guardar muestra preprocesada
        cv2.imwrite(ruta_guardado, rostro_roi)

        # Guardar foto de perfil tambien si no tiene
        ruta_relativa = f"/static/uploads/faces/usuario_{usuario_id}/{nombre_archivo}"
        db_manager.guardar_foto_facial(usuario_id, ruta_relativa)

        # Re-entrenar modelo automaticamente en segundo plano
        conteo_fotos = len(db_manager.obtener_fotos_usuario(usuario_id))
        self.entrenar_modelo_lbph(db_manager)

        return {
            'exito': True,
            'mensaje': f'Muestra facial #{conteo_fotos} registrada y entrenada exitosamente.',
            'total_muestras': conteo_fotos,
            'ruta_foto': ruta_relativa
        }

    def entrenar_modelo_lbph(self, db_manager):
        """
        Lee todas las muestras de rostros registradas en SQLite y entrena
        el reconocedor LBPH. Guarda el resultado en 'modelo_lbph_empresariotec.xml'.
        """
        trabajadores = db_manager.obtener_trabajadores()
        rostros_entrenamiento = []
        etiquetas_usuarios = []

        total_muestras = 0
        for trab in trabajadores:
            uid = trab['id']
            dir_usuario = os.path.join(UPLOADS_DIR, f"usuario_{uid}")
            if not os.path.exists(dir_usuario):
                continue

            for archivo in os.listdir(dir_usuario):
                if archivo.lower().endswith(('.jpg', '.jpeg', '.png')):
                    ruta_img = os.path.join(dir_usuario, archivo)
                    img_gris = cv2.imread(ruta_img, cv2.IMREAD_GRAYSCALE)
                    if img_gris is not None:
                        rostro_norm = cv2.resize(img_gris, (200, 200))
                        rostros_entrenamiento.append(rostro_norm)
                        etiquetas_usuarios.append(int(uid))
                        total_muestras += 1

        if len(rostros_entrenamiento) == 0:
            print("[BIOMETRIA] No hay muestras faciales suficientes para entrenar.")
            return {'exito': False, 'mensaje': 'Sin muestras para entrenar'}

        print(f"[BIOMETRIA] Entrenando modelo LBPH con {total_muestras} muestras...")
        self.reconocedor.train(rostros_entrenamiento, np.array(etiquetas_usuarios))
        os.makedirs(os.path.dirname(self.modelo_path), exist_ok=True)
        self.reconocedor.write(self.modelo_path)
        self.modelo_entrenado = True

        print(f"[BIOMETRIA] Entrenamiento finalizado. Modelo guardado en: {self.modelo_path}")
        return {
            'exito': True,
            'mensaje': f'Modelo LBPH re-entrenado con {total_muestras} muestras faciales.',
            'total_muestras': total_muestras
        }

    def verificar_rostro_en_vivo(self, imagen_base64, db_manager, umbral_confianza=42.0, usuario_id_filtro=None):
        """
        Analiza un fotograma enviado por el terminal facial movil.
        Detecta el rostro, predice con LBPH y valida con precision estricta si el trabajador esta autorizado.
        Soporta modo 1:1 (usuario_id_filtro) y modo 1:N automatico con umbral estricto <= 42.0.
        """
        img_bgr = self.decodificar_base64_a_cv2(imagen_base64)
        if img_bgr is None:
            return {'estado': 'ERROR', 'mensaje': 'Transmision de video ilegible'}

        rostros = self.detectar_y_extraer_rostros(img_bgr)
        if len(rostros) == 0:
            return {
                'estado': 'BUSCANDO',
                'mensaje': 'Posicione su rostro frente a la camara',
                'coordenadas': None
            }

        # Tomar el rostro dominante
        rostro_roi, (x, y, w, h) = max(rostros, key=lambda item: item[1][2] * item[1][3])
        coordenadas = {'x': x, 'y': y, 'w': w, 'h': h}

        if not self.modelo_entrenado:
            # Si todavia no hay fotos entrenadas en el sistema
            db_manager.registrar_acceso(
                usuario_id=None,
                nombre_usuario="DESCONOCIDO",
                dni="N/A",
                metodo="FACIAL",
                terminal="TERMINAL_FACIAL",
                estado="DENEGADO",
                detalle="Sistema sin base biometrica entrenada"
            )
            return {
                'estado': 'DENEGADO',
                'mensaje': 'Base facial sin entrenar en el sistema',
                'coordenadas': coordenadas,
                'confianza': 0
            }

        try:
            label_uid, distancia_lbph = self.reconocedor.predict(rostro_roi)
            # Umbral de alta exigencia: distancia <= 42.0 (Tope estricto anti-intrusos)
            umbral_estricto = min(42.0, float(umbral_confianza))

            # Cálculo de similitud calibrado y realista:
            if distancia_lbph <= umbral_estricto:
                porcentaje_similitud = max(75, min(99, int(100 - (distancia_lbph * 0.65))))
            else:
                porcentaje_similitud = max(0, min(65, int(100 - (distancia_lbph * 1.2))))

            print(f"[LBPH PREDICT] Predicho: {label_uid} | Filtro: {usuario_id_filtro} | Distancia: {distancia_lbph:.2f} | Similitud: {porcentaje_similitud}% | Umbral: {umbral_estricto}", flush=True)

            # MODO 1:1 ASISTIDO (Si se seleccionó un colaborador específico en la lista)
            if usuario_id_filtro:
                try:
                    id_esperado = int(usuario_id_filtro)
                except (ValueError, TypeError):
                    id_esperado = None

                if id_esperado:
                    usuario_sel = db_manager.obtener_trabajador_por_id(id_esperado)
                    nom_sel = f"{usuario_sel['nombres']} {usuario_sel['apellidos']}" if usuario_sel else f"ID {id_esperado}"

                    # CASO 1: Suplantación detectada (El rostro en la cámara es de otra persona)
                    if label_uid != id_esperado:
                        usuario_detectado = db_manager.obtener_trabajador_por_id(label_uid)
                        nom_detectado = f"{usuario_detectado['nombres']} {usuario_detectado['apellidos']}" if usuario_detectado else f"ID {label_uid}"
                        db_manager.registrar_acceso(
                            usuario_id=id_esperado,
                            nombre_usuario=nom_sel,
                            dni=usuario_sel['dni'] if usuario_sel else "N/A",
                            metodo="FACIAL",
                            terminal="TERMINAL_FACIAL",
                            estado="DENEGADO",
                            detalle=f"Suplantación 1:1 Bloqueada: Esperado={nom_sel} | Detectado={nom_detectado}"
                        )
                        db_manager.registrar_incidente(
                            tipo_sensor="INTRUSION_FACIAL_1A1",
                            nivel_alerta="CRITICO",
                            descripcion=f"Suplantación 1:1 Bloqueada: Se esperaba a {nom_sel}, pero se presentó {nom_detectado}"
                        )
                        return {
                            'estado': 'DENEGADO',
                            'motivo': 'SUPLANTACION_1A1',
                            'mensaje': f'Acceso Denegado: Su rostro pertenece a {nom_detectado}, no a {nom_sel}.',
                            'esperado': nom_sel,
                            'detectado': nom_detectado,
                            'coordenadas': coordenadas,
                            'similitud': porcentaje_similitud,
                            'distancia': round(distancia_lbph, 2)
                        }

                    # CASO 2: Coincide el ID, pero la distancia no cumple el umbral estricto
                    if distancia_lbph > umbral_estricto or porcentaje_similitud < 75:
                        db_manager.registrar_acceso(
                            usuario_id=id_esperado,
                            nombre_usuario=nom_sel,
                            dni=usuario_sel['dni'] if usuario_sel else "N/A",
                            metodo="FACIAL",
                            terminal="TERMINAL_FACIAL",
                            estado="DENEGADO",
                            detalle=f"Rostro no coincide con patrones de {nom_sel} (Distancia: {distancia_lbph:.1f})"
                        )
                        return {
                            'estado': 'DENEGADO',
                            'motivo': 'UMBRAL_INSUFICIENTE',
                            'mensaje': f'Acceso Denegado: Su rostro no coincide con los patrones de {nom_sel}.',
                            'esperado': nom_sel,
                            'coordenadas': coordenadas,
                            'similitud': porcentaje_similitud,
                            'distancia': round(distancia_lbph, 2)
                        }

                    # CASO 3: Verificación 1:1 Exitosa y Autorizada
                    if usuario_sel and usuario_sel['estado'] == 'ACTIVO':
                        db_manager.registrar_acceso(
                            usuario_id=usuario_sel['id'],
                            nombre_usuario=nom_sel,
                            dni=usuario_sel['dni'],
                            metodo="FACIAL",
                            terminal="TERMINAL_FACIAL",
                            estado="PERMITIDO",
                            detalle=f"1:1 Verificado LBPH Dist: {distancia_lbph:.1f} ({porcentaje_similitud}%)"
                        )
                        return {
                            'estado': 'PERMITIDO',
                            'mensaje': f'Acceso Autorizado: {nom_sel}',
                            'trabajador': {
                                'id': usuario_sel['id'],
                                'nombres': usuario_sel['nombres'],
                                'apellidos': usuario_sel['apellidos'],
                                'cargo': usuario_sel['cargo'],
                                'departamento': usuario_sel['departamento'],
                                'dni': usuario_sel['dni'],
                                'foto_perfil': usuario_sel['foto_perfil']
                            },
                            'similitud': porcentaje_similitud,
                            'distancia': round(distancia_lbph, 2),
                            'coordenadas': coordenadas
                        }
                    else:
                        return {
                            'estado': 'DENEGADO',
                            'mensaje': 'Acceso Denegado: Trabajador inactivo',
                            'coordenadas': coordenadas
                        }

            # VERIFICACIÓN EN MODO AUTOMÁTICO 1:N (Para toda la nómina)
            if distancia_lbph <= umbral_estricto and porcentaje_similitud >= 75:
                # Coincidencia biometrica positiva y estricta
                usuario = db_manager.obtener_trabajador_por_id(label_uid)
                if usuario and usuario['estado'] == 'ACTIVO':
                    db_manager.registrar_acceso(
                        usuario_id=usuario['id'],
                        nombre_usuario=f"{usuario['nombres']} {usuario['apellidos']}",
                        dni=usuario['dni'],
                        metodo="FACIAL",
                        terminal="TERMINAL_FACIAL",
                        estado="PERMITIDO",
                        detalle=f"LBPH Dist: {distancia_lbph:.1f} ({porcentaje_similitud}%)"
                    )
                    return {
                        'estado': 'PERMITIDO',
                        'mensaje': 'Acceso Autorizado',
                        'trabajador': {
                            'id': usuario['id'],
                            'nombres': usuario['nombres'],
                            'apellidos': usuario['apellidos'],
                            'cargo': usuario['cargo'],
                            'departamento': usuario['departamento'],
                            'dni': usuario['dni'],
                            'foto_perfil': usuario['foto_perfil']
                        },
                        'similitud': porcentaje_similitud,
                        'distancia': round(distancia_lbph, 2),
                        'coordenadas': coordenadas
                    }
                else:
                    estado_motivo = "Trabajador inactivo" if usuario else "Registro no encontrado"
                    db_manager.registrar_acceso(
                        usuario_id=label_uid,
                        nombre_usuario=f"{usuario['nombres']} {usuario['apellidos']}" if usuario else "DESCONOCIDO",
                        dni=usuario['dni'] if usuario else "N/A",
                        metodo="FACIAL",
                        terminal="TERMINAL_FACIAL",
                        estado="DENEGADO",
                        detalle=estado_motivo
                    )
                    return {
                        'estado': 'DENEGADO',
                        'mensaje': f'Acceso Denegado: {estado_motivo}',
                        'coordenadas': coordenadas,
                        'similitud': porcentaje_similitud
                    }
            else:
                # Rostro desconocido o no coincide suficientemente (INTRUSO RECHAZADO)
                db_manager.registrar_acceso(
                    usuario_id=None,
                    nombre_usuario="INTRUSO / NO IDENTIFICADO",
                    dni="N/A",
                    metodo="FACIAL",
                    terminal="TERMINAL_FACIAL",
                    estado="DENEGADO",
                    detalle=f"Rostro no coincide con base biometrica (Distancia LBPH: {distancia_lbph:.1f})"
                )
                db_manager.registrar_incidente(
                    tipo_sensor="BIOMETRIA_FALLIDA",
                    nivel_alerta="ADVERTENCIA",
                    descripcion=f"Rostro no coincide con ningún colaborador (Distancia: {distancia_lbph:.1f})"
                )
                return {
                    'estado': 'DENEGADO',
                    'mensaje': 'Acceso Denegado: Rostro No Reconocido',
                    'coordenadas': coordenadas,
                    'similitud': porcentaje_similitud,
                    'distancia': round(distancia_lbph, 2)
                }

        except Exception as e:
            print(f"[ERROR PREDICT] {e}")
            return {
                'estado': 'ERROR',
                'mensaje': f'Error en clasificador biometrico: {str(e)}',
                'coordenadas': coordenadas
            }
