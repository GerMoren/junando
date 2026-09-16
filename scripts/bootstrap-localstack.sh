#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
QUEUE_NAME='junando-alerts'
FIFO_QUEUE_NAME='junando-alerts.fifo'
TABLE_NAME='junando-dedup'
TTL_ATTRIBUTE='expiresAt'

aws_local() {
  aws --endpoint-url "$ENDPOINT" --no-cli-pager "$@"
}

ensure_queue() {
  local queue_name="$1"
  shift

  if ! aws_local sqs get-queue-url --queue-name "$queue_name" >/dev/null 2>&1; then
    aws_local sqs create-queue --queue-name "$queue_name" "$@" >/dev/null
  fi
}

ensure_queue "$QUEUE_NAME"
ensure_queue "$FIFO_QUEUE_NAME" --attributes FifoQueue=true,ContentBasedDeduplication=false

if ! aws_local dynamodb describe-table --table-name "$TABLE_NAME" >/dev/null 2>&1; then
  aws_local dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --attribute-definitions AttributeName=fingerprint,AttributeType=S \
    --key-schema AttributeName=fingerprint,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
fi

TTL_STATUS="$(aws_local dynamodb describe-time-to-live --table-name "$TABLE_NAME" --query 'TimeToLiveDescription.TimeToLiveStatus' --output text)"
if [[ "$TTL_STATUS" == 'DISABLED' ]]; then
  aws_local dynamodb update-time-to-live \
    --table-name "$TABLE_NAME" \
    --time-to-live-specification "Enabled=true,AttributeName=$TTL_ATTRIBUTE" >/dev/null
fi

echo "LocalStack resources are ready at $ENDPOINT"
