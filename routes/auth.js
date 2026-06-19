const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query }                   = require('../db');
const { JWT_SECRET, JWT_EXPIRES } = require('../middleware/auth');

// ── Rate limit específico para login ──────────────────────────────────────────
const limiterLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intenta en 15 minutos.' }
});

/**
 * POST /api/auth/login
 * Body: { correo, password }
 */
router.post('/login', limiterLogin, async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
  }
  if (typeof correo !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Formato de datos inválido' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: 'Formato de datos inválido' });
  }

  try {
    const { rows } = await query(
      `SELECT id, nombre, email, rut, password_hash, rol
       FROM public.usuarios
       WHERE email = $1
       LIMIT 1`,
      [correo.toLowerCase().trim()]
    );

    // Siempre comparar con bcrypt aunque el usuario no exista (anti timing-attack)
    const hashFallback = '$2a$10$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const hash   = rows[0]?.password_hash ?? hashFallback;
    const valida = await bcrypt.compare(password, hash);

    if (rows.length === 0 || !valida) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = rows[0];

    // El payload del JWT lleva solo lo esencial.
    // Las clases del profesor se cargan en el cliente vía GET /api/qr/clases.
    const payload = {
      id:     usuario.id,
      nombre: usuario.nombre,
      correo: usuario.email,
      rut:    usuario.rut,
      rol:    usuario.rol,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    return res.json({ mensaje: 'Login exitoso', token, usuario: payload });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/auth/verificar
 * Valida el JWT actual (usado al recargar la app).
 */
router.get('/verificar', (req, res) => {
  const auth  = req.headers['authorization'];
  const token = auth && auth.split(' ')[1];
  if (!token) return res.status(401).json({ valido: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valido: true, usuario: decoded });
  } catch {
    res.status(403).json({ valido: false });
  }
});

module.exports = router;