# EMPRESARIOTEC S.A. - SISTEMA DE SEGURIDAD BIOMÉTRICO IoT 
**Autores:** 
KLEVERD GABRIEL APAZA QUISPE (ID: 001643199)
OMAR DAVID MAMANI JIHUALLANCA (ID: 001646430)
MICHEL ENRIQUE TEJADA FERNANDEZ (ID: 001639589)
VLADIMIR PEDRO MAMANI QQUELCCA (ID: 1644849)
**Semestre:** V | **Especialidad:** Tecnologías de la Información / IoT

---

## 1. Visión General de la Solución

El sistema implementa una arquitectura distribuida y desacoplada de seguridad perimetral y control de acceso corporativo para **EMPRESARIOTEC S.A.**, cumpliendo a detalle los requisitos técnicos de la especificación **SENATI PIAD-526**:

* **Base de Datos 100% Offline (SQLite con modo WAL):** Almacena y audita la totalidad de los datos biométricos, credenciales, logs de acceso e incidentes de telemetría localmente sin depender de internet.
* **Portal Centralizado con 3 Terminales Móviles Independientes:** Diseñado para ejecutarse en 3 teléfonos inteligentes en simultáneo sobre la red WiFi corporativa:
  1. **Terminal de Reconocimiento Facial (Stand/Kiosco Vertical):** Análisis de fotogramas en vivo mediante algoritmo nativo **OpenCV LBPH** con preprocesamiento de iluminación y ecualización de histograma.
  2. **Terminal Biométrico Dactilar (Hardware Móvil Aratek):** Integración con la API **WebAuthn (FIDO2 / Biometrics)** para interactuar directamente con el sensor físico de huella dactilar del smartphone, con soporte paralelo para el sensor óptico **AS608**.
  3. **Centro de Monitoreo CCTV & Sensores de Rack:** Transmisión continua de video y telemetría de vibración (**SW-420**) y presencia infrarroja (**PIR HC-SR501**).
* **Panel de Administración Maestro:** Gestión integral del personal, captura y entrenamiento facial en tiempo real, registro de huellas dactilares, modificación de contraseñas de las terminales y exportación de auditoría en formato CSV.

---

## 2. Credenciales y Contraseñas por Defecto

Todas las terminales y el panel maestro se encuentran protegidos. El Administrador puede modificar estas contraseñas en cualquier momento desde su panel:

| Acceso / Terminal | Identificador | Contraseña Inicial | Función |
| :--- | :--- | :--- | :--- |
| **Panel Maestro Admin** | `admin` | `admin123` | Registro de trabajadores, fotos, huellas y contraseñas |
| **Terminal Facial** | Stand Móvil 1 | `FACIAL2026` | Verificación facial con cámara en vivo |
| **Terminal Dactilar** | Lector Aratek Móvil 2 | `HUELLA2026` | Verificación de huella en sensor del teléfono |
| **Centro CCTV** | Terminal Móvil 3 | `CCTV2026` | Monitoreo de cámaras y sensores de rack |

---

## 3. Guía de Ejecución y Presentación con 3 Celulares

### Paso 1: Iniciar el Servidor en la Laptop
Ejecute el script en Windows:
```bash
scripts_ejecucion\iniciar_sistema.bat
```
O mediante consola de comandos:
```bash
python server.py
```

### Paso 2: Conectar los Celulares a la misma Red WiFi
En la consola del servidor se mostrará la dirección IP local de su laptop (por ejemplo `https://192.168.18.43:8443`):

* **Celular 1 (Compañero 1):** Abrir en el navegador móvil `https://192.168.18.43:8443/#facial` (ingresar contraseña `FACIAL2026`). Mostrará el terminal facial vertical.
* **Celular 2 (Compañero 2):** Abrir en el navegador móvil `https://192.168.18.43:8443/#huella` (ingresar contraseña `HUELLA2026`). Mostrará el lector biométrico Aratek.
* **Celular 3 (Compañero 3):** Abrir en el navegador móvil `https://192.168.18.43:8443/#cctv` (ingresar contraseña `CCTV2026`). Mostrará las cámaras y sensores.
* **Laptop (Kleverd Gabriel):** Mantener abierto `http://localhost:8080/#admin` para enrolar nuevos trabajadores, capturar fotos, entrenar el modelo y mostrar los reportes de auditoría en vivo al docente.

---

## 4. Despliegue en la Nube (Render Cloud)

El proyecto incluye el manifiesto `render.yaml` y `requirements.txt` listos para producción:
1. Suba este repositorio a su cuenta de GitHub.
2. En [Render.com](https://render.com), seleccione **New Web Service** -> Conectar Repositorio.
3. Render detectará automáticamente `render.yaml` y levantará el sistema con dominio HTTPS gratuito.
