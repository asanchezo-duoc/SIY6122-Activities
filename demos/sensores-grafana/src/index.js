import app from './app.js';
import { ch } from './db.js';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

// Cierre limpio al detener el contenedor
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} recibido, cerrando servidor...`);
    server.close(async () => {
      await ch.close();
      process.exit(0);
    });
  });
}
