#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test-wide-events.sh — Local integration test for wide events
#
# Prerequisites: Docker stack running (pnpm run setup:local)
# Usage:         bash scripts/test-wide-events.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PASS=0
FAIL=0
WEBHOOK_URL="http://localhost:4000"
LOKI_URL="${LOKI_URL:-http://localhost:3100}"
CORRELATION_ID=""
ENV_FILE="tmp/.env.wide-event-test"

cleanup() {
  local exit_code=$?
  if [ -n "${DEV_PID:-}" ]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -f "$ENV_FILE"
  exit $exit_code
}
trap cleanup EXIT INT TERM

info()  { echo -e "  \033[1;34m→\033[0m $*"; }
pass()  { echo -e "  \033[1;32m✔ $1\033[0m"; PASS=$((PASS+1)); }
fail()  { echo -e "  \033[1;31m✘ $1\033[0m"; FAIL=$((FAIL+1)); }
header() { echo -e "\n\033[1;36m━━━ $1 ━━━\033[0m"; }

# ── 1. Check Docker ──────────────────────────────────────────────────────
header "1. Docker stack"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE "junando.*(redis|loki|grafana)"; then
  pass "Docker stack is running"
else
  fail "Docker stack is NOT running — run: pnpm run setup:local"
  exit 1
fi

# ── 2. Build core ────────────────────────────────────────────────────────
header "2. Build core package"
pnpm --filter @junando/core build 2>&1 | tail -1
pass "Core package built"

# ── 3. Create .env file ──────────────────────────────────────────────────
header "3. Create test env"
mkdir -p tmp
cat > "$ENV_FILE" <<'EOF'
LLM_PROVIDER=gemini
LLM_API_KEY=dummy-test-key
NOTIFIER_TYPE=slack
SLACK_BOT_TOKEN=xoxb-dummy-test-token-12345
SLACK_CHANNEL=#test
SLACK_SIGNING_SECRET=dummy-test-secret
LOKI_URL=http://localhost:3100
REDIS_URL=redis://localhost:6379
NODE_ENV=development
LOG_LEVEL=info
WIDE_EVENTS_ENABLED=true
EOF
pass "Test env created"

# ── 4. Start dev server ──────────────────────────────────────────────────
header "4. Start webhook dev server"
pnpm exec tsx --env-file="$ENV_FILE" scripts/dev-server.ts &
DEV_PID=$!
info "Dev server PID: $DEV_PID"

# Wait for health
for i in $(seq 1 30); do
  if curl -sf "$WEBHOOK_URL/health" >/dev/null 2>&1; then
    pass "Webhook server is healthy"
    break
  fi
  sleep 0.5
done
if ! curl -sf "$WEBHOOK_URL/health" >/dev/null 2>&1; then
  fail "Webhook server did not start in time"
  exit 1
fi

# ── 5. Send test alert ──────────────────────────────────────────────────
header "5. Send test alert"
FINGERPRINT="test-wide-event-$(date +%s)"
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
END=$(date -u -v+1H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || python3 -c "from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc) + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")

RESPONSE=$(curl -sf -X POST "$WEBHOOK_URL/webhook/alert" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: 11111111-2222-4333-8444-555555555555" \
  -d '{
    "version": "4",
    "groupKey": "{alertname=\"TestWideEvent\"}",
    "status": "firing",
    "receiver": "test",
    "groupLabels": {"alertname": "TestWideEvent"},
    "commonLabels": {"severity": "warning"},
    "commonAnnotations": {},
    "externalURL": "http://localhost:9093",
    "alerts": [{
      "status": "firing",
      "labels": {"alertname": "TestWideEvent", "service": "test-service"},
      "annotations": {"summary": "Wide event integration test"},
      "startsAt": "'"$NOW"'",
      "endsAt": "'"$END"'",
      "fingerprint": "'"$FINGERPRINT"'"
    }]
  }')

echo "  Response: $RESPONSE"
CORRELATION_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['correlationId'])" 2>/dev/null || echo "")
if [ -n "$CORRELATION_ID" ] && [ "$CORRELATION_ID" = "11111111-2222-4333-8444-555555555555" ]; then
  pass "Alert accepted, upstream correlationId preserved: $CORRELATION_ID"
else
  fail "Expected correlationId=11111111-2222-4333-8444-555555555555, got: $CORRELATION_ID"
fi

# ── 6. Wait for Loki ingestion ──────────────────────────────────────────
header "6. Wait for Loki to ingest the wide event"
sleep 3

REQUEST_ID="${CORRELATION_ID}:${FINGERPRINT}"
LOKI_QUERY='{service_name="junando"} | json | requestId="'"$REQUEST_ID"'"'

info "Querying Loki for requestId=$REQUEST_ID"
for i in $(seq 1 10); do
  LOKI_RESULT=$(curl -sf -G "$LOKI_URL/loki/api/v1/query_range" \
    --data-urlencode "query=$LOKI_QUERY" \
    --data-urlencode "limit=5" \
    -H "Content-Type: application/x-www-form-urlencoded" 2>/dev/null || echo "")

  RESULT_COUNT=$(echo "$LOKI_RESULT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    streams = d.get('data', {}).get('result', [])
    total = sum(len(s.get('values', [])) for s in streams)
    print(total)
except: print(0)" 2>/dev/null || echo "0")

  if [ "$RESULT_COUNT" -gt 0 ]; then
    pass "Wide event found in Loki ($RESULT_COUNT result(s))"
    break
  fi
  sleep 2
done

if [ "$RESULT_COUNT" -eq 0 ]; then
  fail "Wide event NOT found in Loki after 20s"
  info "Tip: Check Loki is running: curl -sf http://localhost:3100/ready"
fi

# ── 7. Validate wide event structure ────────────────────────────────────
header "7. Validate wide event structure"
if [ "$RESULT_COUNT" -gt 0 ]; then
  # Extract the first wide event and validate its structure
  VALIDATION=$(echo "$LOKI_RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
streams = d.get('data', {}).get('result', [])
if not streams:
    print('NO_EVENT')
    sys.exit(0)
values = streams[0].get('values', [])
if not values:
    print('NO_VALUES')
    sys.exit(0)
line = values[0][1]  # log line

# The Pino log has the wide event as its first arg — find the JSON
import re
match = re.search(r'\{.*\"requestId\"', line)
if not match:
    # Try direct parse
    try:
        obj = json.loads(line)
    except:
        print('NOT_JSON')
        sys.exit(0)
else:
    try:
        obj = json.loads(line[match.start():])
    except:
        print('PARSE_ERROR')
        sys.exit(0)

checks = []
checks.append(('requestId', obj.get('requestId') == '$REQUEST_ID'))
checks.append(('component', obj.get('component') == 'useCase'))
checks.append(('outcome', obj.get('outcome') in ('success', 'degraded')))
checks.append(('correlationId', obj.get('correlationId') == '$CORRELATION_ID'))
checks.append(('durationMs', isinstance(obj.get('durationMs'), (int, float)) and obj.get('durationMs', 0) > 0))
checks.append(('cluster.fingerprint', isinstance(obj.get('cluster'), dict) and obj['cluster'].get('fingerprint') == '$FINGERPRINT'))
checks.append(('cluster.alertCount', isinstance(obj.get('cluster'), dict) and obj['cluster'].get('alertCount', 0) >= 1))
checks.append(('dedup.isNew', isinstance(obj.get('dedup'), dict) and obj['dedup'].get('isNew') == True))
checks.append(('dedup.ttlSeconds', isinstance(obj.get('dedup'), dict) and isinstance(obj['dedup'].get('ttlSeconds'), (int, float))))
checks.append(('llm.provider', isinstance(obj.get('llm'), dict) and isinstance(obj['llm'].get('provider'), str)))
checks.append(('llm.latencyMs', isinstance(obj.get('llm'), dict) and isinstance(obj['llm'].get('latencyMs'), (int, float))))
checks.append(('notify.outcome', isinstance(obj.get('notify'), dict) and obj['notify'].get('outcome') in ('success', 'failure')))

all_pass = True
for name, ok in checks:
    status = '✓' if ok else '✗'
    if not ok: all_pass = False
    print(f'  {status} {name}: {\"PASS\" if ok else \"FAIL\"} ')
if all_pass:
    print('ALL_PASS')
else:
    print('SOME_FAILED')
" 2>&1)

  echo "$VALIDATION"

  if echo "$VALIDATION" | grep -q "ALL_PASS"; then
    pass "Wide event structure is valid — all fields present"
  elif echo "$VALIDATION" | grep -qE "NO_EVENT|NO_VALUES|NOT_JSON|PARSE_ERROR"; then
    fail "Could not parse wide event from Loki"
  else
    fail "Some wide event fields are missing or incorrect"
  fi
fi

# ── 8. Test WIDE_EVENTS_ENABLED=false ───────────────────────────────────
header "8. Test WIDE_EVENTS_ENABLED=false (suppression)"
# Restart with flag disabled
kill "$DEV_PID" 2>/dev/null || true
wait "$DEV_PID" 2>/dev/null || true

cat > "$ENV_FILE" <<'EOF'
LLM_PROVIDER=gemini
LLM_API_KEY=dummy-test-key
NOTIFIER_TYPE=slack
SLACK_BOT_TOKEN=xoxb-dummy-test-token-12345
SLACK_CHANNEL=#test
SLACK_SIGNING_SECRET=dummy-test-secret
LOKI_URL=http://localhost:3100
REDIS_URL=redis://localhost:6379
NODE_ENV=development
LOG_LEVEL=info
WIDE_EVENTS_ENABLED=false
EOF

pnpm exec tsx --env-file="$ENV_FILE" scripts/dev-server.ts &
DEV_PID=$!
sleep 2

SUPPRESS_FP="test-suppress-$(date +%s)"
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
END=$(date -u -v+1H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || python3 -c "from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc) + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")

curl -sf -X POST "$WEBHOOK_URL/webhook/alert" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "groupKey": "{alertname=\"SuppressTest\"}",
    "status": "firing",
    "receiver": "test",
    "groupLabels": {"alertname": "SuppressTest"},
    "commonLabels": {"severity": "warning"},
    "commonAnnotations": {},
    "externalURL": "http://localhost:9093",
    "alerts": [{
      "status": "firing",
      "labels": {"alertname": "SuppressTest", "service": "test"},
      "annotations": {"summary": "Suppression test"},
      "startsAt": "'"$NOW"'",
      "endsAt": "'"$END"'",
      "fingerprint": "'"$SUPPRESS_FP"'"
    }]
  }' >/dev/null 2>&1

sleep 3
SUPPRESS_QUERY='{service_name="junando"} | json | requestId=~".*:'"$SUPPRESS_FP"'"'
SUPPRESS_COUNT=$(curl -sf -G "$LOKI_URL/loki/api/v1/query_range" \
  --data-urlencode "query=$SUPPRESS_QUERY" \
  --data-urlencode "limit=5" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    total = sum(len(s.get('values', [])) for s in d.get('data', {}).get('result', []))
    print(total)
except: print(-1)" 2>/dev/null || echo "-1")

if [ "$SUPPRESS_COUNT" = "0" ]; then
  pass "WIDE_EVENTS_ENABLED=false suppressed wide events correctly"
elif [ "$SUPPRESS_COUNT" = "-1" ]; then
  fail "Could not query Loki for suppression test"
else
  fail "WIDE_EVENTS_ENABLED=false produced $SUPPRESS_COUNT wide event(s) — expected 0"
fi

# ── 9. Summary ──────────────────────────────────────────────────────────
header "Results"
echo -e "  \033[1;32m$PASS passed\033[0m, \033[1;31m$FAIL failed\033[0m"
[ "$FAIL" -eq 0 ] && echo -e "  \033[1;32m✓ All wide event checks passed!\033[0m" || echo -e "  \033[1;31m✗ Some checks failed\033[0m"
exit $FAIL
