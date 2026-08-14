# Contract — Approval API

Auth: Entra ID user token. Approval requires the Approver app role.

## GET /v1/approvals?state=PendingApproval

Returns pending proposals with evidence-packet summaries, scoped to the lanes the caller is
entitled to approve.

## GET /v1/approvals/{id}

Returns the full evidence packet: inputs, retrieved sources, routing decision, proposed action, and
the packet hash.

## POST /v1/approvals/{id}/decision

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
| 409 SegregationOfDuties | decidedByObjectId equals proposedByObjectId. Rejected. |
| 409 InvalidTransition | The proposal is already in a terminal state. |
| 410 Expired | The proposal passed expiresAt. It will never execute. |
| 403 | The caller lacks the Approver app role. |

## Invariants

1. No consequential action executes without a 200 from this endpoint.
2. Expiry never implies approval.
3. Every call writes an auditEvents record before returning.
