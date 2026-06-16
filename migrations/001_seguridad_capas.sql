-- migrations/001_seguridad_capas.sql
-- Ejecutar UNA vez: psql -U <usuario> -d asistencia_db -f migrations/001_seguridad_capas.sql

-- ── clases: ubicación del profesor + código verbal ────────────────────────────
ALTER TABLE public.clases
  ADD COLUMN IF NOT EXISTS codigo_verbal CHAR(3),
  ADD COLUMN IF NOT EXISTS lat            NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS lon            NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS radio_metros   INTEGER DEFAULT 100;

-- ── asistencias: puntaje de confianza ────────────────────────────────────────
ALTER TABLE public.asistencias
  ADD COLUMN IF NOT EXISTS confianza_score     INTEGER,
  ADD COLUMN IF NOT EXISTS revision_requerida  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS detalle_validacion  JSONB;

-- Índice para que el profesor encuentre rápido los registros en revisión
CREATE INDEX IF NOT EXISTS idx_asistencias_revision
  ON public.asistencias(revision_requerida)
  WHERE revision_requerida = true;