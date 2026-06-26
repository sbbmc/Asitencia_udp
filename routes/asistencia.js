const express    = require('express');
const Asistencia = require('../models/Asistencia');
const router     = express.Router();
const ExcelJS    = require('exceljs');
const { query }  = require('../db');
const { verificarToken, soloEstudiante, soloProfesor } = require('../middleware/auth');
const { validarTokenQR }    = require('./qr');
const { calcularConfianza } = require('../utils/validacion');

// ══════════════════════════════════════════════════════════════════════════════
//  RUTAS ESTUDIANTE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/asistencia/registrar
 */
router.post('/registrar', verificarToken, soloEstudiante, async (req, res) => {
  const { tokenQR, codigoVerbal, lat, lon } = req.body;
  const estudiante = req.usuario;

  if (!tokenQR || typeof tokenQR !== 'string') {
    return res.status(400).json({ error: 'tokenQR es requerido' });
  }

  try {
    const validacion = await validarTokenQR(tokenQR);
    if (!validacion.valido) {
      return res.status(410).json({ error: 'QR inválido o expirado' });
    }

    const { clase } = validacion;

    const inscritoRes = await query(
      `SELECT id FROM public.inscripciones
       WHERE usuario_id = $1 AND clase_id = $2`,
      [estudiante.id, clase.id]
    );

    if (inscritoRes.rows.length === 0) {
      return res.status(403).json({ error: 'No estás inscrito en este ramo' });
    }

    const inscripcion_id = inscritoRes.rows[0].id;

    const { score, detalle } = calcularConfianza({
      clase,
      codigoVerbal: typeof codigoVerbal === 'string' ? codigoVerbal.trim() : null,
      lat: typeof lat === 'number' ? lat : null,
      lon: typeof lon === 'number' ? lon : null,
    });

    if (score < 60) {
      return res.status(403).json({
        error: 'No se pudo verificar tu presencia en la sala',
        detalle: 'Revisa el código que indicó tu profesor'
      });
    }

    const revisionRequerida = score < 70;

    const fechaDiaHoy = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })
      .split('-').reverse().join('-');

    const registro = await Asistencia.findOneAndUpdate(
      { inscripcion_id, clase_id: clase.id, fecha_dia: fechaDiaHoy },
      {
        $set: {
          estado:             'presente',
          metodo:             'qr',
          confianza_score:    score,
          revision_requerida: revisionRequerida,
          detalle_validacion: detalle,
          fecha_registro:     new Date(),
        },
        $setOnInsert: {
          inscripcion_id,
          clase_id:  clase.id,
          fecha_dia: fechaDiaHoy,
        }
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Asistencia: ${estudiante.nombre} → ${clase.nombre} · score=${score}${revisionRequerida ? ' [revisión]' : ''}`);

    return res.json({
      mensaje:  'Asistencia registrada',
      estado:   registro.estado,
      fecha:    registro.fecha_registro,
      score,
      revision: revisionRequerida
    });

  } catch (err) {
    console.error('Error registrando asistencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/asistencia/mis-clases
 * Devuelve las clases en que está inscrito el estudiante autenticado.
 */
router.get('/mis-clases', verificarToken, soloEstudiante, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.nombre
       FROM public.clases c
       JOIN public.inscripciones i ON i.clase_id = c.id
       WHERE i.usuario_id = $1
       ORDER BY c.nombre ASC`,
      [req.usuario.id]
    );
    return res.json({ clases: rows });
  } catch (err) {
    console.error('Error trayendo clases del estudiante:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/asistencia/mi-historial/:clase_id
 *
 * Devuelve el historial completo de asistencia del estudiante autenticado
 * en la clase indicada, junto con el % de asistencia calculado.
 *
 * No requiere filtro de fecha: trae todas las sesiones registradas.
 */
router.get('/mi-historial/:clase_id', verificarToken, soloEstudiante, async (req, res) => {
  const { clase_id } = req.params;

  try {
    // Verificar inscripción
    const inscritoRes = await query(
      `SELECT i.id FROM public.inscripciones i
       WHERE i.usuario_id = $1 AND i.clase_id = $2`,
      [req.usuario.id, clase_id]
    );

    if (inscritoRes.rows.length === 0) {
      return res.status(403).json({ error: 'No estás inscrito en esta clase' });
    }

    const inscripcion_id = inscritoRes.rows[0].id;

    // Nombre de la clase
    const claseRes = await query(
      `SELECT id, nombre FROM public.clases WHERE id = $1`,
      [clase_id]
    );

    if (claseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Clase no encontrada' });
    }

    const clase = claseRes.rows[0];

    // Buscar en MongoDB.  clase_id puede estar guardado como string o como
    // número entero según qué ruta lo creó (qr.js vs registrar), por eso
    // consultamos ambos tipos para no perder ningún registro.
    const claseIdNum = parseInt(clase_id, 10);
    const registros  = await Asistencia.find({
      inscripcion_id,
      $or: [{ clase_id: clase_id }, { clase_id: claseIdNum }]
    }).sort({ fecha_dia: -1 }).lean();

    // Deduplicar por fecha_dia: presente > justificado > ausente
    const prioridad = { presente: 3, justificado: 2, ausente: 1 };
    const sesionesMap = {};
    for (const r of registros) {
      const prev = sesionesMap[r.fecha_dia];
      if (!prev || (prioridad[r.estado] ?? 0) > (prioridad[prev.estado] ?? 0)) {
        sesionesMap[r.fecha_dia] = r;
      }
    }

    const sesiones = Object.values(sesionesMap)
      .sort((a, b) => b.fecha_dia.localeCompare(a.fecha_dia));

    // Calcular resumen
    const total        = sesiones.length;
    const presentes    = sesiones.filter(s => s.estado === 'presente' || s.estado === 'justificado').length;
    const ausentes     = sesiones.filter(s => s.estado === 'ausente').length;
    const justificados = sesiones.filter(s => s.estado === 'justificado').length;
    const porcentaje   = total > 0 ? Math.round((presentes / total) * 1000) / 10 : 0;

    return res.json({
      clase:   { id: clase.id, nombre: clase.nombre },
      resumen: { presentes, ausentes, justificados, total, porcentaje },
      sesiones: sesiones.map(s => ({
        fecha_dia:      s.fecha_dia,
        estado:         s.estado,
        fecha_registro: s.fecha_registro ?? null
      }))
    });

  } catch (err) {
    console.error('Error trayendo historial del estudiante:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  RUTAS PROFESOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/asistencia/lista/:clase_id?fecha=YYYY-MM-DD
 */
router.get('/lista/:clase_id', verificarToken, soloProfesor, async (req, res) => {
  const { clase_id } = req.params;
  const { fecha }    = req.query;

  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Formato de fecha inválido. Usa YYYY-MM-DD' });
  }

  try {
    const claseRes = await query(
      `SELECT id, nombre, fecha_hora
       FROM public.clases
       WHERE id = $1 AND profesor_id = $2`,
      [clase_id, req.usuario.id]
    );

    if (claseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Clase no encontrada' });
    }

    const clase = claseRes.rows[0];

    const { rows } = await query(
      `SELECT i.id AS inscripcion_id, u.id, u.nombre, u.email
       FROM public.inscripciones i
       JOIN public.usuarios u ON u.id = i.usuario_id
       WHERE i.clase_id = $1
       ORDER BY u.nombre`,
      [clase_id]
    );

    const filtroMongo = { clase_id };
    if (fecha) filtroMongo.fecha_dia = fecha;

    const asistenciasMongo = await Asistencia.find(filtroMongo).lean();

    const asistenciaMap = {};
    for (const a of asistenciasMongo) {
      asistenciaMap[a.inscripcion_id] = a;
    }

    const estudiantes = rows.map(est => {
      const a = asistenciaMap[est.inscripcion_id];
      return {
        id:                 est.id,
        nombre:             est.nombre,
        email:              est.email,
        inscripcion_id:     est.inscripcion_id,
        estado:             a?.estado            ?? 'ausente',
        fecha_registro:     a?.fecha_registro     ?? null,
        id_asistencia:      a?._id?.toString()    ?? null,
        confianza_score:    a?.confianza_score    ?? null,
        revision_requerida: a?.revision_requerida ?? false,
      };
    });

    const presentes = estudiantes.filter(r => r.estado === 'presente').length;
    const ausentes  = estudiantes.filter(r => r.estado === 'ausente').length;
    const revision  = estudiantes.filter(r => r.revision_requerida).length;

    return res.json({
      clase:    { id: clase.id, nombre: clase.nombre, fecha_hora: clase.fecha_hora },
      resumen:  { presentes, ausentes, total: estudiantes.length, revision },
      estudiantes
    });

  } catch (err) {
    console.error('Error trayendo lista:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/asistencia/estado/:inscripcion_id
 */
router.patch('/estado/:inscripcion_id', verificarToken, soloProfesor, async (req, res) => {
  const { inscripcion_id }  = req.params;
  const { estado, clase_id } = req.body;

  const estadosValidos = ['presente', 'ausente', 'justificado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: `estado debe ser: ${estadosValidos.join(', ')}` });
  }
  if (!clase_id) {
    return res.status(400).json({ error: 'clase_id es requerido' });
  }

  try {
    const claseCheck = await query(
      `SELECT id FROM public.clases WHERE id = $1 AND profesor_id = $2`,
      [clase_id, req.usuario.id]
    );
    if (claseCheck.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes acceso a esta clase' });
    }

    const fechaDiaHoy = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })
      .split('-').reverse().join('-');

    const registro = await Asistencia.findOneAndUpdate(
      { inscripcion_id, clase_id, fecha_dia: fechaDiaHoy },
      {
        $set: {
          estado,
          metodo:             'manual',
          revision_requerida: false,
          updated_by:         req.usuario.id,
        },
        $setOnInsert: { inscripcion_id, clase_id, fecha_dia: fechaDiaHoy }
      },
      { upsert: true, new: true }
    );

    return res.json({ mensaje: 'Estado actualizado', estado: registro.estado });

  } catch (err) {
    console.error('Error actualizando estado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/asistencia/:id_asistencia
 */
router.patch('/:id_asistencia', verificarToken, soloProfesor, async (req, res) => {
  const { id_asistencia } = req.params;
  const { estado }        = req.body;

  const estadosValidos = ['presente', 'ausente', 'justificado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: `estado debe ser: ${estadosValidos.join(', ')}` });
  }

  try {
    const check = await query(
      `SELECT a.id
       FROM public.asistencias a
       JOIN public.clases c ON c.id = a.clase_id
       WHERE a.id = $1 AND c.profesor_id = $2`,
      [id_asistencia, req.usuario.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    const result = await query(
      `UPDATE public.asistencias
       SET estado             = $1,
           updated_at         = NOW(),
           updated_by         = $2,
           revision_requerida = false
       WHERE id = $3
       RETURNING id, estado, updated_at`,
      [estado, req.usuario.id, id_asistencia]
    );

    return res.json({ mensaje: 'Estado actualizado', registro: result.rows[0] });

  } catch (err) {
    console.error('Error actualizando asistencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/asistencia/reporte/:clase_id
 */
router.get('/reporte/:clase_id', verificarToken, soloProfesor, async (req, res) => {
  const { clase_id } = req.params;

  try {
    const claseRes = await query(
      `SELECT id, nombre FROM public.clases WHERE id = $1 AND profesor_id = $2`,
      [clase_id, req.usuario.id]
    );

    if (claseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Clase no encontrada' });
    }

    const clase = claseRes.rows[0];

    const estudiantesRes = await query(
      `SELECT u.id, u.nombre, u.email, i.id AS inscripcion_id
       FROM public.inscripciones i
       JOIN public.usuarios u ON u.id = i.usuario_id
       WHERE i.clase_id = $1
       ORDER BY u.nombre`,
      [clase_id]
    );

    const estudiantes = estudiantesRes.rows;

    if (estudiantes.length === 0) {
      return res.status(400).json({ error: 'No hay estudiantes inscritos en esta clase' });
    }

    const todasAsistencias = await Asistencia.find({ clase_id }).lean();

    const fechasSet = new Set();
    for (const a of todasAsistencias) fechasSet.add(a.fecha_dia);

    if (fechasSet.size === 0) {
      const hoy = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })
        .split('-').reverse().join('-');
      fechasSet.add(hoy);
    }

    const fechasClaseISO = Array.from(fechasSet).sort();
    const fechasClase    = fechasClaseISO.map(f => {
      const [y, m, d] = f.split('-');
      return `${d}/${m}/${y}`;
    });

    const asistenciaMap = {};
    for (const a of todasAsistencias) {
      const [y, m, d]    = a.fecha_dia.split('-');
      const fechaDisplay = `${d}/${m}/${y}`;
      const key          = `${a.inscripcion_id}_${fechaDisplay}`;
      if (!asistenciaMap[key] || a.estado === 'presente') {
        asistenciaMap[key] = a.estado;
      }
    }

    // ── Construir Excel ───────────────────────────────────────────────────────
    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(clase.nombre);

    const estiloHeaderClase = {
      font:      { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD42931' } },
      alignment: { horizontal: 'center', vertical: 'middle' }
    };
    const estiloHeaderCol = {
      font:      { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border:    { bottom: { style: 'thin', color: { argb: 'FFD42931' } } }
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

    const totalCols = 2 + fechasClase.length + 1;

    worksheet.mergeCells(1, 1, 1, totalCols);
    const celdaTitulo  = worksheet.getCell('A1');
    celdaTitulo.value  = `Reporte de Asistencia — ${clase.nombre}`;
    Object.assign(celdaTitulo, estiloHeaderClase);
    worksheet.getRow(1).height = 30;

    worksheet.mergeCells(2, 1, 2, totalCols);
    const celdaFecha   = worksheet.getCell('A2');
    celdaFecha.value   = `Generado: ${formatFecha(new Date())}   ·   Sesiones registradas: ${fechasClase.length}`;
    celdaFecha.font      = { italic: true, size: 10, color: { argb: 'FF666666' } };
    celdaFecha.alignment = { horizontal: 'center' };
    worksheet.getRow(2).height = 18;
    worksheet.getRow(3).height = 6;

    const headers    = ['Estudiante', 'Email', ...fechasClase, '% Asistencia'];
    const filaHeader = worksheet.getRow(4);
    filaHeader.height = 36;
    headers.forEach((h, i) => {
      const celda = filaHeader.getCell(i + 1);
      celda.value = h;
      Object.assign(celda, estiloHeaderCol);
    });

    worksheet.getColumn(1).width = 28;
    worksheet.getColumn(2).width = 26;
    fechasClase.forEach((_, i) => { worksheet.getColumn(3 + i).width = 9; });
    worksheet.getColumn(3 + fechasClase.length).width = 14;

    estudiantes.forEach((est, rowIdx) => {
      const fila      = worksheet.getRow(5 + rowIdx);
      fila.height     = 20;
      const esFilaPar = rowIdx % 2 === 0;
      const fillFila  = esFilaPar
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } }
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

      const celdaNombre  = fila.getCell(1);
      celdaNombre.value  = est.nombre;
      celdaNombre.font   = { size: 11 };
      celdaNombre.fill   = fillFila;

      const celdaEmail       = fila.getCell(2);
      celdaEmail.value       = est.email;
      celdaEmail.font        = { size: 10, color: { argb: 'FF666666' } };
      celdaEmail.fill        = fillFila;
      celdaEmail.alignment   = { horizontal: 'center' };

      let presentes = 0;
      fechasClase.forEach((fechaStr, colIdx) => {
        const key    = `${est.inscripcion_id}_${fechaStr}`;
        const estado = asistenciaMap[key];
        const celda  = fila.getCell(3 + colIdx);

        if (estado === 'presente' || estado === 'justificado') {
          celda.value = '✓';
          Object.assign(celda, estiloPresente);
          presentes++;
        } else if (estado === 'ausente') {
          celda.value = '✕';
          Object.assign(celda, estiloAusente);
        } else {
          celda.value     = '—';
          celda.font      = { color: { argb: 'FFCCCCCC' } };
          celda.alignment = { horizontal: 'center' };
        }
      });

      const porcentaje = fechasClase.length > 0 ? (presentes / fechasClase.length) * 100 : 0;
      const celdaPct   = fila.getCell(3 + fechasClase.length);
      celdaPct.value   = porcentaje;
      celdaPct.numFmt  = '0.0"%"';
      celdaPct.alignment = { horizontal: 'center' };
      celdaPct.font    = {
        bold: true, size: 11,
        color: { argb: porcentaje >= 75 ? 'FF1A7A3C' : porcentaje >= 50 ? 'FF856404' : 'FFD42931' }
      };
      celdaPct.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: porcentaje >= 75 ? 'FFE6F4EA' : porcentaje >= 50 ? 'FFFFF3CD' : 'FFFDE8E8' }
      };
    });

    const filaResumen   = worksheet.getRow(5 + estudiantes.length);
    filaResumen.height  = 22;
    const lblResumen    = filaResumen.getCell(1);
    lblResumen.value    = 'TOTALES PRESENTES';
    lblResumen.font     = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    lblResumen.fill     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF555555' } };
    filaResumen.getCell(2).fill = lblResumen.fill;

    fechasClase.forEach((fechaStr, colIdx) => {
      const presentes = estudiantes.filter(est => {
        const key = `${est.inscripcion_id}_${fechaStr}`;
        return asistenciaMap[key] === 'presente' || asistenciaMap[key] === 'justificado';
      }).length;
      const celda     = filaResumen.getCell(3 + colIdx);
      celda.value     = presentes;
      celda.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
      celda.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF555555' } };
      celda.alignment = { horizontal: 'center' };
    });

    const nombreArchivo = `Asistencia_${clase.nombre.replace(/\s+/g, '_')}_${formatFechaArchivo(new Date())}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Error generando reporte:', err);
    res.status(500).json({ error: 'Error generando reporte' });
  }
});

/**
 * POST /api/asistencia/cerrar/:clase_id
 */
router.post('/cerrar/:clase_id', verificarToken, soloProfesor, async (req, res) => {
  const { clase_id } = req.params;

  try {
    const result = await query(
      `UPDATE public.clases
       SET estado = 'cerrada'
       WHERE id = $1 AND profesor_id = $2
       RETURNING id`,
      [clase_id, req.usuario.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Clase no encontrada' });
    }

    return res.json({ mensaje: 'Clase cerrada' });

  } catch (err) {
    res.status(500).json({ error: 'Error cerrando clase' });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
  });
}

function formatFechaArchivo(fecha) {
  return fecha.toISOString().split('T')[0];
}

module.exports = router;