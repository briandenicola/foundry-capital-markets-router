# Squad Decisions

## Active Decisions

### 2026-08-14T16:26:21Z: Team cast for Feature 001 router core

**By:** briandenicola (via Squad Coordinator)

**What:** Hired four differentiated specialists — Rusty (Service & HTTP Engineer), Livingston
(Approval Domain Engineer), Basher (Contract Test & Quality Gate Engineer), and Saul (Governance
Reviewer). Task ownership: T-011 and T-015 to Rusty, T-017 to Livingston, contract and gate testing
to Basher, review of all three to Saul.

**Why:** The work splits along genuine seams. T-011 and T-015 are one coupled HTTP surface; T-017
is independent pure-domain logic that can run in parallel from day one. Testing is a distinct
discipline here because contract tests must derive from `contracts/*.md` rather than from the
implementation, and the 70% coverage gate must stay honest as service code lands around the
decision assembly.

Saul deliberately owns no task. Given a compliance audience whose professional instinct is
detecting controls that are asserted rather than enforced, an independent reviewer checking work
against the constitution's hard rules is load-bearing, not ceremony — and a reviewer who wrote the
code reviews nothing.

**Standing constraints recorded for the team:** the eight hard rules, with explicit note of the
ADR-007 nuance in both directions — a repository port with an in-memory adapter is a legitimate
abstraction and is encouraged (it changes *where real evidence is read from*), while a path that
fabricates model output is a defect (it changes *whether the evidence is real*). Also recorded:
`src/Fcmr.Router.Decisions/` is frozen and proven at 93.8% coverage across 56 tests, entry point
`RoutingPlanner.Plan()`; T-015 wires to it and must not reimplement it.

**Reviewer gate:** on rejection the original author is locked out of the revision; a different
agent revises. Not waived for small fixes or deadline pressure.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
