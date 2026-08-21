# Contract — Approval API

Auth: Entra ID user token.

## Identity

`proposedByObjectId` and `decidedByObjectId` are read from the `oid` claim of the validated token.
Neither is accepted in a request body, a header, or a query parameter, and a request that supplies
one is rejected with 400.

Segregation of duties therefore compares two values that both originated in tokens this service
validated. A caller cannot name itself. See `docs/adr/011-approval-identity-from-token.md`.

| Operation | Required app role |
|---|---|
| `POST /v1/approvals` | `Proposer` |
| `GET /v1/approvals` | `Approver` |
| `GET /v1/approvals/{id}` | `Approver` |
| `POST /v1/approvals/{id}/decision` | `Approver` |

An identity holding both roles may propose and approve different proposals. It may never decide its
own, because the check is on object id, not on role.

## Error body

Every non-2xx response carries this shape, on every path, including 400 and 403:

```json
{
  "error": "SegregationOfDuties",
  "detail": "The approving identity proposed this action. Segregation of duties is enforced at the transition.",
  "correlationId": "b3f1c2d4-5e6a-7b8c-9d0e-1f2a3b4c5d6e"
}
```

`error` is the stable machine-readable condition named in the status tables below. `detail` is
prose and may change. `correlationId` is also returned in the `X-Correlation-Id` response header,
per AC-8 one-query reconstruction.

## POST /v1/approvals

Creates a proposal in `PendingApproval`. Requires the `Proposer` app role.

### Request

```json
{
  "lane": "OrderRouting",
  "evidencePacket": { "correlationId": "b3f1c2d4-5e6a-7b8c-9d0e-1f2a3b4c5d6e", "...": "..." },
  "expiresAt": "2026-09-10T14:30:00Z"
}
```

The evidence packet must be supplied by the lane that assembled it. There is no overload that
fabricates, defaults, or accepts a null packet — evidence that does not exist is reported as
missing, never manufactured to make a record well-formed. See ADR-007 and Principle III.

### Responses

| Status | Condition |
|---|---|
| 201 | Proposal created. Returns the approval, including its id and evidence-packet hash. |
| 400 CorrelationIdRequired | The evidence packet carries no `correlationId`. The audit trail is keyed by it. |
| 400 EvidenceRequired | No evidence packet was supplied. |
| 400 ExpiryRequired | `expiresAt` is absent or is not in the future. |
| 400 IdentityNotAccepted | The request supplied `proposedByObjectId`. Identity comes from the token. |
| 403 | The caller lacks the `Proposer` app role. |

## GET /v1/approvals?state=PendingApproval

Returns pending proposals with evidence-packet summaries, scoped to the lanes the caller is
entitled to approve. Requires the `Approver` app role.

The response is a bare JSON array, not an envelope. Each row carries `proposedAction` — the queue
has to say what it is asking someone to authorise — and a null `evidencePacket`: the full packet
belongs on the detail response, because a packet delivered in bulk to a list nobody opened is not
a packet anyone reviewed.

## GET /v1/approvals/{id}

Returns the full evidence packet: inputs, retrieved sources, routing decision, proposed action, and
the packet hash. Requires the `Approver` app role.

| Status | Condition |
|---|---|
| 200 | Returned. |
| 403 | The caller lacks the `Approver` app role. |
| 404 | No proposal with that id. |

## POST /v1/approvals/{id}/decision

Requires the `Approver` app role.

### Request

```json
{
  "decision": "Approved",
  "reason": "Best-execution rationale is sound; venue confirmed."
}
```

The reason field is required when the decision is Rejected.

### Responses

| Status | Condition |
|---|---|
| 200 | Decision recorded. Execution proceeds when the decision is Approved. |
| 400 ReasonRequired | The decision is Rejected and no reason was supplied. |
| 400 IdentityNotAccepted | The request supplied `decidedByObjectId`. Identity comes from the token. |
| 409 SegregationOfDuties | decidedByObjectId equals proposedByObjectId. Rejected. |
| 409 InvalidTransition | The proposal is already in a terminal state. |
| 410 Expired | The proposal passed expiresAt. It will never execute. |
| 403 | The caller lacks the Approver app role. |
| 404 | No proposal with that id. |

## Invariants

1. No consequential action executes without a 200 from this endpoint.
2. Expiry never implies approval.
3. Every call writes an auditEvents record before returning.
4. No identity used in an authorisation or segregation-of-duties decision originates in a request.
