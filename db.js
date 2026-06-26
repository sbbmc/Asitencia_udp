const { Pool } = require('pg');
require('dotenv').config();

// En producción se requieren todas las variables de entorno.
// En desarrollo se permiten defaults para facilitar el setup local.
const esProduccion = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host:     process.env.PGHOST     || process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.PGPORT     || process.env.DB_PORT)  || 5432,
  database: process.env.PGDATABASE || process.env.DB_NAME     || 'asistencia_db',
  user:     process.env.PGUSER     || process.env.DB_USER     || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
  ssl: esProduccion ? { rejectUnauthorized: false } : false,
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