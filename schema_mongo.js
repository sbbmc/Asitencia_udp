// ============================================
// SCHEMA MongoDB - Colección: asistencias (v2)
// Incluye campos de validación QR + confianza
// ============================================

const mongoose = require('mongoose');

const asistenciaSchema = new mongoose.Schema(
  {
    // ── Referencia a PostgreSQL ──────────────────────────────────────────────
    inscripcion_id: {
      type:     String,   // UUID de inscripciones
      required: true,
      index:    true,
    },
    clase_id: {
      type:     String,   // UUID de clases
      required: true,
      index:    true,
    },

    // ── Estado ──────────────────────────────────────────────────────────────
    estado: {
      type:    String,
      enum:    ['presente', 'ausente', 'justificado'],
      default: 'presente',
    },

    metodo: {
      type:    String,
      enum:    ['qr', 'manual'],
      default: 'qr',
    },

    // ── Puntaje de confianza (resultado de calcularConfianza) ────────────────
    confianza_score: {
      type:     Number,
      min:      0,
      max:      100,
      required: true,
    },

    // Marca si un profesor debe revisar este registro manualmente
    revision_requerida: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    // Detalle completo del objeto devuelto por calcularConfianza()
    // Ej: { codigoVerbal: 'correcto', geolocalizacion: 'dentro_radio',
    //       distanciaMetros: 42, radioMetros: 100 }
    detalle_validacion: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Cuándo se registró (timestamp del escaneo)
    fecha_registro: {
      type:     Date,
      default:  Date.now,
      required: true,
    },
  },
  {
    timestamps:  true,
    collection: 'asistencias',
  }
);

// Evita duplicado: un alumno no puede tener dos registros en la misma clase
asistenciaSchema.index(
  { inscripcion_id: 1, clase_id: 1 },
  { unique: true }
);

// Índice para que el profesor filtre revisiones pendientes rápido
asistenciaSchema.index(
  { clase_id: 1, revision_requerida: 1 }
);

const Asistencia = mongoose.model('Asistencia', asistenciaSchema);
module.exports = Asistencia;


// ============================================
// EJEMPLO — guardar asistencia desde el endpoint
// (reemplaza el INSERT de tu route actual)
// ============================================

/*
  const Asistencia = require('../models/Asistencia');

  const asistencia = await Asistencia.findOneAndUpdate(
    { inscripcion_id: inscripcionId, clase_id: clase.id },
    {
      estado:             'presente',
      metodo:             'qr',
      confianza_score:    score,
      revision_requerida: score < 70,
      detalle_validacion: detalle,
      fecha_registro:     new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
*/