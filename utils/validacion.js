// utils/validacion.js

function generarCodigoVerbal() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

// Distancia en metros entre dos coordenadas GPS (fórmula de Haversine)
function haversineMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calcula score basado en:
 * - código verbal (40 pts)
 * - ubicación GPS (60 pts)
 */
function calcularConfianza({ clase, codigoVerbal, lat, lon }) {
  const detalle = {};
  let score = 0;

  // ── 1. Código verbal (40 pts) ─────────────────────────
  if (clase.codigo_verbal) {
    if (codigoVerbal && codigoVerbal === clase.codigo_verbal) {
      score += 40;
      detalle.codigoVerbal = 'correcto';
    } else {
      detalle.codigoVerbal = codigoVerbal ? 'incorrecto' : 'no_enviado';
    }
  } else {
    score += 20;
    detalle.codigoVerbal = 'no_configurado';
  }

  // ── 2. Ubicación GPS (60 pts) ─────────────────────────
  const claseConUbicacion = clase.lat != null && clase.lon != null;

  if (!claseConUbicacion) {
    // Profesor no configuró ubicación: no penalizar
    score += 30;
    detalle.ubicacion = 'no_configurada';
  } else if (lat == null || lon == null) {
    // La clase tiene ubicación pero el estudiante no envió coordenadas
    detalle.ubicacion = 'no_enviada';
  } else {
    const distancia   = haversineMetros(clase.lat, clase.lon, lat, lon);
    const radioMetros = clase.radio_metros ?? 100;
    detalle.distancia_metros = Math.round(distancia);
    detalle.radio_metros     = radioMetros;

    if (distancia <= radioMetros) {
      score += 60;
      detalle.ubicacion = 'dentro_del_radio';
    } else if (distancia <= radioMetros * 2) {
      score += 30;
      detalle.ubicacion = 'fuera_del_radio_cercano';
    } else {
      detalle.ubicacion = 'fuera_del_radio';
    }
  }

  return { score, detalle };
}

module.exports = { generarCodigoVerbal, calcularConfianza };