// models/Asistencia.js
// Modelo Mongoose para la colección de asistencias en MongoDB Atlas.

const mongoose = require('mongoose');

const asistenciaSchema = new mongoose.Schema(
  {
    // ── Referencias a PostgreSQL ─────────────────────────────────────────────
    inscripcion_id: {
      type:     String,   // UUID de public.inscripciones
      required: true,
      index:    true,
    },
    clase_id: {
      type:     String,   // UUID de public.clases
      required: true,
      index:    true,
    },

    // Fecha del DÍA de la sesión, sin hora (ej: '2026-06-18').
    // Existe solo para el índice único — permite que un alumno tenga
    // un registro por día en la misma clase, sin chocar entre sesiones.
    fecha_dia: {
      type:     String,
      required: true,
      index:    true,
    },

    // ── Estado ───────────────────────────────────────────────────────────────
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

    // ── Validación QR ────────────────────────────────────────────────────────
    confianza_score: {
      type:     Number,
      min:      0,
      max:      100,
      required: true,
      default:  0,
    },
    revision_requerida: {
      type:    Boolean,
      default: false,
      index:   true,
    },
    detalle_validacion: {
      type: mongoose.Schema.Types.Mixed,
    },

    // ── Timestamp exacto del escaneo (con hora) ─────────────────────────────
    fecha_registro: {
      type:     Date,
      default:  Date.now,
      required: true,
    },

    updated_by: {
      type: String, // UUID del profesor que hizo el último cambio manual
    },
  },
  {
    timestamps:  true,
    collection: 'asistencias',
  }
);

// Un alumno solo puede tener UN registro por día en la misma clase.
// Esto permite múltiples sesiones (días distintos) sin chocar,
// y permite múltiples escaneos el mismo día (se actualiza el mismo doc).
asistenciaSchema.index(
  { inscripcion_id: 1, clase_id: 1, fecha_dia: 1 },
  { unique: true }
);

// Índice para filtrar revisiones pendientes por clase
asistenciaSchema.index({ clase_id: 1, revision_requerida: 1 });

// Índice para buscar por clase + fecha (panel de visualizar asistencia,
// y para extraer fechas únicas en el reporte Excel)
asistenciaSchema.index({ clase_id: 1, fecha_dia: 1 });

const Asistencia = mongoose.model('Asistencia', asistenciaSchema);
module.exports = Asistencia;