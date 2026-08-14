# Data Model — Feature 001

Store: **Azure Cosmos DB for NoSQL**, private endpoint only, managed identity authentication.
Telemetry: **Application Insights** and **Log Analytics**.

## Source-of-truth decision

The scoreboard reads from **Application Insights** as the primary source, per SE preference.
Cosmos remains the durable system of record for decisions, approvals, and audit, because
Application Insights sampling and ingestion latency are unsuitable for an audit trail and for the
reconstruct-any-interaction-in-one-query acceptance criterion.

Mitigation for the Application Insights risk, validated in T-014 before 9/5:

- Sampling disabled for router and approval telemetry.
- Ingestion latency measured against the AC-5 five-second budget.
- If latency or sampling fails the budget, the scoreboard falls back to the Cosmos change feed.
  This fallback is built regardless, so the switch is a configuration change, not a rewrite.

## Containers

Feature 002 extends this model: it adds the `policySets` container and further fields to
`routerDecisions` and `auditEvents`. Those additions are reflected inline below, because a reader
of this file alone must not conclude that routing is ungoverned or that a governance refusal is
stored as a cost denial. See `specs/002-governed-exchange/data-model.md` for `policySets` itself.

### routerDecisions

Partition key: /correlationId

The stored document is **not flat**. An envelope carries the request identity and timing, and the
routing decision is nested beneath it as a `decision` object — the same shape
`POST /v1/route` returns and `GET /v1/decisions/{correlationId}` replays. Ground truth is
`src/router-service/Persistence/RoutingDecisionStore.cs` and
`src/Fcmr.Router.Decisions/RoutingDecision.cs`.

**Envelope**

| Field | Type | Notes |
|---|---|---|
| id | string | GUID |
| correlationId | string | Partition key. Spans the whole request lifecycle |
| lane | enum | Research, Surveillance, OrderRouting |
| taskKind | string | For example synthesize, triage, proposeRoute |
| complexityInputs | object | The signals that produced the score: inputTokenEstimate, requiresMultiStep, requiresRetrieval, requiresToolCalls. Kept so a decision can be re-derived, not merely re-read |
| decision | object | The routing decision. See below |
| latencyMs | number, nullable | End to end. Null until measured |
| createdAt | string | ISO-8601 UTC |

**decision**

| Field | Type | Notes |
|---|---|---|
| complexityScore | number | 0.0 to 1.0 |
| costCeilingUsd | number | Enforced ceiling for this request |
| outcome | enum | **Routed, Downgraded, Denied, RefusedByPolicy.** See Outcome semantics below |
| selectedTier | enum, nullable | Economy, Standard, Premium. Null on any non-routed outcome |
| selectedDeployment | string, nullable | Foundry deployment name. Null on any non-routed outcome |
| selectedVendor | enum, nullable | AzureOpenAI, Anthropic, XAI, OpenWeight. Null on any non-routed outcome |
| candidateTiers | array | Every tier considered: tier, deployment, projectedCostUsd, vendor, selected, rejectedReason |
| rationale | string | Human-readable, shown in the UI. Must name the deciding factor |
| policySetId | string, nullable | Which policy set governed this decision |
| policySetVersion | number, nullable | Pinned at decision time, so a later policy edit cannot rewrite history |
| dataClassification | enum, nullable | Public, Internal, Confidential, Restricted. Declared by the caller, never inferred and never defaulted |
| policyExclusions | array | Every candidate governance removed, each with a kind and a reason. See below |

**policyExclusions[]**

| Field | Type | Notes |
|---|---|---|
| deployment | string | The candidate that was excluded |
| vendor | enum | Its vendor |
| kind | enum | VendorNotApproved, ClassificationExceeded, RegionNotPermitted, PolicyCostCeiling |
| reason | string | Prose fit to read aloud to a governance audience. Never an error code, never "policy" |

`kind` is what keeps a candidate dropped on **price** (`PolicyCostCeiling`) distinguishable from
one dropped on **principle** (the other three) once every exclusion is reduced to prose. Without
it, a request refused purely on cost is indistinguishable in the record from one refused on
governance grounds — the same collapse `RefusedByPolicy` exists to prevent, one level down.
`specs/002-governed-exchange/data-model.md` and `contracts/router-api-policy-extension.md` both
still describe an exclusion as `{ deployment, vendor, reason }`; the code has carried `kind` since
`PolicyGate` was written. Recorded here as a documentation gap, not a design question.

`policySetVersion` matters more than it looks. Without it, replaying an audit record after a policy
edit would show a decision that appears to violate the policy in force, which is exactly the
finding an auditor escalates.

**Fields that depend on a model call.** `promptTokens`, `completionTokens`, `actualCostUsd`,
`baselineCostUsd`, and `qualitySignal` are measured only when a model actually runs, and are
carried on the response's `metrics` object. They are **null until measured, never zero and never
estimated**: a plausible-looking token count is indistinguishable from a real one, and the
scoreboard's only job is to be believed. Every 200 also carries an `inference` object stating
whether a model ran at all. See ADR-007 and `contracts/router-api.md`.

**Known gap.** `executionRegion` is accepted on the request and evaluated by the policy gate, but
is not persisted as its own field. It survives only inside the prose of a `RegionNotPermitted`
exclusion, so "which region was this decision evaluated for?" is not answerable by query on a
routed request. Raised for T-014 rather than silently papered over here.

### Outcome semantics — Denied and RefusedByPolicy are not the same event

A reader of this document must not leave it thinking a governance refusal is stored as `Denied`.
The two outcomes answer different questions, are owned by different people, and produce different
conversations:

| Outcome | Meaning | Status | Whose decision | The conversation it starts |
|---|---|---|---|---|
| Routed | Executed at the tier complexity indicated | 200 | The router | None |
| Downgraded | Executed at a cheaper tier because the ceiling required it | 200 | The router | "Did quality hold?" — the scoreboard answers it |
| **Denied** | **Too expensive.** Nothing affordable within the cost ceiling | 402 `CostCeilingExceeded`, or 503 `NoTierAvailable` when no permitted tier is available at all | Whoever owns the budget | "Raise the ceiling, or accept a cheaper tier" |
| **RefusedByPolicy** | **Not permitted.** Governance left no eligible model | **200** | Whoever owns the policy set | "Approve a vendor, or raise the classification limit" — never a budget conversation |

`RefusedByPolicy` is a **successful, governed outcome carried on a 200**, never an error status.
Modelling a refusal as a failure invites retry-on-error logic, and the one retry that must never
succeed is the one that finds a model governance has not approved.

Collapsing these two into one value — or documenting only `Denied`, as this file previously did —
erases the distinction the entire demonstration rests on: that the exchange refuses work on
governance grounds, visibly, and says so in language a compliance officer can act on. Every
`RefusedByPolicy` record carries a fully populated `policyExclusions` array naming each vendor and
why, because "refused by policy" is not an answer this audience accepts.

### approvals

Partition key: /correlationId

Ground truth is `src/Fcmr.Approvals.Domain/`. The aggregate has no public constructor: records are
created by `Approval.Propose`, changed only by `ApprovalStateMachine`, and read back from this
container by `Approval.Rehydrate`, which refuses documents that contradict themselves.

| Field | Type | Notes |
|---|---|---|
| id | string | GUID |
| correlationId | string | Partition key |
| lane | enum | Research, Surveillance, OrderRouting |
| proposedAction | object | kind, summary, and lane-specific fields. A **projection** of evidencePacket.proposedAction, which is authoritative — the hash covers the packet, so a divergent copy here is tamper evidence, not a second opinion |
| evidencePacket | object | Everything presented to the approver. See below |
| evidencePacketHash | string | SHA-256, lowercase hex, over the **canonical form** of the packet (`fcmr-evidence-canonical-v1`), pinned at proposal time |
| state | enum | PendingApproval, Approved, Rejected, Expired |
| proposedByObjectId | string | Entra object ID of the originating identity. Never null |
| decidedByObjectId | string | Null until decided. **Always null on Expired** |
| decisionReason | string | Required on rejection, optional on approval, always null on expiry |
| expiresAt | string | ISO-8601 UTC |
| createdAt | string | ISO-8601 UTC |
| decidedAt | string | Set when the state left PendingApproval — including on expiry, where it records when the expiry was observed, not a decision |

**evidencePacket**

| Field | Type | Notes |
|---|---|---|
| correlationId | string | Inside the hash, so a packet cannot be moved between interactions |
| lane | enum | |
| inputs | map<string,string> | The request as received |
| retrievedSources | array | documentId, chunkId, excerpt, score — the text actually shown to the approver |
| routingDecision | object | outcome, complexityScore, costCeilingUsd, selectedTier, selectedDeployment, selectedVendor, policySetId, policySetVersion, rationale. Flattened to primitives so the packet stays readable years later without the type that wrote it |
| proposedAction | object | kind, summary, fields |
| unattributableClaims | string[] | Claims that could not be attributed, carried so the approver sees what was **withheld**. Principle III |

The hash is computed over a canonical form derived from the typed packet, never over serialised
bytes. It is therefore stable across JSON round-trips, property reordering, and pretty-printing,
and it moves on any material change. Citation order is not material and does not move it; adding,
removing, or editing a citation does. `EvidencePacketHasher.Canonicalize` is public so an auditor
can reproduce the hash independently rather than taking the system's word for it.

**Legal transitions.** PendingApproval to Approved, Rejected, or Expired. Terminal states are
final. Expiry is legal only at or after `expiresAt`; an expiry job cannot expire a proposal early.
**There is no transition from Expired to Approved** — not a guarded one, not a configurable one.
Expiry is the recorded absence of a decision, and an absence is never upgraded into approval.

Guards on a decision, evaluated in this order, per `contracts/approval-api.md`:

| Guard | Refusal | Status |
|---|---|---|
| The proposal is not already in a terminal state | InvalidTransition | 409 |
| The decision names a deciding identity | ApproverIdentityRequired | 400 |
| `expiresAt` has not passed | Expired | 410 |
| `decidedByObjectId` differs from `proposedByObjectId` | SegregationOfDuties | 409 |
| A rejection carries a reason | ReasonRequired | 400 |
| The stored packet still hashes to `evidencePacketHash` | EvidencePacketMismatch | 409 |

A decision may additionally acknowledge the hash the approver was shown; when supplied it is
verified and a mismatch is refused with EvidencePacketMismatch. The decision request in
`contracts/approval-api.md` does not yet carry that field, so the domain treats it as optional and
never defaults it — defaulting it to the stored hash would fabricate the acknowledgement. T-018
publishes it. See `docs/adr/008-approval-domain-boundaries.md`.

Segregation of duties is enforced in the domain model, not at the API edge, and is re-checked
before execution — the record crosses persistence in between, and the premise of the hash is that
records are not assumed to survive round-trips unaltered. Comparison is case-insensitive after
trimming, so an object ID that differs only in casing is the same identity.

**Execution is not a state of this container.** An approval authorises; it never acts. Execution
is recorded on the lane's own record and in `auditEvents`, correlated by `correlationId`, and
`ExecutionAuthorization` carries `evidencePacketHash` onto that record so the evidence approved and
the evidence executed can be compared. See `docs/adr/008-approval-domain-boundaries.md`.

### surveillanceAlerts

Partition key: /batchId

| Field | Type | Notes |
|---|---|---|
| id | string | |
| batchId | string | Generation batch, seeded |
| alertType | enum | Spoofing, Layering, WashTrade, FrontRunning, MarkingTheClose, InsiderPattern |
| rawSignals | object | Synthetic trade and e-comms evidence |
| riskRank | number | Assigned by triage |
| riskRationale | string | |
| evidenceRefs | array | Pointers to source records |
| triageState | enum | Untriaged, Triaged, EscalationProposed, Escalated, Dismissed |
| correlationId | string | Links to the routing decision |
| syntheticSeed | number | Guarantees reproducibility |

### researchQueries

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | |
| correlationId | string | |
| question | string | |
| claims | array | text, citations, confidence |
| unattributableClaims | array | text and reason; withheld and explicitly reported |
| attributionCoverage | number | 0.0 to 1.0, displayed in the UI |
| retrievedChunks | array | chunkId, documentId, score, excerpt |
| injectionAttempts | array | Logged prompt-injection detections |

### orderProposals

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | |
| correlationId | string | |
| order | object | Synthetic: instrument, side, quantity, constraints |
| proposedVenue | string | |
| projectedCostBps | number | |
| liquidityRationale | string | |
| bestExecJustification | string | |
| policyBreaches | array | policyName and detail; non-empty means halt |
| state | enum | Proposed, Halted, Approved, SimulatedExecuted |
| simulated | boolean | Always true; the UI must render the label |

Execution state lives here, on the lane record, not on the approval — an approval authorises and
is final at the moment it is recorded, while execution has its own outcomes. `SimulatedExecuted`
carries the `evidencePacketHash` of the approval it acted under, so the evidence approved and the
evidence executed can be compared. See `docs/adr/008-approval-domain-boundaries.md`.

### auditEvents

Partition key: /correlationId. Append-only. No update or delete permission is granted to any
service identity.

| Field | Type | Notes |
|---|---|---|
| id | string | |
| correlationId | string | |
| sequence | number | Monotonic within the correlation |
| eventType | enum | See the table below |
| actorObjectId | string | Human or service identity. **Null on ApprovalExpired**, because expiry is the absence of a decision and naming an identity would attribute a record to someone who had nothing to do with it |
| payload | object | Event-specific |
| occurredAt | string | |

**eventType**

| Value | Emitted by | Notes |
|---|---|---|
| AgentAction | Lanes | |
| ModelCall | router-service | |
| RoutingDecision | router-service | |
| Retrieval | Lanes | |
| ApprovalRequested | Approval domain | A proposal was raised and does not execute until approved |
| ApprovalDecided | Approval domain | Carries the approver, the decision, and `evidencePacketHash` |
| ApprovalExpired | Approval domain | No decision was recorded. Carries no actor and no reason |
| ApprovalRefused | Approval domain | A refused attempt — self-approval, late decision, tampered evidence. Written because a blocked attempt is evidence in its own right |
| ExecutionAuthorized | Approval domain | Authorisation issued against an approved proposal. Not execution itself |
| InjectionDetected | Lanes | |
| PolicySetChanged | Policy API (002) | Carries before and after. A governance control whose own changes are unaudited is not a control |
| PolicyEvaluated | router-service (002) | |
| RequestRefusedByPolicy | router-service (002) | A first-class outcome, not an error. A refusal is the system working |

Every approval decision writes its record **before** the API returns, per
`contracts/approval-api.md` invariant 3. The domain returns the audit event alongside the
transition result rather than emitting it as a side effect, so a handler cannot return a decision
it forgot to record.

**Two open points, recorded rather than decided here:**

1. **`PolicyDenial` has been removed from this list and is not replaced by a rename.** It was
   ambiguous in exactly the way this document must not be: read plainly it means "policy denied
   the request", but `Denied` in `routerDecisions` means the **cost ceiling** stopped the request,
   while a governance refusal is `RefusedByPolicy`. Feature 002 introduces `RequestRefusedByPolicy`
   for the governance case. If a distinct audit kind is still wanted for a cost denial it should be
   named for cost, not for policy. **T-019 owns the call.**
2. **This document names the field `eventType`; `specs/002-governed-exchange/data-model.md` calls
   the same field `kind`.** No code implements the container yet, so nothing settles it. T-019
   should pick one and correct the other document rather than shipping both names.


## Quality Signal

The qualitySignal.method field is one of:

- **AttributionCoverage** — research lane; the coverage percentage.
- **RankAgreement** — surveillance lane; agreement with a seeded ground-truth ranking.
- **PolicyConformance** — order routing lane; conformance to encoded best-execution rules.

**Deliberate choice:** no LLM-as-judge for the primary on-screen quality number. A judged score
invites the you-graded-your-own-homework challenge in front of a compliance audience. Every method
above is deterministic and independently checkable. LLM-as-judge may be added as a clearly
labelled secondary metric only. See docs/adr/003-deterministic-quality-signal.md.
