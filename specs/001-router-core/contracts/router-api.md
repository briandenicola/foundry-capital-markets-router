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
  "complexityHints": {
    "inputTokenEstimate": 12000,
    "requiresMultiStep": true,
    "requiresRetrieval": true,
    "requiresToolCalls": false
  }
}
```

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
  }
}
```

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

The caller lacks the Router.Invoke app role.

### Response 503

No tier is available. The response includes the tiers attempted. The router never falls back to an
unrouted direct call.

## GET /v1/decisions/{correlationId}

Returns the full routerDecisions record. Requires the Router.Read app role.

## GET /v1/scoreboard?window=15m

Aggregate for the scoreboard: request count, total cost, baseline cost, savings delta, p50 and p95
latency, tier distribution, and mean quality by lane.
