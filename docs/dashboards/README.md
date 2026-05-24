# Junando Grafana Dashboards

This directory contains Grafana dashboard JSON files provisioned automatically via Grafana's filesystem provisioning.

## Starting Grafana with the Provisioned Dashboard

```bash
docker compose -f docker/docker-compose.yml up grafana
```

The `Junando SLIs` dashboard loads automatically. No manual import is needed.

## Importing into Grafana Cloud (or any external Grafana)

The dashboard JSON hardcodes `datasource.uid: "prometheus-local"`, which only exists in the local compose stack (`docker/grafana/datasources.yml`). External Grafana instances use a different Prometheus datasource UID.

To import:

1. In Grafana → **Dashboards → New → Import**.
2. Upload `docs/dashboards/junando-slis.json` (or paste its contents).
3. When prompted to resolve the missing `prometheus-local` datasource, select your Prometheus datasource (in Grafana Cloud this is typically `grafanacloud-<org>-prom`).
4. Save.

Panels will remain "No data" until your environment is scraping `junando_*` metrics. In Grafana Cloud this means configuring Grafana Alloy / Agent / `remote_write` to ship metrics from your app's `/metrics` endpoint to Cloud Prometheus.

## Dashboard: Junando SLIs (`junando-slis.json`)

UID: `junando-slis` — stable across versions (do not change).

### Panel-to-Metric Mapping

| Panel | Type | Metric(s) | PromQL |
|-------|------|-----------|--------|
| Ingest Latency p95 | Time series | `junando_webhook_duration_seconds` | `histogram_quantile(0.95, rate(junando_webhook_duration_seconds_bucket{status="success"}[5m]))` |
| Dedup Ratio | Stat | `junando_dedup_new_total`, `junando_dedup_duplicate_total` | `rate(junando_dedup_duplicate_total[5m]) / (rate(junando_dedup_new_total[5m]) + rate(junando_dedup_duplicate_total[5m])) or vector(0)` |
| Incident Throughput | Time series | `junando_alerts_processed_total` | `rate(junando_alerts_processed_total[5m])` by `result` |
| Notification Outcomes | Bar chart | `junando_notifications_total` | `rate(junando_notifications_total[5m])` by `channel`, `outcome` |

### Panels Are Live When

Panels display data only after the following instrumentation PRs are deployed:

- **#101** — `feat(metrics): observe ingest latency in webhook handler`
- **#102** — `feat(metrics): instrument processing success/failure counters in worker`
- **#103** — `feat(metrics): instrument notification outcomes in adapters`
- **#104** — `feat(observability): expose SQS queue lag as Prometheus gauge`

All four are delivered together in this PR (issue #78).

> **Note**: The SQS lag poller uses `setInterval` in the worker Lambda's warm container. It does not fire if Lambda is cold-started and exits immediately. For production AWS, consider a dedicated CloudWatch metric stream or a scheduled function to ensure continuous data.
