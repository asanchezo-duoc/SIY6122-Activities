import { Router } from 'express';
import { insert, query, toChDate, toIso } from '../db.js';
import { esSensorValido, parseIdCliente } from '../validation.js';

const router = Router();

export async function buscarCliente(idCliente) {
  const [cliente] = await query(
    `SELECT id_cliente, nombre, creado_en FROM clientes FINAL WHERE id_cliente = {id:UInt32}`,
    { id: idCliente },
  );
  return cliente ?? null;
}

// Enrolar cliente
router.post('/', async (req, res) => {
  const { id_cliente, nombre } = req.body ?? {};
  const id = parseIdCliente(id_cliente);
  if (id === null) {
    return res.status(400).json({ error: '"id_cliente" debe ser un entero entre 1 y 4294967295' });
  }
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 200) {
    return res.status(400).json({ error: '"nombre" es obligatorio (máx. 200 caracteres)' });
  }

  if (await buscarCliente(id)) {
    return res.status(409).json({ error: `El cliente ${id} ya está enrolado` });
  }

  const creadoEn = new Date();
  await insert('clientes', [{ id_cliente: id, nombre: nombre.trim(), creado_en: toChDate(creadoEn) }]);
  res.status(201).json({ id_cliente: id, nombre: nombre.trim(), creado_en: creadoEn.toISOString() });
});

// Listar clientes
router.get('/', async (req, res) => {
  const rows = await query(`
    SELECT c.id_cliente, c.nombre, c.creado_en, count(s.sensor) AS cantidad_sensores
    FROM clientes AS c FINAL
    LEFT JOIN (SELECT DISTINCT id_cliente, sensor FROM sensores) AS s ON s.id_cliente = c.id_cliente
    GROUP BY c.id_cliente, c.nombre, c.creado_en
    ORDER BY c.id_cliente`);
  res.json(rows.map((r) => ({ ...r, creado_en: toIso(r.creado_en), cantidad_sensores: Number(r.cantidad_sensores) })));
});

// Obtener un cliente
router.get('/:id', async (req, res) => {
  const id = parseIdCliente(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id_cliente inválido' });
  const cliente = await buscarCliente(id);
  if (!cliente) return res.status(404).json({ error: `El cliente ${id} no está enrolado` });
  res.json({ ...cliente, creado_en: toIso(cliente.creado_en) });
});

// Sensores del cliente con su última lectura
router.get('/:id/sensores', async (req, res) => {
  const id = parseIdCliente(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id_cliente inválido' });
  if (!(await buscarCliente(id))) return res.status(404).json({ error: `El cliente ${id} no está enrolado` });

  const rows = await query(
    `SELECT
       s.sensor,
       s.enrolado_en,
       l.ultima_lectura,
       l.temperatura_c,
       l.temperatura_f,
       l.cantidad_lecturas
     FROM (
       SELECT sensor, min(creado_en) AS enrolado_en
       FROM sensores WHERE id_cliente = {id:UInt32} GROUP BY sensor
     ) AS s
     LEFT JOIN (
       SELECT
         sensor,
         max(medido_en) AS ultima_lectura,
         argMax(temperatura_c, medido_en) AS temperatura_c,
         argMax(temperatura_f, medido_en) AS temperatura_f,
         count() AS cantidad_lecturas
       FROM lecturas WHERE id_cliente = {id:UInt32} GROUP BY sensor
     ) AS l ON l.sensor = s.sensor
     ORDER BY s.sensor
     SETTINGS join_use_nulls = 1`,
    { id },
  );
  res.json(
    rows.map((r) => ({
      sensor: r.sensor,
      enrolado_en: toIso(r.enrolado_en),
      ultima_lectura: r.ultima_lectura
        ? { medido_en: toIso(r.ultima_lectura), temperatura_c: r.temperatura_c, temperatura_f: r.temperatura_f }
        : null,
      cantidad_lecturas: Number(r.cantidad_lecturas ?? 0),
    })),
  );
});

// Lecturas de un sensor: ?desde=ISO&hasta=ISO&limite=100
router.get('/:id/sensores/:sensor/lecturas', async (req, res) => {
  const id = parseIdCliente(req.params.id);
  const { sensor } = req.params;
  if (id === null) return res.status(400).json({ error: 'id_cliente inválido' });
  if (!esSensorValido(sensor)) return res.status(400).json({ error: 'Nombre de sensor inválido' });

  const desde = req.query.desde ? new Date(req.query.desde) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hasta = req.query.hasta ? new Date(req.query.hasta) : new Date();
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    return res.status(400).json({ error: '"desde" y "hasta" deben ser fechas ISO 8601' });
  }
  const limite = Math.min(Math.max(parseInt(req.query.limite ?? '100', 10) || 100, 1), 10_000);

  const rows = await query(
    `SELECT medido_en, temperatura_c, temperatura_f, recibido_en
     FROM lecturas
     WHERE id_cliente = {id:UInt32} AND sensor = {sensor:String}
       AND medido_en BETWEEN {desde:DateTime64(3, 'UTC')} AND {hasta:DateTime64(3, 'UTC')}
     ORDER BY medido_en DESC
     LIMIT {limite:UInt32}`,
    { id, sensor, desde: toChDate(desde), hasta: toChDate(hasta), limite },
  );
  res.json({
    id_cliente: id,
    sensor,
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    lecturas: rows.map((r) => ({ ...r, medido_en: toIso(r.medido_en), recibido_en: toIso(r.recibido_en) })),
  });
});

export default router;
