import express from 'express';
import { ch } from './db.js';
import clientesRouter from './routes/clientes.js';
import lecturasRouter from './routes/lecturas.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', async (req, res) => {
  const { success } = await ch.ping();
  res.status(success ? 200 : 503).json({ status: success ? 'ok' : 'error', clickhouse: success });
});

app.use('/clientes', clientesRouter);
app.use('/lecturas', lecturasRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

export default app;
