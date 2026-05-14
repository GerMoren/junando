# AlertManager Integration

> **TL;DR** — Copy `docs/alertmanager-example.yml` into your AlertManager config, set the URL to `JunandoStack.WebhookURL`, and send a test alert with `pnpm run generate:alert`. A Slack message should appear within 30 seconds.

---

## Quick Start

1. Deploy Junando and grab the webhook URL from CDK outputs:
   ```bash
   cd packages/cdk && pnpm cdk outputs
   # JunandoStack.WebhookURL = https://<id>.lambda-url.<region>.on.aws
   ```

2. Send a smoke-test alert (bypasses AlertManager, posts directly to the webhook):
   ```bash
   pnpm run generate:alert
   ```
   Expected: a Slack message in your configured channel within ~5 seconds.

3. For full AlertManager wiring, continue to the next section.

---

## Wiring AlertManager

Copy the receiver block from [`docs/alertmanager-example.yml`](./alertmanager-example.yml) into your existing `alertmanager.yml`:

```yaml
receivers:
  - name: junando
    webhook_configs:
      - url: 'https://<id>.lambda-url.<region>.on.aws'  # JunandoStack.WebhookURL
        send_resolved: false   # see § Resolved Alerts below
        max_alerts: 0
```

Then reload AlertManager:
```bash
curl -X POST http://localhost:9093/-/reload
```

Verify with a manual alert injection:
```bash
amtool --alertmanager.url=http://localhost:9093 alert add alertname=TestAlert service=junando severity=warning
```

---

## Edge Cases

### Resolved Alerts

**Current MVP behavior**: Junando accepts `resolved` payloads and returns `HTTP 200` with `{"accepted": 0}`. No Slack message is sent — resolved alerts are filtered before enqueuing.

**Recommendation**: Set `send_resolved: false` in your receiver config to avoid unnecessary webhook calls and suppress AlertManager retry logs.

Expected response when AlertManager sends a resolved payload:
```json
HTTP 200
{ "accepted": 0 }
```

This is intentional MVP behavior. A future version may forward resolved alerts as a Slack `:white_check_mark:` update.

---

### Grouping and Cardinality

AlertManager batches alerts into a single webhook POST per group per `group_interval`. Junando delivers one Slack message per batch.

**Recommended `group_by`**:
```yaml
group_by: ['alertname', 'service']
```

**Avoid** high-cardinality labels such as `pod`, `instance`, or `namespace` in `group_by`. Each unique combination becomes its own group — with 100 pods, you get 100 Slack messages per interval instead of 1.

---

### Large Payloads (250 KB SQS Limit)

SQS has a hard 256 KB message size limit. Junando enforces a **250 KB soft threshold** before enqueuing:

- If the serialized alert batch exceeds 250 KB, **alert annotations are truncated to 1000 characters** per alert.
- The `truncatedAlerts` field in the SQS message body reflects the count of truncated alerts.
- The alert is still processed and forwarded to Slack — only annotation text is shortened.

To avoid truncation: keep `group_by` cardinality low (see above) and avoid attaching large log blobs in alert annotations.

---

### Fingerprints and Deduplication

AlertManager includes a `fingerprint` field per alert. Junando passes this through to SQS metadata but does **not** deduplicate based on it at MVP. Deduplication relies on Redis (keyed on `alertname + service + labels`).

If you use Grafana Loki, the `fingerprint` can be used to correlate alert events with log streams — see § Loki Correlation below.

---

### 30-Second SLA

AlertManager marks a webhook delivery as failed if no response arrives within its configured `http_config.timeout` (default: 30s). Junando's webhook Lambda cold-start p99 is under 1 second, so this limit is not a concern in practice.

If you observe AlertManager retry loops, check CloudWatch logs for the `junando-webhook` Lambda first:
```bash
aws logs tail /aws/lambda/junando-webhook --follow
```

---

## Loki Correlation

Each incoming alert is logged to Loki with the `fingerprint` label (when provided by AlertManager). To correlate:

1. In Grafana, open **Explore → Loki**.
2. Query: `{app="junando"} |= "<fingerprint-value>"`
3. This shows the full alert lifecycle: receive → enqueue → worker → Slack post.

Alternatively, filter by `alertname`:
```logql
{app="junando"} | json | alertname="<name>"
```

---

## Local E2E with Docker

### Path A — Direct webhook (fastest, no full stack needed)

```bash
# Start only what's needed
docker compose -f docker/docker-compose.yml up redis loki -d

# Run the app locally
pnpm dev

# Send a test alert (bypasses AlertManager entirely)
pnpm run generate:alert
```

Expected: Slack message within ~5 seconds.

---

### Path B — Full Prometheus → AlertManager → Junando stack

This path validates the complete production-equivalent flow without any manual curl commands.

**Prerequisites**: set `JUNANDO_WEBHOOK_URL` to a publicly reachable URL (ngrok or equivalent) that forwards to your local `http://localhost:4000/webhook/alert`.

```bash
# Expose local port via ngrok (or any tunnel tool)
ngrok http 4000
# Copy the https URL, e.g. https://abc123.ngrok.io

# Set the webhook URL
export JUNANDO_WEBHOOK_URL=https://abc123.ngrok.io/webhook/alert

# Start the full stack
docker compose -f docker/docker-compose.yml up -d

# Start the app locally
pnpm dev
```

After ~1 minute, Prometheus will evaluate the demo alerting rule (`JunandoDown` fires when the `junando` job is unreachable). Since the local Junando app is running on the host, the rule will NOT fire during normal operation — use the `generate:alert` smoke test instead for quick validation.

To force the demo rule to fire, stop the local app and wait 30 seconds for the `for:` duration to elapse. Prometheus will then POST to AlertManager, which routes to Junando, which sends a Slack message.

> **Note**: The demo rule in `docker/prometheus/rules/demo.yml` is annotated `# demo-only` and fires only when the `junando` job target is down. Do not copy it to a production Prometheus instance.

#### Verify Prometheus loaded the rules

```bash
curl http://localhost:9090/api/v1/rules | jq '.data.groups[].name'
# Should output: "demo"
```

#### Verify AlertManager received an alert

```bash
curl http://localhost:9093/api/v2/alerts | jq '.[].labels.alertname'
```

---

## Production vs Local: Key Differences

| Concern | Production | Local Docker |
|---------|------------|--------------|
| Webhook URL | Lambda Function URL from CDK outputs | `http://host.docker.internal:4000/webhook/alert` |
| AlertManager config | Copy from `docs/alertmanager-example.yml` | `docker/alertmanager/alertmanager.yml` (env-var substituted) |
| Prometheus alerting rules | Operator-managed | `docker/prometheus/rules/demo.yml` (demo-only) |
| `resolved` behavior | HTTP 200 / `{"accepted":0}` — no Slack | Same |
| Alert injection | `amtool alert add` or real system alerts | `pnpm run generate:alert` or demo rules |
