# Architecture

## Purpose

This system exists to make three claims demonstrable rather than assertable, in front of an
audience that has heard the assertions before: the footprint is private, the spend is governed,
and the agent cannot act alone.

Every architectural choice below serves one of those three claims. Where a choice makes the system
more elaborate without strengthening a claim, it has been left out.

## Component view

```text
                        Entra ID  ·  RBAC  ·  app roles
                                    |
   webui (Vite/React)               |
        |                           |
        v                           v
   router-service  ────────>  APIM AI Gateway  ────────>  Azure AI Foundry
        |    ^                  metering                  hosted agents
        |    |                  cost ceilings             model tiers
        |    |                  content safety            MCP tool surface
        |    |
        |    +──────────────────────────────────┐
        v                                       |
   research-service      ──> Azure AI Search    |
   surveillance-service  ──> Cosmos DB          | all model calls
   orderrouting-service  ──> simulated OMS      | return through the router
                                                |
                              Cosmos DB  <──────+
                              (decisions, approvals, audit)

   Telemetry: Application Insights and Log Analytics
   Compute:   Azure Container Apps, inside the VNet
   Data:      every plane on a private endpoint
```

## The router is a chokepoint by design

`router-service` is the only component permitted to reach a model deployment. This is not a
convention enforced by code review; it is enforced by network policy. The lane services have no
route to the Foundry data plane.

That chokepoint is what makes the second claim demonstrable. Because every model call passes
through one place, cost, latency, tier, and rationale can be captured for every call without
exception, and the scoreboard can state a total rather than a sample.

It is also what makes the cost ceiling enforceable rather than advisory. A ceiling that services
could bypass would be a reporting feature. A ceiling at a chokepoint the services cannot route
around is a control.

## Two Terraform stacks

`infrastructure/` holds the platform: resource group, VNet and subnets, private DNS, private
endpoints, Container Apps Environment, container registry, Cosmos, AI Search, Key Vault, AI
Foundry, Log Analytics, and Application Insights. It changes rarely and takes a long time to
apply.

`apps/` holds the workloads: container apps, managed identities, role assignments, and the Entra
app registration. It changes constantly during a compressed build.

Separating them means a routine service redeploy does not risk a plan against the network. During
a three-week build with a fixed demo date, that risk asymmetry matters more than the convenience
of a single apply. See `adr/002-two-stack-terraform.md`.

`apps/` reads platform values through `references.tf` using remote state data sources. Values are
never duplicated between stacks.

## Private networking

`enable_private_networking` defaults to true and gates the networking resources with `count`,
following the reference pattern. Every data plane — Foundry, Cosmos, AI Search, Key Vault, the
registry — is reachable only through a private endpoint with a corresponding private DNS zone
linked to the VNet.

The only public surface is the demo UI front door. Everything behind it is internal ingress.

A CI job fails the build if any resource in either stack declares public data-plane access. The
control is therefore continuous, not a one-time configuration that drifts.

## Identity

Every service runs as a user-assigned managed identity with resource-scoped role assignments. No
service holds a subscription-scoped role. There are no connection strings anywhere in the system.

Human access is Entra ID with three app roles:

| Role | Grants |
|---|---|
| Router.Invoke | Service-to-service model access through the router |
| Router.Read | Read routing decisions and the scoreboard |
| Approver | Decide on pending proposals |

Segregation of duties is enforced in the approval service, not in the UI. The UI hides the button;
the API rejects the call. A demo audience will ask which one is real, and the answer needs to be
the API.

## Data flow for a single request

1. The UI or a lane service issues a request carrying a `correlationId`.
2. `router-service` computes a complexity score and resolves a cost ceiling.
3. The router selects a tier, records the decision with its rationale, and calls through APIM.
4. APIM meters tokens, enforces the ceiling, and applies content safety.
5. Foundry executes the hosted agent, using MCP tools where the lane requires decomposition.
6. The lane service assembles a result. If the result implies a consequential action, it becomes
   a proposal in `PendingApproval` rather than an execution.
7. Every step writes an `auditEvents` record keyed by the same `correlationId`.
8. The scoreboard reflects cost, latency, tier, rationale, and quality within five seconds.

Step 6 is the whole of the third claim. The agent produces a proposal and an evidence packet. A
human, holding a different identity from the proposer, produces the decision.

## Quality signal

Each lane reports a deterministic quality number: attribution coverage for research, rank
agreement against a seeded ground truth for surveillance, and policy conformance for order
routing.

None of these is an LLM-as-judge score. In front of a compliance audience, a model-graded number
invites an obvious objection and the demo loses the room defending it. Deterministic numbers can
be recomputed by the audience. See `adr/003-deterministic-quality-signal.md`.

## Observability

Application Insights is the primary scoreboard source, with sampling disabled for router and
approval telemetry. Cosmos remains the system of record for anything that must be auditable,
because sampled telemetry cannot underwrite an audit claim.

A Cosmos change-feed fallback for the scoreboard is built regardless, behind configuration. If the
Application Insights ingestion latency misses the five-second budget under load, switching is a
configuration change rather than a rewrite. See `adr/004-appinsights-scoreboard-with-cosmos-fallback.md`.

## What this architecture deliberately does not do

- No Kubernetes. Container Apps carries the workload, and a cluster would add operational surface
  that serves none of the three claims. See `adr/001-container-apps-over-aks.md`.
- No high availability, disaster recovery, or multi-region. The demo environment is ephemeral.
- No real execution. The OMS is simulated and labelled as such everywhere it appears.
- No fine-tuning. Routing and retrieval carry the quality argument.
