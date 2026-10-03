import { Router } from 'express';
import { insert, query, toChDate } from '../db.js';
import { buscarCliente } from './clientes.js';
import {
  celsiusAFahrenheit,
  esNumero,
  esSensorValido,
  MAX_FUTURO_MS,
  parseIdCliente,
  TOLERANCIA_F,
} from '../validation.js';

const router = Router();

// Caché en memoria para no consultar ClickHouse en cada lectura
const clientesConocidos = new Set();
const sensoresConocidos = new Set();

async function clienteExiste(idCliente) {
  if (clientesConocidos.has(idCliente)) return true;
  if (!(await buscarCliente(idCliente))) return false;
  clientesConocidos.add(idCliente);
  return true;
}

// Devuelve true si el sensor se enroló en esta llamada
async function autoEnrolarSensor(idCliente, sensor) {
  const clave = `${idCliente}:${sensor}`;
  if (sensoresConocidos.has(clave)) return false;

  const existente = await query(
    `SELECT 1 FROM sensores WHERE id_cliente = {id:UInt32} AND sensor = {sensor:String} LIMIT 1`,
    { id: idCliente, sensor },
  );
  const nuevo = existente.length === 0;
  if (nuevo) {
    await insert('sensores', [{ id_cliente: idCliente, sensor, creado_en: toChDate(new Date()) }]);
  }
  sensoresConocidos.add(clave);
  return nuevo;
}

// Recibir una lectura de un sensor
router.post('/', async (req, res) => {
  const { id_cliente, sensor, temperatura_c, temperatura_f, timestamp } = req.body ?? {};

  const id = parseIdCliente(id_cliente);
  if (id === null) {
    return res.status(400).json({ error: '"id_cliente" debe ser un entero entre 1 y 4294967295' });
  }
  if (!esSensorValido(sensor)) {
    return res.status(400).json({
      error: '"sensor" debe tener 1 a 64 caracteres: letras, números, "-" o "_" (ej: sensor-pasillo-1)',
    });
  }
  if (!esNumero(temperatura_c) || !esNumero(temperatura_f)) {
    return res.status(400).json({ error: '"temperatura_c" y "temperatura_f" deben ser numéricos' });
  }
  const esperadoF = celsiusAFahrenheit(temperatura_c);
  if (Math.abs(esperadoF - temperatura_f) > TOLERANCIA_F) {
    return res.status(422).json({
      error: `Temperaturas inconsistentes: ${temperatura_c} °C equivale a ${esperadoF.toFixed(2)} °F, se recibió ${temperatura_f} °F`,
    });
  }

  // timestamp es opcional; si no viene se usa la hora de recepción (UTC)
  const ahora = new Date();
  const medidoEn = timestamp === undefined ? ahora : new Date(timestamp);
  if (Number.isNaN(medidoEn.getTime())) {
    return res.status(400).json({ error: '"timestamp" debe ser una fecha ISO 8601 (ej: 2026-10-02T21:00:00Z)' });
  }
  if (medidoEn.getTime() - ahora.getTime() > MAX_FUTURO_MS) {
    return res.status(422).json({ error: '"timestamp" está en el futuro' });
  }

  if (!(await clienteExiste(id))) {
    return res.status(404).json({ error: `El cliente ${id} no está enrolado` });
  }
  const sensorNuevo = await autoEnrolarSensor(id, sensor);

  await insert(
    'lecturas',
    [{
      id_cliente: id,
      sensor,
      temperatura_c,
      temperatura_f,
      medido_en: toChDate(medidoEn),
      recibido_en: toChDate(ahora),
    }],
    // Inserciones pequeñas y frecuentes: ClickHouse las agrupa en el servidor
    { async_insert: 1, wait_for_async_insert: 1 },
  );

  res.status(201).json({
    id_cliente: id,
    sensor,
    sensor_nuevo: sensorNuevo,
    temperatura_c,
    temperatura_f,
    medido_en: medidoEn.toISOString(),
    recibido_en: ahora.toISOString(),
  });
});

export default router;
