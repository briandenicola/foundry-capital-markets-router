# Data Model — Feature 002

Extends `specs/001-router-core/data-model.md`. Same source-of-truth rule: Cosmos is authoritative,
Application Insights is derived and may be sampled.

## Containers

### policySets

Partition key: `/businessUnit`. The governance object the demo mutates on stage.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Policy set identifier, e.g. `CapitalMarkets-US` |
| `businessUnit` | string | Partition key. Governance is scoped per business unit |
| `displayName` | string | Shown in the policy screen |
| `approvedVendors` | string[] | `AzureOpenAI`, `Anthropic`, `XAI`, `OpenWeight` |
| `maxClassification` | map<string,string> | Vendor to maximum permitted classification |
| `allowedRegions` | string[] | Empty means unrestricted |
| `maxCostPerRequestUsd` | number | Policy ceiling, applied before any per-request ceiling |
| `version` | number | Incremented on write |
| `updatedBy` | string | Entra object id of the approver who changed it |
| `updatedAt` | string | ISO 8601 |
| `_ts` | number | Cosmos timestamp; drives the change feed |

**Seeded from Terraform, written through the API.** The deploy-time baseline is a
Terraform-managed JSON document; runtime writes exist for the demo and for break-glass. Nothing
writes to this container directly.

**Change feed is the audit trail.** Every write produces an `auditEvent` of kind
`PolicySetChanged` carrying the before and after. A governance control whose own changes are
unaudited is not a control.

### routerDecisions — extended

Feature 001 fields are unchanged. Slice A adds:

| Field | Type | Notes |
|---|---|---|
| `policySetId` | string | Which policy set governed this decision |
| `policySetVersion` | number | Pinned at decision time, so a later edit cannot rewrite history |
| `dataClassification` | string | `Public`, `Internal`, `Confidential`, `Restricted` |
| `selectedVendor` | string | Vendor of the selected model |
| `policyExclusions` | object[] | `{ deployment, vendor, reason }` per excluded candidate |

`policySetVersion` matters more than it looks. Without it, replaying an audit record after a policy
edit would show a decision that appears to violate the policy in force — which is exactly the
finding an auditor would escalate.

`policyExclusions` is persisted, not merely computed for the response. The question "why was this
model not used?" is asked long after the request completes.

### auditEvents — extended

New `kind` values: `PolicySetChanged`, `PolicyEvaluated`, `RequestRefusedByPolicy`.

`RequestRefusedByPolicy` is a first-class outcome, not an error. A refusal is the system working.

## Enumerations

`DataClassification` is ordered, and the ordering is the comparison used by the gate:

```text
Public (0) < Internal (1) < Confidential (2) < Restricted (3)
```

A vendor's `maxClassification` is the highest it may process. `request > vendor maximum` excludes
the vendor. Adding a level later means inserting into this ordering — do not renumber; append.

## Slice B additions (deferred)

Recorded for completeness; not built for 9/10.

### executionPlans

| Field | Type | Notes |
|---|---|---|
| `id` | string | Plan identifier |
| `correlationId` | string | Partition key |
| `intent` | string | Classified intent of the business request |
| `tasks` | object[] | `{ taskId, description, complexity, selectedVendor, selectedDeployment, status }` |
| `status` | string | `Planned`, `Executing`, `Completed`, `PartiallyFailed` |

`PartiallyFailed` exists because a task with no eligible model must fail that task explicitly
rather than failing the whole request silently.
