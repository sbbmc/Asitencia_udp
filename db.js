const { Pool } = require('pg');
require('dotenv').config();

// En producción se requieren todas las variables de entorno.
// En desarrollo se permiten defaults para facilitar el setup local.
const esProduccion = process.env.NODE_ENV === 'production';

if (esProduccion) {
  const requeridas = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const faltantes  = requeridas.filter(k => !process.env[k]);
  if (faltantes.length > 0) {
    console.error(`❌ FATAL: Faltan variables de entorno en producción: ${faltantes.join(', ')}`);
    process.exit(1);
  }
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'asistencia_db',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ...(esProduccion && { ssl: { rejectUnauthorized: false } }),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

pool.on('error', (err) => {
  console.error('❌ Error en pool PostgreSQL:', err.message);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query };