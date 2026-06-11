const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET  = process.env.JWT_SECRET  || 'asistudp_secret_2024';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

function verificarToken(req, res, next) {
  const auth  = req.headers['authorization'];
  const token = auth && auth.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

function soloProfesor(req, res, next) {
  if (req.usuario.rol !== 'profesor') {
    return res.status(403).json({ error: 'Solo profesores pueden realizar esta acción' });
  }
  next();
}

function soloEstudiante(req, res, next) {
  if (req.usuario.rol !== 'estudiante') {
    return res.status(403).json({ error: 'Solo estudiantes pueden realizar esta acción' });
  }
  next();
}

module.exports = { verificarToken, soloProfesor, soloEstudiante, JWT_SECRET, JWT_EXPIRES };
