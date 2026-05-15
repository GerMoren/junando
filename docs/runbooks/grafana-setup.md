# Grafana Setup Guide

Connect Grafana Cloud to Loki and CloudWatch, import the Junando dashboards, and bind template variables.

---

## Prerequisites

- Grafana Cloud account (or self-hosted Grafana ≥ 10.0)
- AWS IAM credentials or role for CloudWatch access
- Loki instance receiving Junando structured logs

---

## 1. Connect Loki Datasource

1. In Grafana, go to **Connections → Data Sources → Add data source**.
2. Select **Loki**.
3. Set **URL** to your Loki endpoint (e.g. `https://<your-org>.grafana.net/loki` for Grafana Cloud).
4. For Grafana Cloud Loki, add **Basic auth** with your Cloud username + API token.
5. Click **Save & test** — confirm "Data source connected".
6. Note the datasource **name** you assigned (used as the `$loki_ds` variable value).

---

## 2. Connect CloudWatch Datasource

### IAM Policy (minimum permissions)

Create an IAM policy with the following statement and attach it to the IAM user or role Grafana uses:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"],
      "Resource": "*"
    }
  ]
}
```

### Cross-Account Role (Grafana Cloud recommended)

For Grafana Cloud, use a cross-account IAM role instead of access keys:

1. In the Grafana CloudWatch datasource config UI, find the **Assume Role ARN** field.
2. Create a role in your AWS account that trusts Grafana's service account principal (shown in the datasource config).
3. Attach the above policy to that role.
4. Paste the role ARN into the **Assume Role ARN** field.

### Datasource setup

1. Go to **Connections → Data Sources → Add data source**.
2. Select **CloudWatch**.
3. Choose your **Authentication Provider** (keys, instance profile, or assume role).
4. Set **Default Region** to the region where your SQS queues are deployed.
5. Click **Save & test**.
6. Note the datasource **name** (used as the `$cloudwatch_ds` variable value).

---

## 3. Import Dashboard JSONs

The three dashboard JSON files are located in `docs/dashboards/`:

| File | Dashboard |
|------|-----------|
| `alert-volume.json` | Alert pipeline throughput |
| `llm-performance.json` | LLM latency and reliability |
| `sqs-health.json` | SQS queue and DLQ health |

**Import steps:**

1. In Grafana, go to **Dashboards → Import**.
2. Click **Upload dashboard JSON file**.
3. Select one of the JSON files from `docs/dashboards/`.
4. Grafana will prompt you to bind the template variables (see next section).
5. Click **Import**.
6. Repeat for each of the three dashboards.

---

## 4. Bind Template Variables

Each dashboard uses the following template variables. Grafana will prompt for these on import:

| Variable | Type | How to set |
|----------|------|------------|
| `$loki_ds` | Datasource | Select the Loki datasource you created in Step 1 |
| `$cloudwatch_ds` | Datasource | Select the CloudWatch datasource you created in Step 2 (SQS dashboard only) |
| `$environment` | Custom | Choose `production`, `staging`, or `dev` |

After import, you can update variable bindings at any time via **Dashboard Settings → Variables**.

---

## 5. Verify Panels

After binding variables:

1. Open the **Alert Volume** dashboard and set the time range to the last 1 hour.
2. Confirm **Alerts Received Rate** shows data if webhook traffic has occurred.
3. Open the **LLM Performance** dashboard.
4. Confirm **p99 latency** panel shows data if LLM calls have been logged.
5. Open the **SQS Health** dashboard.
6. Confirm **SQS Queue Depth** shows data from CloudWatch.

If a panel shows "No data", check:
- The time range covers a period with actual traffic.
- The `$environment` variable matches the label in your Loki logs.
- The datasource variables are bound to active datasources.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Loki panels empty | Wrong environment label | Check logs have `environment` label matching `$environment` |
| CloudWatch panels empty | IAM permissions missing | Add `cloudwatch:GetMetricData` to the policy |
| "No data source" error | Variable not bound | Re-import and bind `$loki_ds` / `$cloudwatch_ds` |
| p99 latency panel empty | No `latencyMs` field in logs | Ensure `llm:request:success` log events include `latencyMs` |
