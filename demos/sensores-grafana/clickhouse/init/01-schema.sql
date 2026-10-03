-- Se ejecuta solo la primera vez que arranca ClickHouse (volumen vacío).
-- ClickHouse no tiene llaves foráneas: la relación clientes -> sensores -> lecturas
-- y la unicidad (id_cliente, sensor) se validan en la API.

CREATE DATABASE IF NOT EXISTS sensores;

-- Empresas contratantes
CREATE TABLE IF NOT EXISTS sensores.clientes
(
    id_cliente  UInt32,
    nombre      String,
    creado_en   DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree
ORDER BY id_cliente;

-- Sensores, se auto-enrolan con su primera lectura.
-- La llave de orden (id_cliente, sensor) hace que la combinación sea única:
-- si se inserta dos veces, ReplacingMergeTree deja una sola fila al fusionar.
CREATE TABLE IF NOT EXISTS sensores.sensores
(
    id_cliente  UInt32,
    sensor      String,
    creado_en   DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree
ORDER BY (id_cliente, sensor);

-- Lecturas de temperatura (serie de tiempo)
CREATE TABLE IF NOT EXISTS sensores.lecturas
(
    id_cliente     UInt32,
    sensor         LowCardinality(String),
    temperatura_c  Float64,
    temperatura_f  Float64,
    medido_en      DateTime64(3, 'UTC'),
    recibido_en    DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(medido_en)
ORDER BY (id_cliente, sensor, medido_en);
