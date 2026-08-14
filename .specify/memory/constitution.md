# Foundry Capital Markets Router Constitution

## Mission

Prove that a bank's capital markets division can run agentic AI on a private, policy-governed
Azure footprint where every model call is routed by cost and task complexity, every consequential
action passes a human approval gate, and every claim is attributable — demonstrated live across
research, trade surveillance, and order routing.

## Audience

AI decision makers and trade leadership within a bank's capital markets division.
Secondary: the compliance and risk stakeholder who holds veto power over AI adoption.

## Core Principles

### I. Human-In-The-Loop (NON-NEGOTIABLE)

No consequential action executes without explicit human approval. A consequential action is any
action that would, in production, move an order, close or escalate a surveillance alert, or
publish research to a client. The agent may propose, rank, draft, and evidence — it may not
commit. Every approval is persisted with approver identity, timestamp, decision, and the full
evidence packet presented at decision time. An unapproved proposal expires; it never
auto-executes on timeout.

### II. Private By Construction (NON-NEGOTIABLE)

All Azure data-plane traffic traverses private endpoints inside a customer VNet. No workload has
public inbound ingress except the single demo UI front door. No workload has unrestricted public
egress. The `enable_private_networking` variable defaults to true; setting it false is a local
development affordance only and must be impossible in the cloud stack. A CI policy test fails the
build if any Terraform resource declares public data-plane access.

### III. Attribution Or Refusal (NON-NEGOTIABLE)

Every factual claim in a research or surveillance output carries a citation to a retrieved source
chunk. Claims that cannot be attributed are withheld and explicitly reported as unattributable,
never silently emitted. Coverage of attributed claims is measured and surfaced in the UI, not
merely logged.

### IV. Applications Never Select Models (NON-NEGOTIABLE)

No application, service, or prompt names a model, a vendor, or a deployment. Callers submit a
business request with its intent, its cost ceiling, and its data classification; the exchange
decides what executes it.

Governance policy — the approved vendor catalog, per-vendor data classification limits, region
restrictions, and cost ceilings — is evaluated **before** cost and complexity selection, and every
exclusion carries a human-readable reason. Policy decides what is permissible; the router then
decides what is appropriate among the permissible. Reversing that order would let a cost
optimisation reach a model governance has not approved.

The test of this principle is concrete and demonstrable: disabling a vendor in policy must change
which model executes an unchanged request from an unchanged application. If a code change,
redeploy, or prompt edit is required to swap a vendor, this principle is violated. Models are
temporary; governance is strategic.

### V. Routed By Cost And Complexity

Every model invocation passes through the router. From the policy-approved candidates, the router
selects using an assessed task-complexity score and an enforced cost ceiling, records the decision
with its inputs and rationale, and emits telemetry. No service may call a model deployment
directly. Routing rationale is visible in the UI at demo time, not buried in logs.

### VI. Evidenced And Auditable

Every agent action, model call, routing decision, retrieval, and approval writes an immutable
audit record correlated by a single correlationId spanning the request lifecycle. The audit trail
is reconstructable end-to-end for any single demo interaction within one query.

### VII. Synthetic Data Only

The repository and every deployed environment contain synthetic data exclusively. No real market
data, no real counterparties, no real personal data, no anonymised production extracts. Synthetic
generators are committed; generated volume artifacts are not.

### VIII. Identity Without Secrets

All service-to-service and service-to-Azure authentication uses Entra ID managed identity with
least-privilege RBAC. No connection strings, API keys, or shared secrets in code, config,
container images, or Terraform outputs. Key Vault holds only what genuinely cannot be
managed-identity-authenticated, and CI fails on any committed secret.

## Scope

### In Scope

- A routing core (router-service) fronting all model access: a governance policy gate over a
  multi-vendor approved catalog, then selection keyed on cost and task complexity.
- Three demonstrable lanes: research-service, surveillance-service, orderrouting-service.
- A live scoreboard UI showing per-request cost, latency, model tier, and quality signal.
- Human approval workflow with evidence packets, spanning all three lanes.
- Private Azure footprint: VNet, private endpoints, Entra ID, RBAC, Key Vault, Container Apps.
- Azure AI Foundry hosted agents; Foundry Tools and MCP for multi-agent decomposition.
- Synthetic data generators for research documents, e-comms, order flow, and blotters.
- Terraform IaC in two stacks; Taskfile-driven build, deploy, and teardown.

### Out Of Scope

- Real market data feeds of any kind.
- Real order execution. The OMS is simulated and clearly labelled as such in the UI.
- Model fine-tuning or continued pretraining.
- Production high availability, disaster recovery, or multi-region topology.
- Real customer personal data, material non-public information, or any production data extract.
- Regulatory certification claims. The demo simulates a regulated posture; it does not attest
  to one.

## Realism Checklist

The demo is only credible to a regulated capital markets audience if all of these are
demonstrably true on the day:

1. **Data** — every artifact is synthetic and generated by committed code; provenance is
   demonstrable on request; no production extract exists anywhere in the environment.
2. **Identity** — Entra ID authenticates the demo operator; app roles gate the approval action;
   an unprivileged identity is shown being denied an approval, live.
3. **Network** — the AI Foundry, Cosmos DB, Azure AI Search, Key Vault, and container registry
   data planes are reachable only over private endpoints; a public-network access attempt is
   shown failing, live.
4. **Integrations** — Azure AI Foundry, APIM as AI gateway, Cosmos DB, Azure AI Search, Log
   Analytics, and Application Insights are all real deployed Azure resources, not mocks.
5. **Constraints** — cost ceilings are enforced by the gateway and the router, not merely
   reported; exceeding a ceiling produces a visible, explainable denial or downgrade.
6. **Controls** — segregation of duties is enforced: the identity that proposes an action cannot
   be the identity that approves it.
7. **Audit** — any single demo interaction can be reconstructed end-to-end from the audit trail
   in one query, on stage, from an unrehearsed pick by the audience.

## Quality Gate And Definition Of Done

A change is not done until all of the following pass in CI on the pull request:

1. **Lint and typecheck clean** — dotnet format verification, C# analyzers as errors, ESLint and
   tsc for the Vite UI, terraform fmt and validate for both stacks.
2. **Test coverage** — line coverage of the router decision logic assembly is at least 70%,
   enforced by threshold, not reported. Coverage below threshold fails the build.
3. **Code scanning** — CodeQL for C# and JavaScript or TypeScript reports no new high or critical
   alerts. Dependabot is enabled for NuGet, npm, Terraform, GitHub Actions, and Docker.
4. **Secrets policy** — gitleaks scans full history and diff and reports zero findings.
5. **IaC scan** — Checkov runs against both Terraform stacks with no failed high-severity checks.
6. **No-public-endpoint policy test** — a dedicated CI job fails the build if any resource in
   either stack exposes a public data-plane endpoint.

## Delivery Constraints

- Build complete by 2026-09-05. Demo delivered 2026-09-10. Feature work stops on 9/5; the period
  from 9/5 to 9/10 is rehearsal, hardening, and fallback preparation only.
- The full environment must stand up from zero via `task cloud:up` and tear down via
  `task cloud:down`, unattended, in under 45 minutes.
- A local, no-Azure fallback path must exist and be rehearsed, in case cloud access fails on the
  day. The fallback is explicitly labelled as such in the UI and never presented as the
  private-posture proof.

## Engineering Guardrails

- .NET 10, C#, minimal APIs. Central package management via Directory.Packages.props.
- Vite, React, and TypeScript for the scoreboard UI.
- Terraform in two stacks: infrastructure (platform, longer-lived) and apps (workloads,
  frequently reapplied). Remote state; local state is guarded against by a CI script.
- Taskfile.dev is the only supported entry point for build, deploy, test, and teardown.
- Azure Container Apps is the compute platform. No Kubernetes.
- Hosted Foundry agents are preferred over prompt-only agents. A prompt agent requires a recorded
  ADR justifying why a hosted agent was insufficient.
- Multi-agent decomposition uses Foundry Tools and MCP. Bespoke orchestration protocols require
  an ADR.
- Every architecturally significant decision is recorded as an ADR in docs/adr.

## Security And Privacy Guardrails

- Managed identity everywhere; zero standing secrets.
- Least-privilege RBAC scoped per service identity. No service uses a subscription-scoped role.
- All model traffic transits APIM as AI gateway for token metering, cost ceilings, and
  content-safety enforcement. Direct model endpoint calls from services are forbidden and blocked
  by network policy, not merely by convention.
- Prompt injection is treated as an active threat: retrieved content is never granted tool-call
  authority, and the approval gate is the final backstop.
- Audit records are append-only and retained for the life of the demo environment.

## Context Discipline

- The file .github/copilot-instructions.md is the single entry point for agent context.
- Specs live in specs/NNN-slug. The constitution is the tiebreaker when a spec conflicts with an
  implementation preference.
- Any deviation from this constitution requires an ADR recorded before the deviating code merges.

## Governance

This constitution supersedes all other practices. All pull requests must verify compliance.
Complexity must be justified in an ADR. Amendments require an ADR, an updated version, and a note
in this document's history.

**Version**: 1.0.0 | **Ratified**: 2026-08-14 | **Last Amended**: 2026-08-14
