# Incremental Tasks — Feature 001

Sequenced so that a demonstrable slice exists early and the riskiest unknowns resolve first.
Target: feature-complete 2026-09-05.

## Phase 0 — Foundation (day 1 to 2)

- **T-001** Repo scaffold via scripts/bootstrap-repo.mjs; Taskfile tree; Directory.Packages.props;
  global.json pinning the .NET SDK.
- **T-002** Spec-kit assets under .specify, .github/agents, .github/prompts, and
  copilot-instructions.md.
- **T-003** CI quality gate: lint, typecheck, coverage threshold, CodeQL, gitleaks, Checkov,
  no-public-endpoint policy job. The gate must be green before any feature code merges.
- **T-004** Terraform remote state bootstrap and the local-state guard script.

## Phase 1 — Private platform (day 2 to 4) — riskiest, front-loaded

- **T-005** infrastructure stack: resource group, VNet, subnets, Log Analytics, Application
  Insights, container registry, Container Apps Environment with private networking enabled.
- **T-006** Private endpoints and private DNS zones for Cosmos, AI Search, Key Vault, the registry,
  and AI Foundry.
- **T-007** AI Foundry project, model deployments for the Economy, Standard, and Premium tiers, and
  the Foundry managed VNet.
- **T-008** APIM as AI gateway: token metering, cost ceiling policy, content safety.
- **T-009** apps stack: managed identities, least-privilege role assignments, Entra app
  registration with the Approver, Router.Invoke, and Router.Read app roles.
- **T-010** **Prove the negative** — script a live public-access-denied demonstration. If this
  cannot be shown convincingly, the compliance narrative fails. Discover that now, not on 9/9.

## Phase 2 — Router core (day 4 to 7)

- **T-011** router-service skeleton, health endpoint, correlation-ID middleware, Application
  Insights wiring.
- **T-012** Complexity scoring: pure, deterministic, exhaustively unit-tested. This is the
  coverage-gated assembly.
- **T-013** Tier selection and cost ceiling enforcement, including the downgrade-versus-deny
  branch.
- **T-014** Decision persistence to Cosmos plus telemetry. **Validate the Application Insights
  latency and sampling assumption here against the AC-5 five-second budget, and build the Cosmos
  change-feed fallback behind configuration regardless.**
- **T-015** POST /v1/route implemented against contracts/router-api.md, with contract tests.
- **T-016** GET /v1/scoreboard aggregation, including the Premium baseline delta.

## Phase 3 — Approval gate (day 7 to 9)

- **T-017** Approval domain model, state machine, and evidence-packet hashing.
- **T-018** Approval API per contract, segregation-of-duties enforcement, and the expiry job.
- **T-019** Append-only auditEvents, with a service identity holding no update or delete rights.
- **T-020** One-query correlation reconstruction endpoint satisfying AC-8.

## Phase 4 — Lanes (day 9 to 15, parallelisable)

- **T-021** Synthetic data generators: research corpus, e-comms, order flow, blotters. Seeded and
  reproducible.
- **T-022** AI Search index and ingestion for the research corpus.
- **T-023** research-service: retrieval-grounded synthesis, per-claim attribution, unattributable
  refusal, coverage metric.
- **T-024** Prompt-injection defence: retrieved content holds no tool authority; detections logged.
- **T-025** surveillance-service: 500-alert batch triage, reproducible ranking, evidence assembly,
  escalation memo drafting behind approval.
- **T-026** orderrouting-service: simulated OMS, route proposal, best-execution policy boundary
  halt.
- **T-027** Hosted Foundry agents for each lane and the MCP tool surface. An ADR is required for
  any prompt-only agent.

## Phase 5 — Scoreboard UI (day 12 to 17)

- **T-028** Vite, React, and TypeScript shell; Entra authentication; role-aware navigation.
- **T-029** Live scoreboard: cost, latency, tier, rationale, quality, within the five-second
  freshness budget.
- **T-030** Comparison view: aggregate cost against the Premium baseline with a percentage delta.
  **Primary wow moment B.**
- **T-031** Surveillance triage queue view. **Primary wow moment C.**
- **T-032** Approval queue with evidence packet rendering and visible segregation-of-duties
  blocking.
- **T-033** Research view with inline citations, coverage percentage, and the unattributable-claims
  panel. **Secondary wow moment D.**
- **T-034** Simulated-OMS labelling everywhere order execution appears.

## Phase 6 — Hardening and rehearsal (day 17 to 22, to 9/5)

- **T-035** Playwright end-to-end coverage of AC-2, AC-3, and AC-5.
- **T-036** Terraform policy tests; Checkov clean; verify zero subscription-scoped roles.
- **T-037** Coverage to at least 70% on router decision logic; close the gaps.
- **T-038** docs/architecture.md, docs/threat-model.md, and ADRs 001 onward.
- **T-039** Timed unattended task cloud:up from zero. Must land under 45 minutes.
- **T-040** Local no-Azure fallback path, rehearsed end to end.
- **T-041** Demo runbook: narrative beats, timings, failure recovery, seeded fixtures.

## 9/5 to 9/10 — Freeze

No feature work. Rehearsal, fallback drills, and bug fixes only.
