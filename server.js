require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes       = require('./routes/auth');
const qrRoutes         = require('./routes/qr');
const asistenciaRoutes = require('./routes/asistencia');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/qr',         qrRoutes);
app.use('/api/asistencia', asistenciaRoutes);

// ── Páginas HTML ──────────────────────────────────────────────────────────────
// La app es SPA (single HTML), todas las rutas devuelven index.html
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Arrancar ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ AsistUDP corriendo en http://localhost:${PORT}`);
  console.log(`   DB: ${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`);
  console.log(`   Modo: ${process.env.NODE_ENV || 'development'}\n`);
});
