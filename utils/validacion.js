// utils/validacion.js
//
// Capas de seguridad adicionales para el registro de asistencia:
//   1. Código verbal: el profesor lo dice en voz alta, no viaja en el QR.
//   2. Geolocalización: se compara la ubicación de referencia contra la
//      del estudiante al escanear (radio en metros).
//
// Ambas señales se combinan en un puntaje de confianza (0-100) en vez de
// usarse como bloqueos binarios, porque GPS indoor y permisos de
// ubicación/código pueden fallar para alumnos legítimos.

// ── Ubicación de prueba (beta) ─────────────────────────────────────────────────
// Cambia estas coordenadas a la sala donde estás probando.
// Cuando la clase no tiene lat/lon guardados en la DB, se usa esta ubicación.
// Una vez que termines las pruebas, elimina esto y deja que el profesor
// capture la ubicación al generar el QR.
const UBICACION_PRUEBA = {
  lat:          -33.51716941456376,  // <-- reemplaza con tu latitud real
  lon:          -70.5735771002369,  // <-- reemplaza con tu longitud real
  radio_metros: 100        // radio de validez en metros
};

/**
 * Genera un código verbal de 3 dígitos (000-999).
 * El profesor lo lee en voz alta al curso; no se incluye en el QR.
 */
function generarCodigoVerbal() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

/**
 * Distancia en metros entre dos coordenadas (fórmula de Haversine).
 */
function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calcula un puntaje de confianza (0-100) combinando código verbal
 * (peso 50) y geolocalización (peso 50).
 *
 * Si la clase no tiene lat/lon en la DB, se usa UBICACION_PRUEBA como
 * referencia. Cuando termines el beta, elimina ese fallback y en su lugar
 * otorga puntaje neutro (25) si no hay ubicación configurada.
 *
 * @returns {{ score: number, detalle: object }}
 */
function calcularConfianza({ clase, codigoVerbal, lat, lon }) {
  const detalle = {};
  let score = 0;

  // ── Capa 1: código verbal (fuera de banda) ────────────────────────────────
  if (clase.codigo_verbal) {
    if (codigoVerbal && codigoVerbal === clase.codigo_verbal) {
      score += 50;
      detalle.codigoVerbal = 'correcto';
    } else {
      detalle.codigoVerbal = codigoVerbal ? 'incorrecto' : 'no_enviado';
    }
  } else {
    score += 25;
    detalle.codigoVerbal = 'no_configurado';
  }

  // ── Capa 2: geolocalización ───────────────────────────────────────────────
  // Usa la ubicación de la clase si está en la DB, si no usa UBICACION_PRUEBA.
  const refLat   = clase.lat    ?? UBICACION_PRUEBA.lat;
  const refLon   = clase.lon    ?? UBICACION_PRUEBA.lon;
  const radio    = clase.radio_metros ?? UBICACION_PRUEBA.radio_metros;
  const esPrueba = clase.lat == null;

  if (lat != null && lon != null) {
    const dist = distanciaMetros(refLat, refLon, lat, lon);
    detalle.distanciaMetros  = Math.round(dist);
    detalle.radioMetros      = radio;
    detalle.usandoUbicacionPrueba = esPrueba;

    if (dist <= radio) {
      score += 50;
      detalle.geolocalizacion = 'dentro_radio';
    } else if (dist <= radio * 3) {
      score += 20;
      detalle.geolocalizacion = 'fuera_radio_cercano';
    } else {
      detalle.geolocalizacion = 'fuera_radio_lejos';
    }
  } else {
    // El estudiante no envió ubicación
    detalle.geolocalizacion = 'no_enviada';
    if (esPrueba) {
      // En modo prueba, si no hay ubicación del estudiante no penalices
      // (puede que el browser no la permita en tu ambiente de test)
      score += 25;
      detalle.geolocalizacion = 'no_enviada_modo_prueba';
    }
  }

  return { score, detalle };
}

module.exports = { generarCodigoVerbal, distanciaMetros, calcularConfianza };