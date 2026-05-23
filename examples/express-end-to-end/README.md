# Express end-to-end example

The canonical Junando demo. A broken Express endpoint triggers a Prometheus alert, Alertmanager forwards it to Junando, Junando asks an LLM for a structured diagnosis, and the result lands in Slack with the original `correlationId` intact.

```
demo-app (Express)
  └─ /api/checkout always returns 500 + logs an error with correlationId
       └─ Prometheus scrapes http_errors_total
            └─ Alert rule CheckoutEndpointFailing fires
                 └─ Alertmanager posts to junando-webhook
                      └─ Junando builds a cluster, asks the LLM, and notifies Slack
```

Total time to first Slack message: about 5 minutes including filling in credentials.

---

## Prerequisites

- Docker + Docker Compose
- A Slack bot token (or a Microsoft Teams Power Automate webhook — see `.env.example`)
- An LLM API key (Qwen, Claude, Gemini, or OpenRouter)

That is it. You do not need to clone the Junando monorepo or build any package — the example uses the published `ghcr.io/germoren/junando-webhook:latest` image by default.

---

## Run it

```bash
cd examples/express-end-to-end

cp .env.example .env
# edit .env and fill in LLM_API_KEY, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_CHANNEL

docker compose up -d
./scripts/simulate.sh
```

Within ~30 seconds you should see a Slack message in the channel you configured. It will contain:

- The probable cause as inferred by the LLM
- Recommended next steps
- A link to the runbook declared in `prometheus/rules.yml`
- The `correlationId` from the first failing request, so you can pivot to logs

Tear down:

```bash
docker compose down -v
```

---

## What is happening behind the scenes

### `demo-app`

A 60-line Express app at `app/src/server.js`. The only thing worth pointing out is the **correlationId middleware**: every request gets a UUID (or reuses an incoming `x-correlation-id` header). That id is attached to every pino log line and surfaces in the 500 response body. Real apps should do the same so a single incident is greppable across logs, metrics, and incident summaries.

### Prometheus

Scrapes `demo-app:3001/metrics` every 5 seconds. The rule in `docker/prometheus/rules.yml` watches `http_errors_total{route="/api/checkout"}` and fires `CheckoutEndpointFailing` when the rate exceeds zero for 15 seconds.

### Alertmanager

Single route, single receiver: it forwards every alert to `http://junando-webhook:4000/webhook/alert`. The `send_resolved: true` flag means Junando also receives the resolution event when the alert clears.

### Junando webhook

The published `ghcr.io/germoren/junando-webhook` image. It deduplicates against Redis (TTL 5 min by default), clusters related alerts (120 s window), pulls representative log context from Loki when available, and sends the cluster to your configured LLM. The LLM response is mapped to a Slack Block Kit message and posted to `SLACK_CHANNEL`.

---

## Inspect each step

| URL                              | What to look at                                       |
|----------------------------------|-------------------------------------------------------|
| http://localhost:3001/health     | Demo app health                                       |
| http://localhost:3001/metrics    | Raw Prometheus metrics including `http_errors_total`  |
| http://localhost:9090/alerts     | Prometheus alert state (PENDING → FIRING)             |
| http://localhost:9093/#/alerts   | Alertmanager queue and grouping                       |
| http://localhost:4000/health     | Junando webhook health                                |

Logs:

```bash
docker compose logs -f demo-app          # see the failing requests + correlationIds
docker compose logs -f junando-webhook   # see the cluster build, LLM call, Slack post
```

---

## Swap notifier to Microsoft Teams

In `.env`:

```bash
NOTIFIER_TYPE=teams
TEAMS_WEBHOOK_URL=https://prod-XX.westus.logic.azure.com/workflows/.../invoke?api-version=2024-10-01&sp=...
```

Comment out the three `SLACK_*` variables. Restart:

```bash
docker compose up -d junando-webhook
```

Junando posts an Adaptive Card to your Power Automate workflow. The rest of the pipeline is identical.

---

## Contributor mode (build webhook from source)

If you are working on `@junando/core` or `@junando/webhook` and want this example to reflect your local changes:

```bash
docker compose --profile dev up -d --build
```

This builds the webhook from `docker/Dockerfile.webhook` at the repo root instead of pulling the published image. Everything else is unchanged.

---

## Troubleshooting

**No Slack message after 1 minute.**
Check the Junando logs (`docker compose logs junando-webhook`). The most common causes are an invalid `SLACK_BOT_TOKEN`, a channel the bot is not invited to, or the LLM provider returning an error (the log line will say so).

**Alertmanager says `dial tcp: lookup junando-webhook: no such host`.**
This means alertmanager and junando-webhook are not in the same Compose network. Make sure you ran `docker compose up` from this directory, not from the repo root.

**Prometheus alert never fires.**
Hit `/api/checkout` manually a few times (`curl http://localhost:3001/api/checkout`) and watch http://localhost:9090/alerts. If `http_errors_total` is incrementing but the alert stays GREEN, the scrape may not have caught up yet — wait 15 more seconds.

**The LLM call times out.**
Some free-tier providers throttle aggressively. Switch `LLM_PROVIDER` to `openrouter` and use a paid model, or set `LLM_FALLBACK_MODELS` to a comma-separated list of free models.
