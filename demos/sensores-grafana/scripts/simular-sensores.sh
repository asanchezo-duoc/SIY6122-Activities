#!/usr/bin/env bash
# Simula sensores enviando lecturas a la API.
# Uso: ./scripts/simular-sensores.sh [id_cliente] [cantidad_sensores] [intervalo_segundos]
set -euo pipefail

API="${API:-http://localhost:3000}"
CLIENTE="${1:-1001}"
SENSORES="${2:-3}"
INTERVALO="${3:-2}"

echo "Enviando lecturas del cliente $CLIENTE ($SENSORES sensores cada ${INTERVALO}s). Ctrl+C para detener."
while true; do
  for i in $(seq 1 "$SENSORES"); do
    # Temperatura base distinta por sensor + ruido aleatorio
    c=$(awk -v i="$i" -v r="$RANDOM" 'BEGIN { printf "%.2f", 18 + i * 2 + (r % 300) / 100 }')
    f=$(awk -v c="$c" 'BEGIN { printf "%.2f", c * 9 / 5 + 32 }')
    curl -s -o /dev/null -w "sensor-pasillo-$i: $c °C / $f °F -> HTTP %{http_code}\n" \
      -X POST "$API/lecturas" -H 'Content-Type: application/json' \
      -d "{\"id_cliente\": $CLIENTE, \"sensor\": \"sensor-pasillo-$i\", \"temperatura_c\": $c, \"temperatura_f\": $f}"
  done
  sleep "$INTERVALO"
done
