#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# Junando Deploy Script
# Run from project root: ./scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

echo "🚀 Junando AWS Deployment"
echo "================================"

# ── Check prerequisites ────────────────────────────────────────────────────
if ! command -v aws &> /dev/null; then
  echo "❌ AWS CLI not found. Install it first."
  exit 1
fi

if ! command -v pnpm &> /dev/null; then
  echo "❌ pnpm not found. Install it first."
  exit 1
fi

# Verify AWS credentials
echo "📋 Checking AWS credentials..."
aws sts get-caller-identity > /dev/null 2>&1 || {
  echo "❌ AWS not configured. Run 'aws configure' first."
  exit 1
}
echo "✅ AWS credentials OK"

# ── SSM Parameter Setup ────────────────────────────────────────────────────
echo ""
echo "📦 Setting up SSM Parameters..."
echo "================================"

# Function to prompt for SSM parameter
prompt_ssm() {
  local param_name=$1
  local current_value
  current_value=$(aws ssm get-parameter --name "$param_name" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
  
  if [ -n "$current_value" ]; then
    echo "  • $param_name: [configured]"
  else
    echo "  • $param_name: [not set]"
  fi
}

prompt_ssm "/junando/llm-provider"
prompt_ssm "/junando/llm-api-key"
prompt_ssm "/junando/slack-bot-token"
prompt_ssm "/junando/slack-signing-secret"
prompt_ssm "/junando/slack-channel"
prompt_ssm "/junando/loki-url"
prompt_ssm "/junando/redis-url"

echo ""
read -p "Do you want to configure/update SSM parameters? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "Enter values (press Enter to keep existing value):"
  echo ""

  # LLM Provider
  read -p "LLM Provider (openrouter/claude/gemini/qwen) [openrouter]: " LLM_PROVIDER
  LLM_PROVIDER=${LLM_PROVIDER:-openrouter}
  aws ssm put-parameter --name /junando/llm-provider --value "$LLM_PROVIDER" --type SecureString --overwrite

  # LLM API Key
  read -p "LLM API Key: " LLM_API_KEY
  if [ -n "$LLM_API_KEY" ]; then
    aws ssm put-parameter --name /junando/llm-api-key --value "$LLM_API_KEY" --type SecureString --overwrite
  fi

  # Slack Bot Token
  read -p "Slack Bot Token (xoxb-...): " SLACK_BOT_TOKEN
  if [ -n "$SLACK_BOT_TOKEN" ]; then
    aws ssm put-parameter --name /junando/slack-bot-token --value "$SLACK_BOT_TOKEN" --type SecureString --overwrite
  fi

  # Slack Signing Secret
  read -p "Slack Signing Secret: " SLACK_SIGNING_SECRET
  if [ -n "$SLACK_SIGNING_SECRET" ]; then
    aws ssm put-parameter --name /junando/slack-signing-secret --value "$SLACK_SIGNING_SECRET" --type SecureString --overwrite
  fi

  # Slack Channel
  read -p "Slack Channel (e.g., #incidents) [#incidents]: " SLACK_CHANNEL
  SLACK_CHANNEL=${SLACK_CHANNEL:-#incidents}
  aws ssm put-parameter --name /junando/slack-channel --value "$SLACK_CHANNEL" --type SecureString --overwrite

  # Loki URL
  read -p "Loki URL (e.g., https://loki:3100): " LOKI_URL
  if [ -n "$LOKI_URL" ]; then
    aws ssm put-parameter --name /junando/loki-url --value "$LOKI_URL" --type SecureString --overwrite
  fi

  # Redis URL
  read -p "Redis URL (e.g., redis://redis:6379): " REDIS_URL
  if [ -n "$REDIS_URL" ]; then
    aws ssm put-parameter --name /junando/redis-url --value "$REDIS_URL" --type SecureString --overwrite
  fi

  echo ""
  echo "✅ SSM parameters configured"
fi

# ── Build ───────────────────────────────────────────────────────────────────
echo ""
echo "🔨 Building packages..."
echo "================================"
pnpm install
pnpm build
echo "✅ Build complete"

# ── CDK Bootstrap (if needed) ────────────────────────────────────────────
echo ""
echo "🏗️  Checking CDK bootstrap status..."
cd packages/cdk

if ! pnpm cdk bootstrap --quiet 2>/dev/null; then
  echo "⚠️  CDK bootstrap may be needed. Run manually if deploy fails:"
  echo "    cd packages/cdk && pnpm cdk bootstrap"
fi

# ── Deploy ─────────────────────────────────────────────────────────────────
echo ""
echo "🚀 Deploying to AWS..."
echo "================================"
read -p "Proceed with CDK deploy? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Deploy cancelled"
  exit 0
fi

pnpm cdk deploy --all

# ── Show Outputs ───────────────────────────────────────────────────────────
echo ""
echo "📤 Deployment Outputs"
echo "================================"
pnpm cdk outputs

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Copy WebhookURL to your Alertmanager config"
echo "  2. Test: pnpm run generate:alert"
echo "  3. Monitor: aws logs tail /aws/lambda/junando-worker --follow"