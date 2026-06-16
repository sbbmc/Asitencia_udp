require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const authRoutes       = require('./routes/auth');
const qrRoutes         = require('./routes/qr');
const asistenciaRoutes = require('./routes/asistencia');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── Seguridad: cabeceras HTTP ──────────────────────────────────────────────────
// Helmet sin CSP propio — lo manejamos manualmente abajo para mayor control.
app.use(helmet({ contentSecurityPolicy: false }));

// ── CSP manual ─────────────────────────────────────────────────────────────────
// Se define aquí para asegurar que 'unsafe-inline' no sea ignorado por helmet,
// y para incluir los dominios necesarios (fuentes, qr scanner, ngrok).
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com unpkg.com",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
    ].join('; ')
  );
  next();
});

// ── Seguridad: CORS restringido ────────────────────────────────────────────────
// Solo se permiten requests desde el origen definido en .env.
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ── Seguridad: rate limiting global ───────────────────────────────────────────
// Máximo 100 requests cada 15 minutos por IP para todas las rutas de la API.
const limiterGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' }
});
app.use('/api/', limiterGeneral);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // Limitar tamaño del body
app.use(express.static(path.join(__dirname, 'public')));

// ── API ────────────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/qr',         qrRoutes);
app.use('/api/asistencia', asistenciaRoutes);

// ── SPA fallback ───────────────────────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Manejo global de errores ───────────────────────────────────────────────────
// Este middleware captura cualquier error no controlado en las rutas.
// En producción nunca se expone el stack trace al cliente.
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  const esProduccion = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: 'Error interno del servidor',
    ...(esProduccion ? {} : { detalle: err.message })
  });
});

// ── Arrancar ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ AsistUDP corriendo en http://localhost:${PORT}`);
  console.log(`   DB:   ${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`);
  console.log(`   Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS: ${CORS_ORIGIN}\n`);
});