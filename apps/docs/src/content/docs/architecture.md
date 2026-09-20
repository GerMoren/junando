---
title: Architecture
description: Interactive AWS service topology and system deep dive for Junando.
---

Junando's AWS deployment topology, using official AWS Architecture Icons — showing every service in the pipeline (SQS, Lambda, DynamoDB, Bedrock, Slack/Teams) and how sync vs. async edges connect them.

<div style="border:1px solid var(--sl-color-gray-5);border-radius:0.75rem;overflow:hidden;margin:1.5rem 0;">
  <iframe
    src="/architecture/junando-architecture.html"
    title="Junando AWS architecture diagram"
    style="width:100%;height:80vh;min-height:640px;border:none;display:block;"
    loading="lazy"
  ></iframe>
</div>

[Open the diagram in a new tab ↗](/architecture/junando-architecture.html)

## Interactive overview

A second, more exploratory view of the same topology:

<div style="border:1px solid var(--sl-color-gray-5);border-radius:0.75rem;overflow:hidden;margin:1.5rem 0;">
  <iframe
    src="/architecture/junando-architecture-overview.html"
    title="Junando architecture — interactive overview"
    style="width:100%;height:80vh;min-height:640px;border:none;display:block;"
    loading="lazy"
  ></iframe>
</div>

[Open the interactive overview in a new tab ↗](/architecture/junando-architecture-overview.html)

## Deep dive

For the full write-up of each component and how data flows through them, see the [architecture deep dive](https://github.com/GerMoren/junando/blob/main/docs/architecture/system-deep-dive.md).
