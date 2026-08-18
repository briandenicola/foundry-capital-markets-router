# ADR-011 — Approval identity comes from the token, never from the request

Status: Accepted
Date: 2026-08-18
Supersedes: nothing
Related: ADR-008 (approval domain boundaries), Principle VII (segregation of duties)

## Context

`tests/Fcmr.Contract.Tests/CONTRACT-FINDINGS.md` raised two blocking gaps against
`specs/001-router-core/contracts/approval-api.md`, written from the contract rather than from the
implementation.

**Gap 1.** The contract publishes `GET /v1/approvals`, `GET /v1/approvals/{id}`, and
`POST /v1/approvals/{id}/decision`, and nothing that creates the proposal those three operate on.
`PendingApproval` is unreachable for anyone holding only the contract. Every refusal path the
compliance audience is being shown — 409 SegregationOfDuties, 409 InvalidTransition, 410 Expired —
is therefore unverifiable by a client, including the contract suite and the UI.

**Gap 2.** The segregation-of-duties rule is stated as `decidedByObjectId equals proposedByObjectId
→ 409`, and the contract never says how the caller's Entra object id reaches that field. The
contract tests send an `X-Fcmr-Caller-Object-Id` header and say at the call site that it is a
placeholder for a decision nobody has made.

The placeholder is not merely incomplete. If a client supplies the identity that the
segregation-of-duties check compares, then a single caller can present one object id when proposing
and a different one when approving, and the control returns 200. Principle VII would hold only for
callers who chose not to defeat it. A control that depends on the good manners of the party it
constrains is decoration, and this one is the most load-bearing claim in the demo.

## Decision

**Identity is taken from the validated Entra token and never from the request body, a header, or a
query parameter.**

Concretely:

- `POST /v1/approvals` is added to the contract. It requires the `Proposer` app role, and
  `proposedByObjectId` is read from the token's `oid` claim.
- `POST /v1/approvals/{id}/decision` requires the `Approver` app role, and `decidedByObjectId` is
  read from the token's `oid` claim.
- Neither field is accepted in a request body. A request that carries one is rejected with 400
  rather than ignored, because silently discarding a field a caller believed was meaningful is how
  a client ends up trusting a control that is not there.
- Segregation of duties compares two values that both originated in tokens the service validated.
  A caller cannot name itself, so the control cannot be defeated by a well-formed request.

`Proposer` and `Approver` are distinct app roles. An identity holding both can still propose and
approve different proposals, which is correct; what it cannot do is decide its own, because the
comparison is on object id and not on role.

## Consequences

### What this buys us

- Segregation of duties is enforced by construction. The 409 cannot be avoided by a client that
  understands the wire format, which is the only version of the control worth demonstrating to a
  compliance audience.
- `PendingApproval` becomes reachable from the contract, so the refusal paths become testable by
  anyone holding it — the contract suite, the UI, and anybody evaluating the demo.
- The proposing lane no longer needs a privileged side channel. It calls a published endpoint with
  its own identity, which is also what makes the audit trail attributable.

### What this costs us

- The contract suite needs two distinguishable principals rather than a header, so
  `ApprovalApiFactory` has to issue test tokens carrying different `oid` values. That is more
  setup than a header, and it is setup that tests the thing being claimed.
- Seeding a proposal for a demo or a test now requires a token with the `Proposer` role. There is
  deliberately no bypass. An auth-gated seeding operation that set `proposedByObjectId` from its
  input would reintroduce exactly the hole this ADR closes.
- Every lane service that proposes needs its own identity and role assignment. That is more
  Terraform, and it is the same work that makes each proposal attributable to one workload.

### What we will have to revisit

If a proposal ever needs to originate from a non-interactive process with no user context — a
scheduled surveillance sweep, say — that process needs its own service principal with the
`Proposer` role, and the object id recorded is the service principal's. The rule does not change;
the identity is still the token's. What needs deciding then is whether a service principal may
propose an action a human must approve, which is a policy question, not a wire-format one.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the `X-Fcmr-Caller-Object-Id` header | The caller names itself, so segregation of duties is unenforceable against anyone who reads the contract. This is the hole the ADR exists to close. |
| Accept `proposedByObjectId` in the POST body, validate it matches the token | Two sources of truth for one fact, and the validation is the only thing standing between the system and the header design. Simpler not to accept it. |
| An auth-gated seeding endpoint for tests and demos only | It would have to set the proposer identity from its input to be useful, which is the header design wearing a different name. Environment-gating it means the demo path and the tested path differ, and the tested one is not the one on stage. |
| Publish only the lane-service propose operation, not a general endpoint | The lanes are unbuilt (T-023 to T-025). The contract suite and the UI would stay blocked on work that is weeks out, and the proposal shape is the same either way. |
