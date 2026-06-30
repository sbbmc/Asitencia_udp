require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const { conectarMongo }      = require('./mongo');
const authRoutes             = require('./routes/auth');
const qrRoutes               = require('./routes/qr');
const asistenciaRoutes       = require('./routes/asistencia');
const justificativosRoutes   = require('./routes/justificativos');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));

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

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

const limiterGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' }
});
app.use('/api/', limiterGeneral);

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',           authRoutes);
app.use('/api/qr',             qrRoutes);
app.use('/api/asistencia',     asistenciaRoutes);
app.use('/api/justificativos', justificativosRoutes);

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  const esProduccion = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: 'Error interno del servidor',
    ...(esProduccion ? {} : { detalle: err.message })
  });
});

// Conectar a MongoDB antes de levantar el servidor HTTP
conectarMongo().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ AsistUDP corriendo en http://localhost:${PORT}`);
    console.log(`   DB Postgres: ${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`);
    console.log(`   Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   CORS: ${CORS_ORIGIN}`);
    console.log(`   Correo: EMAIL_USER=${process.env.EMAIL_USER ? 'OK' : 'FALTA'} · EMAIL_PASS=${process.env.EMAIL_PASS ? 'OK' : 'FALTA'} · destino=${process.env.EMAIL_DESTINO || '(default)'}\n`);
  });
});