#!/bin/sh
set -eu

QUEUE_NAME='junando-alerts'
FIFO_QUEUE_NAME='junando-alerts.fifo'
TABLE_NAME='junando-dedup'

awslocal sqs create-queue --queue-name "$QUEUE_NAME" >/dev/null
awslocal sqs create-queue \
  --queue-name "$FIFO_QUEUE_NAME" \
  --attributes FifoQueue=true,ContentBasedDeduplication=false >/dev/null
awslocal dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions AttributeName=fingerprint,AttributeType=S \
  --key-schema AttributeName=fingerprint,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST >/dev/null
awslocal dynamodb update-time-to-live \
  --table-name "$TABLE_NAME" \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt >/dev/null
