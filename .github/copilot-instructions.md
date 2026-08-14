# Copilot Instructions — Foundry Capital Markets Router

This file is the single entry point for agent context in this repository.

## Read these first, in order

1. `.specify/memory/constitution.md` — governing principles. This is the tiebreaker whenever a
   specification, a convention, or your own preference points a different way.
2. `specs/001-router-core/spec.md` — the feature being built, with acceptance criteria.
3. `specs/001-router-core/data-model.md` and `specs/001-router-core/contracts/` — the shapes you
   must conform to.
4. `specs/001-router-core/tasks.md` — the sequenced plan. Work the plan; do not freelance.

## What this project is

A demonstration for AI decision makers and trade leadership in a bank's capital markets
division, delivered 2026-09-10. It proves that agentic AI can run on a private, policy-governed
Azure footprint with cost-and-complexity routing, human approval gates, and attributable output,
across research, trade surveillance, and order routing.

It is a demo, but the controls are real. The credibility of those controls in front of a
compliance audience is the entire product. Weakening one to move faster defeats the purpose.

## Hard rules

These are not preferences. Violating one is a defect regardless of how well the code works.

1. **No consequential action executes without recorded human approval.** Propose, rank, draft,
   evidence — never commit. Expiry is not approval.
2. **No public data-plane endpoints.** `public_network_access_enabled = true` fails CI.
3. **Unattributable claims are withheld and reported, never guessed.**
4. **All model access goes through `router-service`.** No other service calls a model
   deployment. This is enforced at the network layer; do not attempt a shortcut.
5. **Managed identity only.** No connection strings, keys, SAS tokens, or shared secrets in
   source, config, images, or Terraform outputs.
6. **Synthetic data only.** Generators are committed; generated volume is gitignored.
7. **Segregation of duties.** The identity that proposes cannot be the identity that approves.

## Stack

| Concern | Choice |
|---|---|
| Services | C#, .NET 10, ASP.NET Core minimal APIs |
| UI | Vite + React + TypeScript |
| Compute | Azure Container Apps. No Kubernetes. |
| IaC | Terraform, two stacks: `infrastructure/` then `apps/` |
| Orchestration | Taskfile.dev only; `Taskfile.yml` includes `tasks/Taskfile.*.yml` |
| Models | Azure AI Foundry, hosted agents preferred over prompt agents |
| Multi-agent | Foundry Tools and MCP |
| State | Cosmos DB for NoSQL (system of record), Azure AI Search (retrieval) |
| Telemetry | Application Insights and Log Analytics |
| Gateway | APIM as AI gateway for metering, cost ceilings, content safety |

Central package management via `Directory.Packages.props`. Do not add `PackageReference`
versions inline.

## Conventions

- Every request carries a `correlationId` end to end. Every audit record is keyed by it.
- Router decision logic lives in a dedicated, dependency-free assembly so it can be
  exhaustively unit-tested. It is coverage-gated at 70%.
- Terraform: `infrastructure/` is platform and longer-lived; `apps/` is workloads and reapplied
  often. `apps/` reads platform values through `references.tf`, never by duplication.
- Guard `enable_private_networking` with `count` on networking resources, following the pattern
  in `infrastructure/network.tf`.
- ADRs in `docs/adr/NNN-slug.md`. Record the decision before the deviating code merges.

## When you are asked to do something that conflicts with the above

Say so, name the principle, and propose an ADR. Do not silently comply and do not silently
refuse. The constitution has an amendment path; use it.

## Definition of done

Lint and typecheck clean; router decision coverage at or above 70%; CodeQL, gitleaks, and
Checkov clean; no-public-endpoint policy job green; specs and ADRs updated to match reality.
