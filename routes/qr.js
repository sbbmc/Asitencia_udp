const express  = require('express');
const router   = express.Router();
const QRCode   = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { query }                        = require('../db');
const { verificarToken, soloProfesor } = require('../middleware/auth');

const DURACION_SEG = 7; // 7 segundos de validez por QR

/**
 * POST /api/qr/generar
 * Solo profesores. Crea un registro en public.clases con token_qr y expira_at,
 * luego devuelve la imagen QR en base64.
 *
 * Body: { id_ramo, id_seccion }
 */
router.post('/generar', verificarToken, soloProfesor, async (req, res) => {
  const { id_ramo, id_seccion } = req.body;

  if (!id_ramo) {
    return res.status(400).json({ error: 'id_ramo es requerido' });
  }

  try {
    // Verificar que el ramo pertenece al profesor
    const ramoCheck = await query(
      `SELECT id FROM public.ramos WHERE id = $1 AND id_profesor = $2`,
      [id_ramo, req.usuario.id]
    );
    if (ramoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Este ramo no te pertenece' });
    }

    const tokenQR  = uuidv4();
    const expiraAt = new Date(Date.now() + DURACION_SEG * 1000);

    // Reusar clase activa del mismo ramo/profesor o crear una nueva
    const claseExistente = await query(
      `SELECT id FROM public.clases 
       WHERE id_ramo = $1 AND id_seccion IS NOT DISTINCT FROM $2
       AND fecha_hora::date = CURRENT_DATE
       ORDER BY fecha_hora DESC LIMIT 1`,
      [id_ramo, id_seccion || null]
    );

    let insertRes;
    if (claseExistente.rows.length > 0) {
      // Actualizar solo el token y expiración
      insertRes = await query(
        `UPDATE public.clases SET token_qr = $1, expira_at = $2
         WHERE id = $3
         RETURNING id, fecha_hora, token_qr, expira_at`,
        [tokenQR, expiraAt, claseExistente.rows[0].id]
      );
    } else {
      insertRes = await query(
        `INSERT INTO public.clases (id_ramo, id_seccion, fecha_hora, token_qr, expira_at)
         VALUES ($1, $2, NOW(), $3, $4)
         RETURNING id, fecha_hora, token_qr, expira_at`,
        [id_ramo, id_seccion || null, tokenQR, expiraAt]
      );
    }

    const clase = insertRes.rows[0];

    // La URL que codifica el QR lleva al estudiante directamente al flujo de registro
    const urlQR = `${req.protocol}://${req.get('host')}/registrar?token=${tokenQR}`;

    const imagenBase64 = await QRCode.toDataURL(urlQR, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 280,
      color: { dark: '#D42931', light: '#ffffff' }
    });

    res.json({
      id_clase:        clase.id,
      token_qr:        clase.token_qr,
      expira_at:       clase.expira_at,
      duracion_seg:    DURACION_SEG,
      tiempoRestanteMs: DURACION_SEG * 1000,
      imagenQR:        imagenBase64,
      urlQR
    });

  } catch (err) {
    console.error('Error generando QR:', err);
    res.status(500).json({ error: 'Error generando QR', detalle: err.message });
  }
});

/**
 * GET /api/qr/ramos
 * Devuelve los ramos del profesor autenticado (para el selector en el modal)
 */
router.get('/ramos', verificarToken, soloProfesor, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.id AS id_ramo, r.nombre_ramo,
              s.id AS id_seccion, s.semestre, s.anio
       FROM public.ramos r
       LEFT JOIN public.secciones s
         ON s.id_ramo = r.id AND s.id_profesor = $1
       WHERE r.id_profesor = $1
       ORDER BY r.nombre_ramo`,
      [req.usuario.id]
    );
    res.json({ ramos: rows });
  } catch (err) {
    console.error('Error trayendo ramos:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * Función interna exportada para que asistencia.js valide el token QR
 * directamente en la DB (sin estado en memoria).
 */
async function validarTokenQR(tokenQR) {
  const { rows } = await query(
    `SELECT id, id_ramo, id_seccion, expira_at
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