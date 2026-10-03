import { createClient } from '@clickhouse/client';

export const ch = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DB || 'sensores',
  clickhouse_settings: {
    // Fechas siempre en UTC, sin importar la zona del servidor
    session_timezone: 'UTC',
    date_time_input_format: 'best_effort',
  },
});

export async function query(sql, params = {}) {
  const result = await ch.query({ query: sql, query_params: params, format: 'JSONEachRow' });
  return result.json();
}

export async function insert(table, values, settings = {}) {
  await ch.insert({ table, values, format: 'JSONEachRow', clickhouse_settings: settings });
}

// ClickHouse devuelve "2026-10-02 21:00:00.000" (UTC); lo pasamos a ISO 8601
export function toIso(chDate) {
  return chDate ? `${chDate.replace(' ', 'T')}Z` : null;
}

// Date -> formato que ClickHouse acepta para DateTime64(3, 'UTC')
export function toChDate(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}
