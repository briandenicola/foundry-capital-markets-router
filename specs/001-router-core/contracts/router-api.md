# Contract — Router API

Base: internal Container Apps ingress only. There is no public FQDN.
Auth: Entra ID. The caller must present a managed-identity token carrying the Router.Invoke app
role.

## POST /v1/route

The sole entry point for model access. Direct model endpoint calls from other services are blocked
at the network layer.

### Request

```json
{
  "correlationId": "b6b1f0a2-0000-0000-0000-000000000000",
  "lane": "Research",
  "taskKind": "synthesize",
  "payload": { "question": "..." },
  "costCeilingUsd": 0.25,
  "latencyBudgetMs": 8000,
  "dataClassification": "Internal",
  "executionRegion": "eastus2",
  "complexityHints": {
    "inputTokenEstimate": 12000,
    "requiresMultiStep": true,
    "requiresRetrieval": true,
    "requiresToolCalls": false
  }
}
```

`lane`, `taskKind`, `costCeilingUsd`, `dataClassification`, and `complexityHints` are required.
`correlationId`, `payload`, `latencyBudgetMs`, and `executionRegion` are optional.

`dataClassification` is one of `Public`, `Internal`, `Confidential`, `Restricted`. It is **never
defaulted** — omission is a 400. Defaulting an omitted classification is how Restricted data
reaches a vendor governance never cleared for it. See ADR-009.

There is no model, vendor, deployment, or tier field, and there will not be one. `payload` is
opaque to the router and is screened for keys that would amount to the caller choosing its own
model; such a request is refused with a 400. Principle IV.

If `correlationId` is supplied in both the body and the `X-Correlation-Id` header, the two must
agree. A conflict is a 400 rather than a precedence rule, because splitting one interaction across
two ids breaks the single-query audit reconstruction in AC-8.

### Response 200

```json
{
  "correlationId": "b6b1f0a2-0000-0000-0000-000000000000",
  "decision": {
    "complexityScore": 0.72,
    "selectedTier": "Standard",
    "selectedDeployment": "gpt-5.4",
    "candidateTiers": [
      {
        "tier": "Economy",
        "deployment": "gpt-5.4-mini",
        "projectedCostUsd": 0.004,
        "rejectedReason": "Below complexity threshold for multi-step retrieval synthesis"
      },
      {
        "tier": "Standard",
        "deployment": "gpt-5.4",
        "projectedCostUsd": 0.031,
        "selected": true
      },
      {
        "tier": "Premium",
        "deployment": "gpt-5.6-sol",
        "projectedCostUsd": 0.180,
        "rejectedReason": "Exceeds cost ceiling headroom with no measured quality gain for this task kind"
      }
    ],
    "outcome": "Routed",
    "rationale": "Complexity 0.72 from multi-step plus retrieval clears Standard. Premium projected 0.180 USD exceeds the 0.25 USD ceiling headroom without measured quality benefit."
  },
  "result": { "note": "lane-specific payload" },
  "metrics": {
    "promptTokens": 11840,
    "completionTokens": 902,
    "actualCostUsd": 0.029,
    "latencyMs": 4310,
    "baselineCostUsd": 0.180,
    "qualitySignal": { "method": "AttributionCoverage", "score": 0.94 }
  },
  "inference": {
    "state": "Invoked",
    "detail": "..."
  }
}
```

Every 200 carries an `inference` object stating whether a model actually ran. `result` is null and
the model-derived fields of `metrics` are null whenever none did. A null states that a number was
not measured; it is never a placeholder, and a plausible-looking figure is never emitted in place
of one. See ADR-007 and ADR-009.

`state` is one of:

| State | Meaning |
|---|---|
| `NotInvoked` | The decision was made and recorded; no model call was attempted. |
| `NotReached` | Governance policy ended the request before a model call could be attempted. |

`RefusedByPolicy` is a **200** outcome, not an error. Governance refusing a request is a
successful, governed answer, and carrying it on an error status would invite retry-on-error — the
one retry that must never succeed is the one that finds a model governance has not approved. It is
deliberately distinct from `Denied`, which is a 402: "too expensive" and "not permitted" are
different conversations with different people.

### Response 402 — cost ceiling denial

```json
{
  "correlationId": "b6b1f0a2-0000-0000-0000-000000000000",
  "error": "CostCeilingExceeded",
  "message": "Cheapest viable tier projects 0.31 USD against a ceiling of 0.25 USD.",
  "decision": { "outcome": "Denied", "rationale": "..." }
}
```

A denial is never silently absorbed. It is always surfaced to the UI.

### Response 403

The caller lacks the Router.Invoke app role. A missing token and a token without the role both
answer 403: the contract names one status for "not permitted to invoke", and distinguishing the two
for an unauthenticated caller helps nobody except someone probing for the difference.

### Response 503

No tier is available. The response includes the tiers attempted. The router never falls back to an
unrouted direct call.

Also returned when the governing policy set cannot be resolved. Routing without a policy set means
routing ungoverned, which is worse than not routing at all.

### Status code by outcome

| `decision.outcome` | Status | Error code |
|---|---|---|
| `Routed` | 200 | — |
| `Downgraded` | 200 | — |
| `RefusedByPolicy` | 200 | — |
| `Denied`, nothing affordable | 402 | `CostCeilingExceeded` |
| `Denied`, no permitted model available | 503 | `NoTierAvailable` |

Every response on every path, including 400 and 403, carries `correlationId` in the body and in the
`X-Correlation-Id` response header.

## GET /v1/decisions/{correlationId}

Returns the full routerDecisions record. Requires the Router.Read app role.

## GET /v1/scoreboard?window=15m

Aggregate for the scoreboard: request count, total cost, baseline cost, savings delta, p50 and p95
latency, tier distribution, and mean quality by lane.
