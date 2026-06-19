// debug-asistencias.js
//
// Uso:
//   node debug-asistencias.js ver     <clase_id>            → muestra todos los registros
//   node debug-asistencias.js borrar  <clase_id> <YYYY-MM-DD> → borra los registros de esa fecha
//
// Ejemplos:
//   node debug-asistencias.js ver c2b4fa34-365a-4d8c-9354-154ee6b37c3d
//   node debug-asistencias.js borrar c2b4fa34-365a-4d8c-9354-154ee6b37c3d 2026-06-18

require('dotenv').config();
const mongoose  = require('mongoose');
const Asistencia = require('./models/Asistencia');

const MONGO_URI = process.env.MONGO_URI;

async function main() {
  const [,, accion, claseId, fecha] = process.argv;

  if (!accion || !claseId) {
    console.log('Uso: node debug-asistencias.js ver|borrar <clase_id> [YYYY-MM-DD]');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { dbName: 'asistudp' });
  console.log('✅ Conectado a MongoDB\n');

  if (accion === 'ver') {
    const registros = await Asistencia.find({ clase_id: claseId }).lean();
    console.log(`📋 ${registros.length} registro(s) encontrados:\n`);
    registros.forEach(r => {
      const horaStr = new Date(r.fecha_registro).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
      console.log(`  ${r.estado.padEnd(12)} | dia: ${r.fecha_dia} | ${horaStr} | inscripcion: ${r.inscripcion_id} | metodo: ${r.metodo}`);
    });
  }

  if (accion === 'borrar') {
    if (!fecha) {
      console.log('❌ Falta la fecha. Uso: node debug-asistencias.js borrar <clase_id> <YYYY-MM-DD>');
      process.exit(1);
    }

    const resultado = await Asistencia.deleteMany({
      clase_id: claseId,
      fecha_dia: fecha
    });

    console.log(`🗑️  ${resultado.deletedCount} registro(s) eliminados para la fecha ${fecha}`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Listo');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});