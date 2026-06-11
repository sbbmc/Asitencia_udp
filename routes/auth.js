const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { query }                        = require('../db');
const { JWT_SECRET, JWT_EXPIRES }      = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Body: { correo, password }
 *
 * Busca el usuario en public.usuarios por correo,
 * valida bcrypt y devuelve JWT + datos del perfil.
 */
router.post('/login', async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
  }

  try {
    // Traer usuario + ramo del profesor si aplica
    const { rows } = await query(
      `SELECT u.id, u.rut, u.nombre, u.correo, u.password_hash, u.rol
       FROM public.usuarios u
       WHERE u.correo = $1
       LIMIT 1`,
      [correo.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const usuario = rows[0];
    const valida  = await bcrypt.compare(password, usuario.password_hash);

    if (!valida) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

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
