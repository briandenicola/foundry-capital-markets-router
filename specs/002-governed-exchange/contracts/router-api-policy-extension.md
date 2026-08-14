# Contract — Router API, policy extension

Extends `specs/001-router-core/contracts/router-api.md`. Slice A.

## POST /v1/route — additional request fields

```json
{
  "dataClassification": "Internal",
  "policySetId": "CapitalMarkets-US"
}
```

| Field | Required | Notes |
|---|---|---|
| `dataClassification` | Yes | Defaulting this would be unsafe. An omitted classification is a **400**, not an assumption of `Public` |
| `policySetId` | No | Defaults to the policy set for the caller's business unit |

**There is still no model, vendor, or deployment field, and there will not be one.** Principle IV
is enforced by the contract's shape: a field that exists is a field that eventually gets used.

`dataClassification` is a property of the request, not a routing preference. The caller states what
the data *is*; the exchange decides what that permits.

## POST /v1/route — additional response fields

```json
{
  "decision": {
    "policySetId": "CapitalMarkets-US",
    "policySetVersion": 4,
    "selectedVendor": "AzureOpenAI",
    "policyExclusions": [
      {
        "deployment": "claude-sonnet-4-5",
        "vendor": "Anthropic",
        "reason": "Vendor Anthropic is not approved under policy set 'CapitalMarkets-US'."
      }
    ]
  }
}
```

`reason` is prose fit to read aloud to a governance audience. Not an error code, not "policy". The
presenter will read one of these on stage in Beat 5.

## New outcome — RefusedByPolicy

`outcome` gains a value alongside `Routed`, `Downgraded`, and `Denied`:

```json
{
  "decision": {
    "outcome": "RefusedByPolicy",
    "selectedDeployment": null,
    "policyExclusions": [ "...every candidate, each with a reason..." ]
  }
}
```

Returned as **200**, not an error status. A refusal is a correct, governed outcome and callers must
handle it as a normal response. Modelling it as a 4xx would encourage retry-on-error logic, and the
one thing that must never happen is a retry that finds an unapproved model.

`Denied` (cost ceiling, Feature 001) and `RefusedByPolicy` (governance) stay distinct. Collapsing
them would lose the distinction between "too expensive" and "not permitted", which are different
conversations with different people.

## Evaluation order

Policy first, then cost and complexity:

```text
catalog -> PolicyGate.Evaluate() -> eligible -> TierSelector.Select() -> decision
```

Reversing this would let a cost optimisation reach a model governance has not approved. The order
is asserted by test, not left to code reading.
