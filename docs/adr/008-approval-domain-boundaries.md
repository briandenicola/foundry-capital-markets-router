# 008. The approval aggregate authorises; it does not execute

- **Status**: Accepted
- **Date**: 2026-08-14
- **Relates to**: `specs/001-router-core/contracts/approval-api.md`,
  `specs/001-router-core/data-model.md`, Constitution Principle I and Realism Checklist item 6.

## Context

T-017 was briefed with a state machine covering "proposed, approved, rejected, expired,
**executed**". `data-model.md` pins the persisted approval enum at four members —
`PendingApproval, Approved, Rejected, Expired` — and `approval-api.md` names the same four. The
brief and the contract disagree by one state, and the disagreement is not cosmetic: it decides
whether the approvals container is a record of decisions or a record of work.

Two further questions arose while modelling, both of which a compliance audience asks in some
form: what a service is allowed to do with an approval it read back out of Cosmos, and how an
approver's decision is tied to the exact evidence they saw.

## Decision

### 1. `Executed` is not a state of the approval aggregate

`ApprovalState` keeps the four contract members. Execution is modelled separately, by
`ExecutionGate.Authorize`, which returns an `ExecutionAuthorization` — a statement that a specific
approved proposal, with a specific evidence hash, may now be acted on.

Reasons, in descending order of how much the alternative would hurt:

1. **They answer different questions.** An approval answers *did an authorised human, other than
   the proposer, agree to this exact evidence before it acted?* That answer is final the moment it
   is recorded. Execution answers *did the action happen, and how did it go?* — and it has its own
   failure modes: in flight, failed, partially filled, retried. Adding `Executed` invites
   `Executing`, `Failed`, and `Retrying` behind it, and the control we most need to stay simple
   becomes the most complex object in the repository.
2. **A single `Executed` member is actively misleading.** Without `Failed`, an approval that was
   acted on unsuccessfully is indistinguishable from one that was never acted on — both read
   `Approved`. That is a worse audit answer than not modelling execution here at all.
3. **It keeps the demonstrable property clean.** Nothing in `Fcmr.Approvals.Domain` can execute
   anything. The strongest statement the assembly can make is "this is authorised", which is
   exactly the separation Principle I describes: the agent may propose, rank, draft, and evidence
   — it may not commit.

Execution is recorded where it belongs: on the lane's own record and in `auditEvents`, correlated
by `correlationId`, per `data-model.md`. `ExecutionAuthorization` carries the evidence hash onto
that record so the two can be compared afterwards.

**No contract or data-model change is required.** This ADR exists to record that the fifth state
in the task brief was considered and deliberately not built.

### 2. Rehydration is an explicit, validating entry point

`Approval` has no public constructor and no externally usable `with`. It can be created only by
`Approval.Propose` and changed only by `ApprovalStateMachine`. Persistence still has to read
records back, so `Approval.Rehydrate` exists as the single, named door for that — and it refuses
records that contradict themselves (an `Approved` with no approver, an `Expired` naming a decider,
a `Rejected` with no reason).

It deliberately does **not** check segregation of duties or evidence integrity. A stored record
that violates either must remain readable so it can be reported and audited; refusing to load it
would hide the finding. Both are re-verified at `ExecutionGate` instead, which is why that gate
re-runs checks that "already happened" — the record crossed persistence in between, and the whole
premise of the evidence hash is that we do not assume records survive round-trips unaltered.

### 3. The acknowledged evidence hash is optional, and should not stay that way

`ApproveCommand` and `RejectCommand` accept an optional `AcknowledgedEvidencePacketHash`: the hash
the approver was actually looking at, echoed back. When present it is verified, and a mismatch
refuses the decision with `EvidencePacketMismatch` (409).

It is optional because `approval-api.md` defines no such field on
`POST /v1/approvals/{id}/decision`, and the domain does not invent contract fields. Absent means no
claim is made about what the approver saw — weaker, but honest; defaulting it to the stored hash
would fabricate the acknowledgement and make the check meaningless.

**Recommendation for T-018:** add an optional `evidencePacketHash` to the decision request,
populated by the UI from `GET /v1/approvals/{id}`. That closes the gap between "the approver
decided" and "the approver decided *on this evidence*" with one field, and the domain already
enforces it the moment it is supplied.

## Consequences

- The approvals container matches `data-model.md` exactly. No schema deviation, no domain that
  silently disagrees with what is written to Cosmos.
- Whoever performs a consequential action must first hold an `ExecutionAuthorization`. There is no
  path from an `Approval` to an action that does not pass the gate.
- "Was this executed?" is answered from `auditEvents` and the lane record by `correlationId`, not
  from the approval. That is one more join for the T-020 reconstruction endpoint, and it is the
  same join that answers "and what happened when it ran?", which the approval could never answer.
- If a future requirement genuinely needs execution lifecycle state, it belongs in its own
  aggregate with its own states, not as a fifth member here.

## Alternatives considered

- **Add `Executed` as a fifth state.** Rejected for the reasons above. Notably, it also makes the
  terminal-states-are-final rule false: `Approved` would stop being terminal, and that rule is
  currently enforceable and enforced by an exhaustive transition test.
- **Track execution as a boolean on the approval.** Rejected. It is the same conflation with less
  structure, and a boolean cannot express a failed attempt any better than an enum member can.
- **Make the acknowledged hash required.** Rejected today because it would mean the domain
  requires a field the published contract does not carry, which is how a 409 becomes a 500. Revisit
  when T-018 adds the field.
