# Contract — Policy API

Base: internal Container Apps ingress only. There is no public FQDN.
Auth: Entra ID. Reads require `Router.Read`; **writes require `Approver`.**

Governance changes are an approver action. If the role that invokes models could also change which
models are approved, the control would be circular.

## GET /v1/policy-sets

Returns policy sets visible to the caller's business unit.

### Response 200

```json
{
  "policySets": [
    {
      "id": "CapitalMarkets-US",
      "businessUnit": "CapitalMarkets",
      "displayName": "Capital Markets — US",
      "approvedVendors": ["AzureOpenAI", "Anthropic", "XAI", "OpenWeight"],
      "maxClassification": {
        "AzureOpenAI": "Confidential",
        "Anthropic": "Internal",
        "XAI": "Internal",
        "OpenWeight": "Restricted"
      },
      "allowedRegions": ["eastus2"],
      "maxCostPerRequestUsd": 0.5,
      "version": 3,
      "updatedBy": "8f1c...",
      "updatedAt": "2026-09-10T14:02:11Z"
    }
  ]
}
```

## GET /v1/policy-sets/{id}

Single policy set. 404 if not visible to the caller's business unit.

## PATCH /v1/policy-sets/{id}

The stage action. Partial update; only supplied fields change.

### Request

```json
{
  "approvedVendors": ["AzureOpenAI", "XAI", "OpenWeight"],
  "expectedVersion": 3
}
```

`expectedVersion` is required. A mismatch returns **409 Conflict**. Two approvers editing
concurrently must not silently overwrite one another — least of all in a governance control.

### Response 200

```json
{
  "id": "CapitalMarkets-US",
  "version": 4,
  "changed": {
    "approvedVendors": {
      "from": ["AzureOpenAI", "Anthropic", "XAI", "OpenWeight"],
      "to": ["AzureOpenAI", "XAI", "OpenWeight"]
    }
  },
  "effectiveFrom": "2026-09-10T14:05:03Z"
}
```

`changed` is a before-and-after diff, returned so the UI can show precisely what the approver did
without a second fetch. It is the same payload written to the audit event.

### Errors

| Status | When |
|---|---|
| 400 | Unknown vendor, unknown classification, or `maxClassification` naming a vendor not in `approvedVendors` |
| 403 | Caller lacks `Approver` |
| 409 | `expectedVersion` mismatch |
| 422 | The change would leave no vendor able to serve `Restricted`, when the set is marked as permitting Restricted data |

422 is deliberate. Silently creating a policy set that refuses every restricted request is a
configuration accident that would surface as a demo failure.

## GET /v1/policy-sets/{id}/history

Change feed projection. Returns the last N versions with `updatedBy`, `updatedAt`, and the diff.

Backs the audit claim: the control's own changes are auditable.

## Freshness contract

A successful `PATCH` is visible to routing **within 5 seconds**, matching the AC-5 scoreboard
budget. Beat 5 depends on this: the presenter changes policy and resubmits immediately.

In-flight requests are unaffected — they complete under the policy version pinned at decision time.
