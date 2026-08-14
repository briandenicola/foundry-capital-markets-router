# 009. The route response states whether a model ran, and requires a data classification

- **Status**: Accepted
- **Date**: 2026-08-14
- **Relates to**: ADR-007 (no simulated agent reasoning), Principle III, Principle IV, Principle VI
- **Amends**: `specs/001-router-core/contracts/router-api.md`

## Context

T-015 implements `POST /v1/route` as translation between HTTP and `RoutingPlanner.Plan()`. Two
gaps between the published contract and what the router must actually be able to say showed up
while wiring it, and both are the kind that get resolved by assumption if they are not written
down.

### Gap 1 — the 200 example always carries a result

The contract's 200 response carries `result` and a `metrics` block with `promptTokens`,
`completionTokens`, and `actualCostUsd`. Every one of those requires a model to have run.

T-015 makes and records the routing decision; model invocation through the AI gateway is later
work. The contract offers no way to say "routed, decision recorded, no model invoked". That leaves
three options, two of which are defects:

- Emit plausible values. This is exactly what ADR-007 forbids — it changes whether the evidence is
  real, and a fabricated token count on the scoreboard is indistinguishable from a measured one.
- Emit `result: null` and say nothing else. Better, but it leaves the reader to infer the absence.
  A screen showing a complete decision next to a silent null implies an invocation occurred.
- Say so.

The demo's audience reads a screen and asks "did that actually happen?". The response should
answer that question rather than leave it to be inferred from a missing field.

### Gap 2 — the request example omits `dataClassification`

`RoutingRequest.DataClassification` in the frozen decisions assembly is `required` and carries an
explicit note that omission must be a 400 rather than a default. The contract's request example
does not show the field at all.

Following the example literally would mean defaulting it, and the only defensible default is
`Public`. That is the precise mechanism by which Restricted data reaches a vendor governance never
cleared for it, and `PolicyGate` cannot catch it because the gate is being told the wrong thing.

## Decision

**The contract is amended in five places, and the constitution is the tiebreaker for each.**

The first two are the gaps described above. The remaining three surfaced while implementing and
are recorded here rather than only in the contract file, because a client author needs somewhere
that explains *why* — particularly for amendment 5, which is the one place in the API where
`decision.outcome` does not by itself determine the status code.

1. **`dataClassification` is a required request field.** Omission is a `400`, never an assumption.
   Permitted values are `Public`, `Internal`, `Confidential`, `Restricted`.

2. **The 200 response carries an `inference` object** stating whether a model ran:

   ```json
   "inference": {
     "state": "NotInvoked",
     "detail": "The routing decision is live and recorded. Model invocation through the AI gateway is not yet wired, and no result has been produced for this request."
   }
   ```

   `state` is `NotInvoked` when no call was attempted, and `NotReached` when policy or the cost
   ceiling ended the request before one could be. `result` is `null` and the model-derived fields
   of `metrics` are `null` whenever no model ran. A null states that a number was not measured; it
   is never a placeholder.

   Future states denoting a real invocation are added when invocation lands. Until then, no value
   of this field claims one.

3. **`executionRegion` is an optional request field.** `PolicyGate` already evaluates region
   restrictions and `RoutingRequest.ExecutionRegion` already exists; without a way to carry it,
   region policy would be unreachable from the API and a governance control would exist only in
   tests. Omitted means unconstrained, which is what the gate already does with a null.

4. **A `correlationId` supplied in both the body and the `X-Correlation-Id` header must agree.**
   A conflict is a `400`, not a precedence rule. Silently picking one splits a single interaction
   across two ids, and Principle VI requires the whole interaction to be reconstructable in one
   query — a precedence rule would satisfy the letter of the field while breaking the thing the
   field exists for. When only the body carries one, it is adopted and echoed on the response
   header.

5. **`Denied` maps to two different status codes**, and this is the one case where `outcome` does
   not determine the status:

   | `decision.outcome` | Status | Error code |
   |---|---|---|
   | `Routed` | 200 | — |
   | `Downgraded` | 200 | — |
   | `RefusedByPolicy` | 200 | — |
   | `Denied`, nothing affordable | 402 | `CostCeilingExceeded` |
   | `Denied`, no permitted model available | 503 | `NoTierAvailable` |

   The contract already specified both a 402 for cost denial and a 503 for "no tier is available",
   but `TierSelector` returns `Denied` for both conditions, so the decision record alone cannot
   distinguish them. The service resolves it from two facts it already owns — the catalog it
   supplied and the exclusions the gate recorded — and never re-derives a decision. Clients must
   therefore branch on status first and read `outcome` second.

   `RefusedByPolicy` at 200 is not an amendment; it is the enum's documented intent, restated
   here because it is the distinction most likely to be flattened by a client author.

Two supporting rules follow from Principle IV and are enforced at the edge rather than assumed:

- The request DTO has no model, vendor, deployment, or tier field, mirroring `RoutingRequest`.
- The opaque lane `payload` is screened for keys that would amount to the caller choosing its own
  model. Matching is by **substring on a normalised key**, so `model-name`, `model.name`,
  `targetDeployment` and `azureOpenAIDeployment` are caught alongside `model`; a short explicit
  allow-list keeps `modelling` and `modeling` legal. A payload nested deeper than the screen
  descends is **refused with a 400**, never passed unscreened — a control that gives up quietly is
  worse than one that is absent, because the 200 that follows reads as clearance.

## Consequences

- The UI can render "decision made, no model ran" as a first-class state rather than guessing from
  a null, which is the same load-bearing honesty ADR-007 keeps in the `degraded` states.
- A caller that forgets `dataClassification` gets a clear 400 instead of silently routing its
  Confidential request as Public.
- Adding `inference` is additive; existing consumers reading `decision` are unaffected.
- The payload screen will occasionally reject an innocent field whose name contains `tier` or
  `provider`. That is the correct trade: the cost is a clear error message, and the alternative is
  a hole in the one principle the whole demo rests on. The allow-list is deliberately short —
  growing it on request is how a substring screen becomes an equality screen one exception at a
  time.
- A lane that legitimately needs payloads nested more than eight levels deep must flatten them.
  No lane produces such a shape today.
- Clients branch on status code first and `outcome` second, because of amendment 5.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Emit zeros or estimates for token and cost metrics until invocation lands | Forbidden by ADR-007. A plausible number is worse than an absent one, because it will be believed. |
| Give `Denied`-no-tier-available its own `RoutingOutcome` member | Would require editing the frozen, coverage-gated decisions assembly for a transport concern. The distinction is resolvable from facts the service already holds. Revisit if a second consumer needs it. |
| Resolve the body/header `correlationId` conflict by precedence | Satisfies the field and breaks what the field is for. Two ids for one interaction defeats AC-8. |
| Omit `result` and `metrics` entirely on a non-invoked response | Silence is still an inference the reader has to make, and it makes the response shape vary in a way clients must special-case. |
| Default an omitted `dataClassification` to `Public` | The exact failure Principle IV and the decisions assembly's own comments exist to prevent. |
| Default it to `Restricted` instead, failing closed | Safer, but it teaches callers that the field is optional, and the one that matters is the one they meant to send and did not. |
