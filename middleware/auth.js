const jwt = require('jsonwebtoken');
require('dotenv').config();

// Si JWT_SECRET no está definido el servidor no debe arrancar.
// Un fallback hardcodeado es un agujero de seguridad crítico.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET no está definido en .env');
  console.error('   Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}

const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

function verificarToken(req, res, next) {
  const auth  = req.headers['authorization'];
  const token = auth && auth.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    // No filtrar el tipo de error JWT al cliente
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

function soloProfesor(req, res, next) {
  if (req.usuario?.rol !== 'profesor') {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }
  next();
}

function soloEstudiante(req, res, next) {
  if (req.usuario?.rol !== 'estudiante') {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }
  next();
}

module.exports = { verificarToken, soloProfesor, soloEstudiante, JWT_SECRET, JWT_EXPIRES };