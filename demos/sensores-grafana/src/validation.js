export const MAX_ID_CLIENTE = 4_294_967_295; // UInt32
export const SENSOR_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Diferencia máxima aceptada entre °F enviado y °F calculado desde °C
export const TOLERANCIA_F = 0.5;
// Una lectura no puede venir con fecha más adelantada que esto (desfase de reloj)
export const MAX_FUTURO_MS = 5 * 60 * 1000;

export function parseIdCliente(valor) {
  const id = typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor;
  return Number.isInteger(id) && id > 0 && id <= MAX_ID_CLIENTE ? id : null;
}

export function esSensorValido(sensor) {
  return typeof sensor === 'string' && SENSOR_REGEX.test(sensor);
}

export function esNumero(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

export function celsiusAFahrenheit(c) {
  return (c * 9) / 5 + 32;
}
