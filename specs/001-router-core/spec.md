# Feature 001 — Router Core, Lanes, and Approval Gate

## Problem Statement

A bank's capital markets division cannot adopt agentic AI on the terms currently offered to it.
Three objections block every conversation:

1. **Compliance veto.** No one can demonstrate that the AI footprint is genuinely private — that
   model traffic and data planes never traverse the public internet, and that an unprivileged
   actor is actually stopped rather than merely discouraged.
2. **Unbounded and unexplainable spend.** Model costs are opaque. Leadership is asked to approve
   a budget with no per-request visibility and no enforcement mechanism, only a promise of
   prudence.
3. **Fear of ungoverned autonomy.** The prospect of an agent taking a consequential action —
   routing an order, closing a surveillance alert, publishing a research claim — without a human
   in the loop and without attributable evidence is a non-starter.

Today the division's analysts absorb the cost of these unresolved objections directly.
Surveillance analysts triage large alert queues dominated by false positives. Research analysts
hand-assemble syntheses and hand-verify every citation. Order routing decisions are made under
time pressure with incomplete cost and liquidity context. Agentic AI is the obvious remedy, and
it is unavailable to them because nobody has shown it operating under their constraints rather
than in spite of them.

This feature builds the demonstration that removes all three objections at once: a routing core
on a private Azure footprint, routing every model call by cost and task complexity, gating every
consequential action behind human approval, and attributing every factual claim to a source.

## Scope

### In Scope

- **router-service** — model tier selection, cost ceiling enforcement, decision recording,
  telemetry emission. The sole path to model access.
- **research-service** — retrieval-grounded synthesis with mandatory per-claim attribution and
  explicit refusal of unattributable claims.
- **surveillance-service** — bulk synthetic alert triage: ranking, evidence assembly, escalation
  memo drafting, all behind approval.
- **orderrouting-service** — order route proposal against a simulated OMS, with a best-execution
  policy boundary that halts for approval.
- **webui** — the live scoreboard: per-request cost, latency, model tier, routing rationale,
  quality signal, and the approval queue.
- Approval workflow with evidence packets and segregation-of-duties enforcement.
- Two-stack Terraform, private networking, Entra ID, RBAC, Key Vault, Container Apps.
- Synthetic data generators and seeded demo fixtures.

### Out Of Scope

Per constitution: real market data, real execution, fine-tuning, high availability and disaster
recovery, multi-region, real personal data, regulatory attestation.

## Jobs To Be Done

**JTBD-1 — Surveillance analyst.** When I face a queue of hundreds of overnight alerts, I want
the highest-risk ones surfaced first with evidence already assembled, so I can spend my morning
on the alerts that matter instead of clearing noise.

**JTBD-2 — Research analyst.** When I synthesise a view across many documents, I want every claim
traceable to its source and unsupported claims withheld rather than guessed, so I can publish
without personally re-verifying every sentence.

**JTBD-3 — Trading desk lead.** When an order needs routing, I want a proposed route with its
cost, liquidity, and best-execution rationale laid out, and I want to be the one who approves it,
so I retain accountability while losing the manual assembly work.

**JTBD-4 — AI decision maker.** When I evaluate agentic AI for the division, I want to see
per-request cost, model tier, and quality side by side, so I can commit to a budget I can defend
and prove savings rather than assert them.

**JTBD-5 — Compliance officer.** When AI is proposed for my division, I want to see private
networking, identity enforcement, segregation of duties, and a reconstructable audit trail
demonstrated live, so I can withdraw my objection on evidence rather than assurance.

## Acceptance Criteria

### AC-1 — Routing by cost and complexity

- **Given** an inbound task, **when** it reaches router-service, **then** a complexity score and
  a cost ceiling are computed before any model is invoked.
- **Given** a computed complexity score, **when** a tier is selected, **then** the decision record
  persists the score, the ceiling, the candidate tiers, the selected tier, and a human-readable
  rationale.
- **Given** a request whose projected cost exceeds its ceiling, **when** routing occurs, **then**
  the router downgrades tier or denies, and the reason is surfaced in the UI — never silently
  absorbed.
- **Given** any service other than router-service, **when** it attempts a direct model endpoint
  call, **then** the call fails at the network layer.

### AC-2 — Human-in-the-loop

- **Given** any consequential action, **when** an agent proposes it, **then** it enters the
  approval queue in PendingApproval and does not execute.
- **Given** a pending proposal, **when** it is presented for approval, **then** the evidence
  packet shows the inputs, the retrieved sources, the routing decision, and the proposed action.
- **Given** an approval decision, **when** it is recorded, **then** approver identity, timestamp,
  decision, and evidence-packet hash are persisted immutably.
- **Given** the identity that originated a proposal, **when** that same identity attempts to
  approve it, **then** the approval is rejected on segregation-of-duties grounds.
- **Given** a proposal that reaches its expiry, **when** the expiry elapses, **then** it
  transitions to Expired and never executes.

### AC-3 — Attribution or refusal

- **Given** a research synthesis, **when** it is returned, **then** every factual claim carries at
  least one citation resolving to a retrieved source chunk.
- **Given** a claim that cannot be grounded in retrieved sources, **when** synthesis completes,
  **then** the claim is withheld and reported in an explicit unattributableClaims list.
- **Given** any synthesis, **when** it renders, **then** attribution coverage is displayed as a
  percentage in the UI.
- **Given** retrieved content containing injected instructions, **when** it is processed, **then**
  no tool call is authorised from that content and the attempt is logged.

### AC-4 — Private by construction

- **Given** the cloud stack applied with defaults, **when** networking is inspected, **then** AI
  Foundry, Cosmos DB, Azure AI Search, Key Vault, and the container registry data planes are
  reachable only over private endpoints.
- **Given** a public-network access attempt against any data plane, **when** it is made from
  outside the VNet, **then** it fails, and the failure is demonstrable live.
- **Given** a pull request adding public data-plane access, **when** CI runs, **then** the
  no-public-endpoint policy job fails the build.
- **Given** any service, **when** it authenticates to Azure, **then** it uses managed identity and
  no secret is present in image, config, or Terraform output.

### AC-5 — Scoreboard

- **Given** a completed request, **when** the scoreboard refreshes, **then** cost, latency, model
  tier, routing rationale, and quality signal are visible within 5 seconds of completion.
- **Given** a batch of comparable requests, **when** the comparison view renders, **then**
  aggregate cost against a single-premium-tier baseline is shown with the delta as a percentage.
- **Given** a routing decision, **when** a user drills into it, **then** the full decision record
  including complexity inputs is displayed.

### AC-6 — Surveillance triage

- **Given** a synthetic alert batch of at least 500, **when** triage runs, **then** every alert
  receives a risk rank, a rationale, and an evidence set.
- **Given** the ranked queue, **when** it is presented, **then** ranking is reproducible for a
  fixed seed and input set.
- **Given** a high-risk alert, **when** escalation is proposed, **then** a drafted memo enters the
  approval queue and no alert state changes until approved.

### AC-7 — Order routing

- **Given** a synthetic order, **when** a route is proposed, **then** the proposal includes venue,
  projected cost, liquidity rationale, and best-execution justification.
- **Given** a proposal that breaches a policy boundary, **when** it is evaluated, **then** it
  halts with the breached policy named explicitly.
- **Given** an approved route, **when** it executes, **then** it executes against the simulated
  OMS only, and the UI labels it as simulated.

### AC-8 — Audit

- **Given** any demo interaction, **when** its correlationId is queried, **then** the full chain of
  agent actions, model calls, routing decisions, retrievals, and approvals is returned in one
  query.
- **Given** an audience member selecting an arbitrary past interaction, **when** it is queried
  live, **then** reconstruction succeeds without rehearsal.

## Test Ideas

**Unit — router decision logic (coverage-gated at 70%)**

- Complexity scoring boundaries: minimum, maximum, and each tier threshold.
- Cost ceiling: under, exactly at, and over; verify the downgrade-versus-deny branch.
- Tier selection determinism for identical inputs.
- Rationale string is non-empty and names the deciding factor for every branch.
- Unavailable preferred tier falls back predictably rather than throwing.

**Unit — approval workflow**

- Segregation of duties rejects self-approval.
- Expiry transitions to Expired and blocks execution.
- Evidence-packet hash changes when any packet field changes.
- State machine rejects illegal transitions.

**Unit — attribution**

- Claim with a resolving citation is emitted.
- Claim without a citation is withheld and listed as unattributable.
- Coverage percentage arithmetic across mixed claim sets.
- Injected-instruction content yields no tool authorisation.

**Contract**

- Router API request and response schemas against contracts/router-api.md.
- Approval API state transitions against contracts/approval-api.md.
- Cosmos document shapes against data-model.md.

**Integration**

- End-to-end research query produces a synthesis with resolvable citations.
- Surveillance batch of 500 completes and ranks reproducibly for a fixed seed.
- Order proposal breaching best execution halts with the policy named.
- Correlation ID spans all services in a single reconstruction query.

**Infrastructure policy**

- Terraform plan contains zero public data-plane exposures.
- Every service identity's role assignments are resource-scoped, never subscription-scoped.
- No Terraform output is marked non-sensitive while containing a credential pattern.
- Checkov high-severity findings are zero.

**End-to-end (Playwright)**

- Scoreboard renders cost, latency, and tier within 5 seconds of request completion.
- Approval queue: propose, approve as a second identity, verify execution.
- Self-approval attempt is blocked with a visible segregation-of-duties message.
- Unprivileged identity is denied the approval action.

**Demo rehearsal**

- task cloud:up from zero completes under 45 minutes unattended.
- Agent failure is demonstrable and honest: when a dependency is unreachable, the UI names the
  failed dependency rather than substituting a recorded result. No path renders simulated
  reasoning (ADR-007).

## Open Questions

1. **Scoreboard source of truth.** Application Insights is primary per SE preference, with a
   Cosmos change-feed fallback built behind configuration. Validated in T-014 against the AC-5
   five-second budget. Accepted as a hedge, not a settled decision.
2. **Quality signal method.** Deterministic signals chosen over LLM-as-judge for the primary
   on-screen number. See docs/adr/003-deterministic-quality-signal.md.
3. **Region.** Default eastus2, overridable per deployment via the region variable. Confirmed.
4. **Model catalog.** The catalog is multi-vendor and spans Azure OpenAI, Anthropic, xAI, and
   open-weight models served on Foundry managed compute (preview). Specific deployment names
   must be confirmed against availability in eastus2. See ADR 006.
5. **Governance layer.** Feature 002 supersedes the framing of this feature. See
   specs/002-governed-exchange/spec.md and docs/decisions-needed.md.

## Constitution Check

| Principle | Upheld | Notes |
|---|---|---|
| I. Human-in-the-loop | Yes | AC-2 |
| II. Private by construction | Yes | AC-4 |
| III. Attribution or refusal | Yes | AC-3 |
| IV. Routed by cost and complexity | Yes | AC-1 |
| V. Evidenced and auditable | Yes | AC-8 |
| VI. Synthetic data only | Yes | T-021 generators |
| VII. Identity without secrets | Yes | AC-4, T-009 |
