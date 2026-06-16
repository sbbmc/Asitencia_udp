const express   = require('express');
const router    = express.Router();
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query }                   = require('../db');
const { JWT_SECRET, JWT_EXPIRES } = require('../middleware/auth');

// ── Rate limit específico para login ──────────────────────────────────────────
// Máximo 10 intentos cada 15 minutos por IP. Corta ataques de fuerza bruta.
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

  // Validación básica de entrada
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
      `SELECT u.id, u.rut, u.nombre, u.correo, u.password_hash, u.rol
       FROM public.usuarios u
       WHERE u.correo = $1
       LIMIT 1`,
      [correo.toLowerCase().trim()]
    );

    // Siempre hacer la comparación bcrypt aunque el usuario no exista.
    // Esto evita timing attacks que permiten enumerar correos válidos.
    const hashFallback = '$2a$10$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const hash  = rows[0]?.password_hash ?? hashFallback;
    const valida = await bcrypt.compare(password, hash);

    if (rows.length === 0 || !valida) {
      // Mensaje genérico: no revelar si el correo existe o no
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = rows[0];

    // Si es profesor, traer sus ramos
    let ramos = [];
    if (usuario.rol === 'profesor') {
      const ramosRes = await query(
        `SELECT r.id, r.nombre_ramo,
                s.id AS id_seccion, s.semestre, s.anio
         FROM public.ramos r
         LEFT JOIN public.secciones s ON s.id_ramo = r.id AND s.id_profesor = $1
         WHERE r.id_profesor = $1
         ORDER BY r.nombre_ramo`,
        [usuario.id]
      );
      ramos = ramosRes.rows;
    }

    const payload = {
      id:     usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rut:    usuario.rut,
      rol:    usuario.rol,
      ...(ramos.length > 0 && { ramos })
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.json({ mensaje: 'Login exitoso', token, usuario: payload });

  } catch (err) {
    console.error('Error en login:', err);
    // No filtrar detalles del error al cliente
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/auth/verificar
 * Valida el JWT actual (usado al recargar la app)
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