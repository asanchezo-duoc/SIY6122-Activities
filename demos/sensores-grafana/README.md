# POC – Monitoreo de sensores de temperatura

API en Node.js (Express) que recibe lecturas de sensores de temperatura, las guarda en **ClickHouse** y las muestra en **Grafana**. Todo se levanta con Docker Compose y trabaja en **UTC**.

## Arquitectura

```
 sensores ──POST /lecturas──▶  API (Node, :3000) ──HTTP──▶ ClickHouse (:8123)
                                                              ▲
                                       Grafana (:3001) ───────┘ (protocolo nativo)
```

| Servicio   | URL                     | Credenciales por defecto |
|------------|-------------------------|--------------------------|
| API        | http://localhost:3000   | —                        |
| Grafana    | http://localhost:3001   | `admin` / `admin`        |
| ClickHouse | http://localhost:8123   | `sensores` / `sensores123` |

Para cambiar las credenciales, copia `.env.example` a `.env` y edítalo.

## Levantar el entorno

Todos los comandos se ejecutan desde esta carpeta (`demos/sensores-grafana`).

```bash
cd demos/sensores-grafana
docker compose up --build -d
docker compose ps          # los 3 servicios deben quedar "Up"
docker compose logs -f api # logs de la API
docker compose down        # detener (los datos se mantienen)
docker compose down -v     # detener y BORRAR los datos
```

> El esquema (`clickhouse/init/01-schema.sql`) se crea solo la primera vez que arranca ClickHouse con el volumen vacío. Si lo modificas, ejecuta `docker compose down -v` para recrearlo.

## Modelo de datos (ClickHouse)

```
clientes (id_cliente) 1 ──── N sensores (id_cliente, sensor) 1 ──── N lecturas
```

| Tabla      | Llave                         | Motor               | Descripción |
|------------|-------------------------------|---------------------|-------------|
| `clientes` | `id_cliente`                  | ReplacingMergeTree  | Empresas contratantes. |
| `sensores` | `(id_cliente, sensor)`        | ReplacingMergeTree  | Sensores auto-enrolados. La combinación cliente + sensor es única. |
| `lecturas` | `(id_cliente, sensor, medido_en)` | MergeTree, particionada por mes | Serie de tiempo de temperaturas. |

- ClickHouse no tiene llaves foráneas ni restricciones `UNIQUE`. La API se encarga de validar que el cliente exista y de no duplicar sensores. Además, `ReplacingMergeTree` elimina en segundo plano cualquier duplicado de la llave.
- Un mismo nombre de sensor (ej: `sensor-pasillo-1`) puede existir en clientes distintos.
- Todas las fechas son `DateTime64(3, 'UTC')`. El servidor está configurado en UTC (`clickhouse/config/timezone.xml`), la API también fuerza UTC en su sesión y Grafana muestra el dashboard en UTC.

## Contrato JSON del sensor

`POST /lecturas`

```json
{
  "id_cliente": 1001,
  "sensor": "sensor-pasillo-1",
  "temperatura_c": 22.5,
  "temperatura_f": 72.5,
  "timestamp": "2026-10-02T21:00:00Z"
}
```

| Campo           | Tipo    | Obligatorio | Regla |
|-----------------|---------|-------------|-------|
| `id_cliente`    | entero  | sí          | Entre 1 y 4294967295. El cliente debe estar enrolado. |
| `sensor`        | string  | sí          | 1 a 64 caracteres: letras, números, `-` o `_`. Lo elige el cliente. |
| `temperatura_c` | número  | sí          | Grados Celsius. |
| `temperatura_f` | número  | sí          | Grados Fahrenheit. Debe ser coherente con °C (`F = C × 9/5 + 32`, tolerancia ±0,5). |
| `timestamp`     | string  | no          | ISO 8601 con zona (`Z` o `-03:00`); se convierte a UTC. Si no se envía, se usa la hora en que llega la lectura. No se aceptan fechas más de 5 minutos en el futuro. |

**Auto-enrolamiento:** si el sensor no existe para ese cliente, se registra con su primera lectura. La respuesta lo indica con `"sensor_nuevo": true`.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/health` | Estado de la API y de la conexión con ClickHouse |
| POST   | `/clientes` | Enrolar un cliente |
| GET    | `/clientes` | Listar clientes con su cantidad de sensores |
| GET    | `/clientes/:id` | Obtener un cliente |
| GET    | `/clientes/:id/sensores` | Sensores del cliente con su última lectura |
| GET    | `/clientes/:id/sensores/:sensor/lecturas` | Lecturas de un sensor (`?desde=&hasta=&limite=`) |
| POST   | `/lecturas` | Enviar una lectura (contrato del sensor) |

### Códigos de respuesta

| Código | Cuándo |
|--------|--------|
| 201 | Cliente enrolado / lectura guardada |
| 400 | JSON inválido o campos con formato incorrecto |
| 404 | El cliente no está enrolado |
| 409 | El cliente ya estaba enrolado |
| 422 | °C y °F no coinciden, o `timestamp` en el futuro |

## Ejemplos con curl

### Estado

```bash
curl http://localhost:3000/health
# {"status":"ok","clickhouse":true}
```

### Enrolar clientes

```bash
curl -X POST http://localhost:3000/clientes \
  -H "Content-Type: application/json" \
  -d '{"id_cliente": 1001, "nombre": "Acme SpA"}'
# 201 {"id_cliente":1001,"nombre":"Acme SpA","creado_en":"2026-10-03T00:30:47.822Z"}

curl -X POST http://localhost:3000/clientes \
  -H "Content-Type: application/json" \
  -d '{"id_cliente": 2002, "nombre": "Frio Sur Ltda"}'

# Repetir el mismo id -> 409 {"error":"El cliente 1001 ya está enrolado"}
```

### Enviar lecturas

```bash
# Primera lectura: el sensor se auto-enrola
curl -X POST http://localhost:3000/lecturas \
  -H "Content-Type: application/json" \
  -d '{"id_cliente": 1001, "sensor": "sensor-pasillo-1", "temperatura_c": 22.5, "temperatura_f": 72.5}'
# 201 {"id_cliente":1001,"sensor":"sensor-pasillo-1","sensor_nuevo":true, ...}

# Con timestamp en hora de Chile: se guarda en UTC (21:30Z)
curl -X POST http://localhost:3000/lecturas \
  -H "Content-Type: application/json" \
  -d '{"id_cliente": 1001, "sensor": "sensor-pasillo-1", "temperatura_c": 23, "temperatura_f": 73.4, "timestamp": "2026-10-02T18:30:00-03:00"}'
# 201 {..., "sensor_nuevo":false, "medido_en":"2026-10-02T21:30:00.000Z", ...}

# Mismo nombre de sensor en otro cliente: es un sensor distinto
curl -X POST http://localhost:3000/lecturas \
  -H "Content-Type: application/json" \
  -d '{"id_cliente": 2002, "sensor": "sensor-pasillo-1", "temperatura_c": 4, "temperatura_f": 39.2}'
```

### Errores

```bash
# Cliente no enrolado -> 404
curl -X POST http://localhost:3000/lecturas -H "Content-Type: application/json" \
  -d '{"id_cliente": 9999, "sensor": "sensor-1", "temperatura_c": 1, "temperatura_f": 33.8}'

# °C y °F no coinciden -> 422
curl -X POST http://localhost:3000/lecturas -H "Content-Type: application/json" \
  -d '{"id_cliente": 1001, "sensor": "sensor-1", "temperatura_c": 20, "temperatura_f": 80}'

# Nombre de sensor inválido -> 400
curl -X POST http://localhost:3000/lecturas -H "Content-Type: application/json" \
  -d '{"id_cliente": 1001, "sensor": "mal nombre!", "temperatura_c": 20, "temperatura_f": 68}'
```

### Consultar

```bash
curl http://localhost:3000/clientes
curl http://localhost:3000/clientes/1001
curl http://localhost:3000/clientes/1001/sensores

# Últimas 24 h (por defecto), máximo 100 lecturas
curl http://localhost:3000/clientes/1001/sensores/sensor-pasillo-1/lecturas

# Rango y límite específicos (fechas ISO 8601)
curl "http://localhost:3000/clientes/1001/sensores/sensor-pasillo-1/lecturas?desde=2026-10-02T00:00:00Z&hasta=2026-10-03T00:00:00Z&limite=500"
```

## Simular sensores

```bash
# cliente 1001, 3 sensores, una lectura cada 2 segundos (Ctrl+C para detener)
./scripts/simular-sensores.sh 1001 3 2
```

El cliente debe estar enrolado antes de ejecutar el script.

## Grafana

Abre http://localhost:3001 (`admin` / `admin`). El datasource de ClickHouse y el dashboard **Sensores › Sensores de temperatura** se cargan automáticamente. El dashboard incluye:

- Selectores de **cliente** y **sensor**.
- Gráfico de temperatura (°C) por sensor, que se actualiza cada 10 s.
- Tabla con la última lectura de cada sensor.

## Consultas directas a ClickHouse

```bash
docker exec -it sensores-clickhouse clickhouse-client --user sensores --password sensores123 --database sensores

# o por HTTP
curl -u sensores:sensores123 "http://localhost:8123/?query=SELECT+count()+FROM+sensores.lecturas"
```

## Pendientes antes de producción

Esto es una POC; faltan, entre otros:

- **Autenticación**: hoy cualquiera puede enviar lecturas a nombre de cualquier cliente. Se recomienda usar una API key o token por cliente o por sensor.
- **Credenciales reales** y un usuario de solo lectura para Grafana.
- **Lotes**: permitir que un sensor envíe varias lecturas en una sola petición.
- **Retención**: definir un `TTL` en la tabla `lecturas`.
- **Unicidad estricta** al enrolar: dos enrolamientos simultáneos del mismo `id_cliente` podrían insertarse ambos. `ReplacingMergeTree` los deja en uno solo al fusionar, pero si se necesita una garantía inmediata hay que usar un bloqueo o un servicio aparte.
