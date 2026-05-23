#!/usr/bin/env bash
# Triggers the broken /api/checkout endpoint enough times to fire the
# Prometheus alert rule. Each request gets a unique correlationId so you can
# follow it in pino logs, Prometheus metrics, and the Slack message.

set -euo pipefail

HOST="${HOST:-http://localhost:3001}"
COUNT="${COUNT:-20}"
DELAY="${DELAY:-0.2}"

echo "Firing ${COUNT} failing checkout requests against ${HOST} ..."

for i in $(seq 1 "${COUNT}"); do
  CID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "x-correlation-id: ${CID}" \
    "${HOST}/api/checkout" || true)
  printf "  [%2d/%s] correlationId=%s -> %s\n" "${i}" "${COUNT}" "${CID}" "${STATUS}"
  sleep "${DELAY}"
done

cat <<EOF

Done. What to watch next:
  - Prometheus rules:   http://localhost:9090/alerts
  - Alertmanager queue: http://localhost:9093/#/alerts
  - Junando logs:       docker compose logs -f junando-webhook
  - Slack channel:      the one you configured in .env (SLACK_CHANNEL)

Expected timeline:
  ~15s  alert CheckoutEndpointFailing transitions to FIRING in Prometheus
  ~20s  Alertmanager posts to junando-webhook
  ~30s  Junando publishes the LLM analysis to Slack
EOF
