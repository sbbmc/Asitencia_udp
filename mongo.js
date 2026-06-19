// mongo.js
// Conexión a MongoDB Atlas con Mongoose.
// Se conecta una sola vez al arrancar el servidor y reutiliza la conexión.

const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ FATAL: MONGO_URI no está definida en .env');
  process.exit(1);
}

async function conectarMongo() {
  try {
    await mongoose.connect(MONGO_URI, {
      dbName: 'asistudp',  // nombre de la base de datos en Atlas
    });
    console.log('✅ MongoDB Atlas conectado');
  } catch (err) {
    console.error('❌ Error conectando a MongoDB:', err.message);
    process.exit(1);
  }
}

module.exports = { conectarMongo };