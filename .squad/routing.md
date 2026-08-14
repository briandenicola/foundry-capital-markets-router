# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| `router-service` HTTP surface | Rusty | T-011 skeleton, health endpoint, correlation-ID middleware, App Insights wiring, T-015 `POST /v1/route`, DTOs, DI composition, persistence **port** definition |
| Approval domain | Livingston | T-017 domain model, state machine, transition table, segregation-of-duties invariant, evidence-packet canonicalisation and SHA-256 hashing |
| Contract tests, coverage, CI gates | Basher | Contract tests from `contracts/*.md`, negative-path tests (402/403/409/410), 70% coverage gate, `task lint` / `task test`, `scripts/policy-no-simulated-reasoning.sh` health |
| Constitution compliance, ADRs, review gate | Saul | Reviewing T-011/T-015/T-017, hard-rule violations, ADR authorship, adjudicating ambiguous contracts, scope-versus-principle calls |
| Session logging | Scribe | Automatic — never needs routing |
| Backlog and work queue | Ralph | Issue triage, PR state, keeping the pipeline moving |

## Ownership Boundaries

Deliberately disjoint — these four do not overlap:

- **Rusty writes HTTP.** He does not write routing decision logic. `src/Fcmr.Router.Decisions/` is
  built, proven at 93.8% coverage across 56 tests, and frozen. `RoutingPlanner.Plan()` is the entry
  point. T-015 wires HTTP to it; it does not reimplement it. If decision logic appears in
  `router-service`, that is a routing error — escalate to Saul.
- **Livingston writes pure domain.** No ASP.NET, no Cosmos, no Azure SDK, no ambient clock. The
  Approval **API** (T-018) is not his; the model underneath it is.
- **Basher writes tests, never production code.** Tests derive from the contract, not from the
  implementation.
- **Saul writes no implementation at all.** He reviews all three tasks. That independence is the
  whole reason he is on the roster.

## Reviewer Gate

Saul is the reviewer for T-011, T-015, and T-017.

- On **rejection**, the original author is locked out of the revision. Saul names a different agent
  or requests a specialist; the Coordinator enforces this and does not waive it because the fix
  looks small.
- Saul rejects with a principle, a location, and what would satisfy him — never "this feels risky."
- Deadline pressure is not grounds to bypass the gate. Cut scope instead of softening a control.

## Escalation Signals

Route to Saul immediately, before code is written, when any of these appear:

- A fallback, mock, fixture, or replay in a path that could render as agent output (ADR-007).
- A model, vendor, or deployment named outside `router-service`.
- A connection string, key, SAS token, or shared secret.
- `public_network_access_enabled = true`, or any public data-plane surface.
- Anything that would let a proposal execute without a recorded approval, or let expiry imply one.
- A proposer identity that could also approve.
- A proposed change to a CI gate threshold or a policy script.

Note the ADR-007 nuance both ways: a repository **port with an in-memory adapter** is a legitimate
abstraction and is encouraged — it changes *where real evidence is read from*. A path that
fabricates model output is a defect — it changes *whether the evidence is real*. Do not flag the
former; never allow the latter.

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Saul |
| `squad:rusty` | router-service HTTP work | Rusty |
| `squad:livingston` | Approval domain work | Livingston |
| `squad:basher` | Tests, coverage, CI gates | Basher |
| `squad:saul` | Review, ADRs, compliance | Saul |

Saul holds triage because triage is a routing judgement against the constitution, which is his
domain anyway.

## Rules

1. **T-011 and T-015 are coupled** — same surface, same owner, sequenced not parallel. T-011 lands
   the skeleton; T-015 builds on it.
2. **T-017 is independent** — pure domain, no dependency on the HTTP work. Livingston runs in
   parallel with Rusty from day one.
3. **Basher starts early.** Contract tests derive from `contracts/router-api.md`, which already
   exists. He does not wait for Rusty's implementation — waiting is how tests end up describing the
   code instead of the contract.
4. **Saul reviews last, but reads first.** Bring him in before implementation on anything touching
   an escalation signal; a defect caught in design costs nothing.
5. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
6. **Quick facts → coordinator answers directly.** Don't spawn for "what's the coverage threshold?"
7. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
8. **The constitution is the tiebreaker.** When a spec, a convention, or a preference points a
   different way, the constitution wins. Name the principle.
