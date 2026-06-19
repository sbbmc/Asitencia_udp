// fix-passwords.js
// Ejecutar UNA SOLA VEZ desde la raíz del proyecto:
//   node fix-passwords.js
//
// Hashea la contraseña actual de cada usuario que tenga password_hash
// en texto plano (detectado porque NO empieza con '$2').
// Los que ya tienen hash bcrypt los deja intactos.

require('dotenv').config();
const bcrypt     = require('bcryptjs');
const { query, pool } = require('./db');

const SALT_ROUNDS = 10;

async function main() {
  console.log('🔍 Buscando usuarios con contraseña en texto plano...\n');

  const { rows } = await query(
    `SELECT id, nombre, password_hash FROM public.usuarios`
  );

  const sinHash = rows.filter(u => !u.password_hash.startsWith('$2'));

  if (sinHash.length === 0) {
    console.log('✅ Todos los usuarios ya tienen contraseña hasheada. Nada que hacer.');
    await pool.end();
    return;
  }

  console.log(`⚠️  ${sinHash.length} usuario(s) con contraseña en texto plano:\n`);

  for (const usuario of sinHash) {
    const nuevoHash = await bcrypt.hash(usuario.password_hash, SALT_ROUNDS);
    await query(
      `UPDATE public.usuarios SET password_hash = $1 WHERE id = $2`,
      [nuevoHash, usuario.id]
    );
    console.log(`  ✓ ${usuario.nombre}`);
  }

  console.log(`\n✅ Listo. ${sinHash.length} contraseñas hasheadas correctamente.`);
  console.log('   Puedes borrar este archivo ahora.\n');

  await pool.end();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});