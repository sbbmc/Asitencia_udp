const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const nodemailer = require('nodemailer');
const { verificarToken, soloEstudiante } = require('../middleware/auth');
const { query } = require('../db');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten archivos PDF, JPG o PNG'));
  }
});

function crearTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    }
  });
}

router.post('/enviar', verificarToken, soloEstudiante, upload.single('archivo'), async (req, res) => {
  const { clase_id, fecha_ausencia, motivo } = req.body;
  const estudiante = req.usuario;

  if (!clase_id || !fecha_ausencia || !motivo?.trim()) {
    return res.status(400).json({ error: 'Clase, fecha y motivo son requeridos' });
  }

  if (motivo.trim().length < 20) {
    return res.status(400).json({ error: 'El motivo debe tener al menos 20 caracteres' });
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.status(500).json({ error: 'El servicio de correo no está configurado' });
  }

  try {
    const inscritoRes = await query(
      `SELECT c.nombre FROM public.inscripciones i
       JOIN public.clases c ON c.id = i.clase_id
       WHERE i.usuario_id = $1 AND i.clase_id = $2`,
      [estudiante.id, clase_id]
    );

    if (inscritoRes.rows.length === 0) {
      return res.status(403).json({ error: 'No estás inscrito en esta clase' });
    }

    const nombreClase = inscritoRes.rows[0].nombre;
    const [y, m, d]  = fecha_ausencia.split('-');
    const fechaDisplay = `${d}/${m}/${y}`;
    const destino = process.env.EMAIL_DESTINO || 'secretaria.academica@udp.cl';

    const mailOptions = {
      from: `"AsistUDP" <${process.env.EMAIL_USER}>`,
      to:   destino,
      replyTo: estudiante.correo,
      subject: `Justificativo Médico — ${estudiante.nombre} — ${nombreClase} — ${fechaDisplay}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#D42931;padding:28px 24px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">Justificativo Médico</h1>
            <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">
              AsistUDP — Universidad Diego Portales
            </p>
          </div>
          <div style="background:#fff;padding:28px 24px;border:1px solid #E5E5E5;border-top:none;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr style="border-bottom:1px solid #F0F0F0;">
                <td style="padding:10px 0;color:#ABABAB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;width:140px;">Estudiante</td>
                <td style="padding:10px 0;font-size:14px;font-weight:600;color:#161616;">${estudiante.nombre}</td>
              </tr>
              <tr style="border-bottom:1px solid #F0F0F0;">
                <td style="padding:10px 0;color:#ABABAB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Correo</td>
                <td style="padding:10px 0;font-size:14px;color:#161616;">${estudiante.correo}</td>
              </tr>
              <tr style="border-bottom:1px solid #F0F0F0;">
                <td style="padding:10px 0;color:#ABABAB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Clase</td>
                <td style="padding:10px 0;font-size:14px;color:#161616;">${nombreClase}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#ABABAB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Fecha de ausencia</td>
                <td style="padding:10px 0;font-size:14px;color:#161616;">${fechaDisplay}</td>
              </tr>
            </table>
            <div style="background:#F7F7F7;border-radius:8px;padding:16px 18px;">
              <p style="margin:0 0 8px;color:#ABABAB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Motivo / Descripción</p>
              <p style="margin:0;font-size:14px;line-height:1.7;color:#161616;">${motivo.trim().replace(/\n/g, '<br>')}</p>
            </div>
            ${req.file
              ? `<p style="margin:18px 0 0;font-size:13px;color:#6B6B6B;">📎 Documento adjunto: <strong>${req.file.originalname}</strong></p>`
              : `<p style="margin:18px 0 0;font-size:13px;color:#ABABAB;">Sin archivo adjunto</p>`
            }
          </div>
        </div>`,
      attachments: req.file
        ? [{ filename: req.file.originalname, content: req.file.buffer, contentType: req.file.mimetype }]
        : []
    };

    await crearTransporter().sendMail(mailOptions);
    return res.json({ mensaje: 'Justificativo enviado correctamente a secretaría académica' });

  } catch (err) {
    console.error('Error enviando justificativo:', err);
    res.status(500).json({ error: 'Error al enviar el correo. Intenta nuevamente.' });
  }
});

module.exports = router;
