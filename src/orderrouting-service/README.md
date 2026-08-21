# orderrouting-service

Order route proposals against a simulated OMS, with best-execution policy boundaries.

Built by **T-026**. See `specs/001-router-core/spec.md` AC-7.

## Status

The **decision logic is built and tested**; the service host is not.

| Piece | State |
|---|---|
| Best-execution cost model and venue ranking | Built — `src/Fcmr.OrderRouting.Domain`, 41 tests, 100% line covered |
| Policy boundaries and named-breach halting | Built — six boundary types |
| Simulated OMS and the approval refusal ladder | Built — execution is unreachable without a valid approval |
| Service host and HTTP surface | Built — `POST /v1/route-proposals`, `GET /v1/route-proposals/{id}`, `POST /v1/executions` |
| Replay protection on an approval | Built — a second execution of one proposal answers 409 |
| Durable proposal store | Not built — in-memory today; Cosmos-backed alongside T-014a |
| Hosted Foundry agent (T-027e) | Not built |

The deterministic core lives in `Fcmr.OrderRouting.Domain` for the same reason
`Fcmr.Router.Decisions` and `Fcmr.Research.Domain` do: a routing decision shown to a trading
audience must be reproducible and explainable with no model, no venue feed, and no network. It is
coverage-gated at 70% alongside the other two.

## Simulated, and labelled as such

The OMS is simulated. Every surface that shows an execution must render the simulated label. Do
not describe it any other way, in the UI, in a log line, or on stage.

`SimulatedExecution.ExecutionMode` is a computed property that always returns `"SIMULATED"` and has
no setter, so the label travels with the record through `with` expressions and serialisation. It is
deliberately on the row rather than on the type: T-034 needs every rendered execution to carry it,
and a type-level marker is lost the moment a row is projected into a view model.

## The rule this service exists to enforce

A proposal that breaches a policy boundary halts and **names the breached policy explicitly**.
"Blocked by policy" is not sufficient; the audience will ask which one, and the answer needs to be
already on screen.

Every `PolicyBreach` carries the boundary, what was permitted, and what was observed. The
`Explanation` string is built from those three, so the named reason and the underlying numbers
cannot drift apart.

An **order-level** breach — notional ceiling, unpriced order — halts on its own without listing
venue-level breaches. Showing an audience nine venue rejections when the real cause is that the
order is too large obscures the answer rather than evidencing it.

## The cost model

`TotalCostBps = SpreadCostBps + ImpactBps + FeeBps`, and the venue with the lowest total wins, tie
broken on venue code so the ranking is reproducible regardless of the order quotes arrive in.

The model is deliberately crude, because it has to be explainable in one sentence to a room that
knows more about execution than the presenter does:

- **Spread cost** is half the quoted spread in basis points. Dark venues execute at the midpoint,
  so their spread cost is zero — this is *why* they win on cost, and *why* the block-size floor
  exists to stop everything routing there.
- **Impact** is linear in participation rate, capped at 100% participation. Real impact is not
  linear; a square-root model would be more defensible and less explainable.
- **Fees** are per-venue and may be **negative** where a venue rebates. A negative total cost is
  reported honestly as price improvement rather than clamped to zero.

The projected cost in dollars is implementation shortfall against the arrival midpoint, which is
the benchmark a best-execution committee would actually ask about.

## What this proves, and what it does not

It proves the **route selection is reproducible and attributable**: the same order against the same
quotes yields the same venue, the same ranking, and the same justification string, on any machine
in any locale — asserted directly in `CultureIndependenceTests`, which was written after a
current-culture formatting bug made the output machine-dependent.

It does **not** prove the route is genuinely best execution. The cost model is a demonstration
model over synthetic quotes; venue behaviour, queue position, adverse selection, and information
leakage are all absent. No number this service produces should be read as a real TCA result.

## Principle I is enforced here, not asserted

`SimulatedOms.Execute` refuses in a deliberate order — unknown proposal, correlation mismatch,
**expiry, then segregation of duties**. Expiry is checked before the approver identity because a
lapsed approval is not a valid approval whose approver is then scrutinised; treating it as one
invites the argument that a stale approval is repairable by finding a better approver.

There is no code path from a proposal to an execution that does not pass an
`ExecutionAuthorization` carrying an approval. Expiry is not approval, and the identity that
proposed cannot be the identity that approved.
