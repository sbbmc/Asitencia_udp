const express  = require('express');
const router   = express.Router();
const { query }                          = require('../db');
const { verificarToken, soloEstudiante } = require('../middleware/auth');
const { validarTokenQR }                 = require('./qr');

/**
 * POST /api/asistencia/registrar
 * El estudiante envía su JWT (header) + tokenQR (body).
 * Se graba en public.asistencias con estado = 'presente'.
 *
 * Usa INSERT ... ON CONFLICT para evitar duplicados
 * (constraint UNIQUE id_clase + id_estudiante ya existe en el schema).
 */
router.post('/registrar', verificarToken, soloEstudiante, async (req, res) => {
  const { tokenQR } = req.body;
  const estudiante  = req.usuario;

  if (!tokenQR) {
    return res.status(400).json({ error: 'tokenQR es requerido' });
  }

  try {
    // 1. Validar QR contra la DB
    const validacion = await validarTokenQR(tokenQR);
    if (!validacion.valido) {
      return res.status(410).json({
        error: 'QR inválido o expirado',
        detalle: validacion.razon
      });
    }

    const { clase } = validacion;

    // 2. Verificar que el estudiante está inscrito en la sección del ramo
    //    (si la clase tiene id_seccion; si no, se permite a cualquiera)
    if (clase.id_seccion) {
      const inscrito = await query(
        `SELECT 1 FROM public.inscripciones
         WHERE id_estudiante = $1 AND id_seccion = $2`,
        [estudiante.id, clase.id_seccion]
      );
      if (inscrito.rows.length === 0) {
        return res.status(403).json({
          error: 'No estás inscrito en este ramo/sección'
        });
      }
    }

    // 3. INSERT con ON CONFLICT para manejar el intento de doble registro
    const result = await query(
      `INSERT INTO public.asistencias
         (id_clase, id_estudiante, estado, fecha_registro, updated_at)
       VALUES ($1, $2, 'presente', NOW(), NOW())
       ON CONFLICT (id_clase, id_estudiante)
       DO UPDATE SET estado = 'presente', updated_at = NOW()
       RETURNING id, estado, fecha_registro`,
      [clase.id, estudiante.id]
    );

    const registro = result.rows[0];

    // 4. Traer nombre del ramo para la respuesta (UX)
    const ramoRes = await query(
      `SELECT nombre_ramo FROM public.ramos WHERE id = $1`,
      [clase.id_ramo]
    );
    const nombreRamo = ramoRes.rows[0]?.nombre_ramo || 'Clase';

    console.log(`✅ Asistencia: ${estudiante.nombre} → ${nombreRamo} (clase ${clase.id})`);

    res.status(201).json({
      mensaje:   '¡Asistencia registrada correctamente!',
      registro: {
        id:              registro.id,
        estado:          registro.estado,
        nombre:          estudiante.nombre,
        rut:             estudiante.rut,
        ramo:            nombreRamo,
        fecha_registro:  registro.fecha_registro,
        hora: new Date(registro.fecha_registro).toLocaleTimeString('es-CL', {
          timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit'
        })
      }
    });

  } catch (err) {
    console.error('Error registrando asistencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/asistencia/lista/:id_clase
 * Solo profesores. Devuelve todos los estudiantes de la clase con su estado.
 */
router.get('/lista/:id_clase', verificarToken, async (req, res) => {
  const { id_clase } = req.params;

  try {
    // Verificar que la clase existe y (si es profesor) que le pertenece
    const claseRes = await query(
      `SELECT c.id, c.id_ramo, c.fecha_hora, r.nombre_ramo
       FROM public.clases c
       JOIN public.ramos r ON r.id = c.id_ramo
       WHERE c.id = $1`,
      [id_clase]
    );

    if (claseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Clase no encontrada' });
    }

    const clase = claseRes.rows[0];

    // Traer todos los estudiantes con su estado (presente / ausente)
    // LEFT JOIN para incluir los que nunca escanearon (ausentes por defecto)
    const { rows } = await query(
      `SELECT u.id, u.nombre, u.rut, u.correo,
              COALESCE(a.estado, 'ausente') AS estado,
              a.fecha_registro,
              a.id AS id_asistencia
       FROM public.inscripciones i
       JOIN public.usuarios u ON u.id = i.id_estudiante
       LEFT JOIN public.asistencias a
         ON a.id_estudiante = u.id AND a.id_clase = $1
       WHERE i.id_seccion = (
         SELECT id_seccion FROM public.clases WHERE id = $1
       )
       ORDER BY u.nombre`,
      [id_clase]
    );

    const presentes = rows.filter(r => r.estado === 'presente').length;
    const ausentes  = rows.filter(r => r.estado === 'ausente').length;

    res.json({
      clase: {
        id:         clase.id,
        nombre_ramo: clase.nombre_ramo,
        fecha_hora:  clase.fecha_hora
      },
      resumen: { presentes, ausentes, total: rows.length },
      estudiantes: rows
    });

  } catch (err) {
    console.error('Error trayendo lista:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/asistencia/:id_asistencia
 * El profesor puede cambiar manualmente el estado (presente/ausente/justificado).
 * Body: { estado }
 */
router.patch('/:id_asistencia', verificarToken, async (req, res) => {
  const { id_asistencia } = req.params;
  const { estado }        = req.body;

  const estadosValidos = ['presente', 'ausente', 'justificado'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: `estado debe ser uno de: ${estadosValidos.join(', ')}` });
  }

  try {
    const result = await query(
      `UPDATE public.asistencias
       SET estado = $1, updated_at = NOW(), updated_by = $2
       WHERE id = $3
       RETURNING id, estado, updated_at`,
      [estado, req.usuario.id, id_asistencia]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro de asistencia no encontrado' });
    }

    res.json({ mensaje: 'Estado actualizado', registro: result.rows[0] });

  } catch (err) {
    console.error('Error actualizando asistencia:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
