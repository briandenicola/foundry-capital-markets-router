# Incremental Tasks — Feature 001

Sequenced so that a demonstrable slice exists early and the riskiest unknowns resolve first.
Target: feature-complete 2026-09-05.

**Status key:** `[x]` complete and gated in CI · `[~]` partially delivered · unmarked = not started.
Last updated 2026-08-14.

## Phase 0 — Foundation (day 1 to 2)

- [x] **T-001** Repo scaffold via scripts/bootstrap-repo.mjs; Taskfile tree; Directory.Packages.props;
  global.json pinning the .NET SDK.
- [x] **T-002** Spec-kit assets under .specify, .github/agents, .github/prompts, and
  copilot-instructions.md.
- [x] **T-003** CI quality gate: lint, typecheck, coverage threshold, CodeQL, gitleaks, Checkov,
  no-public-endpoint policy job. The gate must be green before any feature code merges.
- [x] **T-004** Terraform remote state bootstrap and the local-state guard script.

## Phase 1 — Private platform (day 2 to 4) — riskiest, front-loaded

- **T-005** infrastructure stack: resource group, VNet, subnets, Log Analytics, Application
  Insights, container registry, Container Apps Environment with private networking enabled.
- **T-006** Private endpoints and private DNS zones for Cosmos, AI Search, Key Vault, the registry,
  and AI Foundry.
- **T-007** AI Foundry project, model deployments for the Economy, Standard, and Premium tiers, and
  the Foundry managed VNet. *(Terraform written: `infrastructure/model-deployments.tf` creates one
  serverless deployment per approved catalog entry across three vendors. Every model name, format,
  version, and SKU was verified against `az cognitiveservices model list` in eastus2, and
  `scripts/preflight-azure.sh` re-verifies them before any apply. **Unapplied** — nothing here is
  proven until it runs.)*
- **T-008** APIM as AI gateway: token metering, cost ceiling policy, content safety.
- **T-009** apps stack: managed identities, least-privilege role assignments, Entra app
  registration with the Approver, Router.Invoke, and Router.Read app roles.
- **T-010** **Prove the negative** — script a live public-access-denied demonstration. If this
  cannot be shown convincingly, the compliance narrative fails. Discover that now, not on 9/9.

## Phase 2 — Router core (day 4 to 7)

- [x] **T-011** router-service skeleton, health endpoint, correlation-ID middleware, Application
  Insights wiring. *(Done. Liveness at `/healthz/live` and readiness at `/healthz/ready` are
  deliberately separate — a readiness check that reports healthy while the decision store is
  unreachable hides the failure ADR-007 says must be surfaced. Telemetry is config-driven and
  managed-identity authenticated, with sampling disabled per ADR-004, and the host builds and runs
  its tests with no Azure resource in reach.)*
- [x] **T-012** Complexity scoring: pure, deterministic, exhaustively unit-tested. This is the
  coverage-gated assembly. *(Done — `Fcmr.Router.Decisions` at 93.6% line coverage.)*
- [x] **T-013** Tier selection and cost ceiling enforcement, including the downgrade-versus-deny
  branch. *(Done, and extended for multi-vendor catalogs. Two defects fixed in the process: the
  candidate list marked every same-tier model as selected, which would have mis-attributed
  scoreboard cost the moment Feature 002 put four vendors in one tier; and within-tier selection
  took the first match rather than the cheapest.)*
- [x] **T-014** Decision persistence to Cosmos. `CosmosRoutingDecisionStore` landed as a
  registration change, exactly as the port promised. Verified against the Cosmos DB Linux emulator
  in Docker (`task cosmos:up`, then `task cosmos:test`) — 13 tests covering round-trip
  serialisation, camelCase and enum-name storage, decimal precision, partition-key isolation,
  create-versus-upsert, the scoreboard window and ordering, and the readiness probe. Two deployment
  defects were found and fixed on the way: `COSMOS_ENDPOINT`/`COSMOS_DATABASE` bound to nothing
  (ASP.NET needs `Cosmos__AccountEndpoint`), and no Cosmos data-plane role assignments existed at
  all, so every read and write would have been a 403.
- **T-014a** The parts of T-014 that need a live subscription, split out rather than ticked off:
  managed-identity authentication, private-endpoint reachability and the container-scoped data-plane
  roles are all unverified, because the emulator implements none of them. Also here: running the
  persistence suite in CI against an emulator service container, and validating the Application
  Insights latency and sampling assumption against the AC-5 five-second budget. **The Cosmos
  change-feed fallback is still to be built behind configuration regardless.**
- [x] **T-015** POST /v1/route implemented against contracts/router-api.md, with contract tests.
  *(Done — HTTP-to-`RoutingPlanner.Plan()` translation only. The previous stub called
  `TierSelector` directly and so bypassed `PolicyGate`; that is fixed. Two contract gaps closed in
  ADR-009: `dataClassification` is required rather than defaulted, and the response states whether
  a model actually ran instead of leaving it to be inferred from a null.)*
- **T-016** GET /v1/scoreboard aggregation, including the Premium baseline delta.

## Phase 3 — Approval gate (day 7 to 9)

- [x] **T-017** Approval domain model, state machine, and evidence-packet hashing.
- [x] **T-018** Approval API per contract, with segregation-of-duties enforcement.
  `src/approvals-service` serves all four published operations. The proposing and deciding
  identities are read from the token's `oid` claim and refused if supplied in a request (ADR-011),
  so the segregation-of-duties check compares two values no caller can choose. All 65 contract
  cases pass, up from 13 failing. **The CI expiry recorded here has been discharged:**
  `contract-conformance` no longer carries `continue-on-error` and is now a required check.
- **T-018a** Expiry sweeper. Today a proposal past `expiresAt` is transitioned and audited the
  next time anyone touches it, which is correct but lazy: an abandoned proposal sits in the queue
  reading `PendingApproval` until someone looks. The queue is what the approver is shown on stage,
  so a background sweep is needed for it to be honest without a reader. Split out of T-018 rather
  than folded into it, because the API is complete and shipping it should not wait on the sweeper.
- **T-019** Append-only auditEvents, with a service identity holding no update or delete rights.
- **T-020** One-query correlation reconstruction endpoint satisfying AC-8.

## Phase 4 — Lanes (day 9 to 15, parallelisable)

- [x] **T-021** Synthetic data generators: research corpus, e-comms, order flow, blotters. Seeded and
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
  any prompt-only agent. Broken out below; see `docs/agent-architecture.md`.
  - **T-027a** **Spike first.** Stand up one trivial hosted agent and confirm the Foundry tool-count
    and step-depth limits, thread creation latency, and that the project identity can reach the
    router but not a model deployment. Everything else in this phase assumes all four. Discover it
    now, not during T-025.
  - **T-027b** Agent host pattern in the lane services: thread-per-request lifecycle, correlationId
    propagation into every tool call and router call, step budget with a halt-and-report path.
  - **T-027c** MCP tool server conventions: schema definition, identity, structured errors,
    idempotency, and the audit record emitted per tool call. One shared implementation; the lanes
    supply tools, not plumbing.
  - **T-027d** Research agent — `search_corpus`, `fetch_chunk`, `list_sources`. Refusal is a
    success path, not an error path.
  - **T-027e** Surveillance agent — `fetch_alert_batch`, `fetch_communications`,
    `fetch_trade_context`, `submit_for_approval`. Chunked concurrent scoring with bounded
    parallelism. **Ranking is applied by deterministic code from model-produced scores**, which is
    what makes AC-6 reproducibility achievable.
  - **T-027f** Order routing agent — `fetch_order`, `fetch_venue_liquidity`,
    `evaluate_best_execution_policy`, `submit_for_approval`. Policy evaluation is deterministic code
    the agent explains, not a judgement the agent makes.
  - **T-027g** Agent failure-mode matrix implemented and demonstrable: tool error, model timeout, no
    eligible model, step-budget exhaustion. **No silent retry on a different tier** — it would
    corrupt the cost figures the scoreboard claims.
  - **T-027h** Determinism harness: fixed seeds and pinned temperature so rehearsal runs are
    comparable. Transcripts are recorded **for evaluation and for out-of-product narration only**;
    no code path may replay one into the UI. ADR-007.

## Phase 5 — Scoreboard UI (day 12 to 17)

Twelve screens; see `docs/ui-design.md` for the inventory, component layout, and required states.
Three of the four wow moments are screens in this phase.

- **T-028** Vite, React, and TypeScript shell; Entra authentication; role-aware navigation.
  - [x] **T-028a** App shell, routing, error boundary, and the projector-grade type scale. Every screen
    has one number that is deliberately the largest thing on it.
  - **T-028b** MSAL auth, `Router.Invoke` / `Router.Read` / `Approver` role guards. Unauthorised
    navigation is hidden; unauthorised *actions* render disabled with a stated reason — Beat 6
    needs something visible to refuse.
  - [~] **T-028c** API client, token acquisition, and **types generated from `contracts/`**. Not
    hand-written; hand-written types drift and the drift surfaces on stage.
    *(Client and generated types done, gated by the `api-types` CI job. Token acquisition waits on
    T-028b. **Deviation:** types are generated from the C# records rather than from the contract
    JSON, because an example payload cannot distinguish an optional field from one that happened to
    be null — the C# type system already carries that information and the contract examples do not.)*
  - [x] **T-028d** The five required states as shared primitives: loading, empty, error, partial,
    degraded. Build these before the screens that need them.
  - **T-028e** Request console (screen 1), including data classification on the request.
- **T-029** Live scoreboard: cost, latency, tier, rationale, quality, within the five-second
  freshness budget.
  - **T-029a** Scoreboard view with TanStack Query 5s polling, `refetchOnWindowFocus` disabled, and
    a visible data timestamp rather than a spinner.
  - **T-029b** Decision detail (screen 4) showing the full record including complexity inputs.
  - **T-029c** **Measure AC-5 end to end.** If Application Insights cannot make the 5s budget,
    switch to the Cosmos change-feed fallback here — that is what ADR 004 built it for — and render
    the degraded-source label.
- **T-030** Comparison view: aggregate cost against the Premium baseline with a percentage delta.
  **Primary wow moment B.** One dominant number; per-request table drillable mid-sentence, with the
  rationale as a plain sentence naming the deciding factor.
- **T-031** Surveillance triage queue view. **Primary wow moment C.**
  - **T-031a** Virtualised 500+ row queue. Unvirtualised lists stutter on projector hardware and the
    stutter reads as "this does not scale."
  - **T-031b** Alert detail (screen 6) with evidence set and rationale.
  - **T-031c** Visible seed indicator supporting the AC-6 reproducibility claim on stage.
- [x] **T-032** Approval queue with evidence packet rendering and visible segregation-of-duties
  blocking. Screens 7 and 8. Blocked actions render disabled with the reason stated, never hidden.
  The client-side segregation check is a courtesy that saves an approver a pointless round trip;
  the service remains the control. With T-028b outstanding the current identity is null, and
  `evaluateApproval` refuses on a null identity rather than permitting — guessing would enable
  exactly what segregation of duties prevents.
- **T-033** Research view with inline citations, coverage percentage, and the unattributable-claims
  panel. **Secondary wow moment D.** The panel is always present and states "no unattributable
  claims" when empty — a panel that only appears on failure teaches the audience it is an error.
- [x] **T-034** Simulated-OMS labelling everywhere order execution appears, on the record itself so a
  screenshot out of context is still honest. Screen 10 renders proposal, policy halt, and execution
  refusal with equal weight; `SimulatedBadge` reads `execution.executionMode` off the stored record
  rather than a constant in the component. The execution panel forwards a retrieved approval record
  verbatim and never assembles one, and offers an explicit no-approval attempt so the gate can be
  seen refusing.
- **T-042** **Policy sets screen (screen 12).** Previously unscheduled. Beat 5 has to change policy
  *somewhere*, and doing it in the Azure portal breaks the claim that governance is a first-class
  surface. Read-mostly with a per-vendor approval toggle is sufficient.
- **T-043** Audit reconstruction view (screen 11) for Beat 8. Takes a correlationId and renders the
  full chain from the AC-8 endpoint. Must handle an arbitrary audience-chosen id with no special
  casing.

## Phase 6 — Hardening and rehearsal (day 17 to 22, to 9/5)

Task numbers T-042 and T-043 belong to Phase 5 above; Phase 6 keeps its original numbering so
existing references elsewhere in the repository stay valid.

- **T-035** Playwright end-to-end coverage of AC-2, AC-3, and AC-5.
- [x] **T-036** Terraform policy tests; Checkov clean; verify zero subscription-scoped roles.
  Checkov is at zero failures across both stacks: 20 passed, 7 skipped, each skip carrying its
  reason inline next to the resource it applies to rather than in a central list that decays away
  from the code. Six findings were real and fixed -- Cosmos key-metadata writes off, Key Vault
  purge protection on, ACR dedicated data endpoints, zone redundancy, and untagged-manifest
  retention. Of the seven skipped, one (CKV_AZURE_140) is a false positive against the current
  provider schema, four are disproportionate to a single-region demo over synthetic data, and two
  are genuine gaps carried forward as T-036a rather than dismissed.
  Subscription-scoped roles are now checked rather than inspected once, by
  scripts/policy-least-privilege-scope.sh, wired into CI, task lint, and the cloud:up guard. It
  fails closed on scope expressions it does not recognise, and refuses to pass if it matches no
  role assignments at all. Verified to reject resource-group, subscription-data-source, and
  literal /subscriptions/ scopes, not merely to pass on the current four.
- **T-036a** Image provenance. ACR content trust could not be enabled: Docker Content Trust was
  deprecated 2025-03-31 and Azure has refused to enable it on registries that did not already have
  it since 2026-05-31, so `trust_policy_enabled` would fail at apply. The successor is the Notary
  Project, and neither scheme signs images as part of `az acr build` -- signing is a separate
  pipeline step. Quarantine (CKV_AZURE_166) is blocked behind the same gap, because without a
  scanner to release images it would make every build unpullable. Sign images with notation in
  task app:build, then enable quarantine so unsigned images cannot be deployed. Until this lands,
  the demo cannot claim image provenance, only image privacy.
- **T-037** Coverage to at least 70% on router decision logic; close the gaps.
- **T-038** docs/architecture.md, docs/threat-model.md, and ADRs 001 onward.
- **T-039** Timed unattended task cloud:up from zero. Must land under 45 minutes.
- **T-040** **Honest-failure path**, rehearsed end to end. When a model or agent dependency is
  unreachable, every lane surfaces which dependency failed, what the request would have done, and
  the governed decision that was still made — rather than substituting a recorded result. Replaces
  the deleted no-Azure replay fallback (ADR-007). This is a real task, not the absence of one: the
  failure screens must be as rehearsed as the success screens, because they are now the thing that
  runs if 9/10 goes wrong.
- **T-041** Demo runbook: narrative beats, timings, failure recovery, seeded fixtures.

## 9/5 to 9/10 — Freeze

No feature work. Rehearsal, honest-failure drills, and bug fixes only.
