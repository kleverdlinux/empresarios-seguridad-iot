"""
=============================================================================
SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
GENERADOR DE REPORTES EN EXCEL NATIVO (.xlsx OpenXML) - 100% COMPATIBLE
=============================================================================
Genera archivos .xlsx binarios nativos de Microsoft Excel sin advertencias de
incompatibilidad de formato. Incluye diseno corporativo con paleta oficial,
tipografia ejecutiva, bandas alternadas, bordes y badges biometricos.
=============================================================================
"""

import io
from datetime import datetime, timezone, timedelta
import xlsxwriter

TZ_PERU = timezone(timedelta(hours=-5))

def formatear_fecha(iso_str):
    """Convierte formato ISO a texto legible humano en hora oficial de Perú (UTC-5)."""
    if not iso_str:
        return "N/A"
    try:
        s = str(iso_str).strip()
        if s.endswith('Z'):
            dt = datetime.fromisoformat(s[:-1]).replace(tzinfo=timezone.utc).astimezone(TZ_PERU)
            return dt.strftime("%d/%m/%Y %H:%M:%S")
        elif 'T' in s:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is not None:
                dt = dt.astimezone(TZ_PERU)
            else:
                dt = dt.replace(tzinfo=timezone.utc).astimezone(TZ_PERU)
            return dt.strftime("%d/%m/%Y %H:%M:%S")
        elif ' ' in s:
            partes = s.split(' ')
            f = partes[0].split('-')
            if len(f) == 3 and len(f[0]) == 4:
                return f"{f[2]}/{f[1]}/{f[0]} {partes[1]}"
            return s
        dt = datetime.fromisoformat(s)
        return dt.strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        return str(iso_str)

def crear_formatos_corporativos(wb):
    """Genera paleta y estilos corporativos en el workbook."""
    return {
        'title': wb.add_format({
            'bold': True,
            'font_name': 'Segoe UI',
            'font_size': 14,
            'font_color': '#FFFFFF',
            'bg_color': '#0284C7',
            'valign': 'vcenter',
            'align': 'left'
        }),
        'subtitle': wb.add_format({
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#E0F2FE',
            'bg_color': '#0369A1',
            'valign': 'vcenter',
            'align': 'left'
        }),
        'header': wb.add_format({
            'bold': True,
            'font_name': 'Segoe UI',
            'font_size': 10,
            'font_color': '#FFFFFF',
            'bg_color': '#0F172A',
            'valign': 'vcenter',
            'align': 'center',
            'border': 1,
            'border_color': '#334155'
        }),
        'row_even': wb.add_format({
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#1E293B',
            'bg_color': '#FFFFFF',
            'valign': 'vcenter',
            'bottom': 1,
            'bottom_color': '#E2E8F0'
        }),
        'row_odd': wb.add_format({
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#1E293B',
            'bg_color': '#F8FAFC',
            'valign': 'vcenter',
            'bottom': 1,
            'bottom_color': '#E2E8F0'
        }),
        'row_even_center': wb.add_format({
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#1E293B',
            'bg_color': '#FFFFFF',
            'valign': 'vcenter',
            'align': 'center',
            'bottom': 1,
            'bottom_color': '#E2E8F0'
        }),
        'row_odd_center': wb.add_format({
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#1E293B',
            'bg_color': '#F8FAFC',
            'valign': 'vcenter',
            'align': 'center',
            'bottom': 1,
            'bottom_color': '#E2E8F0'
        }),
        'badge_permitido': wb.add_format({
            'bold': True,
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#16A34A',
            'bg_color': '#DCFCE7',
            'valign': 'vcenter',
            'align': 'center',
            'border': 1,
            'border_color': '#BBF7D0'
        }),
        'badge_denegado': wb.add_format({
            'bold': True,
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#DC2626',
            'bg_color': '#FEE2E2',
            'valign': 'vcenter',
            'align': 'center',
            'border': 1,
            'border_color': '#FECACA'
        }),
        'badge_biometria': wb.add_format({
            'bold': True,
            'font_name': 'Segoe UI',
            'font_size': 9.5,
            'font_color': '#0284C7',
            'bg_color': '#E0F2FE',
            'valign': 'vcenter',
            'align': 'center',
            'border': 1,
            'border_color': '#BAE6FD'
        }),
        'section_banner': wb.add_format({
            'bold': True,
            'font_name': 'Segoe UI',
            'font_size': 11,
            'font_color': '#0F172A',
            'bg_color': '#E2E8F0',
            'valign': 'vcenter',
            'align': 'left'
        }),
        'meta_label': wb.add_format({
            'bold': True,
            'font_name': 'Segoe UI',
            'font_size': 10,
            'font_color': '#475569',
            'bg_color': '#F8FAFC',
            'valign': 'vcenter',
            'align': 'right'
        }),
        'meta_value': wb.add_format({
            'font_name': 'Segoe UI',
            'font_size': 10,
            'font_color': '#0F172A',
            'valign': 'vcenter',
            'align': 'left'
        })
    }

def exportar_excel_nomina_completa(trabajadores):
    """Genera reporte grupal de toda la nómina en formato nativo .xlsx."""
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {'in_memory': True})
    ws = wb.add_worksheet('Nomina_Personal')
    ws.hide_gridlines(0)

    fmt = crear_formatos_corporativos(wb)
    ahora_legible = datetime.now(TZ_PERU).strftime("%d/%m/%Y %H:%M:%S")

    # Anchos de columna
    columnas = [
        (0, 8),   # ID
        (1, 14),  # DNI
        (2, 28),  # Nombres y Apellidos
        (3, 24),  # Cargo
        (4, 22),  # Departamento
        (5, 14),  # Estado
        (6, 18),  # Facial
        (7, 18),  # Huella
        (8, 22)   # Fecha Registro
    ]
    for col, ancho in columnas:
        ws.set_column(col, col, ancho)

    # Encabezado institucional
    ws.set_row(0, 36)
    ws.merge_range(0, 0, 0, 8, '  EMPRESARIOTEC S.A. • REPORTE GENERAL DE NÓMINA BIOMÉTRICA', fmt['title'])
    ws.set_row(1, 22)
    ws.merge_range(1, 0, 1, 8, f'  Generado: {ahora_legible} | Base de Datos SQLite (WAL Mode) | SENATI PIAD-526', fmt['subtitle'])
    ws.set_row(2, 10)

    # Cabeceras de tabla
    headers = ["ID", "DNI", "Nombres y Apellidos", "Cargo / Puesto", "Departamento", "Estado", "Facial (Fotos)", "Huella Digital", "Fecha Registro"]
    ws.set_row(3, 26)
    for col, h in enumerate(headers):
        ws.write(3, col, h, fmt['header'])

    # Filas de datos
    for idx, t in enumerate(trabajadores):
        r = idx + 4
        ws.set_row(r, 22)
        style_base = fmt['row_odd'] if idx % 2 == 1 else fmt['row_even']
        style_center = fmt['row_odd_center'] if idx % 2 == 1 else fmt['row_even_center']
        estado_style = fmt['badge_permitido'] if t.get('estado') == 'ACTIVO' else fmt['badge_denegado']

        facial_txt = f"SÍ ({t.get('fotos_entrenadas', 0)} fotos)" if t.get('rostro_registrado') == 1 else "PENDIENTE"
        huella_txt = "ENROLADA" if t.get('huella_registrada') == 1 else "PENDIENTE"

        ws.write(r, 0, t.get('id', idx + 1), style_center)
        ws.write(r, 1, str(t.get('dni', '')), style_center)
        ws.write(r, 2, f"{t.get('nombres', '')} {t.get('apellidos', '')}", style_base)
        ws.write(r, 3, t.get('cargo', 'Operativo'), style_base)
        ws.write(r, 4, t.get('departamento', 'General'), style_base)
        ws.write(r, 5, t.get('estado', 'ACTIVO'), estado_style)
        ws.write(r, 6, facial_txt, fmt['badge_biometria'])
        ws.write(r, 7, huella_txt, fmt['badge_biometria'])
        ws.write(r, 8, formatear_fecha(t.get('fecha_registro')), style_center)

    wb.close()
    return output.getvalue()

def exportar_excel_auditoria_accesos(logs, filtros_desc=None):
    """Genera reporte grupal de auditoría de accesos en formato nativo .xlsx con filtros dinámicos."""
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {'in_memory': True})
    ws = wb.add_worksheet('Auditoria_Accesos')
    ws.hide_gridlines(0)

    fmt = crear_formatos_corporativos(wb)
    ahora_legible = datetime.now(TZ_PERU).strftime("%d/%m/%Y %H:%M:%S")

    # Anchos de columna
    columnas = [
        (0, 8),   # ID
        (1, 22),  # Fecha y Hora
        (2, 14),  # DNI
        (3, 26),  # Trabajador
        (4, 14),  # Método
        (5, 20),  # Terminal
        (6, 14),  # Estado
        (7, 36)   # Detalle Técnico
    ]
    for col, ancho in columnas:
        ws.set_column(col, col, ancho)

    # Encabezado institucional
    ws.set_row(0, 36)
    ws.merge_range(0, 0, 0, 7, '  EMPRESARIOTEC S.A. • AUDITORÍA DE ACCESOS BIOMÉTRICOS IoT', fmt['title'])
    ws.set_row(1, 22)
    subtitulo = f'  Generado: {ahora_legible} | Total Registros: {len(logs)}'
    if filtros_desc:
        subtitulo += f' | Filtros: {filtros_desc}'
    else:
        subtitulo += ' | Filtros: Todos los eventos (Sin filtros)'
    ws.merge_range(1, 0, 1, 7, subtitulo, fmt['subtitle'])
    ws.set_row(2, 10)

    # Cabeceras
    headers = ["ID", "Fecha y Hora", "DNI", "Trabajador", "Método", "Terminal", "Estado", "Detalle Técnico"]
    ws.set_row(3, 26)
    for col, h in enumerate(headers):
        ws.write(3, col, h, fmt['header'])

    for idx, l in enumerate(logs):
        r = idx + 4
        ws.set_row(r, 22)
        style_base = fmt['row_odd'] if idx % 2 == 1 else fmt['row_even']
        style_center = fmt['row_odd_center'] if idx % 2 == 1 else fmt['row_even_center']
        estado_style = fmt['badge_permitido'] if l.get('estado') == 'PERMITIDO' else fmt['badge_denegado']

        ws.write(r, 0, l.get('id', idx + 1), style_center)
        ws.write(r, 1, formatear_fecha(l.get('timestamp')), style_center)
        ws.write(r, 2, str(l.get('dni', 'N/A')), style_center)
        ws.write(r, 3, l.get('nombre_usuario', 'Desconocido'), style_base)
        ws.write(r, 4, l.get('metodo', 'DESCONOCIDO'), style_center)
        ws.write(r, 5, l.get('terminal', 'TERMINAL_CENTRAL'), style_base)
        ws.write(r, 6, l.get('estado', 'DENEGADO'), estado_style)
        ws.write(r, 7, l.get('detalle', 'Sin observaciones'), style_base)

    wb.close()
    return output.getvalue()

def exportar_excel_trabajador_individual(trabajador, logs_usuario):
    """Genera reporte individual: Ficha técnica y su historial personal en formato nativo .xlsx."""
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {'in_memory': True})
    ws = wb.add_worksheet(f"Ficha_{trabajador.get('dni', 'Colaborador')}")
    ws.hide_gridlines(0)

    fmt = crear_formatos_corporativos(wb)
    ahora_legible = datetime.now(TZ_PERU).strftime("%d/%m/%Y %H:%M:%S")

    ws.set_column(0, 0, 26)
    ws.set_column(1, 1, 36)
    ws.set_column(2, 2, 24)
    ws.set_column(3, 3, 28)

    # Banner
    ws.set_row(0, 36)
    ws.merge_range(0, 0, 0, 3, '  EMPRESARIOTEC S.A. • FICHA TÉCNICA BIOMÉTRICA INDIVIDUAL', fmt['title'])
    ws.set_row(1, 22)
    ws.merge_range(1, 0, 1, 3, f'  Expediente del Colaborador | Emisión: {ahora_legible}', fmt['subtitle'])
    ws.set_row(2, 10)

    # Seccion 1
    ws.set_row(3, 24)
    ws.merge_range(3, 0, 3, 3, '1. DATOS PERSONALES Y LABORALES', fmt['section_banner'])

    st_style = fmt['badge_permitido'] if trabajador.get("estado") == "ACTIVO" else fmt['badge_denegado']
    ws.set_row(4, 22)
    ws.write(4, 0, 'DNI / Documento:', fmt['meta_label'])
    ws.write(4, 1, str(trabajador.get('dni', '')), fmt['meta_value'])
    ws.write(4, 2, 'Estado Operativo:', fmt['meta_label'])
    ws.write(4, 3, trabajador.get('estado', 'ACTIVO'), st_style)

    ws.set_row(5, 22)
    ws.write(5, 0, 'Nombres y Apellidos:', fmt['meta_label'])
    ws.write(5, 1, f"{trabajador.get('nombres', '')} {trabajador.get('apellidos', '')}", fmt['meta_value'])
    ws.write(5, 2, 'Fecha de Alta:', fmt['meta_label'])
    ws.write(5, 3, formatear_fecha(trabajador.get('fecha_registro')), fmt['meta_value'])

    ws.set_row(6, 22)
    ws.write(6, 0, 'Cargo / Puesto:', fmt['meta_label'])
    ws.write(6, 1, trabajador.get('cargo', 'Operativo'), fmt['meta_value'])
    ws.write(6, 2, 'Departamento:', fmt['meta_label'])
    ws.write(6, 3, trabajador.get('departamento', 'General'), fmt['meta_value'])

    ws.set_row(7, 12)

    # Seccion 2
    ws.set_row(8, 24)
    ws.merge_range(8, 0, 8, 3, '2. REGISTRO BIOMÉTRICO ASOCIADO', fmt['section_banner'])

    facial_txt = f"ACTIVO ({trabajador.get('fotos_entrenadas', 0)} fotos en LBPH)" if trabajador.get('rostro_registrado') == 1 else "NO ENROLADO"
    huella_txt = "ACTIVA (Firma biométrica almacenada)" if trabajador.get('huella_registrada') == 1 else "NO ENROLADA"

    ws.set_row(9, 22)
    ws.write(9, 0, 'Reconocimiento Facial:', fmt['meta_label'])
    ws.write(9, 1, facial_txt, fmt['badge_biometria'])
    ws.write(9, 2, 'Huella Dactilar:', fmt['meta_label'])
    ws.write(9, 3, huella_txt, fmt['badge_biometria'])

    ws.set_row(10, 16)

    # Seccion 3
    ws.set_row(11, 24)
    ws.merge_range(11, 0, 11, 3, f'3. HISTORIAL DE MARCACIONES Y ACCESOS ({len(logs_usuario)} eventos)', fmt['section_banner'])

    headers_historial = ["Fecha / Hora", "Terminal", "Método", "Resultado"]
    ws.set_row(12, 24)
    for col, h in enumerate(headers_historial):
        ws.write(12, col, h, fmt['header'])

    if not logs_usuario:
        ws.set_row(13, 22)
        ws.merge_range(13, 0, 13, 3, 'No se registran eventos de acceso previos para este trabajador.', fmt['row_even_center'])
    else:
        for idx, l in enumerate(logs_usuario):
            r = idx + 13
            ws.set_row(r, 22)
            style_base = fmt['row_odd'] if idx % 2 == 1 else fmt['row_even']
            style_center = fmt['row_odd_center'] if idx % 2 == 1 else fmt['row_even_center']
            st_style = fmt['badge_permitido'] if l.get('estado') == 'PERMITIDO' else fmt['badge_denegado']

            ws.write(r, 0, formatear_fecha(l.get('timestamp')), style_center)
            ws.write(r, 1, l.get('terminal', 'TERMINAL_CENTRAL'), style_base)
            ws.write(r, 2, l.get('metodo', 'DESCONOCIDO'), style_center)
            ws.write(r, 3, l.get('estado', 'DENEGADO'), st_style)

    wb.close()
    return output.getvalue()

def exportar_excel_incidentes_seguridad(incidentes, filtros_desc=None):
    """Genera reporte grupal de incidentes de seguridad y alarmas Centinela en formato nativo .xlsx con filtros dinámicos."""
    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {'in_memory': True})
    ws = wb.add_worksheet('Incidentes_Seguridad')
    ws.hide_gridlines(0)

    fmt = crear_formatos_corporativos(wb)
    ahora_legible = datetime.now(TZ_PERU).strftime("%d/%m/%Y %H:%M:%S")

    columnas = [
        (0, 8),   # ID
        (1, 22),  # Fecha y Hora
        (2, 24),  # Tipo de Sensor
        (3, 14),  # Nivel
        (4, 38)   # Descripción
    ]
    for col, ancho in columnas:
        ws.set_column(col, col, ancho)

    ws.set_row(0, 36)
    ws.merge_range(0, 0, 0, 4, '  EMPRESARIOTEC S.A. • BITÁCORA DE INCIDENTES Y ALARMAS', fmt['title'])
    ws.set_row(1, 22)
    subtitulo = f'  Emisión: {ahora_legible} | Supervisión Centinela y Telemetría | Total: {len(incidentes)}'
    if filtros_desc:
        subtitulo += f' | Filtros: {filtros_desc}'
    else:
        subtitulo += ' | Filtros: Todos los incidentes (Sin filtros)'
    ws.merge_range(1, 0, 1, 4, subtitulo, fmt['subtitle'])
    ws.set_row(2, 10)

    headers = ["ID", "Fecha y Hora", "Tipo de Sensor", "Nivel", "Descripción del Incidente"]
    ws.set_row(3, 26)
    for col, h in enumerate(headers):
        ws.write(3, col, h, fmt['header'])

    for idx, inc in enumerate(incidentes):
        r = idx + 4
        ws.set_row(r, 22)
        style_base = fmt['row_odd'] if idx % 2 == 1 else fmt['row_even']
        style_center = fmt['row_odd_center'] if idx % 2 == 1 else fmt['row_even_center']
        st_style = fmt['badge_denegado'] if inc.get("nivel_alerta") == "CRITICO" else fmt['badge_biometria']

        ws.write(r, 0, inc.get('id', idx + 1), style_center)
        ws.write(r, 1, formatear_fecha(inc.get('timestamp')), style_center)
        ws.write(r, 2, inc.get('tipo_sensor', 'CENTINELA_AI'), style_base)
        ws.write(r, 3, inc.get('nivel_alerta', 'ADVERTENCIA'), st_style)
        ws.write(r, 4, inc.get('descripcion', 'Sin detalle'), style_base)

    wb.close()
    return output.getvalue()
