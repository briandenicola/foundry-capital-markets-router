# Contract findings — Basher, T-015 / T-018 surface

Raised while writing `tests/Fcmr.Contract.Tests` from the published contracts rather than from the
implementations. Every item here is a place where the contract does not say enough for two people
to build the same thing. None has been resolved by picking an interpretation.

**Status after T-018:** the approvals host exists and all 65 contract cases pass. Gaps 1, 2, 3, 5,
6 and 8 are closed. Gap 4 remains open and unowned; Gap 7 is deferred to T-035. The two open items
are left here rather than deleted, because a findings file that only records solved problems stops
being read.

Sources read: `specs/001-router-core/contracts/router-api.md`,
`specs/001-router-core/contracts/approval-api.md`,
`specs/002-governed-exchange/contracts/router-api-policy-extension.md`,
`specs/001-router-core/data-model.md`.

## Gap 1 — the approval contract has no way to create a proposal — CLOSED

`approval-api.md` publishes `GET /v1/approvals`, `GET /v1/approvals/{id}`, and
`POST /v1/approvals/{id}/decision`. Nothing creates the proposal those three operate on.

Consequence: the PendingApproval state is unreachable from the contract, so every rejection path
the compliance audience came to see — 409 SegregationOfDuties, 409 InvalidTransition, 410 Expired —
is unverifiable by anyone who only has the contract. That includes this suite, and it will include
the UI team.

Needed from T-018: either the lane-service endpoint that enqueues a proposal is published as part
of this contract, or an explicit, auth-gated seeding operation is. Owner: Livingston, with Saul on
whether a seeding operation is constitutionally acceptable in a demo build.

**Closed by ADR-011.** `POST /v1/approvals` is published, gated on the `Proposer` app role. The
seeding option was rejected: to be useful it would have to set the proposer identity from its
input, which is the Gap 2 hole wearing a different name.

## Gap 2 — the approval contract never says how the caller becomes `decidedByObjectId` — CLOSED

The segregation-of-duties rule is stated as `decidedByObjectId equals proposedByObjectId → 409`,
but nothing says how the caller's Entra object id reaches that field. Until it does, the single
most load-bearing control in the demo cannot be exercised by a client-side test, because a test
cannot present two distinguishable identities.

`ApprovalContractTests` sends `X-Fcmr-Caller-Object-Id` as a placeholder and says so at the call
site. That header is not a proposal; it is a marker for the decision that has not been made.

**Closed by ADR-011.** Identity comes from the validated token's `oid` claim and is never accepted
from a request. The header was worse than incomplete: a caller supplying the value that
segregation of duties compares can present one id when proposing and another when approving, and
the control returns 200. The suite now issues two principals with different `oid` values.

## Gap 3 — no way to say "routed, decision recorded, model not yet invoked" — CLOSED

`router-api.md`'s 200 example always carries `result` and a full `metrics` block including
`promptTokens` and `actualCostUsd`. Today, correctly, no model is invoked (T-016 outstanding), so
router-service returns `result: null` plus an `inference` object — `{"state":"NotInvoked"}` or
`{"state":"NotReached"}` — that the contract does not mention.

Raised, then closed within the same session: `router-api.md` now documents the `inference` block
and enumerates `NotInvoked` and `NotReached`, and ADR-009 records the reasoning. Recording the gap
anyway, because the resolution is the useful part — ADR-007 forbids fabricating the missing result,
so a truthful response *must* be able to say a model did not run.
`Route_NeverReturnsAResultWithoutAnInvocation` reads `inference.state` and falls back to
"`metrics.promptTokens` is a number" as the invocation signal.

## Gap 4 — `data-model.md` contradicts the policy extension

`routerDecisions.outcome` is documented as `Routed, Downgraded, Denied`. `RefusedByPolicy` is
missing, as are `policySetId`, `policySetVersion`, `dataClassification`, `selectedVendor`, and
`policyExclusions`, all of which the router now persists and returns.

This is the one finding here that could rot silently: a reader of `data-model.md` alone would
conclude a governance refusal is stored as `Denied`, which is exactly the collapse the 002
extension exists to prevent. Owner: whoever holds Feature 002 Slice A documentation.

## Gap 5 — error responses are not required to carry `correlationId` — CLOSED

AC-8 requires one-query reconstruction, and the 402 example does carry `correlationId`. The 403
has no documented body at all, and the 400 and 503 shapes are unspecified.

Closed in the same session: the contract now states that every response on every path, including
400 and 403, carries `correlationId` in the body and in the `X-Correlation-Id` response header, and
adds a status-by-outcome table. Asserted by
`Route_EchoesTheCorrelationId_OnEveryResponseIncludingErrors`,
`Route_CarriesTheCorrelationIdInTheResponseHeaderToo`, and
`Route_WhenRefused_StillEchoesTheCorrelationId`.

Note the table also maps `Denied` to **two** statuses — 402 when nothing is affordable, 503 when
nothing is available — so `Route_StatusIsDeterminedByOutcome` accepts either for `Denied` and
neither for anything else. This is the one place where outcome does not determine status alone, and
it is worth knowing before someone writes a client that assumes it does.

## Gap 6 — `approval-api.md` gives no error body shape — CLOSED

The status table names conditions (`SegregationOfDuties`, `InvalidTransition`, `Expired`) without
saying where they appear on the wire. The tests assume the router's shape — a top-level `error`
string — because it is the only precedent in the repository. If T-018 chooses differently, the
contract, not the test, should decide.

## Gap 7 — 503 is not reachable from a request

`router-api.md` specifies a 503 when no tier is available, "including the tiers attempted". A
contract test cannot make every deployment unavailable, so this path has no coverage here. It is
reachable through catalog configuration (`Router:Catalog[].Available`), which makes it an
integration-test concern (T-035) rather than a contract-test one. Flagging it so nobody assumes
the 503 is covered because the other statuses are.

## Gap 8 — authorisation is off in Development, and a naive test host inherits that

`appsettings.Development.json` sets `Router:Authorization:Enabled: false`, honoured only in the
Development environment. The affordance is well built and well guarded. The trap is for the test
author: `WebApplicationFactory` hosts in Development by default, so a contract suite that does
nothing about it tests an endpoint with the 403 switched off and reports green.

`RouterApiFactory` forces `Router:Authorization:Enabled=true` and supplies principals through a
test authentication scheme, so `Route_WithATokenLackingTheRouterInvokeRole_Returns403` fails if the
role check is removed. Worth knowing for every future test project in this repository.

## Not a contract gap, but raised while gate-keeping

- **`scripts/check-coverage.sh` was understating coverage.** Test projects report the same source
  file under two different roots (`TierSelector.cs` and `Fcmr.Router.Decisions/TierSelector.cs`),
  and the union keyed on the raw filename counted those lines twice — once covered, once not.
  `Fcmr.Router.Decisions` read 77.03% against a true 93.76%. Fixed by stripping the leading
  assembly directory before the union. The gate was never wrong in the unsafe direction, but a
  number drifting toward the threshold for a reason nobody can explain is how a threshold gets
  "adjusted".
- **`Azure.Identity` was pinned at 1.13.2 while `Microsoft.Identity.Web` 4.14.2 requires ≥ 1.17.2.**
  Any project without a direct pin failed to restore (NU1109). Raised centrally to 1.17.2, which is
  a strictly forward move and leaves NuGetAudit enforcing.
