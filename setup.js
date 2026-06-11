// setup.js — Ejecutar UNA sola vez para crear los usuarios de prueba
// Uso: node setup.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function setup() {
  console.log('\n🔧 Configurando base de datos...\n');

  try {
    // ── 1. Generar hash de la contraseña ──────────────────────────────────────
    const password   = 'test1234';
    const hash       = await bcrypt.hash(password, 10);
    console.log('✅ Contraseña hasheada');

    // ── 2. Insertar profesor ──────────────────────────────────────────────────
    const profRes = await pool.query(
      `INSERT INTO public.usuarios (rut, nombre, correo, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (correo) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, nombre, correo, rol`,
      ['12.345.678-9', 'Andrea Rojas', 'arojas@udp.cl', hash, 'profesor']
    );
    const profesor = profRes.rows[0];
    console.log(`✅ Profesor creado:    ${profesor.nombre} (id: ${profesor.id})`);

    // ── 3. Insertar estudiante ────────────────────────────────────────────────
    const estRes = await pool.query(
      `INSERT INTO public.usuarios (rut, nombre, correo, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (correo) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, nombre, correo, rol`,
      ['19.234.567-8', 'Camila Torres', 'ctorres@udp.cl', hash, 'estudiante']
    );
    const estudiante = estRes.rows[0];
    console.log(`✅ Estudiante creado:  ${estudiante.nombre} (id: ${estudiante.id})`);

    // ── 4. Insertar ramo ──────────────────────────────────────────────────────
    const ramoRes = await pool.query(
      `INSERT INTO public.ramos (nombre_ramo, id_profesor)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id, nombre_ramo`,
      ['Estadística Aplicada', profesor.id]
    );
    const ramo = ramoRes.rows[0];
    if (ramo) {
      console.log(`✅ Ramo creado:        ${ramo.nombre_ramo} (id: ${ramo.id})`);
    } else {
      console.log('ℹ️  Ramo ya existía, se omitió');
    }

    // Obtener id del ramo (por si ya existía)
    const ramoId = ramo?.id || (
      await pool.query(
        `SELECT id FROM public.ramos WHERE nombre_ramo = $1 AND id_profesor = $2`,
        ['Estadística Aplicada', profesor.id]
      )
    ).rows[0]?.id;

    // ── 5. Insertar sección ───────────────────────────────────────────────────
    const secRes = await pool.query(
      `INSERT INTO public.secciones (id_ramo, id_profesor, semestre, anio)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [ramoId, profesor.id, 1, 2025]
    );
    const seccion = secRes.rows[0];
    if (seccion) {
      console.log(`✅ Sección creada:     id: ${seccion.id}`);
    } else {
      console.log('ℹ️  Sección ya existía, se omitió');
    }

    // Obtener id de la sección
    const seccionId = seccion?.id || (
      await pool.query(
        `SELECT id FROM public.secciones WHERE id_ramo = $1 AND semestre = 1 AND anio = 2025`,
        [ramoId]
      )
    ).rows[0]?.id;

    // ── 6. Inscribir estudiante en la sección ─────────────────────────────────
    await pool.query(
      `INSERT INTO public.inscripciones (id_estudiante, id_seccion)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [estudiante.id, seccionId]
    );
    console.log(`✅ Estudiante inscrito en la sección`);

    // ── Resumen ───────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════');
    console.log('  ✅ Base de datos lista');
    console.log('═══════════════════════════════════════');
    console.log('\n  Usuarios de prueba:');
    console.log(`  👩‍🏫 Profesor:    arojas@udp.cl  /  test1234`);
    console.log(`  👩‍🎓 Estudiante:  ctorres@udp.cl /  test1234`);
    console.log('\n  Ahora ejecuta:  node server.js\n');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('\nVerifica que:');
    console.error('  1. PostgreSQL está corriendo');
    console.error('  2. Los datos en .env son correctos');
    console.error('  3. Ya importaste el schema (asistencia_db.sql)\n');
  } finally {
    await pool.end();
  }
}

setup();
