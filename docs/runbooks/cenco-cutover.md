# Cenco Cutover: Replace CronJob with Junando Ingest

Junando becomes the production consumer of the Cenco error-manager SQS queue,
replacing the CronJob that generates CSVs and sends email notifications.
The platform code (SQS subscriber, mapper registry, processors, OpenSearch indexer)
is already merged to `main`. This runbook guides any on-call engineer through
the cutover, validation, rollback, and CronJob decommission steps.

---

## Quick path

An on-call engineer can complete the full cutover by following this checklist
top-to-bottom without reading any other section.

1. Confirm all **Pre-checks** pass (see `## Pre-checks` below).
2. Pull the image: `ghcr.io/germoren/junando-ingest:main`
   (pin to a SHA digest for go-live stability).
3. Mount the production config:
   `INGEST_CONFIG_PATH=/etc/junando/ingest.config.yaml`
   using `docker/ingest.config.cenco-prod.example.yaml` as the template
   (replace every `<PLACEHOLDER>` token with real values).
4. Deploy / scale the Junando ingest Deployment or Task.
5. Confirm the startup log shows:
   `"junando ingest running in sqs mode, mapper=cenco-error-v1"` — no `fatal` lines.
6. Send one real or synthetic Cenco SQS message.
7. Run the **OpenSearch validation query** — confirm document count ≥ 1 in `cenco-traceability`.
8. Watch the **SQS metric**: `NumberOfMessagesDeleted` rising in CloudWatch.
9. Monitor for ≥ 48 h of clean data — then proceed to **CronJob decommission**.
10. On any failure at any step → go to **Rollback**.

---

## Pre-checks

Verify all five items before deploying. A failed check means the deployment is
not ready; do not proceed until the issue is resolved.

- [ ] **SQS queue exists and is reachable.**

  ```bash
  aws sqs get-queue-attributes \
    --queue-url https://sqs.<REGION>.amazonaws.com/<ACCOUNT_ID>/cenco-error-manager \
    --attribute-names All
  ```

  Expected: HTTP 200 response with queue attributes.

- [ ] **IAM role attached to pod/task grants required SQS permissions.**
      The role must allow `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and
      `sqs:ChangeMessageVisibility` on the queue ARN.

  ```bash
  aws iam simulate-principal-policy \
    --policy-source-arn <ROLE_ARN> \
    --action-names sqs:ReceiveMessage sqs:DeleteMessage sqs:ChangeMessageVisibility \
    --resource-arns arn:aws:sqs:<REGION>:<ACCOUNT_ID>:cenco-error-manager
  ```

  Expected: `EvalDecisionType: allowed` for all three actions.

- [ ] **OpenSearch domain endpoint returns HTTP 200.**

  ```bash
  curl -f https://<OPENSEARCH_DOMAIN_ENDPOINT>
  ```

  Expected: JSON cluster info response (HTTP 200).

- [ ] **`cenco-error-v1` mapper is registered in the deployed image.**
      Confirm via the startup log line containing `mapperKind=cenco-error-v1`,
      or by inspecting the image manifest for the side-effect import.
      If you see `"Mapper not registered: \"cenco-error-v1\""` in the log, the
      mapper side-effect import is missing from the image — halt the deployment.

- [ ] **`INGEST_CONFIG_PATH` secret/ConfigMap is mounted and fully substituted.**
      All `<PLACEHOLDER>` tokens in the config must be replaced with real values.
      Verify by inspecting the mounted file inside the running container:
  ```bash
  kubectl exec -it <POD_NAME> -- cat /etc/junando/ingest.config.yaml
  ```

---

## Deploy order

### Step 1 — Deploy the Junando ingest container

Apply the Deployment or Task with the production config mounted:

```bash
kubectl set image deployment/junando-ingest \
  junando-ingest=ghcr.io/germoren/junando-ingest:<SHA>
kubectl rollout status deployment/junando-ingest
```

- **Image**: use a pinned SHA digest for go-live (avoids tag mutability risk).
  Example: `ghcr.io/germoren/junando-ingest:main@sha256:<digest>`
- **Config**: derived from `docker/ingest.config.cenco-prod.example.yaml` with all
  placeholders substituted, mounted at `INGEST_CONFIG_PATH=/etc/junando/ingest.config.yaml`.

### Step 2 — Confirm startup log

Within 30 seconds of the pod becoming Ready, confirm the log contains:

```
"junando ingest running in sqs mode, mapper=cenco-error-v1"
```

```bash
kubectl logs -l app=junando-ingest --tail=20
```

- **No `fatal` log lines** should appear.
- **No container restarts** (CrashLoopBackOff means the pre-flight check failed —
  check for `"Mapper not registered"` in the logs).
- If a fatal is present, scale to 0 and consult **Rollback** before retrying.

### Step 3 — Validate first message indexed

Send one real or synthetic Cenco SQS message to the queue, then run the
**Validation queries** below to confirm it is indexed in `cenco-traceability`.
Allow up to `visibilityTimeoutSeconds` (60 s) for processing.

---

## Validation queries

### OpenSearch — confirm document indexed

```bash
curl -s -X GET \
  "https://<OPENSEARCH_DOMAIN_ENDPOINT>/cenco-traceability/_count" \
  --aws-sigv4 "aws:amz:<REGION>:es" \
  --user "<AWS_ACCESS_KEY_ID>:<AWS_SECRET_ACCESS_KEY>" \
  | jq '.count'
# Expected: ≥ 1 after the first message is processed
```

Alternatively, use the OpenSearch Dashboards console:
`GET /cenco-traceability/_count`

### SQS metric — confirm queue draining

- **CloudWatch metric**: `AWS/SQS` → `NumberOfMessagesDeleted` on queue
  `cenco-error-manager` — should be **rising** after deployment.
- **Drain indicator**: `ApproximateNumberOfMessagesNotVisible` returning to `0`
  after each processing cycle.
- **Alert threshold**: 0 deleted messages in a 5-minute window after the first
  message was sent → investigate immediately.

---

## Rollback

**Target recovery time: < 5 minutes.**

- [ ] Scale Junando ingest to zero replicas:

  ```bash
  kubectl scale deployment/junando-ingest --replicas=0
  ```

  Confirm pods are gone: `kubectl get pods -l app=junando-ingest`

- [ ] Re-enable or un-suspend the Cenco CronJob:

  ```bash
  kubectl patch cronjob cenco-error-manager \
    -p '{"spec":{"suspend":false}}'
  ```

- [ ] Confirm the CronJob resumes normal email delivery:
      check CronJob logs and verify the next scheduled email notification is sent.

- [ ] File a comment on issue #36 with:
  - Timestamp of rollback
  - Failure description and step where it occurred
  - Next steps before retrying

---

## CronJob decommission

> ⚠️ **Gate check**: Do NOT delete the CronJob manifests until ≥ 48 hours of
> uninterrupted clean data have been confirmed. If fewer than 48 h have elapsed
> since go-live, **STOP** — come back when the gate criterion is met.

- [ ] **Confirm ≥ 48 h of clean data in `cenco-traceability`.**
      Verify via OpenSearch `_count` or Dashboards that documents have been indexed
      continuously, with no gaps, for the past 48 h.
      Also confirm the DLQ (`cenco-error-manager-dlq`) shows
      `ApproximateNumberOfMessagesNotVisible = 0` throughout the period.

- [ ] **Delete CronJob manifests from the Cenco repo.**
      Open a PR in the Cenco repository removing the `cenco-error-manager` CronJob
      and any associated resources. Request review from TI Cenco.

- [ ] **Confirm decommission with the TI Cenco stakeholder.**
      Get explicit sign-off before merging the removal PR.

- [ ] **Close issue #36** once the CronJob is removed from production.
