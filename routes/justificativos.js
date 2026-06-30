const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const nodemailer = require('nodemailer');
const { verificarToken, soloEstudiante } = require('../middleware/auth');

// Lee las variables de correo limpiando comillas/espacios del VALOR, y
// tolerando que el NOMBRE de la variable en el panel tenga espacios o
// mayúsculas raras (ej. "EMAIL_USER " con espacio final), que hacen que
// process.env.EMAIL_USER no la encuentre aunque el valor esté ahí.
const clean = v => (v ?? '').trim().replace(/^["']|["']$/g, '');
function resolveEnv(name) {
  if (process.env[name] != null) return clean(process.env[name]);
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(process.env)) {
    if (k.trim().toLowerCase() === target) return clean(v);
  }
  return '';
}
const EMAIL_USER    = resolveEnv('EMAIL_USER');
const EMAIL_PASS    = resolveEnv('EMAIL_PASS');
const EMAIL_DESTINO = resolveEnv('EMAIL_DESTINO');

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
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

router.post('/enviar', verificarToken, soloEstudiante, upload.single('archivo'), async (req, res) => {
  const { motivo } = req.body;
  const estudiante = req.usuario;

  if (!motivo?.trim()) {
    return res.status(400).json({ error: 'El motivo es requerido' });
  }

  if (!EMAIL_USER || !EMAIL_PASS) {
    console.error('[justificativos] Faltan variables de correo en el entorno:',
      { EMAIL_USER: !!EMAIL_USER, EMAIL_PASS: !!EMAIL_PASS });
    return res.status(500).json({ error: 'El servicio de correo no está configurado' });
  }

  try {
    const destino = EMAIL_DESTINO || 'secretaria.academica@udp.cl';

    const mailOptions = {
      from: `"AsistUDP" <${EMAIL_USER}>`,
      to:   destino,
      replyTo: estudiante.correo,
      subject: `Justificativo — ${estudiante.nombre}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#D42931;padding:28px 24px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;">Justificativo</h1>
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
              <tr>
                <td style="padding:10px 0;color:#ABABAB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Correo</td>
                <td style="padding:10px 0;font-size:14px;color:#161616;">${estudiante.correo}</td>
              </tr>
            </table>
            <div style="background:#F7F7F7;border-radius:8px;padding:16px 18px;">
              <p style="margin:0 0 8px;color:#ABABAB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Motivo</p>
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
