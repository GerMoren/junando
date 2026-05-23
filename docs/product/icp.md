# Junando — ICP & Problem Statement

> **One-liner**
> Junando is the intelligent glue between your existing observability stack and the people who respond to incidents.

---

## 1. What is Junando?

Junando is an **incident correlation and enrichment layer** that sits between your observability tools (Loki, Prometheus, CloudWatch, Alertmanager) and your communication channels (Slack, Teams).

It takes raw alerts and turns them into **actionable incidents** with full traceability across logs, traces, and metrics — augmented by LLM-based analysis.

Junando does **not** replace your observability stack. It makes it usable during the worst moments.

---

## 2. Ideal Customer Profile (ICP)

### Primary ICP

**Mid-sized engineering organizations running microservices on AWS** with the following characteristics:

| Dimension | Profile |
|-----------|---------|
| **Company size** | 50–500 engineers |
| **Architecture** | 10+ microservices, distributed ownership |
| **Cloud** | AWS-first (EKS, Lambda, ECS) |
| **Observability** | Already using Prometheus, Loki, Grafana, CloudWatch, or similar |
| **Alerting** | Alertmanager or equivalent — already firing alerts |
| **Pain trigger** | Incidents that span multiple services and require cross-team coordination |

### Secondary ICPs (downstream beneficiaries)

Once the primary ICP is served well, the same product naturally extends to:

- **(b) Backend Node.js/NestJS teams** with established observability but no incident workflow
- **(c) Startups building observability from scratch** — they adopt Junando as the "right way" from day one

> **Strategic note:** We do **not** target startups first. They lack the pain (few services, few alerts, one person on-call). The pain is real and measurable in mid-sized orgs — that is where Junando earns adoption.

### Who Junando is NOT for

- Solo developers or hobby projects
- Teams without existing observability tooling (Junando consumes, it does not instrument)
- Organizations that already have a mature incident response platform they are happy with

---

## 3. The Real Problem

### Symptom (what users feel)

> "When something breaks, I have to jump between 5 dashboards, search Loki by hand, correlate trace IDs across services, and explain to the team what is happening — all under pressure."

### Root cause (what Junando attacks)

**Fragmented traceability during incidents.**

Modern observability stacks excel at collecting data but fail at **connecting it**. A single incident produces:

- Alerts in Alertmanager
- Logs in Loki/CloudWatch
- Traces in Tempo/Jaeger/X-Ray
- Metrics in Prometheus/CloudWatch
- Notifications in Slack/Teams

Each tool is excellent in isolation. **The human is the integration layer.** That is the problem.

### Downstream consequences (also solved)

- **Alert noise without context** → on-call engineers ignore alerts because they cannot tell what matters
- **Slack/Teams notifications that do not help** → "Service X is down" with no trace ID, no recent deploys, no related alerts

These are symptoms of the root cause. Solving traceability solves them too.

---

## 4. Job To Be Done

> When an incident happens, I want to understand **what broke, where, and why** without manually crossing five tools — so I can act in minutes instead of arguing about ownership for an hour.

**Critical phrasing:** the user does not want "another alerting tool." The user wants **the cognitive load of correlation removed**.

---

## 5. What Makes Junando Different

| Capability | Traditional alerting | Junando |
|------------|---------------------|---------|
| Receives alerts | ✅ | ✅ |
| Routes to Slack/Teams | ✅ | ✅ |
| **Deduplicates intelligently** (fingerprint + clustering) | ⚠️ Basic | ✅ Domain-aware |
| **Correlates across logs, traces, metrics** | ❌ | ✅ Built-in |
| **LLM-based incident analysis** | ❌ | ✅ Pluggable (Claude, Gemini, OpenRouter) |
| **CorrelationId-driven traceability** | ❌ | ✅ End-to-end |
| **Drop-in for existing stack** (Loki, Prom, CW) | ❌ Reinvents | ✅ Consumes what you have |
| **Open architecture** (ports & adapters) | ❌ Vendor lock-in | ✅ Swap any component |

The differentiator is **not** the LLM by itself. It is the **architecture**: a clean correlation layer that you can plug into any existing stack and that uses the LLM to remove cognitive load — without forcing you to rebuild observability from scratch.

---

## 6. Anti-Goals — What Junando Will Never Be

These are explicit non-goals. Future contributions that move toward them will be rejected:

| Anti-goal | Why not |
|-----------|---------|
| ❌ **Not an APM** (Datadog, New Relic, Dynatrace) | Junando does not instrument your code. It consumes the signals you already collect. |
| ❌ **Not a Grafana replacement** | Grafana visualizes. Junando correlates and acts. They complement each other. |
| ❌ **Not another monitoring system** | Junando does not collect metrics or logs. It enriches what is already collected. |
| ❌ **Not a Slack/Teams replacement** | Notification channels remain owned by your team. Junando makes them smarter. |
| ❌ **Not a SaaS-first product** | Junando is self-hosted, open architecture. SaaS may come later but is not the primary mode. |

---

## 7. Success Criteria

How we know Junando is working — measurable outcomes for the primary ICP:

### Adoption metrics
- **Time-to-first-incident-processed**: < 30 minutes from `pnpm install` to a real alert correlated
- **Number of integrated sources per deployment**: target ≥ 2 (e.g., Loki + Prometheus)
- **Notification channels active**: target ≥ 1 (Slack or Teams)

### Value metrics (the real proof)
- **Incident triage time reduction**: target ≥ 40% vs baseline (measured by the team adopting Junando)
- **Cross-tool context switches per incident**: target ≤ 2 (vs 5+ baseline)
- **Alert noise reduction**: deduplication ratio ≥ 60% on production-grade traffic
- **On-call satisfaction**: qualitative — "I can act on alerts without dreading them"

### Product health metrics (Junando itself)
- Ingest pipeline p95 latency < 5s
- LLM enrichment success rate > 95%
- Notification delivery success rate > 99%

---

## 8. North Star

> **One sentence we measure ourselves against:**
> *"A mid-sized engineering team should be able to install Junando, plug in their existing Loki and Prometheus, and resolve their next cross-service incident with half the cognitive load."*

Every roadmap decision, every feature, every doc must serve that sentence. If it does not, it does not belong in Junando.

---

## Appendix — Related Documents

- [README](../../README.md) — product landing and quickstart
- `docs/product/value-proposition.md` *(coming in #80)* — measurable benchmark plan
- `docs/api-stability.md` *(coming in #82)* — public API guarantees
- `docs/compatibility-matrix.md` *(coming in #83)* — supported runtimes
