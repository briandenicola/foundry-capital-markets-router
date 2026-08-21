# Architecture

## Purpose

This system exists to make three claims demonstrable rather than assertable, in front of an
audience that has heard the assertions before: the footprint is private, the spend is governed,
and the agent cannot act alone.

Every architectural choice below serves one of those three claims. Where a choice makes the system
more elaborate without strengthening a claim, it has been left out.

> **This document describes the target architecture.** Parts of it are not built yet — the model
> invocation and the three lane services in particular. The README's
> [status table](../README.md#status--what-is-built-today) is authoritative about what exists
> today, and [`diagrams/05-src-architecture`](diagrams/05-src-architecture.svg) draws the gap
> rather than omitting it. Where this prose and the repository disagree, the repository is right.

## Diagrams

The drawn version of everything below, generated from `scripts/diagrams/` and drift-checked in CI:

| Diagram | Answers |
|---|---|
| [01 · Platform topology](diagrams/01-platform-topology.svg) | Where does everything run, and what is reachable from the internet? |
| [02 · Request decision flow](diagrams/02-request-decision-flow.svg) | What happens to one request, and in what order? |
| [03 · Agent architecture](diagrams/03-agent-architecture.svg) | Who are the agents, what may they touch, where does a human intervene? |
| [04 · UI screen map](diagrams/04-ui-screen-map.svg) | Which screen carries which demo beat? |
| [05 · `src/` code map](diagrams/05-src-architecture.svg) | What code exists today, and what is deliberately still empty? |

## Component view

```text
                          Entra ID  ·  RBAC  ·  app roles
                                      |
   webui (Vite/React)                 |
        |                             |
        +──────────────┐              |
        v              |              v
   router-service      |      APIM AI Gateway ────────> Azure AI Foundry     [not built]
        |    ^         |         metering                hosted agents
        |    |         |         cost ceilings           model tiers
        |    |         |         content safety          MCP tool surface
        |    |         |
        |    |         v
        |    |    approvals-service
        |    |         |  propose / approve, by two distinct identities
        |    |         |  segregation of duties enforced from the token
        |    |         v
        |    |    Cosmos DB — approvals, auditEvents (append-only)
        |    |
        |    +──────────────────────────────────┐
        v                                       |
   research-service      ──> Azure AI Search    |  [not built]
   surveillance-service  ──> Cosmos DB          |  all model calls        [not built]
   orderrouting-service  ──> simulated OMS      |  return through          [not built]
                                                |  the router
                              Cosmos DB  <──────+
                              routerDecisions — every outcome, including refusals

   Telemetry: Application Insights and Log Analytics
   Compute:   Azure Container Apps, inside the VNet
   Data:      every plane on a private endpoint
```

`webui` talks to exactly two services. `router-service` decides; `approvals-service` gates. Nothing
else is reachable from a browser.

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

## Persistence

Cosmos DB for NoSQL is the system of record. Six containers, declared once in
`infrastructure/cosmos.tf`:

| Container | Partition key | Holds |
|---|---|---|
| `routerDecisions` | `/correlationId` | Every routing outcome, including both refusal kinds |
| `approvals` | `/correlationId` | Proposals and their decisions |
| `auditEvents` | `/correlationId` | The append-only trail |
| `researchQueries` | `/correlationId` | Research lane requests |
| `orderProposals` | `/correlationId` | Order routing proposals |
| `surveillanceAlerts` | `/batchId` | Surveillance alerts, partitioned by batch rather than request |

Three details matter more than the schema.

**Every outcome is written, including the refusals.** A request denied on cost and a request that
found no policy-eligible vendor are both persisted with their rationale. A trail that records only
what succeeded cannot answer the question an auditor actually asks.

**Writes use `CreateItemAsync`, never upsert.** A duplicate `correlationId` must surface as a 409
rather than silently replacing an earlier decision. Persistence that quietly overwrites is not a
record.

**Data-plane access is a separate permission system from Azure RBAC.** Cosmos SQL role assignments
live in `apps/cosmos-roles.tf`, scoped to individual containers. Granting a management-plane role
does nothing for data access, and the resulting 403 reads like a network fault — which is exactly
the kind of failure that costs an hour on the day.

The store is reached through the `IRoutingDecisionStore` port, so the in-memory implementation and
the Cosmos one are interchangeable. The persistence tests run against a **real Cosmos engine** in
Docker rather than a fake, and fail with instructions when it is absent rather than skipping green.
The container definitions are duplicated in `tools/Fcmr.CosmosProvision` because Terraform cannot
reach the emulator; that duplication is guarded by `scripts/policy-cosmos-containers-match.sh`,
which fails the build if the two ever disagree.

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

That last claim is checked rather than remembered. `scripts/policy-least-privilege-scope.sh` fails
the build if any role assignment is scoped to a subscription, resource group, or management group,
and fails closed on a scope expression it does not recognise. The reason it is a script and not a
review item is that the quickest fix for a 403 is to widen the scope one level, and nothing in a
plan or an apply looks any different afterwards.

Human access is Entra ID with three app roles:

| Role | Grants |
|---|---|
| Router.Invoke | Service-to-service model access through the router |
| Router.Read | Read routing decisions and the scoreboard |
| Approver | Decide on pending proposals |

Segregation of duties is enforced in the approval service, not in the UI. The UI hides the button;
the API rejects the call. A demo audience will ask which one is real, and the answer needs to be
the API.

The identity that decides is read from the `oid` claim on the caller's token, never from the
request body. A body-supplied identity would make segregation of duties a naming convention — the
service would be checking a string the caller chose. See
[`adr/011-approval-identity-from-token.md`](adr/011-approval-identity-from-token.md).

The interesting case is not a caller who lacks the Approver role; refusing them proves nothing. It
is a caller who genuinely holds Approver attempting to approve a proposal they raised themselves,
and being refused on that specific proposal. That is the case the contract tests exercise.

Refusals are audited too. "Someone tried to approve their own proposal and was stopped" is
precisely the record a compliance reviewer comes looking for, so it is written rather than merely
returned as a 409.

## Data flow for a single request

1. The UI or a lane service issues a request carrying a `correlationId`.
2. `router-service` computes a complexity score from caller-supplied hints only — never inferred
   from model output — and resolves a cost ceiling.
3. The policy gate runs against the **full** catalog, excluding candidates by region, vendor
   approval, data classification, and cost. Each exclusion carries a reason written in prose fit
   to read aloud to a governance audience.
4. Only the policy-eligible candidates reach tier selection. The router picks among them, records
   the decision with its rationale, and calls through APIM.
5. APIM meters tokens, enforces the ceiling, and applies content safety.
6. Foundry executes the hosted agent, using MCP tools where the lane requires decomposition.
7. The lane service assembles a result. If the result implies a consequential action, it becomes
   a proposal in `PendingApproval` rather than an execution.
8. Every step writes an `auditEvents` record keyed by the same `correlationId`.
9. The scoreboard reflects cost, latency, tier, rationale, and quality within five seconds.

The order of steps 3 and 4 is load-bearing. Governance decides what is *permissible*; the router
then decides what is *appropriate* among the permissible. Reversed — selecting a cheap candidate
and then asking whether it is allowed — a cost optimisation could reach a model governance never
approved. The order is asserted by test, not left to code reading.

A refusal is a correct outcome, not an error. `RefusedByPolicy` returns HTTP 200 with a null
selection and a reason per excluded candidate, because modelling it as a 4xx would invite retry-on-
error, and a retry that finds an unapproved model is the one thing that must never happen. A denial
on cost is kept distinct from a denial on policy: "too expensive" and "not permitted" are different
conversations with different people.

Step 7 is the whole of the third claim. The agent produces a proposal and an evidence packet. A
human, holding a different identity from the proposer, produces the decision. Expiry is not
approval: a proposal decided after its `expiresAt` is expired, persisted as expired, audited, and
refused with a 410.

Steps 5 and 6 are **not built**. Today the route response reports `InferenceState.NotInvoked`, and
by [`adr/007-no-simulated-agent-reasoning.md`](adr/007-no-simulated-agent-reasoning.md) it will
never report anything else until a model is genuinely called. When a dependency is unreachable the
system names it and refuses; it does not substitute a recorded result.

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
- **No image provenance.** Images are private — the registry has no public endpoint and pulls run
  over a private endpoint — but they are not signed. ACR content trust could not be enabled: Docker
  Content Trust was deprecated in 2025 and Azure stopped permitting it on new registries in May
  2026, and its successor, the Notary Project, signs as a separate pipeline step that `az acr
  build` does not perform. Registry quarantine is blocked behind the same gap, because without a
  scanner to release images it would make every build unpullable. Tracked as T-036a. Until it
  lands, this system can claim image *privacy* and not image *provenance*, and the distinction is
  worth stating plainly to an audience that will know the difference.
