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

### routerDecisions

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | GUID |
| correlationId | string | Spans the whole request lifecycle |
| lane | enum | Research, Surveillance, OrderRouting |
| taskKind | string | For example synthesize, triage, proposeRoute |
| complexityScore | number | 0.0 to 1.0 |
| complexityInputs | object | Signals and weights that produced the score |
| costCeilingUsd | number | Enforced ceiling for this request |
| candidateTiers | array | Tiers considered, with projected cost |
| selectedTier | enum | Economy, Standard, Premium |
| selectedDeployment | string | Foundry deployment name |
| outcome | enum | Routed, Downgraded, Denied |
| rationale | string | Human-readable, shown in the UI |
| promptTokens | number | From the gateway |
| completionTokens | number | From the gateway |
| actualCostUsd | number | Computed after the call |
| latencyMs | number | End to end |
| qualitySignal | object | method and score |
| baselineCostUsd | number | Cost had Premium been used; powers the savings delta |
| createdAt | string | ISO-8601 UTC |

### approvals

Partition key: /correlationId

| Field | Type | Notes |
|---|---|---|
| id | string | GUID |
| correlationId | string | |
| lane | enum | |
| proposedAction | object | Lane-specific action payload |
| evidencePacket | object | Inputs, retrieved sources, routing decision, proposal |
| evidencePacketHash | string | SHA-256; detects tampering |
| state | enum | PendingApproval, Approved, Rejected, Expired |
| proposedByObjectId | string | Entra object ID of the originating identity |
| decidedByObjectId | string | Null until decided; must differ from the proposer |
| decisionReason | string | Required on rejection |
| expiresAt | string | ISO-8601 UTC |
| createdAt | string | |
| decidedAt | string | |

Legal transitions: PendingApproval to Approved, Rejected, or Expired. Terminal states are final.

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

### auditEvents

Partition key: /correlationId. Append-only. No update or delete permission is granted to any
service identity.

| Field | Type | Notes |
|---|---|---|
| id | string | |
| correlationId | string | |
| sequence | number | Monotonic within the correlation |
| eventType | enum | AgentAction, ModelCall, RoutingDecision, Retrieval, ApprovalRequested, ApprovalDecided, PolicyDenial, InjectionDetected |
| actorObjectId | string | Human or service identity |
| payload | object | Event-specific |
| occurredAt | string | |

## Quality Signal

The qualitySignal.method field is one of:

- **AttributionCoverage** — research lane; the coverage percentage.
- **RankAgreement** — surveillance lane; agreement with a seeded ground-truth ranking.
- **PolicyConformance** — order routing lane; conformance to encoded best-execution rules.

**Deliberate choice:** no LLM-as-judge for the primary on-screen quality number. A judged score
invites the you-graded-your-own-homework challenge in front of a compliance audience. Every method
above is deterministic and independently checkable. LLM-as-judge may be added as a clearly
labelled secondary metric only. See docs/adr/003-deterministic-quality-signal.md.
