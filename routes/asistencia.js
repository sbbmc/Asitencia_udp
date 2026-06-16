const express   = require('express');
const router    = express.Router();
const ExcelJS   = require('exceljs');
const { query } = require('../db');
const { verificarToken, soloEstudiante, soloProfesor } = require('../middleware/auth');
const { validarTokenQR }                 = require('./qr');
const { calcularConfianza }              = require('../utils/validacion');

/**
 * POST /api/asistencia/registrar
 */
router.post('/registrar', verificarToken, soloEstudiante, async (req, res) => {
  const { tokenQR, codigoVerbal, lat, lon } = req.body;
  const estudiante = req.usuario;

  if (!tokenQR || typeof tokenQR !== 'string') {
    return res.status(400).json({ error: 'tokenQR es requerido' });
  }

  const latNum = (lat !== undefined && lat !== null) ? parseFloat(lat) : null;
  const lonNum = (lon !== undefined && lon !== null) ? parseFloat(lon) : null;
  if ((latNum !== null && isNaN(latNum)) || (lonNum !== null && isNaN(lonNum))) {
    return res.status(400).json({ error: 'Coordenadas inválidas' });
  }

  try {
    const validacion = await validarTokenQR(tokenQR);
    if (!validacion.valido) {
      return res.status(410).json({ error: 'QR inválido o expirado' });
    }

    const { clase } = validacion;

    if (clase.id_seccion) {
      const inscrito = await query(
        `SELECT 1 FROM public.inscripciones
         WHERE id_estudiante = $1 AND id_seccion = $2`,
        [estudiante.id, clase.id_seccion]
      );
      if (inscrito.rows.length === 0) {
        return res.status(403).json({ error: 'No estás inscrito en este ramo' });
      }
    }

    const { score, detalle } = calcularConfianza({
      clase,
      codigoVerbal: typeof codigoVerbal === 'string' ? codigoVerbal.trim() : null,
      lat: latNum,
      lon: lonNum
    });

    if (score < 60) {
      return res.status(403).json({
        error: 'No se pudo verificar tu presencia en la sala',
        detalle: 'Revisa el código que indicó tu profesor y que tu ubicación esté activada'
      });
    }

    const revisionRequerida = score < 70;

    const result = await query(
      `INSERT INTO public.asistencias
         (id_clase, id_estudiante, estado, fecha_registro, updated_at,
          confianza_score, revision_requerida, detalle_validacion)
       VALUES ($1, $2, 'presente', NOW(), NOW(), $3, $4, $5)
       ON CONFLICT (id_clase, id_estudiante)
       DO UPDATE SET estado = 'presente', updated_at = NOW(),
                     confianza_score = $3, revision_requerida = $4,
                     detalle_validacion = $5
       RETURNING id, estado, fecha_registro`,
      [clase.id, estudiante.id, score, revisionRequerida, JSON.stringify(detalle)]
    );

    const registro = result.rows[0];

    const ramoRes = await query(
      `SELECT nombre_ramo FROM public.ramos WHERE id = $1`,
      [clase.id_ramo]
    );
    const nombreRamo = ramoRes.rows[0]?.nombre_ramo || 'Clase';

    console.log(`✅ Asistencia: ${estudiante.nombre} → ${nombreRamo} · score=${score}${revisionRequerida ? ' [revisión]' : ''}`);

    res.status(201).json({
      mensaje: revisionRequerida
        ? 'Asistencia registrada. Tu profesor revisará este registro.'
        : '¡Asistencia registrada correctamente!',
      registro: {
        id:                 registro.id,
        estado:             registro.estado,
        nombre:             estudiante.nombre,
        rut:                estudiante.rut,
        ramo:               nombreRamo,
        fecha_registro:     registro.fecha_registro,
        hora: new Date(registro.fecha_registro).toLocaleTimeString('es-CL', {
          timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit'
        }),
        revision_requerida: revisionRequerida
      }
    });

  } catch (err) {
    console.error('Error registrando asistencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/asistencia/lista/:id_clase
 */
router.get('/lista/:id_clase', verificarToken, soloProfesor, async (req, res) => {
  const { id_clase } = req.params;
  const id_clase_num = parseInt(id_clase);

  if (isNaN(id_clase_num)) {
    return res.status(400).json({ error: 'ID de clase inválido' });
  }

  try {
    const claseRes = await query(
      `SELECT c.id, c.id_ramo, c.fecha_hora, r.nombre_ramo
       FROM public.clases c
       JOIN public.ramos r ON r.id = c.id_ramo
       WHERE c.id = $1 AND r.id_profesor = $2`,
      [id_clase_num, req.usuario.id]
    );

    if (claseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Clase no encontrada' });
    }

    const clase = claseRes.rows[0];

    const { rows } = await query(
      `SELECT u.id, u.nombre, u.rut, u.correo,
              COALESCE(a.estado, 'ausente') AS estado,
              a.fecha_registro,
              a.id AS id_asistencia,
              a.confianza_score,
              COALESCE(a.revision_requerida, false) AS revision_requerida
       FROM public.inscripciones i
       JOIN public.usuarios u ON u.id = i.id_estudiante
       LEFT JOIN public.asistencias a
         ON a.id_estudiante = u.id AND a.id_clase = $1
       WHERE i.id_seccion = (
         SELECT id_seccion FROM public.clases WHERE id = $1
       )
       ORDER BY u.nombre`,
      [id_clase_num]
    );

    const presentes = rows.filter(r => r.estado === 'presente').length;
    const ausentes  = rows.filter(r => r.estado === 'ausente').length;
    const revision  = rows.filter(r => r.revision_requerida).length;

    res.json({
      clase: { id: clase.id, nombre_ramo: clase.nombre_ramo, fecha_hora: clase.fecha_hora },
      resumen: { presentes, ausentes, total: rows.length, revision },
      estudiantes: rows
    });

  } catch (err) {
    console.error('Error trayendo lista:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/asistencia/:id_asistencia
 */
router.patch('/:id_asistencia', verificarToken, soloProfesor, async (req, res) => {
  const { id_asistencia } = req.params;
  const { estado }        = req.body;
  const id_asistencia_num = parseInt(id_asistencia);

  if (isNaN(id_asistencia_num)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  const estadosValidos = ['presente', 'ausente', 'justificado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: `estado debe ser: ${estadosValidos.join(', ')}` });
  }

  try {
    const check = await query(
      `SELECT a.id
       FROM public.asistencias a
       JOIN public.clases c ON c.id = a.id_clase
       JOIN public.ramos r  ON r.id = c.id_ramo
       WHERE a.id = $1 AND r.id_profesor = $2`,
      [id_asistencia_num, req.usuario.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    const result = await query(
      `UPDATE public.asistencias
       SET estado = $1, updated_at = NOW(), updated_by = $2,
           revision_requerida = false
       WHERE id = $3
       RETURNING id, estado, updated_at`,
      [estado, req.usuario.id, id_asistencia_num]
    );

    res.json({ mensaje: 'Estado actualizado', registro: result.rows[0] });

  } catch (err) {
    console.error('Error actualizando asistencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/asistencia/reporte/:id_ramo
 * Genera y descarga un Excel con la asistencia global del periodo.
 * Solo el profesor dueño del ramo puede acceder.
 */
router.get('/reporte/:id_ramo', verificarToken, soloProfesor, async (req, res) => {
  const id_ramo = parseInt(req.params.id_ramo);
  if (isNaN(id_ramo)) return res.status(400).json({ error: 'ID de ramo inválido' });

  try {
    // 1. Obtener datos del ramo y verificar que pertenece al profesor
    const ramoRes = await query(
      `SELECT id, nombre_ramo, dias_semana, fecha_inicio, fecha_fin
       FROM public.ramos
       WHERE id = $1 AND id_profesor = $2`,
      [id_ramo, req.usuario.id]
    );

    if (ramoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Ramo no encontrado' });
    }

    const ramo = ramoRes.rows[0];

    if (!ramo.dias_semana || !ramo.fecha_inicio || !ramo.fecha_fin) {
      return res.status(400).json({ error: 'El ramo no tiene periodo ni días configurados' });
    }

    // 2. Generar todas las fechas de clase del periodo
    const fechasClase = generarFechasClase(
      new Date(ramo.fecha_inicio),
      new Date(ramo.fecha_fin),
      ramo.dias_semana
    );

    if (fechasClase.length === 0) {
      return res.status(400).json({ error: 'No hay fechas de clase en el periodo configurado' });
    }

    // 3. Obtener todos los estudiantes inscritos en el ramo
    const estudiantesRes = await query(
      `SELECT DISTINCT u.id, u.nombre, u.rut
       FROM public.usuarios u
       JOIN public.inscripciones i ON i.id_estudiante = u.id
       JOIN public.secciones s ON s.id = i.id_seccion
       WHERE s.id_ramo = $1
       ORDER BY u.nombre`,
      [id_ramo]
    );

    const estudiantes = estudiantesRes.rows;

    // 4. Obtener todas las asistencias del ramo en el periodo
    const asistenciasRes = await query(
      `SELECT a.id_estudiante, a.estado,
              DATE(c.fecha_hora AT TIME ZONE 'America/Santiago') AS fecha_clase
       FROM public.asistencias a
       JOIN public.clases c ON c.id = a.id_clase
       WHERE c.id_ramo = $1
         AND DATE(c.fecha_hora) >= $2
         AND DATE(c.fecha_hora) <= $3`,
      [id_ramo, ramo.fecha_inicio, ramo.fecha_fin]
    );

    // 5. Indexar asistencias por estudiante+fecha para lookup rápido
    const asistenciaMap = {};
    for (const row of asistenciasRes.rows) {
      const fechaStr = row.fecha_clase.toISOString().split('T')[0];
      const key = `${row.id_estudiante}_${fechaStr}`;
      asistenciaMap[key] = row.estado;
    }

    // 6. Construir el Excel
    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(ramo.nombre_ramo);

    // ── Estilos ──────────────────────────────────────────────────────────────
    const estiloHeaderRamo = {
      font:      { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD42931' } },
      alignment: { horizontal: 'center', vertical: 'middle' }
    };

    const estiloHeaderCol = {
      font:      { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        bottom: { style: 'thin', color: { argb: 'FFD42931' } }
      }
    };

    const estiloPresente = {
      font:      { bold: true, color: { argb: 'FF1A7A3C' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } },
      alignment: { horizontal: 'center' }
    };

    const estiloAusente = {
      font:      { bold: true, color: { argb: 'FFD42931' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } },
      alignment: { horizontal: 'center' }
    };

    const estiloPorcentaje = {
      font:      { bold: true, size: 11 },
      alignment: { horizontal: 'center' },
      numFmt:    '0.0"%"'
    };

    // ── Fila 1: título del ramo ───────────────────────────────────────────────
    const totalCols = 2 + fechasClase.length + 1; // Nombre + RUT + fechas + %
    worksheet.mergeCells(1, 1, 1, totalCols);
    const celdaTitulo = worksheet.getCell('A1');
    celdaTitulo.value = `Reporte de Asistencia — ${ramo.nombre_ramo}`;
    Object.assign(celdaTitulo, estiloHeaderRamo);
    worksheet.getRow(1).height = 30;

    // ── Fila 2: periodo ───────────────────────────────────────────────────────
    worksheet.mergeCells(2, 1, 2, totalCols);
    const celdaPeriodo = worksheet.getCell('A2');
    celdaPeriodo.value = `Periodo: ${formatFecha(ramo.fecha_inicio)} → ${formatFecha(ramo.fecha_fin)}   ·   Clases: ${fechasClase.length}   ·   Generado: ${formatFecha(new Date())}`;
    celdaPeriodo.font      = { italic: true, size: 10, color: { argb: 'FF666666' } };
    celdaPeriodo.alignment = { horizontal: 'center' };
    worksheet.getRow(2).height = 18;

    // ── Fila 3: vacía ─────────────────────────────────────────────────────────
    worksheet.getRow(3).height = 6;

    // ── Fila 4: headers de columnas ───────────────────────────────────────────
    const headers = [
      'Estudiante',
      'RUT',
      ...fechasClase.map(f => formatFechaCorta(f)),
      '% Asistencia'
    ];

    const filaHeader = worksheet.getRow(4);
    filaHeader.height = 36;
    headers.forEach((h, i) => {
      const celda = filaHeader.getCell(i + 1);
      celda.value = h;
      Object.assign(celda, estiloHeaderCol);
    });

    // ── Anchos de columna ─────────────────────────────────────────────────────
    worksheet.getColumn(1).width = 28; // Nombre
    worksheet.getColumn(2).width = 16; // RUT
    fechasClase.forEach((_, i) => {
      worksheet.getColumn(3 + i).width = 9;
    });
    worksheet.getColumn(3 + fechasClase.length).width = 14; // % Asistencia

    // ── Filas de estudiantes ──────────────────────────────────────────────────
    estudiantes.forEach((est, rowIdx) => {
      const fila     = worksheet.getRow(5 + rowIdx);
      fila.height    = 20;
      const esFilaPar = rowIdx % 2 === 0;

      // Nombre
      const celdaNombre = fila.getCell(1);
      celdaNombre.value = est.nombre;
      celdaNombre.font  = { size: 11 };
      celdaNombre.fill  = esFilaPar
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } }
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

      // RUT
      const celdaRut = fila.getCell(2);
      celdaRut.value = est.rut;
      celdaRut.font  = { size: 10, color: { argb: 'FF666666' } };
      celdaRut.fill  = celdaNombre.fill;
      celdaRut.alignment = { horizontal: 'center' };

      // Celdas de asistencia por fecha
      let presentes = 0;
      fechasClase.forEach((fecha, colIdx) => {
        const fechaStr = fecha.toISOString().split('T')[0];
        const key      = `${est.id}_${fechaStr}`;
        const estado   = asistenciaMap[key];
        const celda    = fila.getCell(3 + colIdx);

        if (estado === 'presente' || estado === 'justificado') {
          celda.value = '✓';
          Object.assign(celda, estiloPresente);
          presentes++;
        } else if (estado === 'ausente') {
          celda.value = '✕';
          Object.assign(celda, estiloAusente);
        } else {
          // Fecha futura o clase no realizada
          celda.value = '—';
          celda.font      = { color: { argb: 'FFCCCCCC' } };
          celda.alignment = { horizontal: 'center' };
        }
      });

      // % Asistencia (solo sobre clases ya realizadas)
      const clasesRealizadas = fechasClase.filter(f => f <= new Date()).length;
      const porcentaje = clasesRealizadas > 0
        ? (presentes / clasesRealizadas) * 100
        : 0;

      const celdaPct = fila.getCell(3 + fechasClase.length);
      celdaPct.value = porcentaje;
      Object.assign(celdaPct, estiloPorcentaje);
      celdaPct.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: porcentaje >= 75 ? 'FFE6F4EA' : porcentaje >= 50 ? 'FFFFF3CD' : 'FFFDE8E8' }
      };
      celdaPct.font = {
        bold: true, size: 11,
        color: { argb: porcentaje >= 75 ? 'FF1A7A3C' : porcentaje >= 50 ? 'FF856404' : 'FFD42931' }
      };
    });

    // ── Fila resumen totales ──────────────────────────────────────────────────
    const filaResumen = worksheet.getRow(5 + estudiantes.length);
    filaResumen.height = 22;
    const celdaResLabel = filaResumen.getCell(1);
    celdaResLabel.value = 'TOTALES PRESENTES';
    celdaResLabel.font  = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    celdaResLabel.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF555555' } };

    filaResumen.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF555555' } };

    fechasClase.forEach((fecha, colIdx) => {
      const fechaStr  = fecha.toISOString().split('T')[0];
      const presentes = estudiantes.filter(est => {
        const key = `${est.id}_${fechaStr}`;
        return asistenciaMap[key] === 'presente' || asistenciaMap[key] === 'justificado';
      }).length;

      const celda    = filaResumen.getCell(3 + colIdx);
      celda.value    = fecha <= new Date() ? presentes : '—';
      celda.font     = { bold: true, color: { argb: 'FFFFFFFF' } };
      celda.fill     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF555555' } };
      celda.alignment = { horizontal: 'center' };
    });

    // ── Enviar el archivo ─────────────────────────────────────────────────────
    const nombreArchivo = `Asistencia_${ramo.nombre_ramo.replace(/\s+/g, '_')}_${formatFechaArchivo(new Date())}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Error generando reporte:', err);
    res.status(500).json({ error: 'Error generando reporte' });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Genera todas las fechas de clase entre fecha_inicio y fecha_fin
 * que caigan en los días de la semana indicados (1=lunes ... 7=domingo, ISO).
 */
function generarFechasClase(inicio, fin, diasSemana) {
  const fechas = [];
  const actual = new Date(inicio);
  actual.setHours(0, 0, 0, 0);
  fin.setHours(23, 59, 59, 999);

  while (actual <= fin) {
    // getDay() devuelve 0=domingo...6=sábado, convertimos a ISO 1=lunes...7=domingo
    const diaSemana = actual.getDay() === 0 ? 7 : actual.getDay();
    if (diasSemana.includes(diaSemana)) {
      fechas.push(new Date(actual));
    }
    actual.setDate(actual.getDate() + 1);
  }
  return fechas;
}

function formatFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
  });
}

function formatFechaCorta(fecha) {
  return fecha.toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', timeZone: 'UTC'
  });
}

function formatFechaArchivo(fecha) {
  return fecha.toISOString().split('T')[0];
}

module.exports = router;