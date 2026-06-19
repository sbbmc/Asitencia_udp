const express   = require('express');
const router    = express.Router();
const QRCode    = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { query }                        = require('../db');
const { verificarToken, soloProfesor } = require('../middleware/auth');
const { generarCodigoVerbal }          = require('../utils/validacion');
const Asistencia                       = require('../models/Asistencia');

const DURACION_SEG = 7;

/**
 * POST /api/qr/generar
 * Body: { clase_id, lat?, lon? }
 *
 * Recibe el ID de la clase existente y solo actualiza token_qr + expira_at.
 * NUNCA crea clases nuevas — eso evita la proliferación de duplicados.
 *
 * Si es el primer QR del día, además crea en MongoDB un registro 'ausente'
 * para todos los inscritos que aún no tengan documento hoy. Así el reporte
 * Excel siempre refleja la sesión completa, aunque nadie haya escaneado.
 */
router.post('/generar', verificarToken, soloProfesor, async (req, res) => {
  const { clase_id, lat, lon } = req.body;

  if (!clase_id) {
    return res.status(400).json({ error: 'clase_id es requerido' });
  }

  try {
    const tokenQR  = uuidv4();
    const expiraAt = new Date(Date.now() + DURACION_SEG * 1000);

    // Verificar si el último QR fue generado hoy (hora Chile).
    // Si fue otro día → generar código verbal nuevo y crear ausencias base.
    // Si fue hoy      → mantener el mismo código verbal del día.
    const claseActual = await query(
      `SELECT fecha_hora, codigo_verbal FROM public.clases
       WHERE id = $1 AND profesor_id = $2`,
      [clase_id, req.usuario.id]
    );

    const ahora       = new Date();
    const hoyChile     = ahora.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    const ultimaFecha  = claseActual.rows[0]?.fecha_hora
      ? new Date(claseActual.rows[0].fecha_hora).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })
      : null;

    const esNuevoDia       = ultimaFecha !== hoyChile;
    const codigoVerbalFijo = esNuevoDia
      ? generarCodigoVerbal()
      : (claseActual.rows[0]?.codigo_verbal ?? generarCodigoVerbal());

    // Si es la primera vez que se pasa lista hoy: actualizar SOLO el token
    // primero (sin tocar fecha_hora todavía), crear las ausencias base en
    // MongoDB, y SOLO AL FINAL marcar fecha_hora = hoy. Así, si llega una
    // llamada concurrente del auto-renovado mientras el bulkWrite corre,
    // esa llamada sigue viendo "es nuevo día" como false-not-yet y no
    // pisa el proceso a medio camino.
    let updateRes;

    if (esNuevoDia) {
      // 1. Actualizar token sin tocar fecha_hora todavía
      updateRes = await query(
        `UPDATE public.clases
         SET token_qr      = $1,
             expira_at     = $2,
             codigo_verbal = $3,
             lat           = COALESCE($4, lat),
             lon           = COALESCE($5, lon),
             estado        = 'activa'
         WHERE id = $6 AND profesor_id = $7
         RETURNING id, nombre, fecha_hora, token_qr, expira_at,
                   codigo_verbal, lat, lon, radio_metros`,
        [tokenQR, expiraAt, codigoVerbalFijo, lat ?? null, lon ?? null,
         clase_id, req.usuario.id]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ error: 'Clase no encontrada o no te pertenece' });
      }

      // 2. Crear ausencia base para TODOS los inscritos (espera a que termine)
      const inscritosRes = await query(
        `SELECT id FROM public.inscripciones WHERE clase_id = $1`,
        [clase_id]
      );

      const fechaDiaHoy = hoyChile.split('-').reverse().join('-'); // DD-MM-YYYY -> YYYY-MM-DD

      const operaciones = inscritosRes.rows.map(({ id: inscripcion_id }) => ({
        updateOne: {
          filter: {
            inscripcion_id,
            clase_id,
            fecha_dia: fechaDiaHoy
          },
          update: {
            $setOnInsert: {
              inscripcion_id,
              clase_id,
              fecha_dia:          fechaDiaHoy,
              estado:             'ausente',
              metodo:             'manual',
              confianza_score:    0,
              revision_requerida: false,
              fecha_registro:     new Date(),
            }
          },
          upsert: true
        }
      }));

      if (operaciones.length > 0) {
        const resultado = await Asistencia.bulkWrite(operaciones, { ordered: false });
        console.log(`📋 Ausencias base creadas: ${resultado.upsertedCount}/${operaciones.length} para clase ${clase_id}`);
      }

      // 3. SOLO AHORA marcar fecha_hora = hoy, una vez que todo terminó
      await query(
        `UPDATE public.clases SET fecha_hora = NOW() WHERE id = $1`,
        [clase_id]
      );

    } else {
      // Mismo día: solo renovar el token, no tocar ausencias ni fecha_hora
      updateRes = await query(
        `UPDATE public.clases
         SET token_qr      = $1,
             expira_at     = $2,
             codigo_verbal = $3,
             lat           = COALESCE($4, lat),
             lon           = COALESCE($5, lon),
             estado        = 'activa'
         WHERE id = $6 AND profesor_id = $7
         RETURNING id, nombre, fecha_hora, token_qr, expira_at,
                   codigo_verbal, lat, lon, radio_metros`,
        [tokenQR, expiraAt, codigoVerbalFijo, lat ?? null, lon ?? null,
         clase_id, req.usuario.id]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ error: 'Clase no encontrada o no te pertenece' });
      }
    }

    const clase = updateRes.rows[0];

    const urlQR = `${req.protocol}://${req.get('host')}/registrar?token=${tokenQR}`;

    const imagenBase64 = await QRCode.toDataURL(urlQR, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width:  280,
      color:  { dark: '#D42931', light: '#ffffff' }
    });

    return res.json({
      id_clase:              clase.id,
      nombre:                clase.nombre,
      token_qr:              clase.token_qr,
      expira_at:             clase.expira_at,
      duracion_seg:          DURACION_SEG,
      tiempoRestanteMs:      DURACION_SEG * 1000,
      imagenQR:              imagenBase64,
      urlQR,
      codigo_verbal:         clase.codigo_verbal,
      ubicacion_configurada: clase.lat != null && clase.lon != null,
      radio_metros:          clase.radio_metros
    });

  } catch (err) {
    console.error('Error generando QR:', err);
    res.status(500).json({ error: 'Error generando QR', detalle: err.message });
  }
});

/**
 * GET /api/qr/clases
 * Devuelve las clases del profesor autenticado para el selector.
 */
router.get('/clases', verificarToken, soloProfesor, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre, codigo, estado
       FROM public.clases
       WHERE profesor_id = $1
       ORDER BY nombre ASC`,
      [req.usuario.id]
    );
    return res.json({ clases: rows });
  } catch (err) {
    console.error('Error trayendo clases:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * Función interna para validar token QR desde asistencia.js
 */
async function validarTokenQR(tokenQR) {
  const { rows } = await query(
    `SELECT id, nombre, expira_at, codigo_verbal, lat, lon, radio_metros
     FROM public.clases
     WHERE token_qr = $1
     LIMIT 1`,
    [tokenQR]
  );

  if (rows.length === 0) return { valido: false, razon: 'Token QR no encontrado' };

  const clase = rows[0];
  if (new Date() > new Date(clase.expira_at)) {
    return { valido: false, razon: 'QR expirado' };
  }

  return { valido: true, clase };
}

module.exports = router;
module.exports.validarTokenQR = validarTokenQR;